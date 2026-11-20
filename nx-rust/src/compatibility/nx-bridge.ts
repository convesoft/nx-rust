import type {
  CreateDependenciesContext,
  NxJsonConfiguration,
  PluginConfiguration,
  ProjectConfiguration,
  ProjectGraph,
  ProjectGraphProjectNode,
  TargetConfiguration,
  Task,
} from "@nx/devkit";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** Loads a resolved module path; replaced in tests where needed. */
export type ModuleLoader = (resolvedPath: string) => unknown;

/** Options accepted by every bridge loader. */
export interface BridgeLoadOptions {
  /** Custom module loader, defaulting to Node's `require`. */
  load?: ModuleLoader;
}

/** Structured cause of a bridge load or shape-check failure. */
export type NxBridgeFailure =
  | {
      kind: "load";
      module: string;
      /** First line of the underlying error message. */
      reason: string;
      /** Full underlying error message. */
      fullReason: string;
    }
  | {
      kind: "export";
      module: string;
      exportName: string;
      expected: "function" | "constructor" | "createNodes";
    };

/**
 * Thrown when a private `nx/src/*` module or one of its dependencies cannot be
 * loaded, or lacks an export of the expected shape (`RISK-UPSTREAM-CHANGES`).
 */
export class NxBridgeError extends Error {
  constructor(readonly failure: NxBridgeFailure) {
    super(describeFailure(failure));
    this.name = "NxBridgeError";
  }
}

/**
 * Resolves `specifier` from the repository at `workspaceRoot`, matching Nx's
 * own resolution order (`getNxRequirePaths` in
 * `nx/src/utils/installation-directory`): `.nx/installation` first, then
 * `workspaceRoot`, falling back to the plugin's own resolution when `nx` is
 * not installed in the repository.
 *
 * Non-`MODULE_NOT_FOUND` errors (such as an unreadable `package.json` or a
 * disallowed package export) are never masked by fallback. Likewise, when `nx`
 * itself resolves from the repository and a subpath `nx/...` is missing from
 * that `nx` package, the `MODULE_NOT_FOUND` error stands rather than mixing
 * modules from the plugin's peer dependency.
 */
// @mara implements REQ-COMPATIBILITY
export function resolveFromRepository(specifier: string, workspaceRoot?: string): string {
  if (workspaceRoot === undefined) {
    return require.resolve(specifier);
  }
  const paths = [join(workspaceRoot, ".nx", "installation"), workspaceRoot];
  try {
    return require.resolve(specifier, { paths });
  } catch (error) {
    if (errorCode(error) !== "MODULE_NOT_FOUND") {
      throw error;
    }
    if (specifier !== "nx/package.json" && specifier.startsWith("nx/")) {
      try {
        require.resolve("nx/package.json", { paths });
        throw error;
      } catch (nxError) {
        if (nxError === error || errorCode(nxError) !== "MODULE_NOT_FOUND") {
          throw nxError;
        }
      }
    }
    return require.resolve(specifier);
  }
}

/**
 * The version from `nx/package.json` resolved from `workspaceRoot`, or
 * `undefined` when it cannot be read.
 */
