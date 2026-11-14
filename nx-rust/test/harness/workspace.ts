import type {
  ProjectConfiguration,
  ProjectGraph,
  ProjectGraphDependency,
  ProjectGraphExternalNode,
} from "@nx/devkit";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CargoCall, CargoWrapper } from "./cargo-wrapper";
import { loadsCompiledPlugin, pluginEntry, pluginPackage } from "./compiled-plugin";
import { testEnvironment } from "./environment";
import { testRunSocketFolder } from "./test-run";
import { fakeNxPackage } from "./nx-package";
import { copyFixture, FileChanges, FixtureName, pluginPackageName } from "./fixtures";

/** The project graph that Nx built for a fixture, arranged for comparison. */
export interface FixtureGraph {
  /** Each project's configuration, by project name. */
  projects: Record<string, ProjectConfiguration>;
  /** Every edge, sorted by source, target and type. */
  dependencies: ProjectGraphDependency[];
  /** External nodes, by name. */
  externalNodes: Record<string, ProjectGraphExternalNode>;
}

/** What Nx computed for a task's cache key. */
export interface TaskHash {
  value: string;
  /** The hash of each input, as Nx reports it. */
  details: Record<string, unknown>;
}

/** What a hash computation sees besides the files. */
export interface HashOptions {
  /** Environment variables to set; `undefined` removes one. */
  env?: Record<string, string | undefined>;
  /** Options as `nx run project:target --name=value` passes them. */
  overrides?: Record<string, unknown>;
}

/** Graph creation failed. The message holds every error Nx and the plugins reported. */
export class GraphCreationError extends Error {
  constructor(
    message: string,
    /** The cargo invocations up to the failure, relative to the workspace root. */
    readonly cargoCalls: CargoCall[],
    /**
     * The message of each error that Nx or a plugin raised, without the
     * errors that Nx wraps around it, such as the heading of a plugin whose
     * `createNodes` failed.
     */
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "GraphCreationError";
  }
}

const inspectScript = join(__dirname, "inspect-workspace.cjs");

// The Nx package of this repository, which every workspace links to.
const nxPackage = dirname(require.resolve("nx/package.json"));
const nxBin: string = JSON.parse(readFileSync(join(nxPackage, "package.json"), "utf8")).bin.nx;

/** What inspect-workspace.cjs writes. */
interface InspectResult {
  ok: boolean;
  error?: string;
  errors?: string[];
  graph?: ProjectGraph;
  hashes?: Record<string, TaskHash>;
  files?: Record<string, string[]>;
  globbed?: string[];
}

/**
 * A copy of a fixture in a temporary folder, set up as an Nx workspace that
 * loads the plugin ({@link pluginEntry}: the test run's compiled copy, or the
 * TypeScript source without one), with a {@link CargoWrapper} that sees every
 * cargo invocation of the commands the harness runs there. Its
 * `node_modules`, which Nx ignores, links to this repository's Nx and to the
 * plugin's package ({@link pluginPackage}), where Nx finds the executors and
 * `nx g` the generators, and holds a copy of the wrapper in `.bin`, ahead of
 * Node's folder on the `PATH` that `nx:run-commands` builds for its tasks.
 *
 * Its Nx keeps its sockets in a folder of their own ({@link socketFolder}),
 * and loads the plugins into its own process unless a command asks for
 * plugin workers or the daemon ({@link pluginsInNxProcess}).
 *
 * Remove it with {@link FixtureWorkspace.remove} when the test is done.
 * Setting `NX_RUST_KEEP_FIXTURES=1` keeps every workspace for inspection.
 */
export class FixtureWorkspace {
  /** The repository root of the copy. */
  readonly root: string;
  /** The wrapper that logs the cargo invocations in this workspace. */
  readonly cargo: CargoWrapper;
  private requests = 0;

  private constructor(
    readonly fixture: FixtureName,
    private readonly base: string,
    private readonly sockets: string | undefined,
  ) {
    this.root = join(base, "repo");
    this.cargo = CargoWrapper.install(join(base, "cargo"));
  }

  /**
   * Copies `fixture` into a new temporary folder.
   *
   * @param files Changes applied in order on top of the fixture.
   */
  static create(fixture: FixtureName, ...files: (FileChanges | undefined)[]): FixtureWorkspace {
    // The real path, so that it matches what cargo and Nx report on macOS,
    // where the temporary folder is reached through a symbolic link.
    const base = realpathSync(mkdtempSync(join(tmpdir(), `nx-rust-${fixture}-`)));
    const sockets = socketFolder();
    try {
      const workspace = new FixtureWorkspace(fixture, base, sockets);
      workspace.reset(...files);
      return workspace;
    } catch (error) {
      // The caller gets no workspace to remove.
      for (const folder of [base, sockets]) {
        if (folder !== undefined) {
          rmSync(folder, { recursive: true, force: true });
        }
      }
      throw error;
    }
  }

