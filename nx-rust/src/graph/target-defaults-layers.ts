import type {
  CreateDependenciesContext,
  NxJsonConfiguration,
  ProjectConfiguration,
  TargetConfiguration,
} from "@nx/devkit";
import { realpathSync } from "node:fs";
import { extname, join } from "node:path";
import {
  loadDevkitInternals,
  loadPackageJsonPlugin,
  loadProjectJsonPlugin,
  loadProjectNodesManager,
  NxBridgeError,
  readNxPackageVersion,
} from "../compatibility/nx-bridge";
import { pluginPackageName } from "./plugin-package";
import { type CargoProject, projectNodes } from "./projects";
import { targetCargoMetadataKey } from "./targets";

/** A project as Nx's root maps hold it while it merges the layers of a project. */
export interface RootMapProject {
  root: string;
  name?: string;
  tags?: string[];
  namedInputs?: Record<string, unknown[]>;
  targets?: Record<string, TargetConfiguration>;
}

/** A project node that one of Nx's default plugins made of a file in the project's folder. */
export interface DefaultNode {
  /** The `package.json` or `project.json`, relative to the repository root. */
  file: string;
  project: RootMapProject;
}

/** Nx's source maps: by project root, the file and plugin behind each key. */
export type SourceMaps = Record<string, Record<string, [string | null, string]>>;

/** A dependency as Nx's task graph normalises a `dependsOn` entry. */
export interface NormalisedDependency {
  target?: string;
  projects?: string[];
  dependencies?: boolean;
}

/** The project graph, as far as Nx's normalisation of `dependsOn` reads it. */
export interface DependencyGraph {
  nodes: Record<string, { name: string; type: string; data: ProjectConfiguration }>;
}

/**
 * The parts of the installed Nx that the check runs, so that it rebuilds a
 * target as Nx does (`DES-TARGET-DEFAULT-GUARD`). None is public API.
 */
export interface TargetDefaultsInternals {
  /**
   * Nx's synthesis of target defaults: for each project root and target,
   * the elements of `targetDefaults` that Nx lays over the target, each as
   * one result whose file names the key and element, such as
   * `nx.json#targetDefaults.build[1]`.
   */
  createTargetDefaultsResults(
    specifiedPluginRootMap: Record<string, RootMapProject>,
    defaultPluginRootMap: Record<string, RootMapProject>,
    nxJson: { targetDefaults?: unknown },
    specifiedSourceMaps: SourceMaps,
  ): [string, string, { projects?: Record<string, RootMapProject> }][];
  /** Nx's merge of one project node into a root map, as graph creation merges every layer. */
  mergeProject(
    rootMap: Record<string, RootMapProject>,
    project: RootMapProject,
    sourceMaps: SourceMaps | undefined,
    sourceInformation: [string | null, string] | undefined,
    deferSpreadsWithoutBase: boolean,
  ): void;
  /**
   * The project nodes that Nx's default plugins make of the `package.json`
   * and `project.json` files given, each with its file, in the order in
   * which Nx merges them.
   */
  defaultNodes(files: string[], nxJson: object, workspaceRoot: string): Promise<DefaultNode[]>;
  /** Whether a `targetDefaults` key can reach a target of this name and executor at all. */
  keyMayApply(key: string, targetName: string, executor: string | undefined): boolean;
  /** A `dependsOn` entry as the task graph normalises it. */
  normaliseDependency(
    entry: unknown,
    project: string,
    graph: DependencyGraph,
  ): NormalisedDependency;
}

/** What `createDependencies` receives, as far as the check reads it. */
export type TargetDefaultsContext = Pick<
  CreateDependenciesContext,
  "projects" | "nxJsonConfiguration" | "workspaceRoot" | "fileMap"
>;