export function readNxPackageVersion(
  workspaceRoot: string,
  load: ModuleLoader = require,
): string | undefined {
  try {
    const manifest = load(resolveFromRepository("nx/package.json", workspaceRoot));
    const version = isRecord(manifest) ? manifest.version : undefined;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/** The `yargs-parser` function of the installed `nx` package. */
export type NxYargsParser = (
  args: string[],
  options: { boolean?: string[]; configuration: Record<string, boolean> },
) => Record<string, unknown> & { _: unknown[] };

const yargsParsers = new Map<string, NxYargsParser>();

/**
 * Loads `yargs-parser` from the `nx` package resolved from `workspaceRoot`
 * (or from the plugin's resolution when `workspaceRoot` is omitted).
 *
 * @throws {NxBridgeError} When `nx/package.json` or `yargs-parser` cannot be
 *   loaded or is not a function.
 */
export function loadNxYargsParser(workspaceRoot?: string): NxYargsParser {
  let packageJson: string;
  try {
    packageJson = resolveFromRepository("nx/package.json", workspaceRoot);
  } catch (error) {
    throw loadFailure("nx/package.json", error);
  }
  const cached = yargsParsers.get(packageJson);
  if (cached !== undefined) {
    return cached;
  }
  let loaded: unknown;
  try {
    loaded = createRequire(packageJson)("yargs-parser");
  } catch (error) {
    throw loadFailure("yargs-parser", error);
  }
  if (typeof loaded !== "function") {
    throw new NxBridgeError({
      kind: "export",
      module: "yargs-parser",
      exportName: "default",
      expected: "function",
    });
  }
  const parser = loaded as NxYargsParser;
  yargsParsers.set(packageJson, parser);
  return parser;
}

/**
 * Loads a dependency of the installed `nx` package, resolved relative to an
 * already-resolved module file inside that `nx` package.
 *
 * @throws {NxBridgeError} When the dependency cannot be loaded.
 */
export function loadNxDependency(nxModulePath: string, name: string): Record<string, unknown> {
  try {
    const loaded: unknown = require(require.resolve(name, { paths: [dirname(nxModulePath)] }));
    return isRecord(loaded) ? loaded : {};
  } catch (error) {
    throw loadFailure(name, error);
  }
}

/**
 * Reads the version of a dependency of the installed `nx` package relative to
 * an already-resolved module file inside that `nx` package, or `undefined`.
 */
export function readNxDependencyVersion(nxModulePath: string, name: string): string | undefined {
  try {
    const manifest: unknown = require(
      require.resolve(`${name}/package.json`, { paths: [dirname(nxModulePath)] }),
    );
    const version = isRecord(manifest) ? manifest.version : undefined;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Private `nx/src/*` module contracts and loaders
// ---------------------------------------------------------------------------

/** A project as Nx's root maps hold it while merging layers of a project. */
export interface NxRootMapProject {
  root: string;
  name?: string;
  tags?: string[];
  namedInputs?: Record<string, unknown[]>;
  targets?: Record<string, TargetConfiguration>;
}

/** Nx's source maps: by project root, the file and plugin behind each key. */
export type NxSourceMaps = Record<string, Record<string, [string | null, string]>>;

/** A dependency as Nx's task graph normalises a `dependsOn` entry. */
export interface NxNormalisedDependency {
  target?: string;
  projects?: string[];
  dependencies?: boolean;
}

/** The project graph, as far as Nx's normalisation of `dependsOn` reads it. */
export interface NxDependencyGraph {
  nodes: Record<string, { name: string; type: string; data: ProjectConfiguration }>;
}

/** A loaded Nx plugin, as far as `init`'s graph check uses it. */
export interface NxLoadedPlugin {
  createNodes?: unknown;
  createDependencies?(context: CreateDependenciesContext): Promise<unknown>;
}

/** The exports of `nx/src/devkit-internals` used by the plugin. */
export interface NxDevkitInternals {
  mergeTargetConfigurations(
    target: TargetConfiguration,
    baseTarget: TargetConfiguration | undefined,
    projectConfigSourceMap: undefined,
    sourceInformation: undefined,
    targetIdentifier: undefined,
    deferSpreadsWithoutBase: boolean,
  ): TargetConfiguration;
  findMatchingConfigFiles(
    files: readonly string[],
    include: readonly string[] | undefined,
    exclude: readonly string[] | undefined,
  ): string[];
  createGitIgnoreChecker(tree: { read(path: string): string | null }): unknown;
  LoadedNxPlugin: new (plugin: object, entry: PluginConfiguration, index: number) => NxLoadedPlugin;
  retrieveProjectConfigurations(
    plugins: { specifiedPlugins: unknown[]; defaultPlugins: unknown[] },
    workspaceRoot: string,
    nxJson: NxJsonConfiguration,
  ): Promise<unknown>;
  isProjectConfigurationsError(
    error: unknown,
  ): error is { errors?: unknown; message?: unknown; partialProjectConfigurationsResult?: unknown };
  ProcessDependenciesError: new (pluginName: string, options: { cause: unknown }) => Error;
  createTargetDefaultsResults(
    specifiedPluginRootMap: Record<string, NxRootMapProject>,
    defaultPluginRootMap: Record<string, NxRootMapProject>,
    nxJson: { targetDefaults?: unknown },
    specifiedSourceMaps: NxSourceMaps,
  ): [string, string, { projects?: Record<string, NxRootMapProject> }][];
  findMatchingTargetNames(pattern: string, names: string[]): string[];
  expandDependencyConfigSyntaxSugar(
    entry: unknown,
    graph: NxDependencyGraph,
    project: string,
  ): unknown;
  normalizeDependencyConfigProjects(
    entry: unknown,
    project: string,
    graph: NxDependencyGraph,
  ): NxNormalisedDependency;
}

const devkitInternalsModule = "nx/src/devkit-internals";

/**
 * Loads requested exports from `nx/src/devkit-internals`, validating each
 * required export's shape before returning.
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks a required
 *   export of the expected shape.
 */
export function loadDevkitInternals<
  K extends keyof NxDevkitInternals,
  O extends keyof NxDevkitInternals = never,
>(
  workspaceRoot: string,
  required: readonly K[],
  options?: BridgeLoadOptions & { optional?: readonly O[] },
): Pick<NxDevkitInternals, K> & Partial<Pick<NxDevkitInternals, O>> {
  const { module } = loadPrivateModule(devkitInternalsModule, workspaceRoot, options?.load);
  const result: Record<string, unknown> = {};
  for (const name of required) {
    result[name] = requireExport(
      module,
      devkitInternalsModule,
      name,
      name === "LoadedNxPlugin" ? "constructor" : "function",
    );
  }
  for (const name of options?.optional ?? []) {
    const value = module[name];
    const ok =
      name === "LoadedNxPlugin"
        ? typeof value === "function" && typeof value.prototype === "object"
        : typeof value === "function";
    if (ok) {
      result[name] = value;
    }
  }
  return result as Pick<NxDevkitInternals, K> & Partial<Pick<NxDevkitInternals, O>>;
}

/** The exports of `nx/src/project-graph/plugins/get-plugins` used by the plugin. */
export interface NxGetPlugins {
  getPluginsSeparated(nxJson: NxJsonConfiguration, root: string): Promise<unknown>;
}

const getPluginsModule = "nx/src/project-graph/plugins/get-plugins";

/**
 * Loads `getPluginsSeparated` from `nx/src/project-graph/plugins/get-plugins`.
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks the export.
 */
export function loadGetPlugins(workspaceRoot: string, options?: BridgeLoadOptions): NxGetPlugins {
  const { module } = loadPrivateModule(getPluginsModule, workspaceRoot, options?.load);
  return {
    getPluginsSeparated: requireExport(
      module,
      getPluginsModule,
      "getPluginsSeparated",
      "function",
    ) as NxGetPlugins["getPluginsSeparated"],
  };
}

/** The exports of `nx/src/project-graph/utils/retrieve-workspace-files` used by the plugin. */
export interface NxRetrieveWorkspaceFiles {
  retrieveWorkspaceFiles(
    workspaceRoot: string,
    projectRootMap: Record<string, string>,
  ): Promise<unknown>;
  retrieveProjectConfigurationPaths(root: string, plugins: readonly object[]): Promise<unknown>;
}

const retrieveWorkspaceFilesModule = "nx/src/project-graph/utils/retrieve-workspace-files";

/**
 * Loads requested exports from `nx/src/project-graph/utils/retrieve-workspace-files`.
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks a required export.
 */
export function loadRetrieveWorkspaceFiles<K extends keyof NxRetrieveWorkspaceFiles>(
  workspaceRoot: string,
  required: readonly K[],
  options?: BridgeLoadOptions,
): Pick<NxRetrieveWorkspaceFiles, K> {
  const { module } = loadPrivateModule(retrieveWorkspaceFilesModule, workspaceRoot, options?.load);
  const result: Record<string, unknown> = {};
  for (const name of required) {
    result[name] = requireExport(module, retrieveWorkspaceFilesModule, name, "function");
  }
  return result as Pick<NxRetrieveWorkspaceFiles, K>;
}

/**
 * The exports of `nx/src/project-graph/utils/project-configuration/project-nodes-manager`
 * used by the plugin.
 */
export interface NxProjectNodesManager {
  mergeProjectConfigurationIntoRootMap(
    rootMap: Record<string, NxRootMapProject>,
    project: NxRootMapProject,
    sourceMaps: NxSourceMaps | undefined,
    sourceInformation: [string | null, string] | undefined,
    skipTargetNormalization: boolean | undefined,
    deferSpreadsWithoutBase: boolean,
  ): unknown;
}

const projectNodesManagerModule =
  "nx/src/project-graph/utils/project-configuration/project-nodes-manager";

/**
 * Loads `mergeProjectConfigurationIntoRootMap` from
 * `nx/src/project-graph/utils/project-configuration/project-nodes-manager`.
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks the export.
 */
export function loadProjectNodesManager(
  workspaceRoot: string,
  options?: BridgeLoadOptions,
): NxProjectNodesManager {
  const { module } = loadPrivateModule(projectNodesManagerModule, workspaceRoot, options?.load);
  return {
    mergeProjectConfigurationIntoRootMap: requireExport(
      module,
      projectNodesManagerModule,
      "mergeProjectConfigurationIntoRootMap",
      "function",
    ) as NxProjectNodesManager["mergeProjectConfigurationIntoRootMap"],
  };
}

/** The `createNodes` function of one of Nx's default plugins. */
export type NxDefaultCreateNodes = (
  files: string[],
  options: unknown,
  context: { nxJsonConfiguration: object; workspaceRoot: string },
) => Promise<[string, { projects?: Record<string, NxRootMapProject> } | null][]>;

const packageJsonPluginModule = "nx/src/plugins/package-json";

/**
 * Loads `createNodes` from Nx's default `package.json` plugin (`nx/src/plugins/package-json`).
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks the export.
 */
export function loadPackageJsonPlugin(
  workspaceRoot: string,
  options?: BridgeLoadOptions,
): { createNodes: NxDefaultCreateNodes } {
  const { module } = loadPrivateModule(packageJsonPluginModule, workspaceRoot, options?.load);
  return {
    createNodes: requireCreateNodes(module.createNodes, packageJsonPluginModule),
  };
}

const projectJsonPluginModule = "nx/src/plugins/project-json/build-nodes/project-json";

/**
 * Loads `ProjectJsonProjectsPlugin.createNodes` from Nx's default `project.json`
 * plugin (`nx/src/plugins/project-json/build-nodes/project-json`).
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks the export.
 */
export function loadProjectJsonPlugin(
  workspaceRoot: string,
  options?: BridgeLoadOptions,
): { createNodes: NxDefaultCreateNodes } {
  const { module } = loadPrivateModule(projectJsonPluginModule, workspaceRoot, options?.load);
  const value = isRecord(module.ProjectJsonProjectsPlugin)
    ? module.ProjectJsonProjectsPlugin.createNodes
    : undefined;
  return {
    createNodes: requireCreateNodes(value, projectJsonPluginModule),
  };
}

/** The exports of `nx/src/utils/workspace-context` used by the plugin. */
export interface NxWorkspaceContext {
  globWithWorkspaceContext(workspaceRoot: string, globs: string[]): Promise<string[]>;
  globWithWorkspaceContextSync(workspaceRoot: string, globs: string[]): unknown;
}

const workspaceContextModule = "nx/src/utils/workspace-context";

/**
 * Loads requested exports from `nx/src/utils/workspace-context`.
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks a required export.
 */
export function loadWorkspaceContext<K extends keyof NxWorkspaceContext>(
  workspaceRoot: string,
  required: readonly K[],
  options?: BridgeLoadOptions,
): Pick<NxWorkspaceContext, K> {
  const { module } = loadPrivateModule(workspaceContextModule, workspaceRoot, options?.load);
  const result: Record<string, unknown> = {};
  for (const name of required) {
    result[name] = requireExport(module, workspaceContextModule, name, "function");
  }
  return result as Pick<NxWorkspaceContext, K>;
}

/** `matchGlobPaths` of `nx/src/native`. */
export type MatchGlobPaths = (globs: string[], paths: string[]) => boolean[];

/** The exports of `nx/src/native` used by the plugin. */
export interface NxNative {
  matchGlobPaths: MatchGlobPaths;
}

const nativeModule = "nx/src/native";

/**
 * Loads `matchGlobPaths` from `nx/src/native`.
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks the export.
 */
export function loadNxNative(workspaceRoot: string, options?: BridgeLoadOptions): NxNative {
  const { module } = loadPrivateModule(nativeModule, workspaceRoot, options?.load);
  return {
    matchGlobPaths: requireExport(
      module,
      nativeModule,
      "matchGlobPaths",
      "function",
    ) as MatchGlobPaths,
  };
}

/** The part of Nx's `HashPlanInspector` that the plugin uses. */
export interface NxHashPlanInspector {
  init(): Promise<void>;
  inspectTaskInputs(
    target: { project: string; target: string; configuration?: string },
    parsedArgs: Record<string, unknown>,
    extraTargetDependencies: Record<string, unknown>,
    excludeTaskDependencies: boolean,
  ): Record<string, { files?: unknown; environment?: unknown; runtime?: unknown }>;
}

/** The exports of `nx/src/hasher/hash-plan-inspector` used by the plugin. */
export interface NxHashPlanInspectorModule {
  HashPlanInspector: new (...args: unknown[]) => NxHashPlanInspector;
}

const hashPlanInspectorModule = "nx/src/hasher/hash-plan-inspector";

/**
 * Loads `HashPlanInspector` from `nx/src/hasher/hash-plan-inspector`.
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks the export.
 */
export function loadHashPlanInspector(
  workspaceRoot: string,
  options?: BridgeLoadOptions,
): NxHashPlanInspectorModule {
  const { module } = loadPrivateModule(hashPlanInspectorModule, workspaceRoot, options?.load);
  return {
    HashPlanInspector: requireExport(
      module,
      hashPlanInspectorModule,
      "HashPlanInspector",
      "function",
    ) as NxHashPlanInspectorModule["HashPlanInspector"],
  };
}

/** The exports of `nx/src/hasher/task-hasher` used by the plugin. */
export interface NxTaskHasher {
  getInputs(
    task: { target: { project: string; target: string } },
    graph: ProjectGraph,
    nxJson: unknown,
  ): {
    selfInputs: unknown[];
    depsInputs: { input: string }[];
    depsFilesets: { fileset: string }[];
    projectInputs: unknown[];
  };
  getNamedInputs(nxJson: unknown, project: unknown): Record<string, unknown[]>;
  expandSingleProjectInputs(inputs: unknown[], namedInputs: Record<string, unknown[]>): unknown[];
  expandNamedInput(input: string, namedInputs: Record<string, unknown[]>): unknown[];
}

const taskHasherModule = "nx/src/hasher/task-hasher";
const taskHasherExports = [
  "getInputs",
  "getNamedInputs",
  "expandSingleProjectInputs",
  "expandNamedInput",
] as const;

/**
 * Loads task-input expansion helpers from `nx/src/hasher/task-hasher`.
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks any export.
 */
export function loadTaskHasher(workspaceRoot: string, options?: BridgeLoadOptions): NxTaskHasher {
  const { module } = loadPrivateModule(taskHasherModule, workspaceRoot, options?.load);
  const result: Record<string, unknown> = {};
  for (const name of taskHasherExports) {
    result[name] = requireExport(module, taskHasherModule, name, "function");
  }
  return result as unknown as NxTaskHasher;
}

/** The exports of `nx/src/tasks-runner/task-env` used by the plugin. */
export interface NxTaskEnv {
  getTaskSpecificEnv(task: Task, graph: ProjectGraph): unknown;
  getEnvVariablesForTask(
    task: Task,
    taskSpecificEnv: NodeJS.ProcessEnv,
    forceColor: string | undefined,
    skipNxCache: boolean,
    captureStderr: boolean,
    outputPath: string | null,
    streamOutput: boolean | null,
  ): unknown;
  unloadDotEnvFile(file: string, env: NodeJS.ProcessEnv): unknown;
  getEnvFilesForTask(
    task: Pick<Task, "id" | "projectRoot"> & {
      target: { project: string; target: string; configuration?: string };
    },
    graph: ProjectGraph,
  ): unknown;
}

const taskEnvModule = "nx/src/tasks-runner/task-env";

/**
 * Loads requested exports from `nx/src/tasks-runner/task-env` together with the
 * resolved file path of that module (from which Nx's own dependencies such as
 * `dotenv` and `dotenv-expand` resolve).
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks a required export.
 */
export function loadTaskEnv<K extends keyof NxTaskEnv>(
  workspaceRoot: string,
  required: readonly K[],
  options?: BridgeLoadOptions,
): Pick<NxTaskEnv, K> & { file: string } {
  const { module, file } = loadPrivateModule(taskEnvModule, workspaceRoot, options?.load);
  const result: Record<string, unknown> = { file };
  for (const name of required) {
    result[name] = requireExport(module, taskEnvModule, name, "function");
  }
  return result as Pick<NxTaskEnv, K> & { file: string };
}

/** The exports of `nx/src/tasks-runner/create-task-graph` used by the plugin. */
export interface NxCreateTaskGraph {
  resolveConfiguration(
    this: { projectGraph: ProjectGraph },
    project: ProjectGraphProjectNode,
    target: string,
    configuration: string | undefined,
  ): unknown;
}

const createTaskGraphModule = "nx/src/tasks-runner/create-task-graph";

/**
 * Loads `ProcessTasks.prototype.resolveConfiguration` from
 * `nx/src/tasks-runner/create-task-graph`.
 *
 * @throws {NxBridgeError} When the module cannot be loaded or lacks the method.
 */
export function loadCreateTaskGraph(
  workspaceRoot: string,
  options?: BridgeLoadOptions,
): NxCreateTaskGraph {
  const { module } = loadPrivateModule(createTaskGraphModule, workspaceRoot, options?.load);
  const resolve = (
    module.ProcessTasks as { prototype?: { resolveConfiguration?: unknown } } | undefined
  )?.prototype?.resolveConfiguration;
  if (typeof resolve !== "function") {
    throw new NxBridgeError({
      kind: "export",
      module: createTaskGraphModule,
      exportName: "ProcessTasks.resolveConfiguration",
      expected: "function",
    });
  }
  return {
    resolveConfiguration: resolve as NxCreateTaskGraph["resolveConfiguration"],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadPrivateModule(
  specifier: string,
  workspaceRoot: string,
  load: ModuleLoader = require,
): { module: Record<string, unknown>; file: string } {
  try {
    const file = resolveFromRepository(specifier, workspaceRoot);
    const loaded = load(file);
    return { module: isRecord(loaded) ? loaded : {}, file };
  } catch (error) {
    throw loadFailure(specifier, error);
  }
}

function requireExport(
  module: Record<string, unknown>,
  specifier: string,
  name: string,
  expected: "function" | "constructor",
): unknown {
  const value = module[name];
  if (expected === "constructor") {
    if (typeof value !== "function" || typeof value.prototype !== "object") {
      throw new NxBridgeError({
        kind: "export",
        module: specifier,
        exportName: name,
        expected: "constructor",
      });
    }
    return value;
  }
  if (typeof value !== "function") {
    throw new NxBridgeError({
      kind: "export",
      module: specifier,
      exportName: name,
      expected: "function",
    });
  }
  return value;
}

function requireCreateNodes(value: unknown, specifier: string): NxDefaultCreateNodes {
  if (!Array.isArray(value) || typeof value[1] !== "function") {
    throw new NxBridgeError({
      kind: "export",
      module: specifier,
      exportName: "createNodes",
      expected: "createNodes",
    });
  }
  return value[1] as NxDefaultCreateNodes;
}

function loadFailure(specifier: string, error: unknown): NxBridgeError {
  const fullReason = error instanceof Error ? error.message : String(error);
  return new NxBridgeError({
    kind: "load",
    module: specifier,
    reason: fullReason.split("\n")[0],
    fullReason,
  });
}

function describeFailure(failure: NxBridgeFailure): string {
  if (failure.kind === "load") {
    return `${failure.module} could not be loaded (${failure.reason})`;
  }
  switch (failure.expected) {
    case "constructor":
      return `${failure.exportName} from ${failure.module} is not a constructor`;
    case "createNodes":
      return `${failure.exportName} from ${failure.module} is not a pattern and a function`;
    case "function":
      return `${failure.exportName} from ${failure.module} is not a function`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}
