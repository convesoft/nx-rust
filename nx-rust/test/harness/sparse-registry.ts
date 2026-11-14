import { type ChildProcess, fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { testEnvironment } from "./environment";
import {
  indexPath,
  packageRegistryCrate,
  type RegistryCrate,
  registryIndexEntry,
} from "./local-registry";
import type {
  IndexEntry,
  ParentMessage,
  RegistryRequest,
  RegistryUpload,
  ServerMessage,
} from "./registry-server.mjs";
import { testRunFolder } from "./test-run";

export type {
  IndexDependency,
  IndexEntry,
  PublishDependency,
  PublishMetadata,
  RegistryRequest,
  RegistryUpload,
} from "./registry-server.mjs";

/** The server that {@link SparseRegistry} runs, as Node runs it: TypeScript without its types. */
const serverScript = join(__dirname, "registry-server.mts");

/** How long the server may take to listen, and to stop. */
const serverTimeoutMs = 10_000;

/** The options of {@link SparseRegistry.start}. */
export interface SparseRegistryOptions {
  /**
   * How long after an upload the index shows it, in milliseconds: 0 by
   * default, `Infinity` for never. Cargo waits up to 60 seconds after each
   * upload for the index to show it.
   */
  indexDelay?: number;
}

/** How {@link SparseRegistry.seed} puts a version into the registry. */
export interface SeedOptions {
  /**
   * Whether to package the version with the real `cargo package` and serve
   * its `.crate` file, for a test that builds against it. Without it, the
   * index lists the version, and its download fails with 404.
   */
  crateFile?: boolean;
}

/**
 * A sparse Cargo registry with a publish endpoint, served on the loopback
 * interface by a Node process of its own (`registry-server.mts`), with a
 * Cargo home that puts it in place of crates.io. Cargo resolves, downloads,
 * publishes and waits for an upload against it as against crates.io, and
 * nothing reaches crates.io or any other registry.
 *
 * {@link SparseRegistry.start} starts the server on a port that the system
 * picks, so that tests, test files and checkouts can each run their own at
 * once, and {@link SparseRegistry.remove} stops it and deletes its folder
 * with the Cargo home. A test that uses one removes it when it is done, as
 * with any fixture. Its folder lies in the test run's folder
 * (`testRunFolder()`), so that the end of the run deletes what a crashed
 * test left. The server exits with the process that started it. Because it
 * runs in a process of its own, a test may run cargo or Nx synchronously, as
 * with `spawnSync`.
 *
 * Give cargo and Nx {@link SparseRegistry.env}. The Cargo home's
 * `config.toml` names the registry {@link SparseRegistry.registryName},
 * replaces crates.io with it (`[source.crates-io] replace-with`) and makes it
 * `registry.default`, so that `cargo publish` needs no `--registry`, as in
 * `EVD-CARGO-PUBLISH`; its `credentials.toml` holds {@link token}, the only
 * token that the registry takes. The registry is also cargo's HTTP proxy
 * (`http.proxy`), which refuses every host but its own:
 * `cargo publish --registry crates-io` does not follow source replacement
 * and would reach crates.io otherwise. Because a configuration file in a
 * folder above the working folder takes precedence over the Cargo home,
 * {@link env} pins these settings with environment variables, which take
 * precedence over every file, and makes cargo fetch git repositories with
 * the git command line restricted to local files, since git and SSH
 * transports do not go through an HTTP proxy.
 *
 * {@link seed} puts a version into the index directly, {@link uploads}
 * returns what `cargo publish` uploaded, {@link index} what the index lists,
 * and {@link requests} every request that the server received. An upload of
 * a version that the registry already has is refused as crates.io refuses
 * it, and the index can show an upload late ({@link setIndexDelay}).
 */
export class SparseRegistry {
  /** The registry's name in the Cargo home's configuration. */
  static readonly registryName = "nx-rust-test";

  /** The Cargo home whose configuration puts this registry in place of crates.io. */
  readonly cargoHome: string;
  /** The only token that the registry takes for an upload, which the Cargo home holds. */
  readonly token: string;
  /** The registry's address, `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** The URL of the index, as the Cargo home names it. */
  readonly indexUrl: string;
  private child: ChildProcess | undefined;
  private exited: Promise<void>;

  private constructor(
    /** The folder that holds the registry's files and the Cargo home. */
    readonly base: string,
    token: string,
    child: ChildProcess,
    readonly port: number,
  ) {
    this.token = token;
    this.child = child;
    this.exited = new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
      } else {
        child.once("exit", () => resolve());
      }
    });
    this.cargoHome = join(base, "home");
    this.url = `http://127.0.0.1:${port}`;
    this.indexUrl = `sparse+${this.url}/index/`;
    mkdirSync(this.cargoHome, { recursive: true });
    const name = SparseRegistry.registryName;
    writeFileSync(
      join(this.cargoHome, "config.toml"),
      [
        `[registries.${name}]`,
        `index = "${this.indexUrl}"`,
        "",
        "[registry]",
        `default = "${name}"`,
        "",
        "[source.crates-io]",
        `replace-with = "${name}"`,
        "",
        "# Every request goes through the registry, which refuses other hosts.",
        "[http]",
        `proxy = "${this.url}"`,
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(this.cargoHome, "credentials.toml"),
      `[registries.${name}]\ntoken = "${token}"\n`,
    );
  }

  /** Starts a registry with an empty index in a new folder. */
  static async start(options: SparseRegistryOptions = {}): Promise<SparseRegistry> {
    if (!process.features.typescript) {
      throw new Error(
        "The test registry's server is TypeScript that Node runs without its types, which needs Node 22.18 or later.",
      );
    }
    const base = realpathSync(mkdtempSync(join(testRunFolder() ?? tmpdir(), "registry-")));
    let child: ChildProcess | undefined;
    try {
      mkdirSync(join(base, "index"));
      const token = `nx-rust-test-${randomBytes(12).toString("hex")}`;
      const log = join(base, "server.log");
      const output = openSync(log, "a");
      try {
        child = fork(serverScript, [base, token, delayArgument(options.indexDelay ?? 0)], {
          execArgv: [],
          env: testEnvironment(),
          stdio: ["ignore", output, output, "ipc"],
        });
      } finally {
        closeSync(output);
      }
      const port = await listening(child, log);
      const registry = new SparseRegistry(base, token, child, port);
      // A test that forgets the registry does not keep its Jest worker alive,
      // and the server exits when the worker does.
      child.unref();
      child.channel?.unref();
      return registry;
    } catch (error) {
      child?.kill("SIGKILL");
      rmSync(base, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * The variables for a cargo or Nx command that uses the registry, for
   * `testEnvironment`. They leave out the variables of the developer's shell
   * that would override the Cargo home's registries, token, proxy or network
   * settings, and `no_proxy`, with which cargo would bypass the proxy. Then
   * they pin, with environment variables, which take precedence over every
   * configuration file, also over one in a folder above the working folder
   * (`EVD-CARGO-PUBLISH`):
   *
   * - the proxy (`CARGO_HTTP_PROXY`), through which every HTTP and HTTPS
   *   request goes, and `net.offline` off;
   * - `registry.default`, the registry's index and its token (with the index
   *   pinned, cargo takes the token only from the environment), and the
   *   credential provider `cargo:token` for this registry, without which a
   *   global credential provider of a configuration file runs, the token in
   *   the environment notwithstanding. For any other registry, cargo asks the
   *   registry, which the proxy refuses, before it runs a provider;
   * - git fetches through the git command line (`net.git-fetch-with-cli`),
   *   with git allowed only local `file` transports (`GIT_ALLOW_PROTOCOL`):
   *   cargo's own git library ignores the proxy for `git://` and `ssh://` URLs
   *   and ignores `GIT_ALLOW_PROTOCOL`, and the git command line ignores
   *   cargo's proxy. Git refuses `ssh` before it starts an SSH program.
   *
   * Cargo takes no source replacement from the environment, so a
   * configuration file above the working folder can still replace crates.io
   * with another source; its requests then go through the proxy or to local
   * files like any other.
   */
  env(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    for (const name of Object.keys(process.env)) {
      if (/^CARGO_(REGISTRY|REGISTRIES|SOURCE|HTTP|NET)_/.test(name) || /^no_proxy$/i.test(name)) {
        env[name] = undefined;
      }
    }
    const registry = `CARGO_REGISTRIES_${SparseRegistry.registryName.toUpperCase().replace(/-/g, "_")}`;
    return {
      ...env,
      CARGO_HOME: this.cargoHome,
      CARGO_HTTP_PROXY: this.url,
      CARGO_NET_OFFLINE: "false",
      CARGO_REGISTRY_DEFAULT: SparseRegistry.registryName,
      [`${registry}_INDEX`]: this.indexUrl,
      [`${registry}_TOKEN`]: this.token,
      [`${registry}_CREDENTIAL_PROVIDER`]: "cargo:token",
      CARGO_NET_GIT_FETCH_WITH_CLI: "true",
      GIT_ALLOW_PROTOCOL: "file",
    };
  }

  /**
   * Puts a version into the index at once, whatever the index delay, for
   * the cases of a newer version in the registry and of a version that
   * already exists. Seed a crate's dependencies first. With `crateFile`, the
   * version is packaged by the real `cargo package`, which needs the server,
   * and its `.crate` file is served.
   *
   * @throws {Error} Where the index already lists the version.
   */
  seed(crate: RegistryCrate, options: SeedOptions = {}): IndexEntry {
    if (this.index(crate.name).some((entry) => entry.vers === crate.version)) {
      throw new Error(`The test registry already has ${crate.name}@${crate.version}.`);
    }
    let crateBytes = Buffer.alloc(0);
    if (options.crateFile) {
      crateBytes = readFileSync(
        packageRegistryCrate(
          crate,
          join(this.base, "sources", `${crate.name}-${crate.version}`),
          testEnvironment(this.env()),
        ),
      );
      const file = join(this.base, ...crateFilePath(crate.name, crate.version));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, crateBytes);
    }
    const entry = registryIndexEntry(crate, createHash("sha256").update(crateBytes).digest("hex"));
    const indexFile = join(this.base, "index", ...indexPath(crate.name));
    mkdirSync(dirname(indexFile), { recursive: true });
    writeFileSync(indexFile, `${JSON.stringify(entry)}\n`, { flag: "a" });
    return entry;
  }

  /** The versions that the index lists for a crate now, as cargo reads them, in the order they were added. */
  index(name: string): IndexEntry[] {
    return readLines(join(this.base, "index", ...indexPath(name)));
  }

  /** The uploads that the registry accepted, in the order they arrived. */
  uploads(): RegistryUpload[] {
    return readLines(join(this.base, "uploads.jsonl"));
  }

  /** Every request that the server answered, in order, refused ones and proxy requests included. */
  requests(): RegistryRequest[] {
    return readLines(join(this.base, "requests.jsonl"));
  }

  /**
   * Sets how long after an upload the index shows it, in milliseconds,
   * `Infinity` for never, for the uploads that arrive from now on.
   */
  async setIndexDelay(indexDelay: number): Promise<void> {
    const child = this.running();
    child.channel?.ref();
    try {
      const applied = new Promise<void>((resolve, reject) => {
        const onMessage = (message: ServerMessage) => {
          if (message.type === "settings-applied") {
            child.off("exit", onExit);
            child.off("message", onMessage);
            resolve();
          }
        };
        const onExit = () => {
          child.off("message", onMessage);
          reject(new Error("The test registry's server exited."));
        };
        child.on("message", onMessage);
        child.once("exit", onExit);
      });
      send(child, {
        type: "settings",
        indexDelay: Number.isFinite(indexDelay) ? indexDelay : null,
      });
      await applied;
    } finally {
      child.channel?.unref();
    }
  }

  /**
   * Stops the server and resolves once it has exited. The files and the
   * Cargo home stay until {@link remove}, so that a test can run cargo
   * against a registry that does not answer.
   */
  async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined) {
      return;
    }
    this.child = undefined;
    if (child.exitCode === null && child.signalCode === null) {
      child.ref();
      const timer = setTimeout(() => child.kill("SIGKILL"), serverTimeoutMs);
      try {
        if (child.connected) {
          send(child, { type: "stop" });
        } else {
          child.kill();
        }
        await this.exited;
      } finally {
        clearTimeout(timer);
        child.unref();
      }
    }
  }

  /** Stops the server and deletes its folder and the Cargo home, unless `NX_RUST_KEEP_FIXTURES` is set. */
  async remove(): Promise<void> {
    await this.stop();
    if (!process.env.NX_RUST_KEEP_FIXTURES) {
      rmSync(this.base, { recursive: true, force: true });
    }
  }

  private running(): ChildProcess {
    if (this.child === undefined || !this.child.connected) {
      throw new Error("The test registry's server has stopped.");
    }
    return this.child;
  }
}