  /**
   * Puts the fixture back at the same path, with `files` applied, and
   * forgets the logged cargo invocations. Nothing of an earlier state is
   * left, not even Nx's workspace data.
   */
  reset(...files: (FileChanges | undefined)[]): void {
    rmSync(this.root, { recursive: true, force: true });
    // Nx compiles a TypeScript plugin, such as the plugin's source or the
    // discovery probe, only where the workspace root has a tsconfig; this one
    // compiles it as the plugin's build does. It comes before `files`, so
    // that a test can replace it.
    const tsconfig = {
      "tsconfig.base.json": `${JSON.stringify({ extends: join(__dirname, "..", "..", "tsconfig.lib.json") }, null, 2)}\n`,
    };
    copyFixture(this.fixture, this.root, {
      plugin: pluginEntry(),
      files: [tsconfig, ...files],
    });
    const modules = join(this.root, "node_modules");
    this.cargo.placeIn(join(modules, ".bin"));
    symlinkSync(nxPackage, join(modules, "nx"), "dir");
    // Lets Nx find the executors of the plugin's targets and
    // `nx g @convesoft/nx-rust:<generator>` the generators, in the package
    // whose entry point nx.json names.
    const pluginLink = join(modules, ...pluginPackageName.split("/"));
    mkdirSync(dirname(pluginLink), { recursive: true });
    symlinkSync(pluginPackage(), pluginLink, "dir");
    this.cargo.clear();
  }

  /**
   * Makes the workspace's Nx report `version`, as if it had been installed:
   * `node_modules/nx` then links to a copy of this repository's Nx that
   * gives that version ({@link fakeNxPackage}). The commands of
   * {@link FixtureWorkspace.nx} and the graph of {@link FixtureWorkspace.graph}
   * run that copy. {@link FixtureWorkspace.reset} links the real Nx again.
   */
  useNx(version: string): void {
    const copy = join(this.base, `nx-${version}`);
    const nx = existsSync(copy) ? join(copy, "node_modules", "nx") : fakeNxPackage(copy, version);
    const link = join(this.root, "node_modules", "nx");
    rmSync(link, { force: true });
    symlinkSync(nx, link, "dir");
  }

  /** What the Nx daemon of this workspace has written to its log, or "" without one. */
  daemonLog(): string {
    const log = join(this.root, ".nx", "workspace-data", "d", "daemon.log");
    return existsSync(log) ? readFileSync(log, "utf8") : "";
  }

  /** The cargo invocations logged so far, relative to the workspace root. */
  cargoCalls(): CargoCall[] {
    return this.cargo.calls(this.root);
  }

