/**
 * Runs the local registry that the end-to-end tests install the plugin from.
 *
 * It takes the place of `startLocalRegistry` from
 * `@nx/js/plugins/jest/local-registry`, which waits forever when `nx run`
 * starts no registry, and whose stop function does not wait for the registry
 * to stop.
 */

import { type ChildProcess, execFileSync, fork } from "child_process";

/** How long `nx run` may take to print the address of the registry. */
const startTimeoutMs = 2 * 60 * 1000;
/** How long the registry may take to stop before the tests stop waiting. */
const stopTimeoutMs = 30 * 1000;
const listenAddress = "localhost";
/** Verdaccio lets anyone publish; npm and pnpm only need some token. */
const authToken = "secretVerdaccioToken";

/**
 * Starts the registry with `nx run <target>` and points npm and pnpm at it.
 *
 * When the registry cannot start, this stops what it started and rejects with
 * an error that says why. Otherwise it resolves to a function that stops the
 * registry and resolves once the registry has exited.
 */
export function startLocalRegistry(target: string, storage: string): Promise<() => Promise<void>> {
  const child = fork(
    require.resolve("nx/bin/nx"),
    ["run", target, "--location", "none", "--clear", "true", "--storage", storage],
    { stdio: "pipe" },
  );
  let stopping: Promise<void> | undefined;
  const stop = () => (stopping ??= stopProcess(child));

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const fail = (reason: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      void stop().then(() =>
        reject(
          new Error(
            `Could not start the local registry: ${reason}.\nOutput of nx run ${target}:\n${output}`,
          ),
        ),
      );
    };
    const timeout = setTimeout(
      () => fail(`nx run ${target} printed no address within ${startTimeoutMs / 1000} seconds`),
      startTimeoutMs,
    );

    child.stdout.on("data", (data: Buffer) => {
      if (settled) {
        return;
      }
      output += data.toString();
      // Nx runs a continuous task only once per checkout. While another Nx
      // process of this checkout runs it, `nx run` prints this and waits for
      // that process to end, so it starts no registry of its own.
      if (output.includes(`Waiting for ${target} in another nx process`)) {
        fail(
          `another Nx process in this checkout already runs ${target}. ` +
            "It is either an end-to-end run in progress or a registry left behind by one that was killed. " +
            `Stop it (its command line contains "run ${target}") and run the tests again`,
        );
        return;
      }
      const port = new RegExp(`http://${listenAddress}:(\\d+)`).exec(output)?.[1];
      if (port === undefined) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      try {
        useRegistry(port);
      } catch (error) {
        void stop().then(() => reject(error));
        return;
      }
      resolve(async () => {
        await stop();
        execFileSync("npm", [
          "config",
          "delete",
          `//${listenAddress}:${port}/:_authToken`,
          "--ws=false",
        ]);
      });
    });
    child.stderr.on("data", (data: Buffer) => process.stderr.write(data));
    child.on("error", (error) => fail(`nx run ${target} failed: ${error.message}`));
    child.on("exit", (code, signal) => {
      const status = signal ?? `code ${code}`;
      if (!settled) {
        fail(`nx run ${target} exited with ${status} before the registry started`);
      } else if (stopping === undefined) {
        console.error(
          `The local registry stopped unexpectedly: nx run ${target} exited with ${status}.`,
        );
      }
    });
  });
}

/** Points npm and pnpm, in this process and the ones it starts, at the registry. */
function useRegistry(port: string) {
  const registry = `http://${listenAddress}:${port}`;
  console.log(`Local registry started on ${registry}`);
  process.env.npm_config_registry = registry;
  // npm reads registry tokens only from its configuration files.
  execFileSync("npm", [
    "config",
    "set",
    `//${listenAddress}:${port}/:_authToken`,
    authToken,
    "--ws=false",
  ]);
  // pnpm reads `pnpm_config_*` variables rather than `npm_config_*` ones.
  process.env.pnpm_config_registry = registry;
  process.env[`pnpm_config_//${listenAddress}:${port}/:_authToken`] = authToken;
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
