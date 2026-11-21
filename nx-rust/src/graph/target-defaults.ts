import type { ProjectConfiguration, TargetConfiguration } from "@nx/devkit";
import type { CargoGraph, CargoProject } from "./projects";
import {
  appliedElements,
  appliedEntry,
  type AppliedEntry,
  byKey,
  canonical,
  compare,
  type DependencyGraph,
  includes,
  isInferred,
  isRecord,
  laterPlugins,
  type Layers,
  loadTargetDefaultsInternals,
  type NormalisedDependency,
  otherSourcePlugins,
  pluginEntryName,
  rebuild,
  rebuildLayers,
  type RootMapProject,
  spread,
  type TargetDefaultsContext,
  type TargetDefaultsInternals,
} from "./target-defaults-layers";
import {
  describeWeakening,
  isEmptyWeakening,
  listFields,
  namedInputsOf,
  nxNames,
  type OtherLayerLoss,
  weakening,
  weakeningSize,
} from "./target-defaults-meaning";
import {
  describeTargetDefaultChanges,
  type PlacedWarning,
  type TargetDefaultChange,
  type TargetDefaultChanges,
  type TargetDefaultFinding,
  type TargetDefaultReport,
  targetDefaultsGuide,
} from "./target-defaults-report";

export { describeTargetDefaultChanges, loadTargetDefaultsInternals, targetDefaultsGuide };

/** The fields of a target whose changes the check looks at. */
const checkedFields = ["cache", "inputs", "outputs", "dependsOn"] as const;
type CheckedField = (typeof checkedFields)[number];

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