  /**
   * Every file of the repository with its content, by path relative to the
   * root, apart from those in `node_modules` and in Nx's `.nx` folder.
   */
  files(folder = ""): Record<string, string> {
    const files: Record<string, string> = {};
    for (const entry of readdirSync(join(this.root, folder), { withFileTypes: true })) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (path !== "node_modules" && path !== ".nx") {
          Object.assign(files, this.files(path));
        }
      } else {
        files[path] = readFileSync(join(this.root, path), "utf8");
      }
    }
    return files;
  }

  /**
   * Creates the project graph as `nx graph` does.
   *
   * @throws {GraphCreationError} When Nx or the plugin fails.
   */
  async graph(env: Record<string, string | undefined> = {}): Promise<FixtureGraph> {
    const result = await this.inspect({ command: "graph" }, env);
    if (!result.ok) {
      throw new GraphCreationError(result.error, this.cargoCalls(), result.errors);
    }
    const graph = result.graph;
    return {
      projects: Object.fromEntries(
        Object.entries(graph.nodes).map(([name, node]) => [name, node.data]),
      ),
      dependencies: Object.values(graph.dependencies)
        .flat()
        .sort(
          (a, b) =>
            a.source.localeCompare(b.source) ||
            a.target.localeCompare(b.target) ||
            a.type.localeCompare(b.type),
        ),
      externalNodes: graph.externalNodes ?? {},
    };
  }

  /**
   * Hashes tasks with Nx's own task hasher, as `nx run` would before running
   * them. Each task gets the task graph that `nx run project:target` builds.
   *
   * @param tasks Task ids such as `api:test` or `api:build:release`.
   */
  async hashTasks(tasks: string[], options: HashOptions = {}): Promise<Record<string, TaskHash>> {
    const result = await this.inspect(
      { command: "hash", tasks, overrides: options.overrides ?? {} },
      options.env ?? {},
    );
    if (!result.ok) {
      throw new Error(`Hashing ${tasks.join(", ")} in ${this.fixture} failed:\n${result.error}`);
    }
    return result.hashes;
  }

  /**
   * The files that Nx hashes for each of `tasks`, by their paths relative to
   * the repository root, as its `HashPlanInspector` lists them, without the
   * daemon.
   */
  async taskFiles(tasks: string[]): Promise<Record<string, string[]>> {
    const result = await this.inspect({ command: "files", tasks }, { NX_DAEMON: "false" });
    if (!result.ok || result.files === undefined) {
      throw new Error(
        `Listing the files of ${tasks.join(", ")} in ${this.fixture} failed:\n${result.error}`,
      );
    }
    return result.files;
  }

  /**
   * The files of the workspace that Nx's own glob, the engine of its
   * filesets, finds for `globs`, whatever project holds them, by their paths
   * relative to the repository root. No project graph is created for it.
   */
  async glob(globs: string[]): Promise<string[]> {
    const result = await this.inspect({ command: "glob", globs }, { NX_DAEMON: "false" });
    if (!result.ok || result.globbed === undefined) {
      throw new Error(
        `Nx's glob of ${globs.join(", ")} in ${this.fixture} failed:\n${result.error}`,
      );
    }
    return result.globbed;
  }

  /**
   * Runs the Nx command line in the workspace, such as
   * `nx(["run", "api:test", "--skip-nx-cache"])`, and returns its exit status
   * and output.
   *
   * @param env Environment variables to set; `undefined` removes one.
   * @param cwd The folder to run Nx in, relative to the workspace root.
   */
  nx(
    args: string[],
    env: Record<string, string | undefined> = {},
    cwd = ".",
  ): Promise<{ status: number | null; output: string }> {
    return run(process.execPath, [join(this.root, "node_modules", "nx", nxBin), ...args], {
      cwd: join(this.root, cwd),
      // INIT_CWD, which the package manager of an outer run sets, would
      // override the folder for Nx's generators.
      env: this.environment({ NX_TUI: "false", INIT_CWD: undefined, ...env }),
    });
  }

  /**
   * Deletes the workspace and the cargo wrapper, unless `NX_RUST_KEEP_FIXTURES`
   * is set, and the folder for its sockets once the processes of its Nx have
   * stopped ({@link removeSocketFolder}).
   */
  remove(): void {
    if (this.sockets !== undefined) {
      removeSocketFolder(this.sockets);
    }
    if (process.env.NX_RUST_KEEP_FIXTURES) {
      console.log(`Kept the ${this.fixture} workspace in ${this.root}`);
      return;
    }
    rmSync(this.base, { recursive: true, force: true });
  }

  // Runs inspect-workspace.cjs in the workspace. Request and result live
  // outside the workspace, so that Nx does not see them.
  private async inspect(
    request: object,
    env: Record<string, string | undefined>,
  ): Promise<InspectResult> {
    const directory = join(this.base, "requests");
    mkdirSync(directory, { recursive: true });
    const number = ++this.requests;
    const requestFile = join(directory, `${number}.request.json`);
    const resultFile = join(directory, `${number}.result.json`);
    writeFileSync(requestFile, JSON.stringify(request));
    const { status, output } = await run(
      process.execPath,
      [inspectScript, requestFile, resultFile],
      { cwd: this.root, env: this.environment(env) },
    );
    if (!existsSync(resultFile)) {
      throw new Error(
        `Nx exited with status ${status} in ${this.root} and reported nothing:\n${output}`,
      );
    }
    return JSON.parse(readFileSync(resultFile, "utf8"));
  }

  // The environment of every command the harness runs in the workspace.
  private environment(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
    // The plugin's source and the discovery probe are CommonJS written in
    // TypeScript, which Node's own type stripping cannot load; Nx then uses
    // swc instead.
    const base = testEnvironment({
      NX_PREFER_NODE_STRIP_TYPES: "false",
      NX_SOCKET_DIR: this.sockets,
      ...pluginsInNxProcess(env),
      ...env,
    });
    if (loadsCompiledPlugin()) {
      // Stack traces of the compiled plugin name the lines of its source.
      base.NODE_OPTIONS = [base.NODE_OPTIONS, "--enable-source-maps"].filter(Boolean).join(" ");
    }
    return this.cargo.environment(base);
  }
}

/**
 * The variables that have a fixture's Nx run its plugins as Nx does by
 * default, each entry of `nx.json` in a plugin worker of its own, where
 * {@link pluginsInNxProcess} would load them into Nx's own process. A test
 * passes them to keep a case in the default mode beside the same case with
 * the daemon or without plugin isolation.
 */
export const pluginWorkers: Readonly<Record<string, string>> = { NX_ISOLATE_PLUGINS: "true" };

