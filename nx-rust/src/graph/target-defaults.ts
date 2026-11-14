import type {
  CreateDependenciesContext,
  NxJsonConfiguration,
  ProjectConfiguration,
  TargetConfiguration,
} from "@nx/devkit";
import { existsSync, realpathSync } from "node:fs";
import { extname, join } from "node:path";
import type { TargetWarning } from "./collisions";
import { pluginPackageName } from "./plugin-package";
import { CargoGraph, CargoProject, projectNodes } from "./projects";

/**
 * What a `targetDefaults` entry does to an inferred target that the plugin
 * reports (`DES-TARGET-DEFAULT-GUARD`).
 */
export type TargetDefaultChange =
  | "adds-dependencies"
  | "replaces-dependsOn"
  | "replaces-inputs"
  | "replaces-outputs"
  | "turns-on-cache";

/** One inferred target that a `targetDefaults` entry changes. */
export interface TargetDefaultFinding {
  change: TargetDefaultChange;
  /** A warning for an entry that only adds dependencies, an error otherwise. */
  severity: "error" | "warning";
  /** The entry's key in `targetDefaults`. */
  key: string;
  /** The elements of the key's list that Nx applies to the target, where its value is a list. */
  elements?: number[];
  /** The target's name, as `targetNames` gives it. */
  target: string;
  /** The target's executor, which an entry keyed by it would take precedence. */
  executor: string;
  /** The project's name in the merged graph. */
  project: string;
  /** The manifest the project comes from, relative to the repository root. */
  manifest: string;
  /** For `adds-dependencies`, the `dependsOn` entries that the entry adds. */
  added?: unknown[];
}

/**
 * An inferred target that differs from what the plugin inferred, where the
 * plugin could not tell which configuration made the difference.
 */
export interface UnattributedChange {
  target: string;
  project: string;
  manifest: string;
  /** The fields that differ: `cache`, `inputs`, `outputs` or `dependsOn`. */
  fields: string[];
}

/** What {@link findTargetDefaultChanges} found. */
export interface TargetDefaultChanges {
  findings: TargetDefaultFinding[];
  unattributed: UnattributedChange[];
}

/** What {@link checkTargetDefaults} found: warnings to print and an error to fail with. */
export interface TargetDefaultReport {
  warnings: string[];
  /**
   * Each warning once for each target it concerns, which the tasks of that
   * target print again (`DES-DIAGNOSTICS`, "Warnings where they are seen").
   */
  placed: PlacedWarning[];
  /** Absent when no entry does what makes an error. */
  error?: string;
}

/** A warning of {@link TargetDefaultReport} for one target of one project. */
export interface PlacedWarning extends TargetWarning {
  /** The project's name in the merged graph. */
  project: string;
}

/** A project as Nx's root maps hold it while it merges the layers of a project. */
interface RootMapProject {
  root: string;
  name?: string;
  tags?: string[];
  targets?: Record<string, TargetConfiguration>;
}

/** A project node that one of Nx's default plugins made of a file in the project's folder. */
interface DefaultNode {
  /** The `package.json` or `project.json`, relative to the repository root. */
  file: string;
  project: RootMapProject;
}

/** Nx's source maps: by project root, the file and plugin behind each key. */
type SourceMaps = Record<string, Record<string, [string | null, string]>>;

/** A dependency as Nx's task graph normalises a `dependsOn` entry. */
interface NormalisedDependency {
  target?: string;
  projects?: string[];
  dependencies?: boolean;
}

