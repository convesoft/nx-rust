import type {
  CreateDependenciesContext,
  NxJsonConfiguration,
  ProjectConfiguration,
  TargetConfiguration,
} from "@nx/devkit";
import { existsSync, realpathSync } from "node:fs";
import { extname, join } from "node:path";
import {
  loadDevkitInternals,
  loadPackageJsonPlugin,
  loadProjectJsonPlugin,
  loadProjectNodesManager,
  NxBridgeError,
  readNxPackageVersion,
} from "../compatibility/nx-bridge";
import type { TargetWarning } from "./collisions";
import { pluginPackageName } from "./plugin-package";
import { CargoGraph, CargoProject, projectNodes } from "./projects";
import { targetCargoMetadataKey } from "./targets";

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

/**
 * An inferred target whose `inputs`, `outputs` or `dependsOn` mean less
 * than the plugin declared, by a lost entry, an added negated pattern or a
 * named input defined anew, where neither a `targetDefaults` entry nor the
 * `project.json` or `package.json` in the project's folder did it, as
 * another plugin can (`DES-TARGET-DEFAULT-GUARD`, "Other layers").
 */
export interface OtherLayerLoss {
  target: string;
  project: string;
  manifest: string;
  /** The project's folder, relative to the repository root. */
  root: string;
  /** By field, the declared entries that the merged target lacks. */
  lost: Partial<Record<ListField, unknown[]>>;
  /** By field, the entries that another layer added and that leave files out, such as `!` patterns. */
  leavesOut?: Partial<Record<"inputs" | "outputs", unknown[]>>;
  /** The named inputs that the target reads and that another layer defines anew, so that they mean less. */
  namedInputs?: RedefinedInput[];
}

/** A named input of a project that another layer defines anew, so that it means less. */
export interface RedefinedInput {
  name: string;
  /** Its definition in the merged project. */
  definition: unknown;
  /** What its expansion lacks against the definition that the plugin and the project's own files give. */
  lost: unknown[];
  /** The negated patterns that its expansion holds and that definition does not. */
  leavesOut: unknown[];
}