/**
 * `NX_ISOLATE_PLUGINS=false` for a command whose variables set neither it nor
 * `NX_DAEMON=true`: Nx then loads the plugins into its own process instead of
 * starting a plugin worker for each entry of `nx.json`, which took about
 * 200 ms of each graph creation. Besides that choice, Nx 24 reads the
 * variable only where it runs a `preTasksExecution` hook, to carry the
 * changes that the hook makes to `process.env` from a worker to the `nx`
 * process; in Nx's own process the hook makes them there directly, and the
 * tasks get them either way.
 *
 * The daemon keeps Nx's default, and so do the cases that pass
 * {@link pluginWorkers}, and the end-to-end tests, whose commands do not run
 * through this harness.
 */
function pluginsInNxProcess(env: Record<string, string | undefined>): Record<string, string> {
  return env.NX_DAEMON === "true" || "NX_ISOLATE_PLUGINS" in env
    ? {}
    : { NX_ISOLATE_PLUGINS: "false" };
}

/** The longest name Nx gives a socket, as in `p<pid>-<counter>-<8 hex digits>.sock`. */
const socketNameLength = 32;
/** The longest path of a Unix socket on macOS; Linux allows 107 bytes. */
const socketPathLimit = 103;

/**
 * A new folder for the sockets of one workspace's Nx, in the test run's
 * socket folder ({@link testRunSocketFolder}), or `undefined` where the run
 * has none and Nx uses its own.
 *
 * Nx names the folder it uses by default after the workspace root and never
 * removes it, so that every fixture would leave one behind in
 * `/tmp/.nx/<uid>/sockets`. It does not let workspaces share a folder.
 * {@link FixtureWorkspace.remove} removes the folder
 * ({@link removeSocketFolder}), and the end of the test run removes what is
 * left where that ran out of time.
 */
function socketFolder(): string | undefined {
  const parent = testRunSocketFolder();
  if (parent === undefined) {
    return undefined;
  }
  const folder = mkdtempSync(join(parent, "w-"));
  if (folder.length + 1 + socketNameLength <= socketPathLimit) {
    return folder;
  }
  rmSync(folder, { recursive: true, force: true });
  return undefined;
}

/**
 * How long {@link removeSocketFolder} waits for the processes of a fixture's
 * Nx to stop. In a full unit run under a load average of about 20, none was
 * left a second after its command.
 */
const socketWait = 5_000;

/**
 * Removes a fixture's socket folder ({@link socketFolder}) once no process
 * listens there any more, or after {@link socketWait} at the latest.
 *
 * Nx starts its plugin workers and its daemon detached, and they outlive the
 * command that ends them by up to a second: a plugin worker stops when the
 * connection to its `nx` process ends, and a daemon after
 * `nx daemon --stop` has returned. Each removes its socket on the way out,
 * and the daemon the whole folder, which is its `NX_SOCKET_DIR`; a folder
 * without entries therefore has no process listening there. Removing it
 * earlier races with them: `rmSync` returns without an error but leaves the
 * folder, emptied, when another process removes one of its entries at the
 * same moment (Node 26.12), which is why it is repeated while the folder is
 * still there; and a process that asks Nx for a socket path after the
 * removal creates the folder again.
 *
 * Without a socket in it, as for the commands that load the plugins into
 * Nx's own process, the folder goes at once.
 */
function removeSocketFolder(folder: string): void {
  const deadline = Date.now() + socketWait;
  while (holdsEntries(folder) && Date.now() < deadline) {
    pause(10);
  }
  rmSync(folder, { recursive: true, force: true });
  while (existsSync(folder) && Date.now() < deadline) {
    pause(10);
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Whether `folder` exists and has entries. */
function holdsEntries(folder: string): boolean {
  try {
    return readdirSync(folder).length > 0;
  } catch {
    return false;
  }
}

/**
 * Blocks the test process for `milliseconds`, for
 * {@link FixtureWorkspace.remove}, which the tests call without awaiting
 * anything.
 */
function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Loads a fixture through the plugin and returns the graph Nx built for it,
 * together with the cargo invocations that building it took.
 *
 * @throws {GraphCreationError} When Nx or the plugin fails.
 */
export async function loadFixtureGraph(
  fixture: FixtureName,
  options: { files?: FileChanges; env?: Record<string, string | undefined> } = {},
): Promise<FixtureGraph & { cargoCalls: CargoCall[] }> {
  const workspace = FixtureWorkspace.create(fixture, options.files);
  try {
    const graph = await workspace.graph(options.env);
    return { ...graph, cargoCalls: workspace.cargoCalls() };
  } finally {
    workspace.remove();
  }
}

// ESC, `[`, parameters and `m`; built from the character code, because a
// control character in a regular expression literal reads as a mistake.
const colourCode = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * `text` without the colour codes that Nx writes into the output of every
 * command that the harness runs ({@link testEnvironment}).
 */
export function withoutColours(text: string): string {
  return text.replace(colourCode, "");
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output }));
  });
}