/** The layers of the projects concerned, as Nx merges them, by root. */
export interface Layers {
  /** The plugin's own projects, as its `createNodes` returned them, merged. */
  specified: Record<string, RootMapProject>;
  /** What Nx's synthesis of target defaults lays over them, result by result. */
  targetDefaults: ReturnType<TargetDefaultsInternals["createTargetDefaultsResults"]>;
  /**
   * What the synthesis lays over them with this plugin as the source of its
   * targets, as `targetDefaults` holds it, and with each other plugin that
   * may be the source ({@link MergedView.otherSources}).
   */
  mayApply: ReturnType<TargetDefaultsInternals["createTargetDefaultsResults"]>[];
  /** What Nx's default plugins make of the folders' files, node by node. */
  defaults: DefaultNode[];
}

/**
 * What {@link rebuildLayers} takes from the graph that Nx merged, where it
 * has one, and the other plugins that may be the source of the plugin's
 * targets, which `createNodes` knows as well.
 */
export interface MergedView {
  /** The plugin's targets with the names that Nx gives their references (`nxNames`). */
  declared?: (project: CargoProject, target: TargetConfiguration) => TargetConfiguration;
  /**
   * The projects as Nx merged them, by root, whose name and tags Nx's
   * synthesis reads for the filters of `targetDefaults`, also where another
   * plugin gave them.
   */
  asMerged?: ReadonlyMap<string, ProjectConfiguration>;
  /** The other plugins that may be the source of the plugin's targets ({@link otherSourcePlugins}). */
  otherSources: readonly string[];
}

/** The elements of one `targetDefaults` key that Nx laid over one target. */
export interface AppliedEntry {
  key: string;
  /** Their positions in the key's list, where its value is a list. */
  indices?: number[];
}

/** A value in the options or a configuration of one of the plugin's targets. */
export interface OptionPlace {
  project: CargoProject;
  /** The target's name, as `targetNames` gives it. */
  target: string;
  /** The configuration that holds the value; absent for the target's `options`. */
  configuration?: string;
  option: string;
}

/** Where Nx took a value of a target from: a file in the project's folder or a `targetDefaults` entry. */
export type OptionOrigin = { file: string } | AppliedEntry;

export const spread = "...";

/** A source plugin that no `filter.plugin` of `targetDefaults` names. */
const unnamedSource = "\0another plugin";

/**
 * The names of the plugins other than this one that may be the source of a
 * target of this plugin, as Nx's synthesis of target defaults reads it for
 * `filter.plugin`: the plugin whose node first gave the target the executor
 * that it has, which keeps that source when this plugin gives the same
 * executor (`getMergeValueResult` in Nx's
 * `project-graph/utils/project-configuration/utils.js`). Graph creation
 * cannot see which plugin that was. So where `nx.json` lists a plugin other
 * than this one, each other plugin that an element's `filter.plugin` names
 * may be it, and so may one that none names, which `unnamedSource` stands
 * for; where `nx.json` lists none, this plugin is the source.
 */
export function otherSourcePlugins(
  targetDefaults: Record<string, unknown>,
  plugin: string | undefined,
  nxJson: NxJsonConfiguration,
  workspaceRoot: string,
): string[] {
  const listsOther = (nxJson.plugins ?? []).some(
    (entry) => !isThisPlugin(typeof entry === "string" ? entry : entry.plugin, workspaceRoot),
  );
  if (!listsOther) {
    return [];
  }
  const named = new Set<string>();
  for (const value of Object.values(targetDefaults)) {
    for (const element of Array.isArray(value) ? value : [value]) {
      const filter = isRecord(element) ? element.filter : undefined;
      if (isRecord(filter) && typeof filter.plugin === "string" && filter.plugin !== plugin) {
        named.add(filter.plugin);
      }
    }
  }
  return [...named, unnamedSource];
}

/**
 * The plugins that `nx.json` lists after the first entry of this plugin, as
 * it writes them, once each: the ones whose targets Nx merges over this
 * plugin's, where they can replace its lists. A plugin listed before it
 * cannot, since this plugin's lists replace its own.
 */
