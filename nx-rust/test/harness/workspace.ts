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
import { testEnvironment } from "./environment";
import {
  copyFixture,
  FileChanges,
  FixtureName,
  pluginPackageDirectory,
  pluginPackageName,
  pluginSourceEntry,
} from "./fixtures";

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
  graph?: ProjectGraph;
  hashes?: Record<string, TaskHash>;
}

/**
 * A copy of a fixture in a temporary folder, set up as an Nx workspace that
 * loads the plugin from its TypeScript source, with a {@link CargoWrapper}
 * that sees every cargo invocation of the commands the harness runs there.
 * Its `node_modules`, which Nx ignores, links to this repository's Nx and to
 * the plugin's package folder, whose generators `nx g` then runs from source,
 * and holds a copy of the wrapper in `.bin`, ahead of Node's folder on the
 * `PATH` that `nx:run-commands` builds for its tasks.
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
    try {
      const workspace = new FixtureWorkspace(fixture, base);
      workspace.reset(...files);
      return workspace;
    } catch (error) {
      // The caller gets no workspace to remove.
      rmSync(base, { recursive: true, force: true });
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
    // Nx compiles a TypeScript plugin only where the workspace root has a
    // tsconfig; this one compiles it as the plugin's build does. It comes
    // before `files`, so that a test can replace it.
    const tsconfig = {
      "tsconfig.base.json": `${JSON.stringify({ extends: join(__dirname, "..", "..", "tsconfig.lib.json") }, null, 2)}\n`,
    };
    copyFixture(this.fixture, this.root, {
      plugin: pluginSourceEntry,
      files: [tsconfig, ...files],
    });
    const modules = join(this.root, "node_modules");
    this.cargo.placeIn(join(modules, ".bin"));
    symlinkSync(nxPackage, join(modules, "nx"), "dir");
    // Lets `nx g @convesoft/nx-rust:<generator>` find the generators, which
    // Nx then loads from their TypeScript source.
    const pluginLink = join(modules, ...pluginPackageName.split("/"));
    mkdirSync(dirname(pluginLink), { recursive: true });
    symlinkSync(pluginPackageDirectory, pluginLink, "dir");
    this.cargo.clear();
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
      throw new GraphCreationError(result.error, this.cargoCalls());
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

  /** Deletes the workspace and the cargo wrapper, unless `NX_RUST_KEEP_FIXTURES` is set. */
  remove(): void {
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
    // The plugin is CommonJS written in TypeScript, which Node's own type
    // stripping cannot load; Nx then uses swc instead.
    return this.cargo.environment(testEnvironment({ NX_PREFER_NODE_STRIP_TYPES: "false", ...env }));
  }
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
 * `text` without the colour codes that Nx writes when the environment asks
 * for colours, as `nx run-many` does for the tests it runs.
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