/** What {@link findTargetDefaultChanges} found. */
export interface TargetDefaultChanges {
  findings: TargetDefaultFinding[];
  unattributed: UnattributedChange[];
  /** Losses that another layer made, which fail graph creation. */
  otherLayers?: OtherLayerLoss[];
  /** The plugins that `nx.json` lists after this one, as it writes them. */
  laterPlugins?: string[];
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
  namedInputs?: Record<string, unknown[]>;
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

/** The section of the user guide about what other plugins may do to Rust targets. */
export const otherPluginsGuide =
  "https://github.com/convesoft/nx-rust/blob/main/nx-rust/docs/targets.mara.md#other-plugins-that-reach-rust-targets";

const spread = "...";

/** The fields of a target whose changes the check looks at. */
const checkedFields = ["cache", "inputs", "outputs", "dependsOn"] as const;
type CheckedField = (typeof checkedFields)[number];

/** The lists among them, whose meaning another layer must not narrow. */
const listFields = ["inputs", "outputs", "dependsOn"] as const;
type ListField = (typeof listFields)[number];

/** What `createDependencies` receives, as far as the check reads it. */
export type TargetDefaultsContext = Pick<
  CreateDependenciesContext,
  "projects" | "nxJsonConfiguration" | "workspaceRoot" | "fileMap"
>;

/**
 * Checks what the `targetDefaults` of `nx.json`, and the layers that Nx
 * merges after the plugin's, did to the inferred targets of one plugin
 * entry's projects (`DES-TARGET-DEFAULT-GUARD`).
 *
 * What changed is read from the targets that Nx merged, as
 * `createDependencies` receives them, and from nothing else: caching that
 * is on where the plugin left it off, inferred `dependsOn`, `inputs` or
 * `outputs` entries that are missing, and `dependsOn` entries that Nx's task
 * graph resolves to other projects' tasks. A target without such a
 * difference, or one that no `targetDefaults` key can reach, is not
 * reported, and neither is a target whose executor is no longer the
 * inferred one, which another file replaced, nor an extra target that a
 * target table of the Cargo metadata defines, for which the plugin infers
 * nothing. The project references in the `dependsOn` and `inputs` that the
 * plugin declares are first given the names that Nx's merge gives them,
 * where that is certain ({@link nxNames}).
 *
 * Who made a difference is learned by rebuilding the target with Nx's own
 * code: the plugin's projects as its `createNodes` returned them, the
 * elements of `targetDefaults` that Nx's synthesis lays over them, read
 * with the project's name and tags as Nx merged them, and what Nx's default
 * plugins make of the `package.json` and `project.json` in the project's
 * folder, each merged with Nx's merge of project nodes. The synthesis runs
 * once for each plugin that may be the source of the target
 * ({@link otherSourcePlugins}), which `filter.plugin` compares with, and
 * each run gives a rebuild of its own. Each field is judged on its own.
 * Where a rebuild gives the project's name and tags and the field as Nx
 * merged them, a lost entry, an added dependency or caching turned on that
 * the rebuild without the `targetDefaults` layer does not have is the entry
 * that this rebuild laid over the target, for each rebuild that gives the
 * field, since graph creation cannot tell which of them Nx made; a
 * difference that the rebuild without that layer has too is the folder's
 * files', the project's own statement, and is not reported. Where no
 * rebuild gives the field, as where another plugin contributes, such a
 * difference is blamed on every entry with an element that may apply to
 * the target under any of those plugins and would make it: one that sets
 * the list without `"..."`, or `cache: true`, or, for an added dependency,
 * lists it. Where none would, another layer made it: caching turned on or
 * an added dependency is unattributed, which for caching the executor's
 * check of the task backs and which for a dependency only costs time. Each
 * of `inputs`, `outputs` and `dependsOn` is also judged by what it means
 * ({@link weakening}): where no rebuild gives a list that the merged one
 * does not weaken, and no entry is blamed for the field, another layer
 * narrowed it, which is an error of its own ({@link OtherLayerLoss}), also
 * without any `targetDefaults`. A difference in one field never decides
 * another.
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
  // Without entries the check still runs: another layer can take away what
  // the plugin declares (DES-TARGET-DEFAULT-GUARD, "Other layers").
  const targetDefaults: Record<string, unknown> = isRecord(nxJson.targetDefaults)
    ? nxJson.targetDefaults
    : {};
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
    const mergedNamed = namedInputsOf(nxJson, merged.namedInputs);
    const declaredNamed = namedInputsOf(nxJson, project.namedInputs);
    for (const [name, inferredTarget] of Object.entries(project.targets)) {
      const target = merged.targets?.[name];
      if (
        target === undefined ||
        !isInferred(inferredTarget) ||
        target.executor !== inferredTarget.executor
      ) {
        continue;
      }
      const inferred = declared(project, inferredTarget);
      // What the lists mean, against what the plugin declares: a quick
      // test, which the rebuilds below then decide (DES-TARGET-DEFAULT-GUARD,
      // "Other layers").
      const narrows = listFields.some(
        (field) =>
          !isEmptyWeakening(
            weakening(
              field,
              { target, named: mergedNamed },
              { target: inferred, named: declaredNamed },
            ),
          ),
      );
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
        !narrows &&
        Object.values(lostEntries).every((lost) => lost.length === 0) &&
        undeclared.length === 0
      ) {
        continue;
      }
      nx ??= internals();
      const loaded = nx;
      const added = undeclared.filter((entry) =>
        reachesOtherProjects(
          loaded.normaliseDependency(entry, merged.name as string, dependencyGraph),
          merged.name as string,
        ),
      );
      if (
        !cacheOn &&
        !narrows &&
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
  const applied = layers.mayApply.map((results) => appliedElements(results, targetDefaults));
  const changes: TargetDefaultChanges = {
    findings: [],
    unattributed: [],
    otherLayers: [],
    laterPlugins: laterPlugins(nxJson, context.workspaceRoot),
  };
  for (const { project, merged, name, target, cacheOn, lostEntries, added } of pending) {
    const without = rebuild(nx, layers, project.root, undefined).targets?.[name] ?? {};
    // One rebuild for each plugin that may be the source of the target:
    // those that give a field as Nx merged it are what Nx may have done.
    const sources = layers.mayApply.map((results, index) => {
      const rebuilt = rebuild(nx, layers, project.root, results);
      return {
        rebuilt,
        reproduced: reproducedFields(rebuilt, merged, name),
        entry: applied[index].get(project.root)?.get(name),
      };
    });
    const reproducing = (field: CheckedField) =>
      sources.filter(({ reproduced }) => reproduced.has(field));
    const explaining = explainingElements(layers.mayApply, project.root, name, targetDefaults);
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
    const blamed = new Set<CheckedField>();
    // A difference that the rebuild without the elements of targetDefaults
    // has too is the folder's files', the project's own statement, and is
    // not reported. One that it lacks is the entry's where a rebuild gives
    // the field as Nx merged it, and where the rebuilds for several source
    // plugins do, the entry of each, since graph creation cannot tell which
    // source Nx read. Where none does, it is blamed on every element that
    // may apply to the target and would make it. Where none would, another
    // layer made it: caching turned on draws the warning that the
    // executor's check backs, and a list is judged by what it means below.
    const attribute = (field: CheckedField, change: TargetDefaultChange, fromDefaults: boolean) => {
      const entries = byKey(reproducing(field).flatMap(({ entry }) => entry ?? []));
      if (!fromDefaults) {
        return;
      }
      const by = entries.length > 0 ? entries : (explaining.get(field) ?? []);
      for (const entry of by) {
        finding(change, entry);
        blamed.add(field);
      }
      if (by.length === 0 && field === "cache") {
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
    // What each list means, against each rebuild: where one rebuild gives a
    // list that the merged one does not weaken, the layers that the plugin
    // can see explain it; otherwise another layer weakened it, unless an
    // entry of targetDefaults is blamed for the field already.
    const mergedNamed = namedInputsOf(nxJson, merged.namedInputs);
    const loss: Omit<OtherLayerLoss, "target" | "project" | "manifest" | "root"> = { lost: {} };
    for (const field of listFields) {
      if (blamed.has(field)) {
        continue;
      }
      const options = sources.map(({ rebuilt }) => {
        const expected = {
          target: rebuilt.targets?.[name] ?? {},
          named: namedInputsOf(nxJson, rebuilt.namedInputs),
        };
        return {
          expected,
          weakened: weakening(field, { target, named: mergedNamed }, expected),
        };
      });
      if (options.some(({ weakened }) => isEmptyWeakening(weakened))) {
        continue;
      }
      const [least] = [...options].sort(
        (a, b) => weakeningSize(a.weakened) - weakeningSize(b.weakened),
      );
      describeWeakening(field, { target, named: mergedNamed }, least.expected, loss);
    }
    const lostToOthers = loss.lost;
    if (added.length > 0) {
      // As for a lost entry: an added dependency that the rebuild without
      // the elements of targetDefaults lacks is the entry's where a rebuild
      // gives the dependsOn as Nx merged it; where none does, it is blamed
      // on every element that may apply to the target and lists it, and is
      // unattributed where none does.
      const fromEntries = added.filter((dependency) => !includes(without.dependsOn, dependency));
      const entries = byKey(reproducing("dependsOn").flatMap(({ entry }) => entry ?? []));
      if (reproducing("dependsOn").length > 0) {
        for (const by of fromEntries.length > 0 ? entries : []) {
          finding("adds-dependencies", by, { added: fromEntries });
        }
      } else {
        const adding = addingElements(
          layers.mayApply,
          project.root,
          name,
          targetDefaults,
          fromEntries,
          project.targets[name]?.dependsOn !== undefined,
        );
        for (const { by, dependencies } of adding) {
          finding("adds-dependencies", by, { added: dependencies });
        }
        const explained = adding.flatMap(({ dependencies }) => dependencies);
        // A dependsOn that another layer took entries away from fails graph
        // creation already, and a reference that Nx renamed shows as one
        // entry lost and one added.
        if (
          lostToOthers.dependsOn === undefined &&
          fromEntries.some((dependency) => !includes(explained, dependency))
        ) {
          unattributed.add("dependsOn");
        }
      }
    }
    if (
      Object.keys(loss.lost).length > 0 ||
      Object.keys(loss.leavesOut ?? {}).length > 0 ||
      (loss.namedInputs ?? []).length > 0
    ) {
      changes.otherLayers?.push({
        target: name,
        project: merged.name as string,
        manifest: project.manifest,
        root: project.root,
        ...loss,
      });
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

/** A target with the named inputs of its project, as Nx's task hasher reads them. */
interface TargetMeaning {
  target: TargetConfiguration;
  named: Record<string, unknown[]>;
}

/** What one list of a merged target lacks or leaves out against what is expected of it. */
interface Weakening {
  /** Entries of the expected list, `inputs` expanded, that the merged one lacks. */
  lost: unknown[];
  /** Negated patterns of the merged list, `inputs` expanded, that the expected one lacks. */
  leavesOut: unknown[];
}

/** The inputs of a target without `inputs` (`DEFAULT_INPUTS` in Nx's task hasher). */
const defaultInputs: unknown[] = [{ input: "default" }, { dependencies: true, input: "default" }];

/**
 * A project's named inputs as Nx's task hasher reads them (`getNamedInputs`
 * in `nx/src/hasher/task-hasher.js`): Nx's built-in `default`, replaced by
 * a definition in `nx.json`, replaced by the project's own.
 */
function namedInputsOf(
  nxJson: NxJsonConfiguration,
  project: Record<string, unknown> | undefined,
): Record<string, unknown[]> {
  const named: Record<string, unknown[]> = { default: [{ fileset: "{projectRoot}/**/*" }] };
  for (const definitions of [nxJson.namedInputs, project]) {
    for (const [name, definition] of Object.entries(isRecord(definitions) ? definitions : {})) {
      if (Array.isArray(definition)) {
        named[name] = definition;
      }
    }
  }
  return named;
}

/**
 * Inputs expanded as Nx's task hasher expands a project's own inputs
 * (`splitInputsIntoSelfAndDependencies` and `expandSingleProjectInputs`): a
 * name of a named input, as a string or as `{ "input": name }`, stands for
 * its definition, recursively, and any other string for a file set; an entry
 * for the dependencies or other projects, such as `^default`, which means
 * what those projects define, and every other object stay as written.
 */
function expandInputs(
  inputs: readonly unknown[],
  named: Record<string, unknown[]>,
  chain: readonly string[] = [],
): unknown[] {
  const expanded: unknown[] = [];
  const expand = (name: string, written: unknown) => {
    const definition = named[name];
    if (definition !== undefined && !chain.includes(name)) {
      expanded.push(...expandInputs(definition, named, [...chain, name]));
    } else {
      expanded.push(written);
    }
  };
  for (const input of inputs) {
    if (typeof input === "string") {
      if (input.startsWith("^")) {
        expanded.push(input);
      } else if (named[input] !== undefined) {
        expand(input, input);
      } else {
        expanded.push({ fileset: input });
      }
    } else if (
      isRecord(input) &&
      typeof input.input === "string" &&
      input.dependencies === undefined &&
      input.projects === undefined &&
      input.fileset === undefined
    ) {
      expand(input.input, input);
    } else {
      expanded.push(input);
    }
  }
  return expanded;
}

/** The names of the named inputs that inputs read, directly or through other named inputs. */
function namesRead(inputs: readonly unknown[], named: Record<string, unknown[]>): string[] {
  const names = new Set<string>();
  const walk = (list: readonly unknown[]) => {
    for (const input of list) {
      const name =
        typeof input === "string" && !input.startsWith("^")
          ? input
          : isRecord(input) &&
              typeof input.input === "string" &&
              input.dependencies === undefined &&
              input.projects === undefined
            ? input.input
            : undefined;
      if (name !== undefined && named[name] !== undefined && !names.has(name)) {
        names.add(name);
        walk(named[name]);
      }
    }
  };
  walk(inputs);
  return [...names];
}

// Whether an entry leaves files out: a pattern that starts with `!`, in a
// file set of the project's own or of its dependencies, or among outputs.
function leavesOut(field: "inputs" | "outputs", entry: unknown): boolean {
  if (field === "outputs") {
    return typeof entry === "string" && entry.startsWith("!");
  }
  if (typeof entry === "string") {
    return entry.startsWith("^!");
  }
  return isRecord(entry) && typeof entry.fileset === "string" && entry.fileset.startsWith("!");
}

/**
 * What one list of the merged target means less than the expected one
 * (`DES-TARGET-DEFAULT-GUARD`, "Other layers"): the entries of the expected
 * list that the merged one lacks, and the negated patterns of the merged
 * list that the expected one lacks, `inputs` compared after Nx's expansion
 * with each side's named inputs. An added entry that is no negated pattern
 * only widens: an input only adds to what the key hashes, an output to what
 * Nx stores and restores, and a dependency to the tasks that run first.
 */
function weakening(field: ListField, merged: TargetMeaning, expected: TargetMeaning): Weakening {
  const list = (meaning: TargetMeaning): unknown[] =>
    field === "inputs"
      ? expandInputs(meaning.target.inputs ?? defaultInputs, meaning.named)
      : (meaning.target[field] ?? []);
  const mergedList = list(merged);
  const expectedList = list(expected);
  const inMerged = new Set(mergedList.map(canonical));
  const inExpected = new Set(expectedList.map(canonical));
  return {
    lost: expectedList.filter((entry) => !inMerged.has(canonical(entry))),
    leavesOut:
      field === "dependsOn"
        ? []
        : mergedList.filter(
            (entry) => leavesOut(field, entry) && !inExpected.has(canonical(entry)),
          ),
  };
}

function isEmptyWeakening({ lost, leavesOut }: Weakening): boolean {
  return lost.length === 0 && leavesOut.length === 0;
}

function weakeningSize({ lost, leavesOut }: Weakening): number {
  return lost.length + leavesOut.length;
}

/**
 * Adds to `loss` how one list of the merged target means less than the
 * expected one, in the terms in which the layers wrote it: the expected
 * entries whose meaning the merged list lacks, the entries that the merged
 * list adds and that leave files out, and, for `inputs`, the named inputs
 * that the target reads and that the merged project defines so that they
 * mean less. What none of these shows is added as Nx expands it.
 */
function describeWeakening(
  field: ListField,
  merged: TargetMeaning,
  expected: TargetMeaning,
  loss: Omit<OtherLayerLoss, "target" | "project" | "manifest" | "root">,
): void {
  const whole = weakening(field, merged, expected);
  if (field !== "inputs") {
    if (whole.lost.length > 0) {
      loss.lost[field] = whole.lost;
    }
    if (field === "outputs" && whole.leavesOut.length > 0) {
      loss.leavesOut = { ...loss.leavesOut, outputs: whole.leavesOut };
    }
    return;
  }
  const mergedTop = merged.target.inputs ?? defaultInputs;
  const expectedTop = expected.target.inputs ?? defaultInputs;
  const mergedAll = new Set(expandInputs(mergedTop, merged.named).map(canonical));
  const expectedAll = new Set(expandInputs(expectedTop, expected.named).map(canonical));
  const writtenMerged = new Set(mergedTop.map(canonical));
  const writtenExpected = new Set(expectedTop.map(canonical));
  const lost = expectedTop.filter(
    (entry) =>
      !writtenMerged.has(canonical(entry)) &&
      expandInputs([entry], expected.named).some((part) => !mergedAll.has(canonical(part))),
  );
  const added = mergedTop.filter(
    (entry) =>
      !writtenExpected.has(canonical(entry)) &&
      expandInputs([entry], merged.named).some(
        (part) => leavesOut("inputs", part) && !expectedAll.has(canonical(part)),
      ),
  );
  const redefined: RedefinedInput[] = [];
  for (const name of new Set([
    ...namesRead(mergedTop, merged.named),
    ...namesRead(expectedTop, expected.named),
  ])) {
    if (canonical(merged.named[name]) === canonical(expected.named[name])) {
      continue;
    }
    const meaning = (named: Record<string, unknown[]>): TargetMeaning => ({
      target: { inputs: (named[name] ?? []) as TargetConfiguration["inputs"] },
      named,
    });
    const part = weakening("inputs", meaning(merged.named), meaning(expected.named));
    if (!isEmptyWeakening(part)) {
      redefined.push({
        name,
        definition: merged.named[name] ?? null,
        lost: part.lost,
        leavesOut: part.leavesOut,
      });
    }
  }
  if (lost.length > 0) {
    loss.lost.inputs = lost;
  }
  if (added.length > 0) {
    loss.leavesOut = { ...loss.leavesOut, inputs: added };
  }
  if (redefined.length > 0) {
    loss.namedInputs = [...(loss.namedInputs ?? []), ...redefined];
  }
  if (lost.length === 0 && added.length === 0 && redefined.length === 0) {
    loss.lost.inputs = whole.lost;
    if (whole.leavesOut.length > 0) {
      loss.leavesOut = { ...loss.leavesOut, inputs: whole.leavesOut };
    }
  }
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

/**
 * The plugins that `nx.json` lists after the first entry of this plugin, as
 * it writes them, once each: the ones whose targets Nx merges over this
 * plugin's, where they can replace its lists. A plugin listed before it
 * cannot, since this plugin's lists replace its own.
 */
function laterPlugins(nxJson: NxJsonConfiguration, workspaceRoot: string): string[] {
  const names = (nxJson.plugins ?? []).map((entry) =>
    typeof entry === "string" ? entry : entry.plugin,
  );
  const first = names.findIndex((name) => isThisPlugin(name, workspaceRoot));
  return [...new Set(names.slice(first + 1).filter((name) => !isThisPlugin(name, workspaceRoot)))];
}

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
  const explaining = new Map<CheckedField, AppliedEntry[]>();
  for (const [by, element] of mayApplyElements(results, root, name, targetDefaults)) {
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
      explaining.set(field, byKey([...(explaining.get(field) ?? []), by]));
    }
  }
  return explaining;
}