/** The project graph, as far as Nx's normalisation of `dependsOn` reads it. */
interface DependencyGraph {
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

/** The section of the user guide that says how to narrow an entry. */
export const targetDefaultsGuide =
  "https://github.com/convesoft/nx-rust/blob/main/nx-rust/docs/targets.mara.md#target-defaults-that-reach-rust-targets";

const spread = "...";

/** The fields of a target whose changes the check looks at. */
const checkedFields = ["cache", "inputs", "outputs", "dependsOn"] as const;
type CheckedField = (typeof checkedFields)[number];

/** What `createDependencies` receives, as far as the check reads it. */
export type TargetDefaultsContext = Pick<
  CreateDependenciesContext,
  "projects" | "nxJsonConfiguration" | "workspaceRoot" | "fileMap"
>;

/**
 * Checks what the `targetDefaults` of `nx.json` did to the inferred targets
 * of one plugin entry's projects (`DES-TARGET-DEFAULT-GUARD`).
 *
 * What changed is read from the targets that Nx merged, as
 * `createDependencies` receives them, and from nothing else: caching that
 * is on where the plugin left it off, inferred `dependsOn`, `inputs` or
 * `outputs` entries that are missing, and `dependsOn` entries that Nx's task
 * graph resolves to other projects' tasks. A target without such a
 * difference, or one that no `targetDefaults` key can reach, is not
 * reported, and neither is a target whose executor is no longer the
 * inferred one, which another file replaced.
 *
 * Who made a difference is learned by rebuilding the target with Nx's own
 * code: the plugin's projects as its `createNodes` returned them, the
 * elements of `targetDefaults` that Nx's synthesis lays over them, and what
 * Nx's default plugins make of the `package.json` and `project.json` in the
 * project's folder, each merged with Nx's merge of project nodes. The
 * rebuild must give the target's `cache`, `inputs`, `outputs` and
 * `dependsOn` and the project's name and tags as Nx merged them; where it
 * does not, as where another plugin contributes, the change is
 * unattributed. Otherwise a difference that the rebuild without the
 * `targetDefaults` layer does not have is the entry's; the others are the
 * folder's files' and are not reported.
 *
 * @param plugin The name under which Nx knows this plugin entry, which
 *   `filter.plugin` of an entry compares with.
 * @param internals Nx's internal parts, loaded only when they are needed.
 * @throws {Error} When they are needed and the installed Nx lacks them.
 */
// @mara implements DES-TARGET-DEFAULT-GUARD
export async function findTargetDefaultChanges(
  graph: CargoGraph,
  context: TargetDefaultsContext,
  plugin: string | undefined,
  internals: () => TargetDefaultsInternals,
): Promise<TargetDefaultChanges> {
  const none: TargetDefaultChanges = { findings: [], unattributed: [] };
  const nxJson = context.nxJsonConfiguration ?? {};
  const targetDefaults: unknown = nxJson.targetDefaults;
  if (!isRecord(targetDefaults) || Object.keys(targetDefaults).length === 0) {
    return none;
  }
  const byRoot = new Map<string, ProjectConfiguration>();
  for (const project of Object.values(context.projects)) {
    byRoot.set(project.root, project);
  }
  const dependencyGraph: DependencyGraph = {
    nodes: Object.fromEntries(
      Object.entries(context.projects).map(([name, data]) => [name, { name, type: "lib", data }]),
    ),
  };
  let nx: TargetDefaultsInternals | undefined;
  const pending: Pending[] = [];
  for (const project of graph.projects) {
    const merged = byRoot.get(project.root);
    if (merged?.name === undefined) {
      continue;
    }
    for (const [name, inferred] of Object.entries(project.targets)) {
      const target = merged.targets?.[name];
      if (target === undefined || target.executor !== inferred.executor) {
        continue;
      }
      const lostEntries = {
        dependsOn: lostFrom(inferred.dependsOn, target.dependsOn),
        inputs: lostFrom(inferred.inputs, target.inputs),
        outputs: lostFrom(inferred.outputs, target.outputs),
      };
      const cacheOn = inferred.cache !== true && target.cache === true;
      const undeclared = (target.dependsOn ?? []).filter(
        (entry) => entry !== spread && !includes(inferred.dependsOn, entry),
      );
      if (
        !cacheOn &&
        Object.values(lostEntries).every((lost) => lost.length === 0) &&
        undeclared.length === 0
      ) {
        continue;
      }
      nx ??= internals();
      const loaded = nx;
      if (
        !Object.keys(targetDefaults).some((key) => loaded.keyMayApply(key, name, target.executor))
      ) {
        continue;
      }
      const added = undeclared.filter((entry) =>
        reachesOtherProjects(
          loaded.normaliseDependency(entry, merged.name as string, dependencyGraph),
          merged.name as string,
        ),
      );
      if (
        !cacheOn &&
        Object.values(lostEntries).every((lost) => lost.length === 0) &&
        added.length === 0
      ) {
        continue;
      }
      pending.push({ project, merged, name, target, cacheOn, lostEntries, added });
    }
  }
  if (pending.length === 0 || nx === undefined) {
    return none;
  }
  const projects = [...new Set(pending.map(({ project }) => project))];
  const roots = projects.map(({ root }) => root);
  const layers = await rebuildLayers(nx, projects, plugin, context, roots);
  const applied = appliedElements(layers.targetDefaults, targetDefaults);
  const changes: TargetDefaultChanges = { findings: [], unattributed: [] };
  for (const { project, merged, name, target, cacheOn, lostEntries, added } of pending) {
    const withDefaults = rebuild(nx, layers, project.root, true);
    const withoutDefaults = rebuild(nx, layers, project.root, false);
    const fields = [
      ...(cacheOn ? ["cache"] : []),
      ...(["inputs", "outputs"] as const).filter((field) => lostEntries[field].length > 0),
      ...(lostEntries.dependsOn.length > 0 || added.length > 0 ? ["dependsOn"] : []),
    ];
    if (!reproduces(withDefaults, merged, name)) {
      changes.unattributed.push({
        target: name,
        project: merged.name as string,
        manifest: project.manifest,
        fields,
      });
      continue;
    }
    const entry = applied.get(project.root)?.get(name);
    const without = withoutDefaults.targets?.[name] ?? {};
    if (entry === undefined) {
      continue;
    }
    const finding = (change: TargetDefaultChange, extra: Partial<TargetDefaultFinding> = {}) =>
      changes.findings.push({
        change,
        severity: change === "adds-dependencies" ? "warning" : "error",
        key: entry.key,
        ...(entry.indices === undefined ? {} : { elements: entry.indices }),
        target: name,
        executor: target.executor as string,
        project: merged.name as string,
        manifest: project.manifest,
        ...extra,
      });
    // A difference is the entry's where the rebuild without the entries of
    // targetDefaults does not have it.
    const keptWithout = (field: "dependsOn" | "inputs" | "outputs") =>
      lostEntries[field].some((entryValue) => includes(without[field], entryValue));
    if (keptWithout("dependsOn")) {
      finding("replaces-dependsOn");
    }
    if (keptWithout("inputs")) {
      finding("replaces-inputs");
    }
    if (keptWithout("outputs")) {
      finding("replaces-outputs");
    }
    if (cacheOn && without.cache !== true) {
      finding("turns-on-cache");
    }
    const fromEntry = added.filter((dependency) => !includes(without.dependsOn, dependency));
    if (fromEntry.length > 0) {
      finding("adds-dependencies", { added: fromEntry });
    }
  }
  return changes;
}

/** An inferred target that differs from what Nx made of it, waiting to learn why. */
interface Pending {
  project: CargoProject;
  merged: ProjectConfiguration;
  name: string;
  target: TargetConfiguration;
  /** Whether caching is on where the plugin left it off. */
  cacheOn: boolean;
  /** The entries that the plugin declared and the merged target lacks. */
  lostEntries: Record<"dependsOn" | "inputs" | "outputs", unknown[]>;
  /** The `dependsOn` entries that the plugin did not declare and that reach other projects. */
  added: unknown[];
}

/** The layers of the projects concerned, as Nx merges them, by root. */
interface Layers {
  /** The plugin's own projects, as its `createNodes` returned them, merged. */
  specified: Record<string, RootMapProject>;
  /** What Nx's synthesis of target defaults lays over them, result by result. */
  targetDefaults: ReturnType<TargetDefaultsInternals["createTargetDefaultsResults"]>;
  /** What Nx's default plugins make of the folders' files, node by node. */
  defaults: DefaultNode[];
}

// The three layers of the projects at `roots`, built with Nx's own code.
async function rebuildLayers(
  nx: TargetDefaultsInternals,
  projects: readonly CargoProject[],
  plugin: string | undefined,
  context: TargetDefaultsContext,
  roots: readonly string[],
): Promise<Layers> {
  const nxJson = context.nxJsonConfiguration ?? {};
  const specified: Record<string, RootMapProject> = {};
  const sourceMaps: SourceMaps = {};
  for (const [manifest, result] of projectNodes(projects)) {
    for (const [root, project] of Object.entries(result.projects ?? {})) {
      nx.mergeProject(
        specified,
        structuredClone({ ...project, root }) as RootMapProject,
        sourceMaps,
        [manifest, plugin ?? ""],
        false,
      );
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
  return {
    specified,
    targetDefaults: nx.createTargetDefaultsResults(
      structuredClone(specified),
      staged,
      nxJson,
      sourceMaps,
    ),
    defaults,
  };
}

// The project at `root` as Nx merges its layers, with or without the
// entries of targetDefaults.
function rebuild(
  nx: TargetDefaultsInternals,
  layers: Layers,
  root: string,
  withTargetDefaults: boolean,
): RootMapProject {
  const rootMap: Record<string, RootMapProject> = {};
  const merge = (project: RootMapProject | undefined) => {
    if (project !== undefined) {
      nx.mergeProject(rootMap, structuredClone({ ...project, root }), undefined, undefined, false);
    }
  };
  merge(layers.specified[root]);
  if (withTargetDefaults) {
    for (const [, , result] of layers.targetDefaults) {
      merge(result.projects?.[root]);
    }
  }
  for (const { project } of layers.defaults) {
    if (project.root === root) {
      merge(project);
    }
  }
  return rootMap[root] ?? { root };
}

// Whether the rebuilt project gives what Nx merged: the target's checked
// fields, and the project's name and tags, which filters read.
function reproduces(rebuilt: RootMapProject, merged: ProjectConfiguration, name: string): boolean {
  const ours = rebuilt.targets?.[name] ?? {};
  const theirs = merged.targets?.[name] ?? {};
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  const sorted = (tags: string[] | undefined) => [...new Set(tags ?? [])].sort(compare);
  return (
    checkedFields.every((field: CheckedField) =>
      field === "cache"
        ? (ours.cache === true) === (theirs.cache === true)
        : same(ours[field] ?? [], theirs[field] ?? []),
    ) &&
    (rebuilt.name === undefined || rebuilt.name === merged.name) &&
    same(sorted(rebuilt.tags), sorted(merged.tags))
  );
}

/**
 * {@link findTargetDefaultChanges}, worded for the user.
 *
 * @param loadInternals Loads Nx's internal parts, at most once and only when they are needed.
 * @throws Whatever `loadInternals` throws.
 */
export async function checkTargetDefaults(
  graph: CargoGraph,
  context: TargetDefaultsContext,
  plugin: string | undefined,
  loadInternals: () => TargetDefaultsInternals,
): Promise<TargetDefaultReport> {
  let internals: TargetDefaultsInternals | undefined;
  const changes = await findTargetDefaultChanges(
    graph,
    context,
    plugin,
    () => (internals ??= loadInternals()),
  );
  return describeTargetDefaultChanges(changes.findings, changes.unattributed);
}

/**
 * Prints the warnings of {@link checkTargetDefaults} and fails with its
 * error, for `createDependencies`.
 *
 * @param plugin Nx's copy of the plugin for the entry, whose `name` Nx set
 *   to the name it knows the entry by.
 * @returns Each warning for each target it concerns, which `createMetadata`
 *   gives the projects, so that the tasks of those targets print it again.
 * @throws {Error} When an entry replaces what the plugin inferred or turns
 *   on caching, naming each entry, target and project and how to narrow it.
 */
export async function failOnTargetDefaults(
  graph: CargoGraph,
  context: TargetDefaultsContext,
  plugin: unknown,
): Promise<PlacedWarning[]> {
  const report = await checkTargetDefaults(graph, context, pluginEntryName(plugin), () =>
    loadTargetDefaultsInternals(context.workspaceRoot),
  );
  for (const warning of report.warnings) {
    console.warn(warning);
  }
  if (report.error !== undefined) {
    throw new Error(report.error);
  }
  return report.placed;
}

/**
 * What the `targetDefaults` of `nx.json` add to the `dependsOn` of each
 * project's inferred targets, as far as `createNodes` can see it: the
 * cause of the warning of `DES-TARGET-DEFAULT-GUARD` for an entry that adds
 * dependencies on other projects' tasks, which the digest of the project's
 * warnings covers (`DES-DIAGNOSTICS`, "Warnings where they are seen").
 * `createDependencies` finds the warning itself, once Nx has merged the
 * projects of every plugin, too late to change a key.
 *
 * The targets are rebuilt as {@link findTargetDefaultChanges} rebuilds
 * them, from the layers that `createNodes` sees: the projects of this
 * entry, the elements of `targetDefaults` that Nx's synthesis lays over
 * them, and what Nx's default plugins make of the `package.json` and
 * `project.json` on disk in each project's folder. A `dependsOn` entry
 * counts where the rebuild with the `targetDefaults` layer has it and the
 * rebuild without it does not, unless its form shows that it reaches only
 * the project's own tasks ({@link reachesOnlyOwnTasks}). A target whose
 * executor the folder's files replace is left out, as the check leaves it.
 * Nothing is loaded without an entry that sets `dependsOn`; where Nx lacks
 * the internal parts, nothing counts, and `createDependencies` fails graph
 * creation where such an entry changes a target of the plugin.
 *
 * @returns By project root, one line for each target that entries add such
 *   dependencies to, naming the target, the entry and what it adds.
 */
// @mara implements DES-TARGET-DEFAULT-GUARD
export async function targetDefaultCauses(
  projects: readonly CargoProject[],
  nxJson: NxJsonConfiguration | undefined,
  workspaceRoot: string,
  loadInternals: () => TargetDefaultsInternals = () => loadTargetDefaultsInternals(workspaceRoot),
): Promise<Map<string, string[]>> {
  const causes = new Map<string, string[]>();
  const targetDefaults: unknown = nxJson?.targetDefaults;
  if (
    projects.length === 0 ||
    !isRecord(targetDefaults) ||
    !Object.values(targetDefaults).some(setsDependsOn)
  ) {
    return causes;
  }
  let nx: TargetDefaultsInternals;
  try {
    nx = loadInternals();
  } catch {
    return causes;
  }
  const roots = projects.map(({ root }) => root);
  const files = roots
    .flatMap((root) =>
      ["package.json", "project.json"].map((name) => (root === "." ? name : `${root}/${name}`)),
    )
    .filter((file) => existsSync(join(workspaceRoot, file)));
  const context: TargetDefaultsContext = {
    projects: {},
    nxJsonConfiguration: nxJson ?? {},
    workspaceRoot,
    fileMap: { projectFileMap: {}, nonProjectFiles: files.map((file) => ({ file, hash: "" })) },
  };
  const layers = await rebuildLayers(
    nx,
    projects,
    pluginEntryNameIn(nxJson, workspaceRoot),
    context,
    roots,
  );
  const applied = appliedElements(layers.targetDefaults, targetDefaults);
  for (const project of projects) {
    const byTarget = applied.get(project.root);
    if (byTarget === undefined) {
      continue;
    }
    const withDefaults = rebuild(nx, layers, project.root, true);
    const withoutDefaults = rebuild(nx, layers, project.root, false);
    const names = [project.name, ...(withDefaults.name === undefined ? [] : [withDefaults.name])];
    const lines: string[] = [];
    for (const [name, inferred] of Object.entries(project.targets).sort(([a], [b]) =>
      compare(a, b),
    )) {
      const entry = byTarget.get(name);
      const target = withDefaults.targets?.[name];
      if (entry === undefined || target === undefined || target.executor !== inferred.executor) {
        continue;
      }
      const without = withoutDefaults.targets?.[name] ?? {};
      const added = (target.dependsOn ?? []).filter(
        (dependency) =>
          dependency !== spread &&
          !includes(without.dependsOn, dependency) &&
          !reachesOnlyOwnTasks(dependency, names),
      );
      if (added.length > 0) {
        lines.push(
          canonical({ target: name, key: entry.key, elements: entry.indices ?? null, added }),
        );
      }
    }
    if (lines.length > 0) {
      causes.set(project.root, lines);
    }
  }
  return causes;
}

// Whether a value of targetDefaults, an entry or a list of entries, sets dependsOn.
function setsDependsOn(value: unknown): boolean {
  return Array.isArray(value)
    ? value.some((element) => isRecord(element) && "dependsOn" in element)
    : isRecord(value) && "dependsOn" in value;
}

/**
 * Whether a `dependsOn` entry reaches only tasks of the project itself, as
 * far as its form shows without the names of other plugins' projects: a
 * target name without `^` and without another project before a colon, or
 * an object without `dependencies: true` whose `projects` is absent,
 * `"self"`, or only the project's own names.
 *
 * @param names The project's names: the one the plugin gives it, and the
 *   one that a file in its folder gives it.
 */
function reachesOnlyOwnTasks(dependency: unknown, names: readonly string[]): boolean {
  if (typeof dependency === "string") {
    if (dependency.startsWith("^")) {
      return false;
    }
    const colon = dependency.indexOf(":");
    return colon === -1 || names.includes(dependency.slice(0, colon));
  }
  if (!isRecord(dependency) || dependency.dependencies === true) {
    return false;
  }
  const projects = dependency.projects;
  if (projects === undefined) {
    return true;
  }
  const listed = typeof projects === "string" ? [projects] : projects;
  return (
    Array.isArray(listed) &&
    listed.every((name) => name === "self" || (typeof name === "string" && names.includes(name)))
  );
}

/**
 * The name under which Nx knows the plugin's entry in `nx.json`, which
 * `filter.plugin` of a `targetDefaults` entry compares with, as Nx 24
 * derives it (`getPluginPathAndName` in `project-graph/plugins/resolve-plugin.js`):
 * the entry's `plugin` itself where it names a `.js` or `.ts` file, and
 * otherwise the name of the package it resolves to. The first entry that
 * resolves to this plugin decides; the package's name where none does.
 */
function pluginEntryNameIn(nxJson: NxJsonConfiguration | undefined, workspaceRoot: string): string {
  let own: string | undefined;
  try {
    own = realpathSync(join(__dirname, "..", `index${extname(__filename)}`));
  } catch {
    return pluginPackageName;
  }
  for (const entry of nxJson?.plugins ?? []) {
    const plugin = typeof entry === "string" ? entry : entry.plugin;
    if (plugin === pluginPackageName) {
      return plugin;
    }
    let resolved: string;
    try {
      resolved = realpathSync(require.resolve(plugin, { paths: [workspaceRoot] }));
    } catch {
      continue;
    }
    if (resolved === own) {
      return [".js", ".ts"].includes(extname(plugin)) ? plugin : pluginPackageName;
    }
  }
  return pluginPackageName;
}

/**
 * The name under which Nx knows a plugin entry, from Nx's copy of the plugin
 * for the entry, which `createDependencies` receives as `this`.
 */
export function pluginEntryName(plugin: unknown): string | undefined {
  return isRecord(plugin) && typeof plugin.name === "string" ? plugin.name : undefined;
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

/**
 * Where Nx took each value from, as far as the layers that
 * {@link findTargetDefaultChanges} rebuilds with Nx's own code show it: the
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
  const module = (path: string): Record<string, unknown> => {
    let loaded: unknown;
    try {
      loaded = load(require.resolve(path, { paths: [workspaceRoot] }));
    } catch (error) {
      unsupported(
        workspaceRoot,
        load,
        `${path} could not be loaded (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    return isRecord(loaded) ? loaded : {};
  };
  const part = <T>(from: Record<string, unknown>, path: string, name: string): T => {
    const value = from[name];
    if (typeof value !== "function") {
      unsupported(workspaceRoot, load, `${name} from ${path} is not a function`);
    }
    return value as T;
  };
  const internalsPath = "nx/src/devkit-internals";
  const devkit = module(internalsPath);
  const createTargetDefaultsResults = part<TargetDefaultsInternals["createTargetDefaultsResults"]>(
    devkit,
    internalsPath,
    "createTargetDefaultsResults",
  );
  const matchingTargetNames = part<(pattern: string, names: string[]) => string[]>(
    devkit,
    internalsPath,
    "findMatchingTargetNames",
  );
  const expand = part<(entry: unknown, graph: DependencyGraph, project: string) => unknown>(
    devkit,
    internalsPath,
    "expandDependencyConfigSyntaxSugar",
  );
  const normalise = part<
    (entry: unknown, project: string, graph: DependencyGraph) => NormalisedDependency
  >(devkit, internalsPath, "normalizeDependencyConfigProjects");
  const nodesPath = "nx/src/project-graph/utils/project-configuration/project-nodes-manager";
  const mergeIntoRootMap = part<
    (
      rootMap: Record<string, RootMapProject>,
      project: RootMapProject,
      sourceMaps: SourceMaps | undefined,
      sourceInformation: [string | null, string] | undefined,
      skipTargetNormalization: boolean | undefined,
      deferSpreadsWithoutBase: boolean,
    ) => unknown
  >(module(nodesPath), nodesPath, "mergeProjectConfigurationIntoRootMap");
  const packageJsonPath = "nx/src/plugins/package-json";
  const packageJson = createNodesOf(module(packageJsonPath).createNodes, packageJsonPath);
  const projectJsonPath = "nx/src/plugins/project-json/build-nodes/project-json";
  const projectJsonModule = module(projectJsonPath);
  const projectJson = createNodesOf(
    isRecord(projectJsonModule.ProjectJsonProjectsPlugin)
      ? projectJsonModule.ProjectJsonProjectsPlugin.createNodes
      : undefined,
    projectJsonPath,
  );
  function createNodesOf(value: unknown, path: string): DefaultCreateNodes {
    if (!Array.isArray(value) || typeof value[1] !== "function") {
      unsupported(workspaceRoot, load, `createNodes from ${path} is not a pattern and a function`);
    }
    return value[1] as DefaultCreateNodes;
  }
  return {
    createTargetDefaultsResults,
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
        key === executor || key === targetName || matchingTargetNames(key, [targetName]).length > 0
      );
    },
    normaliseDependency(entry, project, graph) {
      return normalise(expand(structuredClone(entry), graph, project), project, graph);
    },
  };
}

/** The `createNodes` function of one of Nx's default plugins. */
type DefaultCreateNodes = (
  files: string[],
  options: unknown,
  context: { nxJsonConfiguration: object; workspaceRoot: string },
) => Promise<[string, { projects?: Record<string, RootMapProject> } | null][]>;

function unsupported(
  workspaceRoot: string,
  load: (path: string) => unknown,
  problem: string,
): never {
  const nx = nxVersion(workspaceRoot, load);
  throw new Error(
    [
      `nx-rust cannot check what the targetDefaults in nx.json do to Rust targets with ${nx === undefined ? "the installed Nx" : `the installed Nx ${nx}`}: ${problem}.`,
      "nx-rust runs these parts of Nx, which are not public API, to learn what Nx applied to a target. This version of @convesoft/nx-rust supports Nx 24.",
      "Use a supported Nx version, or a version of @convesoft/nx-rust that supports the installed one.",
    ].join("\n"),
  );
}

// The package.json and project.json in each of `roots` that Nx sees.
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
  return roots
    .flatMap((root) =>
      ["package.json", "project.json"].map((name) => (root === "." ? name : `${root}/${name}`)),
    )
    .filter((file) => seen.has(file));
}

/** The elements of one `targetDefaults` key that Nx laid over one target. */
export interface AppliedEntry {
  key: string;
  /** Their positions in the key's list, where its value is a list. */
  indices?: number[];
}

/** An entry as messages name it, such as `the targetDefaults entry "build" in nx.json (its element 1)`. */
export function entryName({ key, indices }: AppliedEntry): string {
  return `the targetDefaults entry "${key}" in nx.json${elements(indices)}`;
}

// The key and elements of Nx's synthesis, by root and target. Each result's
// file names them: `nx.json#targetDefaults.<key>` or
// `nx.json#targetDefaults.<key>[<index>]`.
function appliedElements(
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
function appliedEntry(
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

/**
 * The user-facing report of {@link findTargetDefaultChanges}: one paragraph
 * per entry and severity, which says what the entry does to which targets
 * of which projects and how to narrow it.
 */
export function describeTargetDefaultChanges(
  findings: readonly TargetDefaultFinding[],
  unattributed: readonly UnattributedChange[] = [],
): TargetDefaultReport {
  const byEntry = groupBy(findings, (finding) =>
    JSON.stringify([finding.severity, finding.key, finding.elements ?? null]),
  );
  const groups = (severity: TargetDefaultFinding["severity"]) =>
    [...byEntry.values()]
      .filter(([first]) => first.severity === severity)
      .sort(([a], [b]) => compare(a.key, b.key));
  const errors = groups("error").map(paragraph);
  const warnings = groups("warning").map((group) => ({ warning: paragraph(group), group }));
  const placed: PlacedWarning[] = [
    ...warnings.flatMap(({ warning, group }) =>
      [...groupBy(group, ({ project, target }) => `${project}\0${target}`).values()].map(
        ([{ project, target }]) => ({ project, target, warning }),
      ),
    ),
    ...unattributed.map((change) => ({
      project: change.project,
      target: change.target,
      warning: unattributedWarning(change),
    })),
  ];
  return {
    warnings: [...warnings.map(({ warning }) => warning), ...unattributed.map(unattributedWarning)],
    placed,
    ...(errors.length === 0 ? {} : { error: errors.join("\n\n") }),
  };
}

// The warning for a target whose change the plugin could not attribute.
function unattributedWarning({ target, project, manifest, fields }: UnattributedChange): string {
  return [
    `The target "${target}" of the Rust project ${project} (${manifest}) differs from what nx-rust infers in ${list(fields.map((field) => `"${field}"`))}, and nx-rust cannot tell which configuration changed it: it sees the targetDefaults of nx.json and the project's own project.json and package.json, but not, for example, another plugin listed in nx.json.`,
    `Run \`nx show target ${project}:${target} --json\` and look under "sourceMap" for the file and entry behind each of these fields. If it is a targetDefaults entry, narrow it as ${targetDefaultsGuide} shows.`,
  ].join("\n");
}

const changeOrder: readonly TargetDefaultChange[] = [
  "turns-on-cache",
  "replaces-inputs",
  "replaces-outputs",
  "replaces-dependsOn",
  "adds-dependencies",
];

const fieldOf: Record<TargetDefaultChange, string> = {
  "adds-dependencies": "dependsOn",
  "replaces-dependsOn": "dependsOn",
  "replaces-inputs": "inputs",
  "replaces-outputs": "outputs",
  "turns-on-cache": "cache",
};

// The paragraph for the findings of one entry and severity: a line for each
// change and set of projects, naming the targets, then the ways to narrow
// the entry that fit what it does.
function paragraph(findings: TargetDefaultFinding[]): string {
  const [{ key, elements: indices }] = findings;
  const lines: string[] = [];
  for (const change of changeOrder) {
    const ofChange = findings.filter((finding) => finding.change === change);
    const byTargets = groupBy(
      groupBy(ofChange, (finding) => `${finding.project}\0${finding.manifest}`).values(),
      (ofProject) =>
        JSON.stringify(
          [...new Set(ofProject.map(({ target }) => target))]
            .sort(compare)
            .concat(
              ofProject.flatMap(({ added }) => (added ?? []).map((value) => JSON.stringify(value))),
            ),
        ),
    );
    for (const group of byTargets.values()) {
      const targets = [...new Set(group.flat().map(({ target }) => `"${target}"`))].sort(compare);
      const projects = group
        .map(([{ project, manifest }]) => `${project} (${manifest})`)
        .sort(compare);
      const added = [
        ...new Set(
          group.flat().flatMap(({ added }) => (added ?? []).map((v) => JSON.stringify(v))),
        ),
      ];
      lines.push(`  - ${describeChange(change, list(targets), list(added))} In ${list(projects)}.`);
    }
  }
  const changes = new Set(findings.map(({ change }) => change));
  const fields = [...new Set(changeOrder.filter((c) => changes.has(c)).map((c) => fieldOf[c]))];
  const replaced = [...changes]
    .filter((change) => change.startsWith("replaces-"))
    .map((change) => fieldOf[change]);
  const executors = [...new Set(findings.map(({ executor }) => executor))].sort(compare);
  const fixes =
    executors.length === 1 && key === executors[0]
      ? [
          `Remove ${list(fields.map((field) => `"${field}"`))} from the entry. It is keyed by the executor of nx-rust's targets, so it reaches only those.`,
          `Give the entry a "filter" on "projects" that leaves these projects out, which needs the entry written as a list: "${key}": [{ "filter": { "projects": [...] }, ... }].`,
        ]
      : [
          `Give the entry a "filter" that leaves these projects out, which needs the entry written as a list: "${key}": [{ "filter": { "projects": ["!tag:lang:rust"] }, ... }] where the crates carry the tag lang:rust, or a filter on the "executor" of the targets the entry is meant for.`,
          `Add an empty entry keyed by the executor of these targets, ${list(executors.map((executor) => `"${executor}": {}`))}. Nx chooses an entry keyed by a target's executor before one keyed by its name.`,
        ];
  if (replaced.length > 0) {
    fixes.push(
      `Keep what nx-rust declares by putting "..." into the entry's ${list(replaced.map((field) => `"${field}"`))} list, as in ["...", <your entries>].`,
    );
  }
  return [
    `The targetDefaults entry "${key}" in nx.json${elements(indices)} changes targets that nx-rust infers:`,
    ...lines,
    `To narrow the entry (${targetDefaultsGuide}), do one of these:`,
    ...fixes.map((fix) => `  - ${fix}`),
  ].join("\n");
}

// What a change does, for the targets and the added dependencies named.
function describeChange(change: TargetDefaultChange, targets: string, added: string): string {
  switch (change) {
    case "turns-on-cache":
      return `It turns on caching for ${targets}, which nx-rust leaves uncached: Nx could restore a result where running the task would give another one.`;
    case "replaces-inputs":
      return `It replaces the inputs that nx-rust declares for ${targets}, so that the cache key and nx affected miss files or settings that the task depends on.`;
    case "replaces-outputs":
      return `It replaces the outputs that nx-rust declares for ${targets}, so that a cache hit would not restore files that the task writes.`;
    case "replaces-dependsOn":
      return `It replaces the dependsOn that nx-rust declares for ${targets}, so that the task no longer depends on a task whose output its cache key reads.`;
    case "adds-dependencies":
      return `It adds ${added} to the dependsOn of ${targets}, so that the task waits for tasks of other projects. Cargo builds what a crate depends on itself, so these only queue more cargo processes behind its build lock.`;
  }
}

function groupBy<T>(items: Iterable<T>, key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  return groups;
}

// " (its element 1)", " (its elements 0 and 2)" or nothing.
function elements(indices: number[] | undefined): string {
  if (indices === undefined) {
    return "";
  }
  return ` (its element${indices.length === 1 ? "" : "s"} ${list(indices.map(String))})`;
}

// The entries of a list the plugin inferred that the merged list lacks.
function lostFrom(
  inferred: readonly unknown[] | undefined,
  merged: readonly unknown[] | undefined,
): unknown[] {
  return (inferred ?? []).filter((entry) => !includes(merged, entry));
}

// Whether a dependency, as Nx's task graph normalises it, reaches tasks of
// projects other than `project`: through the project graph's dependencies,
// or by naming projects of which one is another.
function reachesOtherProjects(dependency: NormalisedDependency, project: string): boolean {
  return dependency.projects !== undefined
    ? dependency.projects.some((name) => name !== project)
    : dependency.dependencies === true;
}

function includes(list: readonly unknown[] | undefined, value: unknown): boolean {
  const wanted = canonical(value);
  return (list ?? []).some((entry) => canonical(entry) === wanted);
}

// JSON with sorted object keys, so that equal values compare equal.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => compare(a, b)))
      : inner,
  );
}

function nxVersion(workspaceRoot: string, load: (path: string) => unknown): string | undefined {
  try {
    const manifest = load(require.resolve("nx/package.json", { paths: [workspaceRoot] }));
    const version = isRecord(manifest) ? manifest.version : undefined;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// "a", "a and b", "a, b and c"
function list(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