export function laterPlugins(nxJson: NxJsonConfiguration, workspaceRoot: string): string[] {
  const names = (nxJson.plugins ?? []).map((entry) =>
    typeof entry === "string" ? entry : entry.plugin,
  );
  const first = names.findIndex((name) => isThisPlugin(name, workspaceRoot));
  return [...new Set(names.slice(first + 1).filter((name) => !isThisPlugin(name, workspaceRoot)))];
}

// The entries given, one for each key, with the positions of its elements
// joined, in the order in which the keys first appear.
export function byKey(entries: readonly AppliedEntry[]): AppliedEntry[] {
  const joined: AppliedEntry[] = [];
  for (const entry of entries) {
    const same = joined.find(({ key }) => key === entry.key);
    if (same === undefined) {
      joined.push({
        ...entry,
        ...(entry.indices === undefined ? {} : { indices: [...entry.indices] }),
      });
    } else if (entry.indices !== undefined) {
      same.indices = [...new Set([...(same.indices ?? []), ...entry.indices])].sort(
        (a, b) => a - b,
      );
    }
  }
  return joined;
}

// Whether the plugin infers the target: an extra target that a target table
// of the Cargo metadata defines has no record of the plugin's own.
export function isInferred(target: TargetConfiguration): boolean {
  return target.metadata?.[targetCargoMetadataKey] !== undefined;
}