// For each key of targetDefaults with elements that may apply to the target
// at `root`, under any source plugin, and whose `dependsOn` lists some of
// `dependencies`, those dependencies. An element's list counts unless it
// stands before an object-level "..." where the plugin declares a dependsOn,
// which Nx then keeps.
function addingElements(
  results: readonly Layers["targetDefaults"][],
  root: string,
  name: string,
  targetDefaults: Record<string, unknown>,
  dependencies: readonly unknown[],
  declaresDependsOn: boolean,
): { by: AppliedEntry; dependencies: unknown[] }[] {
  const adding = new Map<string, { by: AppliedEntry; dependencies: unknown[] }>();
  for (const [by, element] of mayApplyElements(results, root, name, targetDefaults)) {
    const keys = Object.keys(element);
    const spreadAt = keys.indexOf(spread);
    const listed: unknown = element.dependsOn;
    if (
      !Array.isArray(listed) ||
      (declaresDependsOn && spreadAt !== -1 && keys.indexOf("dependsOn") < spreadAt)
    ) {
      continue;
    }
    const added = dependencies.filter((dependency) => includes(listed, dependency));
    if (added.length === 0) {
      continue;
    }
    const same = adding.get(by.key);
    adding.set(by.key, {
      by: byKey([...(same === undefined ? [] : [same.by]), by])[0],
      dependencies: dependencies.filter(
        (dependency) => includes(added, dependency) || includes(same?.dependencies, dependency),
      ),
    });
  }
  return [...adding.values()];
}