/**
 * Variables that make cargo wait `seconds` instead of 60 for an upload to
 * appear in the index, so that a test can reach cargo's timeout, with an
 * index delay of `Infinity`, in a few seconds. Cargo 1.91 and later read
 * `publish.timeout` only with the unstable flag `publish-timeout`, which
 * `RUSTC_BOOTSTRAP=1` allows on a stable toolchain; the wait then ends with
 * the same messages and exit status as after 60 seconds. `RUSTC_BOOTSTRAP`
 * also lets rustc compile unstable features, which the fixtures do not use.
 * A test that has to show the wait of a cargo as users run it leaves this
 * out and takes the 60 seconds, best in a test file of its own, which Jest
 * runs beside the others.
 */
export function shortPublishTimeout(seconds: number): Record<string, string> {
  return {
    RUSTC_BOOTSTRAP: "1",
    CARGO_UNSTABLE_PUBLISH_TIMEOUT: "true",
    CARGO_PUBLISH_TIMEOUT: String(seconds),
  };
}

/** The path of a version's `.crate` file below the registry's folder, where `registry-server.mts` looks for it. */
function crateFilePath(name: string, version: string): string[] {
  return ["crates", name.toLowerCase(), `${version}.crate`];
}

function delayArgument(indexDelay: number): string {
  if (Number.isNaN(indexDelay) || indexDelay < 0) {
    throw new Error(`The index delay has to be 0 or more milliseconds, not ${indexDelay}.`);
  }
  return Number.isFinite(indexDelay) ? String(Math.round(indexDelay)) : "never";
}