// Whether Nx reads a name as a glob pattern (`isGlobPattern` in `nx/src/utils/globs.js`).
export function isGlobPattern(name: string): boolean {
  return /[*|{}()[]/.test(name);
}

// The three layers of the projects at `roots`, built with Nx's own code.
export async function rebuildLayers(
  nx: TargetDefaultsInternals,
  projects: readonly CargoProject[],
  plugin: string | undefined,
  context: TargetDefaultsContext,
  roots: readonly string[],
  view?: MergedView,
): Promise<Layers> {
  const nxJson = context.nxJsonConfiguration ?? {};
  const specified: Record<string, RootMapProject> = {};
  const sourceMaps: SourceMaps = {};
  const nodes = projectNodes(projects);
  for (const [index, [manifest, result]] of nodes.entries()) {
    for (const [root, project] of Object.entries(result.projects ?? {})) {
      const node = structuredClone({ ...project, root }) as RootMapProject;
      const declared = view?.declared;
      if (declared !== undefined && node.targets !== undefined) {
        const owner = projects[index];
        node.targets = Object.fromEntries(
          Object.entries(node.targets).map(([name, target]) => [name, declared(owner, target)]),
        );
      }
      nx.mergeProject(specified, node, sourceMaps, [manifest, plugin ?? ""], false);
    }
  }
  const defaults = await nx.defaultNodes(
    declarationFiles(roots, context.fileMap),
    nxJson,
    context.workspaceRoot,
  );
  // The default layer as Nx stages it for the synthesis.
  const staged: Record<string, RootMapProject> = {};
  for (const { project } of defaults) {
    nx.mergeProject(staged, structuredClone(project), undefined, undefined, true);
  }
  // The synthesis reads a project's name and tags from both layers; those
  // that another plugin gave it are known only from the merged graph.
  const seen = structuredClone(specified);
  for (const [root, project] of Object.entries(seen)) {
    const merged = view?.asMerged?.get(root);
    if (merged !== undefined) {
      project.name = merged.name ?? project.name;
      project.tags = [...new Set([...(project.tags ?? []), ...(merged.tags ?? [])])];
    }
  }
  const synthesis = (source: string | undefined) =>
    nx.createTargetDefaultsResults(
      structuredClone(seen),
      structuredClone(staged),
      nxJson,
      source === undefined ? sourceMaps : withSource(sourceMaps, plugin ?? "", source),
    );
  const targetDefaults = synthesis(undefined);
  return {
    specified,
    targetDefaults,
    mayApply: [targetDefaults, ...(view?.otherSources ?? []).map(synthesis)],
    defaults,
  };
}

// Source maps in which `source` instead of `plugin` gave the values.
function withSource(sourceMaps: SourceMaps, plugin: string, source: string): SourceMaps {
  return Object.fromEntries(
    Object.entries(sourceMaps).map(([root, keys]) => [
      root,
      Object.fromEntries(
        Object.entries(keys).map(([key, [file, from]]) => [
          key,
          [file, from === plugin ? source : from] as [string | null, string],
        ]),
      ),
    ]),
  );
}

// The project at `root` as Nx merges its layers, with the elements of
// targetDefaults that one run of Nx's synthesis laid over it, or without any.
export function rebuild(
  nx: TargetDefaultsInternals,
  layers: Layers,
  root: string,
  targetDefaults: Layers["targetDefaults"] | undefined,
): RootMapProject {
  const rootMap: Record<string, RootMapProject> = {};
  const merge = (project: RootMapProject | undefined) => {
    if (project !== undefined) {
      nx.mergeProject(rootMap, structuredClone({ ...project, root }), undefined, undefined, false);
    }
  };
  merge(layers.specified[root]);
  for (const [, , result] of targetDefaults ?? []) {
    merge(result.projects?.[root]);
  }
  for (const { project } of layers.defaults) {
    if (project.root === root) {
      merge(project);
    }
  }
  return rootMap[root] ?? { root };
}

/**
 * The name under which Nx knows the plugin's entry in `nx.json`, which
 * `filter.plugin` of a `targetDefaults` entry compares with, as Nx 24
 * derives it (`getPluginPathAndName` in `project-graph/plugins/resolve-plugin.js`):
 * the entry's `plugin` itself where it names a `.js` or `.ts` file, and
 * otherwise the name of the package it resolves to. The first entry that
 * resolves to this plugin decides; the package's name where none does.
 */
export function pluginEntryNameIn(
  nxJson: NxJsonConfiguration | undefined,
  workspaceRoot: string,
): string {
  for (const entry of nxJson?.plugins ?? []) {
    const plugin = typeof entry === "string" ? entry : entry.plugin;
    if (plugin === pluginPackageName) {
      return plugin;
    }
    if (isThisPlugin(plugin, workspaceRoot)) {
      return [".js", ".ts"].includes(extname(plugin)) ? plugin : pluginPackageName;
    }
  }
  return pluginPackageName;
}

/**
 * Whether an entry of `nx.json`'s `plugins` loads this plugin: it names its
 * package, or it resolves to this module's entry point. An entry that does
 * not resolve counts as another plugin.
 */
function isThisPlugin(plugin: string, workspaceRoot: string): boolean {
  if (plugin === pluginPackageName) {
    return true;
  }
  try {
    return (
      realpathSync(require.resolve(plugin, { paths: [workspaceRoot] })) ===
      realpathSync(join(__dirname, "..", `index${extname(__filename)}`))
    );
  } catch {
    return false;
  }
}

/**
 * The name under which Nx knows a plugin entry, from Nx's copy of the plugin
 * for the entry, which `createDependencies` receives as `this`.
 */
export function pluginEntryName(plugin: unknown): string | undefined {
  return isRecord(plugin) && typeof plugin.name === "string" ? plugin.name : undefined;
}

/**
 * Where Nx took each value from, as far as the layers that
 * `findTargetDefaultChanges` rebuilds with Nx's own code show it: the
 * `project.json` or `package.json` in the project's folder whose node sets
 * the option at that place, which Nx merges after `targetDefaults`, the
 * later file winning; otherwise the element of `targetDefaults` that Nx
 * lays over the target and that sets it, the later element winning; and
 * `undefined` where none does, as where another plugin sets it.
 *
 * @param plugin The name under which Nx knows this plugin entry.
 * @param internals Nx's internal parts ({@link loadTargetDefaultsInternals}).
 */
// @mara implements DES-PLUGIN-OPTIONS
export async function optionOrigins(
  places: readonly OptionPlace[],
  context: TargetDefaultsContext,
  plugin: string | undefined,
  internals: TargetDefaultsInternals,
): Promise<(OptionOrigin | undefined)[]> {
  if (places.length === 0) {
    return [];
  }
  const projects = [...new Set(places.map(({ project }) => project))];
  const layers = await rebuildLayers(
    internals,
    projects,
    plugin,
    context,
    projects.map(({ root }) => root),
  );
  const targetDefaults = context.nxJsonConfiguration?.targetDefaults;
  return places.map((place) => {
    const sets = (project: RootMapProject | undefined) => {
      const target = project?.targets?.[place.target];
      const values: unknown =
        place.configuration === undefined
          ? target?.options
          : target?.configurations?.[place.configuration];
      return isRecord(values) && Object.prototype.hasOwnProperty.call(values, place.option);
    };
    const node = [...layers.defaults]
      .reverse()
      .find(({ project }) => project.root === place.project.root && sets(project));
    if (node !== undefined) {
      return { file: node.file };
    }
    const element = [...layers.targetDefaults]
      .reverse()
      .find(([, , result]) => sets(result.projects?.[place.project.root]));
    return element === undefined
      ? undefined
      : appliedEntry(element[1], isRecord(targetDefaults) ? targetDefaults : {});
  });
}

/**
 * The parts of the Nx installed in the repository, which is the Nx that
 * creates the graph, that the check runs: from `nx/src/devkit-internals`,
 * `createTargetDefaultsResults`, `findMatchingTargetNames`,
 * `expandDependencyConfigSyntaxSugar` and `normalizeDependencyConfigProjects`;
 * `mergeProjectConfigurationIntoRootMap`, Nx's merge of project nodes; and
 * the `createNodes` of Nx's default plugins for `package.json` and
 * `project.json`.
 *
 * @param load Loads a module by its resolved path; replaced in tests.
 * @throws {Error} When that Nx lacks one of them, naming the Nx version.
 */
export function loadTargetDefaultsInternals(
  workspaceRoot: string,
  load: (path: string) => unknown = require,
): TargetDefaultsInternals {
  try {
    const devkit = loadDevkitInternals(
      workspaceRoot,
      [
        "createTargetDefaultsResults",
        "findMatchingTargetNames",
        "expandDependencyConfigSyntaxSugar",
        "normalizeDependencyConfigProjects",
      ],
      { load },
    );
    const { mergeProjectConfigurationIntoRootMap: mergeIntoRootMap } = loadProjectNodesManager(
      workspaceRoot,
      { load },
    );
    const { createNodes: packageJson } = loadPackageJsonPlugin(workspaceRoot, { load });
    const { createNodes: projectJson } = loadProjectJsonPlugin(workspaceRoot, { load });
    return {
      createTargetDefaultsResults: devkit.createTargetDefaultsResults,
      mergeProject(rootMap, project, sourceMaps, sourceInformation, deferSpreadsWithoutBase) {
        mergeIntoRootMap(
          rootMap,
          project,
          sourceMaps,
          sourceInformation,
          undefined,
          deferSpreadsWithoutBase,
        );
      },
      async defaultNodes(files, nxJson, root) {
        const context = { nxJsonConfiguration: nxJson, workspaceRoot: root };
        const nodes: DefaultNode[] = [];
        // In the order in which Nx runs its default plugins.
        for (const [createNodes, given] of [
          [packageJson, files],
          [projectJson, files.filter((file) => file.endsWith("project.json"))],
        ] as const) {
          if (given.length === 0) {
            continue;
          }
          for (const [file, result] of await createNodes(given, undefined, context)) {
            for (const [projectRoot, project] of Object.entries(result?.projects ?? {})) {
              nodes.push({ file, project: { ...project, root: projectRoot } });
            }
          }
        }
        return nodes;
      },
      keyMayApply(key, targetName, executor) {
        return (
          key === executor ||
          key === targetName ||
          devkit.findMatchingTargetNames(key, [targetName]).length > 0
        );
      },
      normaliseDependency(entry, project, graph) {
        return devkit.normalizeDependencyConfigProjects(
          devkit.expandDependencyConfigSyntaxSugar(structuredClone(entry), graph, project),
          project,
          graph,
        );
      },
    };
  } catch (error) {
    if (error instanceof NxBridgeError) {
      const problem =
        error.failure.kind === "load"
          ? `${error.failure.module} could not be loaded (${error.failure.fullReason})`
          : error.message;
      unsupported(workspaceRoot, load, problem);
    }
    throw error;
  }
}

function unsupported(
  workspaceRoot: string,
  load: (path: string) => unknown,
  problem: string,
): never {
  const nx = readNxPackageVersion(workspaceRoot, load);
  throw new Error(
    [
      `nx-rust cannot check what the targetDefaults in nx.json do to Rust targets with ${nx === undefined ? "the installed Nx" : `the installed Nx ${nx}`}: ${problem}.`,
      "nx-rust runs these parts of Nx, which are not public API, to learn what Nx applied to a target. This version of @convesoft/nx-rust supports Nx 24.",
      "Use a supported Nx version, or a version of @convesoft/nx-rust that supports the installed one.",
    ].join("\n"),
  );
}

// The package.json and project.json in each of `roots` that Nx sees, and
// the package.json at the repository root, which Nx hands its package.json
// plugin with the others: whether that plugin reads a package.json outside
// the package manager's workspaces can depend on it.
function declarationFiles(
  roots: readonly string[],
  fileMap: CreateDependenciesContext["fileMap"] | undefined,
): string[] {
  const seen = new Set<string>();
  for (const files of Object.values(fileMap?.projectFileMap ?? {})) {
    for (const { file } of files) {
      seen.add(file);
    }
  }
  for (const { file } of fileMap?.nonProjectFiles ?? []) {
    seen.add(file);
  }
  return [
    ...new Set([
      ...roots.flatMap((root) =>
        ["package.json", "project.json"].map((name) => (root === "." ? name : `${root}/${name}`)),
      ),
      "package.json",
    ]),
  ].filter((file) => seen.has(file));
}

// The key and elements of Nx's synthesis, by root and target. Each result's
// file names them: `nx.json#targetDefaults.<key>` or
// `nx.json#targetDefaults.<key>[<index>]`.
export function appliedElements(
  results: ReturnType<TargetDefaultsInternals["createTargetDefaultsResults"]>,
  targetDefaults: Record<string, unknown>,
): Map<string, Map<string, AppliedEntry>> {
  const applied = new Map<string, Map<string, AppliedEntry>>();
  for (const [, file, result] of results) {
    const element = appliedEntry(file, targetDefaults);
    if (element === undefined) {
      continue;
    }
    const { key, indices: [index] = [] } = element;
    for (const [root, project] of Object.entries(result.projects ?? {})) {
      const byTarget = applied.get(root) ?? new Map<string, AppliedEntry>();
      applied.set(root, byTarget);
      for (const name of Object.keys(project.targets ?? {})) {
        const entry = byTarget.get(name) ?? { key };
        if (index !== undefined) {
          entry.indices = [...(entry.indices ?? []), index];
        }
        byTarget.set(name, entry);
      }
    }
  }
  return applied;
}

// The key, and the element where the key's value is a list, that the file
// of one result of Nx's synthesis names; undefined for another file.
export function appliedEntry(
  file: string,
  targetDefaults: Record<string, unknown>,
): AppliedEntry | undefined {
  const prefix = "nx.json#targetDefaults.";
  if (!file.startsWith(prefix)) {
    return undefined;
  }
  const location = file.slice(prefix.length);
  const indexed = /^(.*)\[(\d+)\]$/.exec(location);
  return indexed !== null && Array.isArray(targetDefaults[indexed[1]])
    ? { key: indexed[1], indices: [Number(indexed[2])] }
    : { key: location };
}

export function includes(list: readonly unknown[] | undefined, value: unknown): boolean {
  const wanted = canonical(value);
  return (list ?? []).some((entry) => canonical(entry) === wanted);
}

// JSON with sorted object keys, so that equal values compare equal.
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => compare(a, b)))
      : inner,
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
