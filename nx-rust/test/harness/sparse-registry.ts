import { type ChildProcess, fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
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
  /** The registry to put it into ({@link ServedRegistryName}); the main registry by default. */
  registry?: ServedRegistryName;
}

/**
 * The registries that the server serves beside the main one, each under a
 * path of its own, with its own index, publish endpoint, token and log of
 * uploads, which the Cargo homes name as they are named here (`VER-RELEASE`,
 * group 9).
 */
export const namedRegistries = ["alpha", "beta"] as const;

/** The name of a registry of {@link namedRegistries}. */
export type NamedRegistryName = (typeof namedRegistries)[number];

/**
 * A registry that the server serves beside the main one: one of
 * {@link namedRegistries}, or `spare`, which no Cargo home and no variable
 * of {@link SparseRegistry.env} names, for a case that configures a name of
 * its own for an index, as two names for one index make cargo refuse an
 * upload (`EVD-CARGO-PUBLISH-REGISTRIES`).
 */
export type ServedRegistryName = NamedRegistryName | "spare";

/** A registry of {@link namedRegistries}, as the Cargo homes and {@link SparseRegistry.env} name it. */
export interface NamedRegistry {
  name: NamedRegistryName;
  /** The URL of its index, `sparse+http://127.0.0.1:<port>/<name>/index/`. */
  indexUrl: string;
  /** The only token that it takes for an upload, which {@link SparseRegistry.env} pins. */
  token: string;
}

/**
 * Which Cargo home {@link SparseRegistry.env} gives cargo. Each names every
 * registry, replaces crates.io with the main registry and makes the server
 * its proxy:
 *
 * - `default`: makes the main registry `registry.default`;
 * - `no-default`: sets no `registry.default`;
 * - `alpha-replaced`: sets no `registry.default` either, and replaces
 *   `alpha` with `beta` through a `[source]` table that holds `alpha`'s
 *   index, `alpha-src`, as in `EVD-CARGO-PUBLISH-REGISTRIES`.
 */
export type CargoHomeKind = "default" | "no-default" | "alpha-replaced";

/** The variants of {@link SparseRegistry.env}. */
export interface RegistryEnvOptions {
  /**
   * What `CARGO_REGISTRY_DEFAULT` pins: the main registry by default, the
   * given registry name, or, with `null`, nothing, so that the Cargo home
   * and the crates' `publish` lists choose the registry.
   */
  registryDefault?: string | null;
  /** The Cargo home; `default` by default. */
  home?: CargoHomeKind;
  /**
   * Further registry names that the environment gives the index of a named
   * registry, as `CARGO_REGISTRIES_<NAME>_INDEX`, such as `{ alias: "alpha" }`.
   */
  aliases?: Readonly<Record<string, NamedRegistryName>>;
  /** Whether cargo runs offline, `CARGO_NET_OFFLINE=true`, in place of the pinned `false`. */
  offline?: boolean;
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
 * with any fixture, or shares the server of its test file through
 * {@link withSharedRegistry}, which empties it before each test
 * ({@link SparseRegistry.reset}). Its folder lies in the test run's folder
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
 *
 * The same server serves the registries of {@link namedRegistries},
 * `alpha` and `beta`, each under a path of its own with its own index,
 * publish endpoint, token and log of uploads, which records the registry,
 * the token and the registry that the upload gives each dependency
 * (`VER-RELEASE`, group 9). Every Cargo home names them, and
 * {@link env} pins their indexes and tokens as it pins the main registry's;
 * {@link seed}, {@link index} and {@link uploads} take the registry's name.
 * The variants of {@link env} choose a Cargo home without `registry.default`
 * or one that replaces `alpha` with `beta` ({@link CargoHomeKind}).
 */
export class SparseRegistry {
  /** The registry's name in the Cargo home's configuration. */
  static readonly registryName = "nx-rust-test";

  /** The Cargo home whose configuration puts this registry in place of crates.io and makes it `registry.default`. */
  readonly cargoHome: string;
  /** The only token that the registry takes for an upload, which the Cargo home holds. */
  readonly token: string;
  /** The registry's address, `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** The URL of the index, as the Cargo home names it. */
  readonly indexUrl: string;
  /** The registries that the server serves beside this one, by name. */
  readonly named: Readonly<Record<NamedRegistryName, NamedRegistry>>;
  /** The registry that the server serves and nothing names ({@link ServedRegistryName}). */
  readonly spare: Readonly<{ indexUrl: string; token: string }>;
  private readonly homes: Readonly<Record<CargoHomeKind, string>>;
  /** The files of each Cargo home, which {@link reset} writes again, by path. */
  private readonly homeFiles: ReadonlyMap<string, string>;
  private child: ChildProcess | undefined;
  private exited: Promise<void>;