function send(child: ChildProcess, message: ParentMessage): void {
  child.send(message);
}

/** Resolves to the port once the server listens; rejects with its output when it fails first. */
function listening(child: ChildProcess, log: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const settle = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const fail = (reason: string) => {
      settle();
      const output = existsSync(log) ? readFileSync(log, "utf8") : "";
      reject(new Error(`The test registry's server ${reason}.${output ? `\n${output}` : ""}`));
    };
    const onMessage = (message: ServerMessage) => {
      if (message.type === "listening") {
        settle();
        resolve(message.port);
      } else if (message.type === "failed") {
        fail(`failed: ${message.message}`);
      }
    };
    const onError = (error: Error) => fail(`could not start: ${error.message}`);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      fail(`exited with ${signal ?? `code ${code}`}`);
    const timer = setTimeout(
      () => fail(`did not listen within ${serverTimeoutMs / 1000} seconds`),
      serverTimeoutMs,
    );
    child.on("message", onMessage);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

/** The complete lines of a JSON Lines file, none where there is no file. */
function readLines<T>(file: string): T[] {
  if (!existsSync(file)) {
    return [];
  }
  const text = readFileSync(file, "utf8");
  // A line that the server is still writing has no newline yet.
  const complete = text.slice(0, text.lastIndexOf("\n") + 1);
  return complete
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as T);
}
