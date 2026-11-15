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
 * inferred one, which another file replaced. The project references in
 * the `dependsOn` and `inputs` that the plugin declares are first given
 * the names that Nx's merge gives them, where that is certain
 * ({@link nxNames}).
 *
 * Who made a difference is learned by rebuilding the target with Nx's own
 * code: the plugin's projects as its `createNodes` returned them, the
 * elements of `targetDefaults` that Nx's synthesis lays over them, read
 * with the project's name and tags as Nx merged them, and what Nx's default
 * plugins make of the `package.json` and `project.json` in the project's
 * folder, each merged with Nx's merge of project nodes. Each field is
 * judged on its own. Where the rebuild gives the project's name and tags and
 * the field as Nx merged them, a difference that the rebuild without the
 * `targetDefaults` layer does not have is the entry's, and the others are
 * the folder's files' and are not reported. Where it does not, as where
 * another plugin contributes, a lost `inputs`, `outputs` or `dependsOn`
 * entry, or caching turned on, that the rebuild without the
 * `targetDefaults` layer does not have is blamed on every entry with an
 * element that may apply to the target, under any plugin that may be its
 * source ({@link otherSourcePlugins}), and would make it; any other
 * difference in that field is unattributed, which for caching the
 * executor's check of the task backs. A difference in one field never
 * decides another.
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
  const declared = nxNames(graph.projects, context.projects);
  let nx: TargetDefaultsInternals | undefined;
  const pending: Pending[] = [];
  for (const project of graph.projects) {
    const merged = byRoot.get(project.root);
    if (merged?.name === undefined) {
      continue;
    }
    for (const [name, inferredTarget] of Object.entries(project.targets)) {
      const target = merged.targets?.[name];
      if (target === undefined || target.executor !== inferredTarget.executor) {
        continue;
      }
      const inferred = declared(project, inferredTarget);
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
  const layers = await rebuildLayers(nx, projects, plugin, context, roots, {
    declared,
    asMerged: byRoot,
    otherSources: otherSourcePlugins(targetDefaults, plugin, nxJson, context.workspaceRoot),
  });
  const applied = appliedElements(layers.targetDefaults, targetDefaults);
  const changes: TargetDefaultChanges = { findings: [], unattributed: [] };
  for (const { project, merged, name, target, cacheOn, lostEntries, added } of pending) {
    const withDefaults = rebuild(nx, layers, project.root, true);
    const without = rebuild(nx, layers, project.root, false).targets?.[name] ?? {};
    const reproduced = reproducedFields(withDefaults, merged, name);
    const explaining = explainingElements(layers.mayApply, project.root, name, targetDefaults);
    const entry = applied.get(project.root)?.get(name);
    const finding = (
      change: TargetDefaultChange,
      by: AppliedEntry | undefined,
      extra: Partial<TargetDefaultFinding> = {},
    ) => {
      if (by !== undefined) {
        changes.findings.push({
          change,
          severity: change === "adds-dependencies" ? "warning" : "error",
          key: by.key,
          ...(by.indices === undefined ? {} : { elements: by.indices }),
          target: name,
          executor: target.executor as string,
          project: merged.name as string,
          manifest: project.manifest,
          ...extra,
        });
      }
    };
    const unattributed = new Set<CheckedField>();
    // A difference that the rebuild without the elements of targetDefaults
    // does not have is the entry's where the rebuild gives the field as Nx
    // merged it. Where it does not, the difference is blamed on every
    // element that may apply to the target and would make it, and is
    // unattributed where none would. A difference that the rebuild without
    // those elements has too is the folder's files' where the field is
    // reproduced, and unattributed where it is not.
    const attribute = (field: CheckedField, change: TargetDefaultChange, fromDefaults: boolean) => {
      if (fromDefaults && reproduced.has(field)) {
        finding(change, entry);
      } else if (fromDefaults && (explaining.get(field) ?? []).length > 0) {
        for (const by of explaining.get(field) ?? []) {
          finding(change, by);
        }
      } else if (!reproduced.has(field)) {
        unattributed.add(field);
      }
    };
    for (const [field, change] of [
      ["dependsOn", "replaces-dependsOn"],
      ["inputs", "replaces-inputs"],
      ["outputs", "replaces-outputs"],
    ] as const) {
      if (lostEntries[field].length > 0) {
        attribute(
          field,
          change,
          lostEntries[field].some((lost) => includes(without[field], lost)),
        );
      }
    }
    if (cacheOn) {
      attribute("cache", "turns-on-cache", without.cache !== true);
    }
    if (added.length > 0) {
      if (!reproduced.has("dependsOn")) {
        unattributed.add("dependsOn");
      } else {
        const fromEntry = added.filter((dependency) => !includes(without.dependsOn, dependency));
        if (fromEntry.length > 0) {
          finding("adds-dependencies", entry, { added: fromEntry });
        }
      }
    }
    if (unattributed.size > 0) {
      changes.unattributed.push({
        target: name,
        project: merged.name as string,
        manifest: project.manifest,
        fields: checkedFields.filter((field) => unattributed.has(field)),
      });
    }
  }
  return changes;
}

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
function otherSourcePlugins(
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

/** A source plugin that no `filter.plugin` of `targetDefaults` names. */
const unnamedSource = "\0another plugin";

// For each checked field, the elements of targetDefaults that may apply to
// the target at `root`, under any source plugin, and that would make the
// difference in that field: a list that they set other than with "..." in
// it, or `cache: true`, where the field is not before an object-level
// "...", for which Nx keeps the value below. Grouped by key, as findings
// name them.
function explainingElements(
  results: readonly Layers["targetDefaults"][],
  root: string,
  name: string,
  targetDefaults: Record<string, unknown>,
): Map<CheckedField, AppliedEntry[]> {
  const elements = new Map<string, Record<string, unknown>>();
  for (const result of results) {
    for (const [, file, synthetic] of result) {
      const element: unknown = synthetic.projects?.[root]?.targets?.[name];
      if (isRecord(element)) {
        elements.set(file, element);
      }
    }
  }
  const explaining = new Map<CheckedField, AppliedEntry[]>();
  for (const [file, element] of elements) {
    const by = appliedEntry(file, targetDefaults);
    if (by === undefined) {
      continue;
    }
    const keys = Object.keys(element);
    const spreadAt = keys.indexOf(spread);
    for (const field of checkedFields) {
      const value = element[field];
      const makes =
        field === "cache"
          ? value === true
          : value !== undefined &&
            !(Array.isArray(value) ? value.includes(spread) : isRecord(value) && spread in value);
      if (!makes || (spreadAt !== -1 && keys.indexOf(field) < spreadAt)) {
        continue;
      }
      const entries = explaining.get(field) ?? [];
      const same = entries.find((entry) => entry.key === by.key);
      if (same === undefined) {
        entries.push({ ...by });
      } else if (by.indices !== undefined) {
        same.indices = [...new Set([...(same.indices ?? []), ...by.indices])].sort((a, b) => a - b);
      }
      explaining.set(field, entries);
    }
  }
  return explaining;
}

/**
 * The project references in the `dependsOn` and `inputs` of a target that
 * the plugin declares, with the names that Nx's merge gives them where that
 * is certain (`EVD-NX-24-PLUGIN-NODES`). Nx replaces each reference with
 * the project that had its name when the plugin's projects were merged,
 * and writes the final name of that project in its place once every layer
 * is merged. A name that the plugin gave one of the projects of this entry
 * had that project then, so it becomes the name under which the merged
 * graph knows the project at that root. Only the forms that Nx renames are
 * renamed: a `projects` string other than `*`, `self` and `dependencies`
 * (`self` and `dependencies` in `inputs`), each element of a `projects`
 * list that is no glob pattern, and a `<project>:<target>` string in
 * `dependsOn` with exactly one colon, for which Nx can find no other
 * reading: neither the string nor its first part names a target of the
 * project itself, and the string names no project. Every other name stays
 * as written, so that a reference that Nx renamed in a way that the plugin
 * cannot prove remains a difference.
 *
 * @param merged The projects as Nx merged them, by name.
 */
function nxNames(
  projects: readonly CargoProject[],
  merged: Record<string, ProjectConfiguration>,
): (project: CargoProject, target: TargetConfiguration) => TargetConfiguration {
  const byRoot = new Map(Object.values(merged).map((project) => [project.root, project]));
  const finalNames = new Map<string, string>();
  for (const project of projects) {
    const name = byRoot.get(project.root)?.name;
    if (name !== undefined) {
      finalNames.set(project.name, name);
    }
  }
  if ([...finalNames].every(([name, final]) => name === final)) {
    return (_project, target) => target;
  }
  const projectNames = new Set([...Object.keys(merged), ...finalNames.keys()]);
  const renamed = (name: string) => finalNames.get(name) ?? name;
  const listed = (projects: unknown[]) =>
    projects.map((name) =>
      typeof name === "string" && !isGlobPattern(name) ? renamed(name) : name,
    );
  const withProjects = (reference: unknown, kept: readonly string[]): unknown => {
    if (!isRecord(reference) || !("projects" in reference)) {
      return reference;
    }
    const { projects } = reference;
    if (typeof projects === "string") {
      return kept.includes(projects) ? reference : { ...reference, projects: renamed(projects) };
    }
    return Array.isArray(projects) ? { ...reference, projects: listed(projects) } : reference;
  };
  return (project, target) => {
    const ownTargets = new Set([
      ...Object.keys(project.targets),
      ...Object.keys(byRoot.get(project.root)?.targets ?? {}),
    ]);
    const projectTarget = (dependency: string): string => {
      const colon = dependency.indexOf(":");
      if (
        dependency.startsWith("^") ||
        dependency.includes('"') ||
        ownTargets.has(dependency) ||
        colon <= 0 ||
        colon === dependency.length - 1 ||
        dependency.indexOf(":", colon + 1) !== -1 ||
        ownTargets.has(dependency.slice(0, colon)) ||
        projectNames.has(dependency)
      ) {
        return dependency;
      }
      const final = finalNames.get(dependency.slice(0, colon));
      return final === undefined ? dependency : `${final}${dependency.slice(colon)}`;
    };
    return {
      ...target,
      ...(target.dependsOn === undefined
        ? {}
        : {
            dependsOn: target.dependsOn.map((dependency) =>
              typeof dependency === "string"
                ? projectTarget(dependency)
                : (withProjects(dependency, ["*", "self", "dependencies"]) as typeof dependency),
            ),
          }),
      ...(target.inputs === undefined
        ? {}
        : {
            inputs: target.inputs.map(
              (input) => withProjects(input, ["self", "dependencies"]) as typeof input,
            ),
          }),
    };
  };
}

// Whether Nx reads a name as a glob pattern (`isGlobPattern` in `nx/src/utils/globs.js`).
function isGlobPattern(name: string): boolean {
  return /[*|{}()[]/.test(name);
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
  /**
   * What the synthesis lays over them with this plugin as the source of its
   * targets, as `targetDefaults` holds it, and with each other plugin that
   * may be the source ({@link MergedView.otherSources}).
   */
  mayApply: ReturnType<TargetDefaultsInternals["createTargetDefaultsResults"]>[];
  /** What Nx's default plugins make of the folders' files, node by node. */
  defaults: DefaultNode[];
}

/** What {@link rebuildLayers} takes from the graph that Nx merged, where it has one. */
interface MergedView {
  /** The plugin's targets with the names that Nx gives their references ({@link nxNames}). */
  declared: (project: CargoProject, target: TargetConfiguration) => TargetConfiguration;
  /**
   * The projects as Nx merged them, by root, whose name and tags Nx's
   * synthesis reads for the filters of `targetDefaults`, also where another
   * plugin gave them.
   */
  asMerged: ReadonlyMap<string, ProjectConfiguration>;
  /** The other plugins that may be the source of the plugin's targets ({@link otherSourcePlugins}). */
  otherSources: readonly string[];
}

// The three layers of the projects at `roots`, built with Nx's own code.
async function rebuildLayers(
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
      if (view !== undefined && node.targets !== undefined) {
        const owner = projects[index];
        node.targets = Object.fromEntries(
          Object.entries(node.targets).map(([name, target]) => [
            name,
            view.declared(owner, target),
          ]),
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
    const merged = view?.asMerged.get(root);
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

// The checked fields of the target that the rebuilt project gives as Nx
// merged them, none where it does not give the project's name and tags,
// which decide which elements of targetDefaults apply.
function reproducedFields(
  rebuilt: RootMapProject,
  merged: ProjectConfiguration,
  name: string,
): Set<CheckedField> {
  const ours = rebuilt.targets?.[name] ?? {};
  const theirs = merged.targets?.[name] ?? {};
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  const sorted = (tags: string[] | undefined) => [...new Set(tags ?? [])].sort(compare);
  if (
    (rebuilt.name !== undefined && rebuilt.name !== merged.name) ||
    !same(sorted(rebuilt.tags), sorted(merged.tags))
  ) {
    return new Set();
  }
  return new Set(
    checkedFields.filter((field: CheckedField) =>
      field === "cache"
        ? (ours.cache === true) === (theirs.cache === true)
        : same(ours[field] ?? [], theirs[field] ?? []),
    ),
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
 * the project's own tasks ({@link reachesOnlyOwnTasks}). An element whose
 * filter names a tag, which `createNodes` cannot decide, counts wherever its
 * key can reach the target ({@link undecidedCauses}). A target whose
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
    const withDefaults = rebuild(nx, layers, project.root, true);
    const withoutDefaults = rebuild(nx, layers, project.root, false);
    const names = [project.name, ...(withDefaults.name === undefined ? [] : [withDefaults.name])];
    const lines: string[] = [];
    for (const [name, inferred] of Object.entries(project.targets).sort(([a], [b]) =>
      compare(a, b),
    )) {
      const target = withDefaults.targets?.[name];
      if (target === undefined || target.executor !== inferred.executor) {
        continue;
      }
      const entry = byTarget?.get(name);
      if (entry !== undefined) {
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
      lines.push(
        ...undecidedCauses(targetDefaults, name, inferred.executor, entry, names, nx).map((cause) =>
          canonical({ target: name, ...cause }),
        ),
      );
    }
    if (lines.length > 0) {
      causes.set(project.root, lines);
    }
  }
  return causes;
}

/**
 * The elements of `targetDefaults` whose `filter` `createNodes` cannot
 * decide for a target, because its `projects` names a tag, which another
 * plugin may give the project, and that add dependencies which may reach
 * other projects' tasks: each counts as a cause for every target that its
 * key can reach, by the target's executor, its name or a glob, unless Nx's
 * synthesis applied it already. That errs towards a run without a warning,
 * never towards a cache hit that shows an earlier state of the warning
 * (`DES-TARGET-DEFAULT-GUARD`).
 *
 * @param applied The elements that Nx's synthesis laid over the target.
 */
function undecidedCauses(
  targetDefaults: Record<string, unknown>,
  target: string,
  executor: string | undefined,
  applied: AppliedEntry | undefined,
  names: readonly string[],
  nx: TargetDefaultsInternals,
): { key: string; elements: number[] | null; added: unknown[] }[] {
  const causes: { key: string; elements: number[] | null; added: unknown[] }[] = [];
  for (const [key, value] of Object.entries(targetDefaults)) {
    if (!nx.keyMayApply(key, target, executor)) {
      continue;
    }
    const elements: [unknown, number | undefined][] = Array.isArray(value)
      ? value.map((element, index) => [element, index])
      : [[value, undefined]];
    for (const [element, index] of elements) {
      if (!isRecord(element) || !namesTag(element.filter)) {
        continue;
      }
      const appliedAlready =
        applied?.key === key &&
        (index === undefined ? applied.indices === undefined : applied.indices?.includes(index));
      const dependsOn: unknown[] = Array.isArray(element.dependsOn) ? element.dependsOn : [];
      const added = dependsOn.filter(
        (dependency) => dependency !== spread && !reachesOnlyOwnTasks(dependency, names),
      );
      if (!appliedAlready && added.length > 0) {
        causes.push({ key, elements: index === undefined ? null : [index], added });
      }
    }
  }
  return causes;
}

// Whether an entry's filter selects projects by a tag, also through `!`,
// which `createNodes` cannot decide: another plugin may add the tag.
function namesTag(filter: unknown): boolean {
  if (!isRecord(filter) || filter.projects === undefined) {
    return false;
  }
  const patterns: unknown[] = Array.isArray(filter.projects) ? filter.projects : [filter.projects];
  return patterns.some((pattern) => typeof pattern === "string" && /^!?tag:/.test(pattern));
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
      return `It replaces the dependsOn that nx-rust declares for ${targets}, so that the task no longer depends on a task that it needs: the lockfile task, whose output its cache key reads, or, for a test, the crate's own build, whose executables cargo test replaces.`;
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