  private constructor(
    /** The folder that holds the registry's files and the Cargo homes. */
    readonly base: string,
    tokens: { main: string; named: Record<NamedRegistryName, string>; spare: string },
    child: ChildProcess,
    readonly port: number,
  ) {
    this.token = tokens.main;
    this.child = child;
    this.exited = new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
      } else {
        child.once("exit", () => resolve());
      }
    });
    this.url = `http://127.0.0.1:${port}`;
    this.indexUrl = `sparse+${this.url}/index/`;
    const named = Object.fromEntries(
      namedRegistries.map((name) => [
        name,
        { name, indexUrl: `sparse+${this.url}/${name}/index/`, token: tokens.named[name] },
      ]),
    ) as Record<NamedRegistryName, NamedRegistry>;
    // Frozen, so that a test of a shared registry cannot change them for the next.
    this.named = Object.freeze(
      Object.fromEntries(
        Object.entries(named).map(([name, registry]) => [name, Object.freeze(registry)]),
      ),
    ) as Readonly<Record<NamedRegistryName, NamedRegistry>>;
    this.spare = Object.freeze({
      indexUrl: `sparse+${this.url}/spare/index/`,
      token: tokens.spare,
    });
    const name = SparseRegistry.registryName;
    const registries = [
      `[registries.${name}]`,
      `index = "${this.indexUrl}"`,
      "",
      ...namedRegistries.flatMap((other) => [
        `[registries.${other}]`,
        `index = "${named[other].indexUrl}"`,
        "",
      ]),
      "[source.crates-io]",
      `replace-with = "${name}"`,
      "",
      "# Every request goes through the registry, which refuses other hosts.",
      "[http]",
      `proxy = "${this.url}"`,
      "",
    ];
    const contents: Record<CargoHomeKind, string[]> = {
      default: ["[registry]", `default = "${name}"`, "", ...registries],
      "no-default": registries,
      "alpha-replaced": [
        ...registries,
        "[source.alpha-src]",
        `registry = "${named.alpha.indexUrl}"`,
        `replace-with = "beta"`,
        "",
      ],
    };
    const folders: Record<CargoHomeKind, string> = {
      default: join(base, "home"),
      "no-default": join(base, "home-no-default"),
      "alpha-replaced": join(base, "home-alpha-replaced"),
    };
    const homeFiles = new Map<string, string>();
    for (const kind of Object.keys(folders) as CargoHomeKind[]) {
      homeFiles.set(join(folders[kind], "config.toml"), contents[kind].join("\n"));
      homeFiles.set(
        join(folders[kind], "credentials.toml"),
        `[registries.${name}]\ntoken = "${tokens.main}"\n`,
      );
    }
    this.homeFiles = homeFiles;
    this.writeHomes();
    this.homes = folders;
    this.cargoHome = folders.default;
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
      const tokenOf = (name: string) => `${name}-${randomBytes(12).toString("hex")}`;
      const tokens = {
        main: tokenOf("nx-rust-test"),
        named: Object.fromEntries(namedRegistries.map((name) => [name, tokenOf(name)])) as Record<
          NamedRegistryName,
          string
        >,
        spare: tokenOf("spare"),
      };
      const log = join(base, "server.log");
      const output = openSync(log, "a");
      try {
        child = fork(
          serverScript,
          [
            base,
            delayArgument(options.indexDelay ?? 0),
            tokens.main,
            ...namedRegistries.map((name) => `${name}=${tokens.named[name]}`),
            `spare=${tokens.spare}`,
          ],
          {
            execArgv: [],
            env: testEnvironment(),
            stdio: ["ignore", output, output, "ipc"],
          },
        );
      } finally {
        closeSync(output);
      }
      const port = await listening(child, log);
      const registry = new SparseRegistry(base, tokens, child, port);
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
   *
   * The registries of {@link namedRegistries} are pinned in the same way,
   * each with its index, its own token and `cargo:token`. The variants of
   * `options` leave `CARGO_REGISTRY_DEFAULT` unset or pin another registry,
   * choose another Cargo home, give a further name the index of a named
   * registry, or make cargo work offline.
   */
  env(options: RegistryEnvOptions = {}): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    for (const name of Object.keys(process.env)) {
      if (/^CARGO_(REGISTRY|REGISTRIES|SOURCE|HTTP|NET)_/.test(name) || /^no_proxy$/i.test(name)) {
        env[name] = undefined;
      }
    }
    const pins = (name: string, index: string, token?: string) => {
      const prefix = `CARGO_REGISTRIES_${name.toUpperCase().replace(/-/g, "_")}`;
      return {
        [`${prefix}_INDEX`]: index,
        ...(token === undefined
          ? {}
          : { [`${prefix}_TOKEN`]: token, [`${prefix}_CREDENTIAL_PROVIDER`]: "cargo:token" }),
      };
    };
    const registryDefault =
      options.registryDefault === undefined ? SparseRegistry.registryName : options.registryDefault;
    return {
      ...env,
      CARGO_HOME: this.homes[options.home ?? "default"],
      CARGO_HTTP_PROXY: this.url,
      CARGO_NET_OFFLINE: options.offline ? "true" : "false",
      ...(registryDefault === null ? {} : { CARGO_REGISTRY_DEFAULT: registryDefault }),
      ...pins(SparseRegistry.registryName, this.indexUrl, this.token),
      ...Object.assign(
        {},
        ...namedRegistries.map((name) =>
          pins(name, this.named[name].indexUrl, this.named[name].token),
        ),
      ),
      ...Object.assign(
        {},
        ...Object.entries(options.aliases ?? {}).map(([alias, name]) =>
          pins(alias, this.named[name].indexUrl),
        ),
      ),
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
    const folder = this.folderOf(options.registry);
    if (this.index(crate.name, options.registry).some((entry) => entry.vers === crate.version)) {
      throw new Error(
        `The test registry ${options.registry ?? SparseRegistry.registryName} already has ${crate.name}@${crate.version}.`,
      );
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
      const file = join(folder, ...crateFilePath(crate.name, crate.version));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, crateBytes);
    }
    const entry = registryIndexEntry(crate, createHash("sha256").update(crateBytes).digest("hex"));
    const indexFile = join(folder, "index", ...indexPath(crate.name));
    mkdirSync(dirname(indexFile), { recursive: true });
    writeFileSync(indexFile, `${JSON.stringify(entry)}\n`, { flag: "a" });
    return entry;
  }

  /**
   * The versions that the index of the main registry, or of a named one,
   * lists for a crate now, as cargo reads them, in the order they were added.
   */
  index(name: string, registry?: ServedRegistryName): IndexEntry[] {
    return readLines(join(this.folderOf(registry), "index", ...indexPath(name)));
  }

  /** The uploads that the main registry, or a named one, accepted, in the order they arrived. */
  uploads(registry?: ServedRegistryName): RegistryUpload[] {
    return readLines(join(this.folderOf(registry), "uploads.jsonl"));
  }

  /** The uploads that every registry of the server accepted, the main one's first and `spare`'s last. */
  allUploads(): RegistryUpload[] {
    return [
      this.uploads(),
      ...namedRegistries.map((name) => this.uploads(name)),
      this.uploads("spare"),
    ].flat();
  }

  /** The folder of the main registry's files, or of a named one's, as `registry-server.mts` lays them out. */
  private folderOf(registry: ServedRegistryName | undefined): string {
    return registry === undefined ? this.base : join(this.base, "registries", registry);
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
    // Checked and rounded as start() checks its option.
    const delay = delayArgument(indexDelay);
    await this.ask(
      { type: "settings", indexDelay: delay === "never" ? null : Number(delay) },
      "settings-applied",
    );
  }

  /**
   * Puts every upload that waits for the index delay into its registry's
   * index now, and returns how many there were. The delay stays as it is for
   * later uploads.
   */
  async flushIndex(): Promise<number> {
    const { count } = await this.ask({ type: "flush-index" }, "index-flushed");
    return count;
  }

  /**
   * Empties the registry, so that the next test finds it as {@link start}
   * left it, at the same port and with the same tokens: the server forgets
   * the uploads that wait for the index delay and their timers, sets the
   * delay back to 0, closes its connections and deletes every index,
   * `.crate` file and log of uploads and requests; this side deletes what
   * cargo and {@link seed} wrote into the Cargo homes and the registry's
   * folder, and writes the homes' configuration again. Then it checks that
   * nothing is left.
   *
   * @throws {Error} Where the server has stopped or could not empty a
   * registry, or something is left; the registry is then not fit for
   * another test.
   */
  async reset(): Promise<void> {
    const done = await this.ask({ type: "reset" }, "reset-done");
    if (done.error !== undefined) {
      throw new Error(`The test registry's server could not reset: ${done.error}`);
    }
    // What the server owns and has just emptied, which this side leaves to it and checks.
    const emptied = ["crates", "uploads.jsonl", "requests.jsonl", "registries"];
    const kept = new Set([
      "index",
      ...emptied,
      "server.log",
      ...Object.values(this.homes).map((home) => relative(this.base, home)),
    ]);
    for (const entry of readdirSync(this.base)) {
      if (!kept.has(entry)) {
        rmSync(join(this.base, entry), { recursive: true, force: true });
      }
    }
    for (const home of Object.values(this.homes)) {
      rmSync(home, { recursive: true, force: true });
    }
    this.writeHomes();

    const left = [
      ...emptied.filter((entry) => existsSync(join(this.base, entry))),
      ...readdirSync(join(this.base, "index")).map((entry) => `index/${entry}`),
    ];
    if (left.length > 0) {
      throw new Error(
        `The test registry's server left files of an earlier test after its reset: ${left.join(", ")}.`,
      );
    }
  }

  /** Whether the server has stopped or exited, so that it answers no request. */
  get stopped(): boolean {
    return this.child === undefined || !this.child.connected;
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

  /** Writes the configuration and credentials of every Cargo home. */
  private writeHomes(): void {
    for (const [file, content] of this.homeFiles) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }

  /** Sends `message` to the server and resolves to its answer of type `answer`; rejects where the server exits first. */
  private async ask<T extends ServerMessage["type"]>(
    message: ParentMessage,
    answer: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const child = this.running();
    child.channel?.ref();
    try {
      const answered = new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
        const onMessage = (reply: ServerMessage) => {
          if (reply.type === answer) {
            child.off("exit", onExit);
            child.off("message", onMessage);
            resolve(reply as Extract<ServerMessage, { type: T }>);
          }
        };
        const onExit = () => {
          child.off("message", onMessage);
          reject(new Error("The test registry's server exited."));
        };
        child.on("message", onMessage);
        child.once("exit", onExit);
      });
      send(child, message);
      return await answered;
    } finally {
      child.channel?.unref();
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
 * The registry that the tests of one test file share through
 * {@link withSharedRegistry}. Jest loads the modules afresh for each test
 * file, so that each file has its own.
 */
let shared: SparseRegistry | undefined;
/** Whether a test is using {@link shared}. */
let sharedInUse = false;

/**
 * Runs `test` with a registry that is empty as a new one, whose server the
 * tests of a test file share, so that each test does not start a server of
 * its own; the test file removes it with {@link removeSharedRegistry} in its
 * `afterAll`. The first test starts it, and each later one resets it first
 * ({@link SparseRegistry.reset}); a reset that fails fails the test, and the
 * next test starts a new server. A test that stops the server, or runs while
 * another test of the same file uses it, as with `it.concurrent`, gets a
 * server of its own, which is removed after it.
 */
export async function withSharedRegistry<T>(
  test: (registry: SparseRegistry) => Promise<T>,
  options: SparseRegistryOptions = {},
): Promise<T> {
  if (sharedInUse) {
    const own = await SparseRegistry.start(options);
    try {
      return await test(own);
    } finally {
      await own.remove();
    }
  }
  sharedInUse = true;
  try {
    let registry = shared;
    if (registry === undefined || registry.stopped) {
      await registry?.remove();
      shared = undefined;
      registry = await SparseRegistry.start();
      shared = registry;
    } else {
      try {
        await registry.reset();
      } catch (error) {
        shared = undefined;
        try {
          await registry.remove();
        } catch {
          // What the reset left may not be removable either; the reset's error says why.
        }
        throw error;
      }
    }
    if (options.indexDelay !== undefined) {
      await registry.setIndexDelay(options.indexDelay);
    }
    return await test(registry);
  } finally {
    sharedInUse = false;
  }
}

/** Stops the registry of {@link withSharedRegistry} and deletes its folder, for a test file's `afterAll`. */
export async function removeSharedRegistry(): Promise<void> {
  const registry = shared;
  shared = undefined;
  await registry?.remove();
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
