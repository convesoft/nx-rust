import type {
  CreateDependenciesContext,
  NxJsonConfiguration,
  PluginConfiguration,
  ProjectConfiguration,
} from "@nx/devkit";
import { basename } from "node:path";
import { describeNxMajors, nxVerdictFor, supportedNxMajors } from "../../compatibility/nx-version";
import type { CargoWorkspace } from "../../graph/discovery";
import { registrationOf } from "../../graph/registration";
import plugin = require("../../index");

/** The name under which `nx.json` lists the plugin. */
export const pluginName = "@convesoft/nx-rust";

/** What graph creation found with the plugin's entries in `nx.json`. */
export interface GraphCheck {
  /**
   * The `Cargo.toml` files that Nx sees in the repository, relative to its
   * root, before the entries' `include` and `exclude` apply.
   */
  manifests: string[];
  /** The Cargo workspaces the entries found, each once, in the order they were found. */
  workspaces: CargoWorkspace[];
}

/** Graph creation would fail with the plugin's entries in `nx.json`. */
export class GraphCheckError extends Error {
  constructor(
    /** The errors that Nx reports for graph creation, each as Nx words it. */
    readonly errors: string[],
  ) {
    super(errors.join("\n\n"));
    this.name = "GraphCheckError";
  }
}

/**
 * The installed Nx lacks the internal parts of Nx through which the check
 * runs graph creation, or they work differently from what the check expects.
 */
export class UnsupportedNxError extends Error {
  constructor(
    /** The version of the installed Nx, if it could be read. */
    readonly nxVersion: string | undefined,
    /** What is missing or different. */
    readonly detail: string,
  ) {
    const nx = nxVersion === undefined ? "the installed Nx" : `the installed Nx ${nxVersion}`;
    super(
      [
        `nx-rust cannot check this repository with ${nx}: ${detail}.`,
        `This version of ${pluginName} supports ${describeNxMajors(supportedNxMajors())}. It runs the checks of graph creation through parts of Nx that are not public API, and ${nx} does not have them in the form it expects.`,
        `Use a supported Nx version, or a version of ${pluginName} that supports ${nx}.`,
      ].join("\n"),
    );
    this.name = "UnsupportedNxError";
  }
}

/** Whether a `plugins` entry of `nx.json` is one of this plugin. */
export function isPluginEntry(entry: PluginConfiguration): boolean {
  return (typeof entry === "string" ? entry : entry.plugin) === pluginName;
}

/**
 * Creates the project graph as Nx would with `nxJson`, as far as the
 * plugin's checks need it, without writing anything, and returns what the
 * plugin found.
 *
 * First it checks the installed Nx as the plugin does when it loads. Then
 * each entry of the plugin in `nxJson.plugins` runs the plugin's own
 * `createNodes` through Nx's project-configuration step, together with the
 * other plugins that `nxJson` lists and Nx's default plugins, in the order
 * graph creation runs them. Nx hands each entry the `Cargo.toml` files of
 * its workspace context that the entry's `include` and `exclude` let
 * through, and merges the projects of all plugins, as graph creation does.
 * Each entry's `createDependencies` then runs on the merged projects and
 * the repository's files. Every check that graph creation makes in the
 * plugin therefore runs here too, and the warnings it prints are printed
 * again. Nx's project-configuration step and plugin loader are not part of
 * its public API: the end-to-end suite checks them on each supported Nx
 * major (`REQ-COMPATIBILITY`).
 *
 * @param nxJson `nx.json` as it would be, with the plugin's entries.
 * @param workspaceRoot The absolute path of the repository root.
 * @throws {GraphCheckError} When graph creation would fail.
 * @throws {UnsupportedNxError} When the installed Nx lacks those internal
 *   parts, or they return something the check cannot read.
 */