// The elements of targetDefaults that Nx's synthesis lays over the target at
// `root` under any of the source plugins whose results are given, each with
// its key and position, once each.
function mayApplyElements(
  results: readonly Layers["targetDefaults"][],
  root: string,
  name: string,
  targetDefaults: Record<string, unknown>,
): [AppliedEntry, Record<string, unknown>][] {
  const elements = new Map<string, Record<string, unknown>>();
  for (const result of results) {
    for (const [, file, synthetic] of result) {
      const element: unknown = synthetic.projects?.[root]?.targets?.[name];
      if (isRecord(element)) {
        elements.set(file, element);
      }
    }
  }
  return [...elements].flatMap(([file, element]): [AppliedEntry, Record<string, unknown>][] => {
    const by = appliedEntry(file, targetDefaults);
    return by === undefined ? [] : [[by, element]];
  });
}

// The entries given, one for each key, with the positions of its elements
// joined, in the order in which the keys first appear.
function byKey(entries: readonly AppliedEntry[]): AppliedEntry[] {
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
function isInferred(target: TargetConfiguration): boolean {
  return target.metadata?.[targetCargoMetadataKey] !== undefined;
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

/**
 * What {@link rebuildLayers} takes from the graph that Nx merged, where it
 * has one, and the other plugins that may be the source of the plugin's
 * targets, which `createNodes` knows as well.
 */
interface MergedView {
  /** The plugin's targets with the names that Nx gives their references ({@link nxNames}). */
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
function rebuild(
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
  return describeTargetDefaultChanges(changes.findings, changes.unattributed, changes);
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
 *   on caching, naming each entry, target and project and how to narrow it,
 *   or when another layer takes away what the plugin declared, naming each
 *   target, what was lost, the plugins listed after this one and the fixes.
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
 * The inferred targets are rebuilt as {@link findTargetDefaultChanges}
 * rebuilds them, from the layers that `createNodes` sees: the projects of
 * this entry, the elements of `targetDefaults` that Nx's synthesis lays over
 * them, once for each plugin that may be the source of the targets, which
 * `createNodes` cannot see either ({@link otherSourcePlugins}), and what
 * Nx's default plugins make of the `package.json` and `project.json` on disk
 * in each project's folder. A `dependsOn` entry counts where a rebuild with
 * the `targetDefaults` layer has it and the rebuild without it does not,
 * unless its form shows that it reaches only the project's own tasks
 * ({@link reachesOnlyOwnTasks}). An element whose filter names a tag, which
 * `createNodes` cannot decide, counts wherever its key can reach the target
 * ({@link undecidedCauses}). A target whose executor the folder's files
 * replace is left out, as the check leaves it, and so is an extra target.
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
  const files = [
    ...new Set([
      ...roots.flatMap((root) =>
        ["package.json", "project.json"].map((name) => (root === "." ? name : `${root}/${name}`)),
      ),
      "package.json",
    ]),
  ].filter((file) => existsSync(join(workspaceRoot, file)));
  const context: TargetDefaultsContext = {
    projects: {},
    nxJsonConfiguration: nxJson ?? {},
    workspaceRoot,
    fileMap: { projectFileMap: {}, nonProjectFiles: files.map((file) => ({ file, hash: "" })) },
  };
  const plugin = pluginEntryNameIn(nxJson, workspaceRoot);
  const layers = await rebuildLayers(nx, projects, plugin, context, roots, {
    otherSources: otherSourcePlugins(targetDefaults, plugin, nxJson ?? {}, workspaceRoot),
  });
  const applied = layers.mayApply.map((results) => appliedElements(results, targetDefaults));
  for (const project of projects) {
    const withoutDefaults = rebuild(nx, layers, project.root, undefined);
    // For each plugin that may be the source of the project's targets.
    const sources = layers.mayApply.map((results, index) => ({
      rebuilt: rebuild(nx, layers, project.root, results),
      byTarget: applied[index].get(project.root),
    }));
    const [primary] = sources;
    const names = [
      project.name,
      ...(primary.rebuilt.name === undefined ? [] : [primary.rebuilt.name]),
    ];
    const lines = new Set<string>();
    for (const [name, inferred] of Object.entries(project.targets).sort(([a], [b]) =>
      compare(a, b),
    )) {
      if (!isInferred(inferred)) {
        continue;
      }
      for (const { rebuilt, byTarget } of sources) {
        const target = rebuilt.targets?.[name];
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
            lines.add(
              canonical({ target: name, key: entry.key, elements: entry.indices ?? null, added }),
            );
          }
        }
      }
      const target = primary.rebuilt.targets?.[name];
      if (target === undefined || target.executor !== inferred.executor) {
        continue;
      }
      for (const cause of undecidedCauses(
        targetDefaults,
        name,
        inferred.executor,
        primary.byTarget?.get(name),
        names,
        nx,
      )) {
        lines.add(canonical({ target: name, ...cause }));
      }
    }
    if (lines.size > 0) {
      causes.set(project.root, [...lines]);
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
 * of which projects and how to narrow it, and one paragraph for the losses
 * that another layer made.
 */
export function describeTargetDefaultChanges(
  findings: readonly TargetDefaultFinding[],
  unattributed: readonly UnattributedChange[] = [],
  others: Pick<TargetDefaultChanges, "otherLayers" | "laterPlugins"> = {},
): TargetDefaultReport {
  const byEntry = groupBy(findings, (finding) =>
    JSON.stringify([finding.severity, finding.key, finding.elements ?? null]),
  );
  const groups = (severity: TargetDefaultFinding["severity"]) =>
    [...byEntry.values()]
      .filter(([first]) => first.severity === severity)
      .sort(([a], [b]) => compare(a.key, b.key));
  const errors = [
    ...groups("error").map(paragraph),
    ...((others.otherLayers ?? []).length > 0
      ? [otherLayersParagraph(others.otherLayers ?? [], others.laterPlugins ?? [])]
      : []),
  ];
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

// The error for the losses that another layer made: a line for each field of
// each target, with up to three of the lost entries, the plugins listed
// after nx-rust and the fixes (DES-TARGET-DEFAULT-GUARD, "Other layers").
function otherLayersParagraph(losses: readonly OtherLayerLoss[], laterPlugins: string[]): string {
  const sorted = [...losses].sort(
    (a, b) => compare(a.project, b.project) || compare(a.target, b.target),
  );
  // Up to three entries, then how many more.
  // A file set that Nx's expansion wrote as an object is shown as the
  // pattern that the layers write.
  const some = (entries: readonly unknown[]) => {
    const shown = entries
      .slice(0, 3)
      .map((entry) =>
        JSON.stringify(
          isRecord(entry) && Object.keys(entry).length === 1 && typeof entry.fileset === "string"
            ? entry.fileset
            : entry,
        ),
      );
    const more = entries.length - shown.length;
    return list(more > 0 ? [...shown, `${more} more`] : shown);
  };
  const lines: string[] = [];
  for (const { target, project, manifest, lost, leavesOut, namedInputs } of sorted) {
    const subject = `"${target}" of ${project} (${manifest})`;
    for (const field of listFields) {
      const entries = lost[field] ?? [];
      if (entries.length > 0) {
        lines.push(
          `  - ${subject} lacks entries of its "${field}" that nx-rust declares: ${some(entries)}.`,
        );
      }
    }
    for (const field of ["inputs", "outputs"] as const) {
      const entries = leavesOut?.[field] ?? [];
      if (entries.length > 0) {
        lines.push(
          `  - ${subject} has entries of its "${field}" that leave files out: ${some(entries)}.`,
        );
      }
    }
    for (const { name, definition, lost: dropped, leavesOut: excluded } of namedInputs ?? []) {
      const effects = [
        ...(dropped.length > 0 ? [`lacks ${some(dropped)}`] : []),
        ...(excluded.length > 0 ? [`leaves files out with ${some(excluded)}`] : []),
      ];
      lines.push(
        `  - ${subject} reads the named input "${name}", which another layer defines for ${project} as ${JSON.stringify(definition)}, so that it ${effects.join(" and ")}.`,
      );
    }
  }
  const [first] = sorted;
  const folder = (file: string) => (first.root === "." ? file : `${first.root}/${file}`);
  const field =
    [...listFields].find(
      (name) =>
        (first.lost[name] ?? []).length > 0 ||
        (name !== "dependsOn" && (first.leavesOut?.[name] ?? []).length > 0),
    ) ?? "inputs";
  const namesProjects = sorted.some(({ lost }) =>
    Object.entries(lost).some(([field, entries]) =>
      (entries ?? []).some((entry) => namesProject(entry, field === "dependsOn")),
    ),
  );
  const fixes = [
    ...(laterPlugins.length > 0
      ? [
          `Keep the plugin away from these projects with an "exclude" on its entry in nx.json, as in { "plugin": ${JSON.stringify(laterPlugins[0])}, "exclude": [${JSON.stringify(folder("**"))}] }.`,
        ]
      : []),
    `Where the plugin is yours, have it keep nx-rust's entries with "..." at the head of each list that it gives these targets, as in "${field}": ["...", <its entries>], and give these projects no negated pattern or named input of its own.`,
    `If the change is intended, write it into the project.json in the project's folder, such as ${folder("project.json")}: nx-rust takes that file, and a package.json there, as the project's own statement.`,
    ...(namesProjects
      ? [
          "Where a lost entry names a project, a project.json or package.json that renames that project makes Nx write the project's final name into the reference: name the project in the Cargo metadata as `nx show projects` lists it.",
        ]
      : []),
  ];
  return [
    "Another plugin takes away or narrows what nx-rust declares for targets that it infers, and neither a targetDefaults entry in nx.json nor the projects' own project.json or package.json does it:",
    ...lines,
    "Nx could then restore a result that running the task would not give: the cache key and nx affected miss what the task reads, a cache hit leaves out files that it writes, or the task runs without a task that it needs.",
    laterPlugins.length > 0
      ? `nx.json lists these plugins after nx-rust, whose targets Nx merges over nx-rust's: ${list(laterPlugins.map((name) => JSON.stringify(name)))}.`
      : "nx.json lists no plugin after nx-rust.",
    `To keep what nx-rust declares (${otherPluginsGuide}), do one of these:`,
    ...fixes.map((fix) => `  - ${fix}`),
    `Run \`nx show target ${first.project}:${first.target} --json\` and look under "sourceMap" for the plugin behind each of these fields.`,
  ].join("\n");
}

// Whether a declared inputs or dependsOn entry names a project, which Nx
// gives the final name of the project that had that name (EVD-NX-24-PLUGIN-NODES):
// a `projects` name other than `*`, `self`, `dependencies` and a pattern with
// a colon, such as `directory:rust`, or a `<project>:<target>` dependency.
function namesProject(entry: unknown, dependsOn: boolean): boolean {
  if (typeof entry === "string") {
    return dependsOn && !entry.startsWith("^") && entry.includes(":");
  }
  if (!isRecord(entry)) {
    return false;
  }
  const projects: unknown[] = Array.isArray(entry.projects) ? entry.projects : [entry.projects];
  return projects.some(
    (name) =>
      typeof name === "string" &&
      !["*", "self", "dependencies"].includes(name) &&
      !name.includes(":") &&
      !isGlobPattern(name),
  );
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
      return `It replaces the dependsOn that nx-rust declares for ${targets}, so that the task no longer depends on a task that it needs: the lockfile task, whose output its cache key reads, or, for a test, the build of each crate whose executables its cargo test replaces.`;
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
  const present = new Set((merged ?? []).map(canonical));
  return (inferred ?? []).filter((entry) => !present.has(canonical(entry)));
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
