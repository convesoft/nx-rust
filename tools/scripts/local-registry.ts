/**
 * Runs the local registry that the end-to-end tests install the plugin from.
 *
 * It takes the place of `startLocalRegistry` from
 * `@nx/js/plugins/jest/local-registry`, which waits forever when `nx run`
 * starts no registry, whose stop function does not wait for the registry to
 * stop, and which uses whatever server answers on the port the registry chose.
 *
 * The `@nx/js:verdaccio` executor takes the first port from its `port` option
 * that is free when it looks, and verdaccio prints its address before it
 * listens. Two end-to-end runs in different checkouts that start their
 * registries at the same moment can therefore both take one port: one
 * verdaccio fails to listen, and its run would publish to and install from the
 * other run's registry. So before it uses a registry, the setup asks it for a
 * file that it has just put in the registry's own storage, which no other
 * registry can serve, and starts again from the next port when another server
 * answers instead.
 */

import { workspaceRoot } from "@nx/devkit";
import { type ChildProcess, execFileSync, fork } from "child_process";
import { randomBytes } from "crypto";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { get } from "http";
import { join, resolve } from "path";

/** How long `nx run` may take to print the address of the registry. */
const startTimeoutMs = 2 * 60 * 1000;
/** How long the registry may take to answer once it printed its address. */
const answerTimeoutMs = 30 * 1000;
/** How long one request to the registry may take. */
const requestTimeoutMs = 5 * 1000;
/** How long to wait between requests while nothing answers on the port. */
const retryDelayMs = 200;
/** How often to start again on another port before giving up. */
const maxAttempts = 5;
/** How long the registry may take to stop before the tests stop waiting. */
const stopTimeoutMs = 30 * 1000;
const listenAddress = "localhost";
/** Verdaccio lets anyone publish; npm and pnpm only need some token. */
const authToken = "secretVerdaccioToken";
/**
 * The package whose files the setup puts in the storage to recognise its own
 * registry. `.verdaccio/config.yml` gives it no uplink, so that a registry
 * that lacks the file says so at once instead of asking npmjs.org.
 */
const probePackage = "nx-rust-e2e-registry-probe";

/**
 * Starts the registry with `nx run <target>`, makes sure that the server on
 * its port is this registry, and points npm and pnpm at it.
 *
 * `storage` is the registry's storage folder, absolute or relative to the
 * workspace root. `firstPort`, when given, replaces the target's `port`
 * option as the first port to try. When the registry cannot start, this stops
 * what it started and rejects with an error that says why. Otherwise it
 * resolves to a function that stops the registry and resolves once the
 * registry has exited.
 */
export async function startLocalRegistry(
  target: string,
  storage: string,
  firstPort?: number,
): Promise<() => Promise<void>> {
  const storagePath = resolve(workspaceRoot, storage);
  const lostPorts: number[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { run, port } = await runRegistry(target, storagePath, firstPort);
    const answer = await askRegistry(run, port, storagePath).catch(async (error) => {
      await run.stop();
      throw error instanceof StartError ? startError(target, error.message, run.output) : error;
    });
    if (answer.server === "other") {
      await run.stop();
      lostPorts.push(port);
      firstPort = port + 1;
      console.log(
        `Port ${port} is taken by another server, probably the local registry of an end-to-end run in another checkout: ${answer.reason}. Starting the local registry again from port ${firstPort}.`,
      );
      continue;
    }
    try {
      useRegistry(port);
    } catch (error) {
      await run.stop();
      throw error;
    }
    void run.exited.then((status) => {
      if (!run.stopRequested) {
        console.error(
          `The local registry stopped unexpectedly: nx run ${target} exited with ${status}.`,
        );
      }
    });
    return () => stopRegistry(run, port);
  }
  throw startError(
    target,
    `another server held each port the registry took (${lostPorts.join(", ")})`,
  );
}

/** A registry that `nx run <target>` runs. */
class NxRun {
  output = "";
  exitStatus: string | undefined;
  /** Resolves to the exit status once `nx run` has exited. */
  readonly exited: Promise<string>;
  /** Resolves once `nx run` has exited and its output has been read. */
  readonly closed: Promise<void>;
  private stopping: Promise<void> | undefined;

  constructor(readonly child: ChildProcess) {
    this.exited = new Promise((resolve) =>
      child.on("exit", (code, signal) => {
        this.exitStatus = signal ?? `code ${code}`;
        resolve(this.exitStatus);
      }),
    );
    this.closed = new Promise((resolve) => child.on("close", () => resolve()));
  }

  get stopRequested(): boolean {
    return this.stopping !== undefined;
  }

  /** Stops `nx run` and resolves once it has exited. */
  stop(): Promise<void> {
    return (this.stopping ??= stopProcess(this.child));
  }
}

/** Why a start failed, before the output of `nx run` is added. */
class StartError extends Error {}

function startError(target: string, reason: string, output?: string): Error {
  return new Error(
    `Could not start the local registry: ${reason}.` +
      (output === undefined ? "" : `\nOutput of nx run ${target}:\n${output}`),
  );
}

/**
 * Starts `nx run <target>` and resolves once it printed the registry's
 * address, which verdaccio prints before it listens. `firstPort` overrides the
 * target's `port` option, the first port the executor tries.
 *
 * When `nx run` cannot start a registry, this stops it and rejects with an
 * error that says why.
 */