// @mara implements DES-GENERATORS
// @mara implements DES-DIAGNOSTICS
export async function checkGraphCreation(
  nxJson: NxJsonConfiguration,
  workspaceRoot: string,
): Promise<GraphCheck> {
  const verdict = nxVerdictFor(workspaceRoot, process.env);
  if (verdict.kind === "error") {
    throw new GraphCheckError([verdict.message]);
  }
  const nx = nxInternals(workspaceRoot);
  const plugins = nxJson.plugins ?? [];
  // Nx copies the plugin module once per entry, so that each entry gets a
  // registration of its own (index.ts); the copies here do the same.
  const entries = plugins.flatMap((entry, index) =>
    isPluginEntry(entry) ? [{ entry, index, copy: { ...plugin, name: pluginName } }] : [],
  );
  const loaded = new Map(
    entries.map(({ entry, index, copy }) => [index, new nx.LoadedNxPlugin(copy, entry, index)]),
  );
  const others = await loadOtherPlugins(nx, nxJson, workspaceRoot);
  const otherSpecified = [...others.specifiedPlugins];
  const specifiedPlugins = plugins.map(
    (_entry, index) => loaded.get(index) ?? otherSpecified.shift(),
  );

  const errors: string[] = [];
  const result = await whileCreatingGraph(async () => {
    try {
      return await nx.retrieveProjectConfigurations(
        { specifiedPlugins, defaultPlugins: others.defaultPlugins },
        workspaceRoot,
        nxJson,
      );
    } catch (error) {
      if (nx.isProjectConfigurationsError(error)) {
        errors.push(...errorMessages(error));
        return error.partialProjectConfigurationsResult;
      }
      throw error;
    }
  });
  const configurations = readConfigurations(result, workspaceRoot);
  const context = await dependenciesContext(nx, configurations, nxJson, workspaceRoot);
  for (const [, loadedEntry] of [...loaded].sort(([a], [b]) => a - b)) {
    try {
      await loadedEntry.createDependencies?.(context);
    } catch (cause) {
      errors.push(dependenciesErrorMessage(nx, pluginName, cause));
    }
  }
  if (errors.length > 0) {
    throw new GraphCheckError(errors);
  }

  const workspaces = new Map<string, CargoWorkspace>();
  for (const { copy } of entries) {
    const discovery = registrationOf(copy).graphForDependencies(workspaceRoot)?.discovery;
    for (const workspace of discovery?.workspaces ?? []) {
      if (!workspaces.has(workspace.root)) {
        workspaces.set(workspace.root, workspace);
      }
    }
  }
  return {
    manifests: [
      ...new Set(
        configurations.matchingProjectFiles.filter((file) => basename(file) === "Cargo.toml"),
      ),
    ].sort(),
    workspaces: [...workspaces.values()],
  };
}

/** A plugin as Nx's loader returns it, as far as the check uses it. */
interface NxPlugin {
  createNodes?: unknown;
  createDependencies?(context: CreateDependenciesContext): Promise<unknown>;
}

/** The plugins that Nx loads for `nx.json`, split as graph creation runs them. */
interface SeparatedPlugins {
  specifiedPlugins: NxPlugin[];
  defaultPlugins: NxPlugin[];
}

/** The internal parts of Nx that the check uses, as far as it uses them. */
interface NxInternals {
  version: string | undefined;
  LoadedNxPlugin: new (plugin: object, entry: PluginConfiguration, index: number) => NxPlugin;
  retrieveProjectConfigurations(
    plugins: { specifiedPlugins: unknown[]; defaultPlugins: unknown[] },
    workspaceRoot: string,
    nxJson: NxJsonConfiguration,
  ): Promise<unknown>;
  isProjectConfigurationsError(
    error: unknown,
  ): error is { errors?: unknown; message?: unknown; partialProjectConfigurationsResult?: unknown };
  ProcessDependenciesError?: new (pluginName: string, options: { cause: unknown }) => Error;
  getPluginsSeparated(nxJson: NxJsonConfiguration, root: string): Promise<unknown>;
  retrieveWorkspaceFiles(
    workspaceRoot: string,
    projectRootMap: Record<string, string>,
  ): Promise<unknown>;
}

/**
 * Nx's internals from the Nx installed in the repository, which is the Nx
 * that runs the generator, after checking that each part the check uses is
 * there and is what the check calls: a constructor or a function.
 *
 * @throws {UnsupportedNxError} When a part is missing or of another kind.
 */