function runRegistry(
  target: string,
  storage: string,
  firstPort: number | undefined,
): Promise<{ run: NxRun; port: number }> {
  const args = ["run", target, "--location", "none", "--clear", "true", "--storage", storage];
  if (firstPort !== undefined) {
    args.push("--port", String(firstPort));
  }
  const run = new NxRun(fork(require.resolve("nx/bin/nx"), args, { stdio: "pipe" }));
  const { child } = run;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (reason: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      void run.stop().then(() => reject(startError(target, reason, run.output)));
    };
    const timeout = setTimeout(
      () => fail(`nx run ${target} printed no address within ${startTimeoutMs / 1000} seconds`),
      startTimeoutMs,
    );

    child.stdout!.on("data", (data: Buffer) => {
      run.output += data.toString();
      if (settled) {
        return;
      }
      // Nx runs a continuous task only once per checkout. While another Nx
      // process of this checkout runs it, `nx run` prints this and waits for
      // that process to end, so it starts no registry of its own.
      if (run.output.includes(`Waiting for ${target} in another nx process`)) {
        fail(
          `another Nx process in this checkout already runs ${target}. ` +
            "It is either an end-to-end run in progress or a registry left behind by one that was killed. " +
            `Stop it (its command line contains "run ${target}") and run the tests again`,
        );
        return;
      }
      const port = new RegExp(`http://${listenAddress}:(\\d+)`).exec(run.output)?.[1];
      if (port === undefined) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ run, port: Number(port) });
    });
    child.stderr!.on("data", (data: Buffer) => process.stderr.write(data));
    child.on("error", (error) => fail(`nx run ${target} failed: ${error.message}`));
    child.on("exit", () =>
      fail(`nx run ${target} exited with ${run.exitStatus} before the registry started`),
    );
  });
}

type Answer = { server: "own" } | { server: "other"; reason: string };

/**
 * Finds out whether the server on `port` is the registry that `run` started
 * with `storage`: it puts a file with random content in the storage and asks
 * the server on the port for it. Only a registry that keeps its packages in
 * that folder can serve the file.
 *
 * Resolves to `server: "other"` when another server answers on the port, or when
 * this registry could not listen on it because the port is taken. Rejects
 * with a `StartError` when `nx run` exits for another reason or nothing
 * answers in time.
 */
async function askRegistry(run: NxRun, port: number, storage: string): Promise<Answer> {
  const content = randomBytes(16).toString("hex");
  const folder = join(storage, probePackage);
  const file = `${content}.tgz`;
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, file), content);
  try {
    const deadline = Date.now() + answerTimeoutMs;
    while (Date.now() < deadline) {
      const response = await request(port, `/${probePackage}/-/${file}`);
      if (response !== undefined) {
        return response.status === 200 && response.body === content
          ? { server: "own" }
          : {
              server: "other",
              reason: `it answered the request for a file of this run's registry with status ${response.status}`,
            };
      }
      if (run.exitStatus !== undefined) {
        // `exit` can come before the last output.
        await Promise.race([run.closed, delay(1000)]);
        if (/\bEADDRINUSE\b/.test(run.output)) {
          return { server: "other", reason: "this run's registry could not listen on it" };
        }
        throw new StartError(
          `nx run exited with ${run.exitStatus} before the registry answered on port ${port}`,
        );
      }
      await delay(retryDelayMs);
    }
    throw new StartError(
      `nothing answered on port ${port} within ${answerTimeoutMs / 1000} seconds after the registry printed its address`,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Sends a GET request for `path` to the server on `port`. Resolves to its
 * answer, or to `undefined` when no answer came, for example because nothing
 * listens on the port yet.
 */
function request(
  port: number,
  path: string,
): Promise<{ status: number; body: string } | undefined> {
  return new Promise((resolve) => {
    // Without an agent, the connection closes after the answer, so that it
    // does not hold up the registry when it stops.
    const req = get({ host: listenAddress, port, path, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      res.on("error", () => resolve(undefined));
    });
    req.setTimeout(requestTimeoutMs, () => req.destroy());
    req.on("error", () => resolve(undefined));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Points npm and pnpm, in this process and the ones it starts, at the registry. */
function useRegistry(port: number) {
  const registry = `http://${listenAddress}:${port}`;
  console.log(`Local registry started on ${registry}`);
  process.env.npm_config_registry = registry;
  // npm reads registry tokens only from its configuration files. The setup
  // writes the token only for a port its own registry holds, so that it never
  // takes over the token of another run.
  execFileSync("npm", ["config", "set", tokenKey(port), authToken, "--ws=false"]);
  // pnpm reads `pnpm_config_*` variables rather than `npm_config_*` ones.
  process.env.pnpm_config_registry = registry;
  process.env[`pnpm_config_${tokenKey(port)}`] = authToken;
}

function tokenKey(port: number): string {
  return `//${listenAddress}:${port}/:_authToken`;
}

/**
 * Removes the registry's token from npm's user configuration and stops the
 * registry. The token goes first: while this registry holds the port, no
 * other run can have written a token for it, so removing it cannot remove
 * another run's.
 */
async function stopRegistry(run: NxRun, port: number): Promise<void> {
  try {
    if (run.exitStatus === undefined) {
      execFileSync("npm", ["config", "delete", tokenKey(port), "--ws=false"]);
    } else {
      console.error(
        `Left ${tokenKey(port)} in npm's user configuration: the local registry has already stopped, so another run may use port ${port} and that token now.`,
      );
    }
  } finally {
    await run.stop();
  }
}

/**
 * Asks `child` to stop and resolves once it has exited, or after
 * `stopTimeoutMs` with a warning. `nx run` stops the registry it runs before it
 * exits.
 */
async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  const exited = new Promise<boolean>((resolve) => child.once("exit", () => resolve(true)));
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), stopTimeoutMs);
  });
  child.kill();
  const stopped = await Promise.race([exited, timedOut]);
  clearTimeout(timer);
  if (!stopped) {
    console.error(
      `The local registry (nx run, process ${child.pid}) did not stop within ${stopTimeoutMs / 1000} seconds. Stop it before the next run.`,
    );
  }
}