function nxInternals(workspaceRoot: string): NxInternals {
  const version = nxVersion(workspaceRoot);
  const modules = {
    "nx/src/devkit-internals": [
      "LoadedNxPlugin",
      "retrieveProjectConfigurations",
      "isProjectConfigurationsError",
    ],
    "nx/src/project-graph/plugins/get-plugins": ["getPluginsSeparated"],
    "nx/src/project-graph/utils/retrieve-workspace-files": ["retrieveWorkspaceFiles"],
  };
  const internals: Record<string, unknown> = { version };
  for (const [path, names] of Object.entries(modules)) {
    let module: Record<string, unknown>;
    try {
      module = require(require.resolve(path, { paths: [workspaceRoot] }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new UnsupportedNxError(version, `${path} could not be loaded (${reason})`);
    }
    for (const name of names) {
      const part = module?.[name];
      if (name === "LoadedNxPlugin") {
        if (typeof part !== "function" || typeof part.prototype !== "object") {
          throw new UnsupportedNxError(version, `${name} from ${path} is not a constructor`);
        }
      } else if (typeof part !== "function") {
        throw new UnsupportedNxError(version, `${name} from ${path} is not a function`);
      }
      internals[name] = part;
    }
    if (
      path === "nx/src/devkit-internals" &&
      typeof module.ProcessDependenciesError === "function"
    ) {
      internals.ProcessDependenciesError = module.ProcessDependenciesError;
    }
  }
  return internals as unknown as NxInternals;
}

// The plugins of `nx.json` other than this one's entries, and Nx's default
// plugins, loaded the way graph creation loads them. A plugin that fails to
// load fails graph creation as well.
async function loadOtherPlugins(
  nx: NxInternals,
  nxJson: NxJsonConfiguration,
  workspaceRoot: string,
): Promise<SeparatedPlugins> {
  const otherEntries = (nxJson.plugins ?? []).filter((entry) => !isPluginEntry(entry));
  let separated: unknown;
  try {
    separated = await nx.getPluginsSeparated({ ...nxJson, plugins: otherEntries }, workspaceRoot);
  } catch (error) {
    throw new GraphCheckError([error instanceof Error ? error.message : String(error)]);
  }
  const { specifiedPlugins, defaultPlugins } = (separated ?? {}) as Partial<SeparatedPlugins>;
  if (
    !Array.isArray(specifiedPlugins) ||
    !Array.isArray(defaultPlugins) ||
    specifiedPlugins.length !== otherEntries.length
  ) {
    throw new UnsupportedNxError(
      nx.version,
      "the result of getPluginsSeparated from nx/src/project-graph/plugins/get-plugins is not one specified plugin per entry and a list of default plugins",
    );
  }
  return { specifiedPlugins, defaultPlugins };
}

/** What Nx's project-configuration step returns, as far as the check reads it. */
interface Configurations {
  /** The merged projects, by root. */
  projects: Record<string, ProjectConfiguration>;
  /** The name of the project at each root. */
  projectRootMap: Record<string, string>;
  externalNodes: CreateDependenciesContext["externalNodes"];
  /** The files that the plugins' patterns matched. */
  matchingProjectFiles: string[];
}

function readConfigurations(result: unknown, workspaceRoot: string): Configurations {
  const value = (result ?? {}) as Partial<Configurations>;
  const isRecord = (x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x);
  if (
    !Array.isArray(value.matchingProjectFiles) ||
    !value.matchingProjectFiles.every((file) => typeof file === "string")
  ) {
    throw new UnsupportedNxError(
      nxVersion(workspaceRoot),
      "the result of retrieveProjectConfigurations from nx/src/devkit-internals has no matchingProjectFiles list of file paths",
    );
  }
  if (!isRecord(value.projects) || !isRecord(value.projectRootMap)) {
    throw new UnsupportedNxError(
      nxVersion(workspaceRoot),
      "the result of retrieveProjectConfigurations from nx/src/devkit-internals has no projects and projectRootMap by project root",
    );
  }
  return {
    projects: value.projects,
    projectRootMap: value.projectRootMap,
    externalNodes: value.externalNodes ?? {},
    matchingProjectFiles: value.matchingProjectFiles,
  };
}

// What graph creation hands `createDependencies`: the merged projects by
// name, which keeps the last of several projects that share one, and the
// files of the repository by project.
async function dependenciesContext(
  nx: NxInternals,
  configurations: Configurations,
  nxJson: NxJsonConfiguration,
  workspaceRoot: string,
): Promise<CreateDependenciesContext> {
  const projects: Record<string, ProjectConfiguration> = {};
  for (const project of Object.values(configurations.projects)) {
    projects[project.name] = project;
  }
  const files = (await nx.retrieveWorkspaceFiles(workspaceRoot, configurations.projectRootMap)) as {
    fileMap?: CreateDependenciesContext["fileMap"];
  } | null;
  const fileMap = files?.fileMap;
  if (
    typeof fileMap?.projectFileMap !== "object" ||
    fileMap.projectFileMap === null ||
    !Array.isArray(fileMap.nonProjectFiles)
  ) {
    throw new UnsupportedNxError(
      nx.version,
      "the result of retrieveWorkspaceFiles from nx/src/project-graph/utils/retrieve-workspace-files has no fileMap with projectFileMap and nonProjectFiles",
    );
  }
  return {
    nxJsonConfiguration: nxJson,
    projects,
    externalNodes: configurations.externalNodes,
    workspaceRoot,
    fileMap,
    filesToProcess: fileMap,
  };
}

// Runs `create` as graph creation runs plugins, with the flag that Nx sets
// while it creates the graph.
async function whileCreatingGraph<T>(create: () => Promise<T>): Promise<T> {
  const graphCreation = globalThis as { NX_GRAPH_CREATION?: boolean };
  const wasCreating = graphCreation.NX_GRAPH_CREATION;
  graphCreation.NX_GRAPH_CREATION = true;
  try {
    return await create();
  } finally {
    if (wasCreating === undefined) {
      delete graphCreation.NX_GRAPH_CREATION;
    } else {
      graphCreation.NX_GRAPH_CREATION = wasCreating;
    }
  }
}

// The messages of the errors that Nx collected for graph creation, or the
// message of the error itself where it holds no list of them.
function errorMessages(error: { errors?: unknown; message?: unknown }): string[] {
  const messages = Array.isArray(error.errors)
    ? error.errors.map((e: { message?: unknown } | null) => e?.message)
    : [];
  return messages.length > 0 && messages.every((message) => typeof message === "string")
    ? messages
    : [String(error.message ?? error)];
}

// The message with which graph creation reports an error of
// `createDependencies`.
function dependenciesErrorMessage(nx: NxInternals, name: string, cause: unknown): string {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  return nx.ProcessDependenciesError === undefined
    ? `The "${name}" plugin threw an error while creating dependencies: ${error.message}`
    : new nx.ProcessDependenciesError(name, { cause: error }).message;
}

// The version of the Nx installed in the repository, if it can be read.
function nxVersion(workspaceRoot: string): string | undefined {
  try {
    const version: unknown = require(
      require.resolve("nx/package.json", { paths: [workspaceRoot] }),
    ).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}
