import type {
  CreateDependenciesContext,
  ProjectConfiguration,
  TargetConfiguration,
} from "@nx/devkit";
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

/** What {@link checkTargetDefaults} found: warnings to print and an error to fail with. */
export interface TargetDefaultReport {
  warnings: string[];
  /** Absent when no entry does what makes an error. */
  error?: string;
}

/** A project as Nx's root maps hold it while it merges the layers of a project. */
interface RootMapProject {
  root: string;
  name?: string;
  tags?: string[];
  targets?: Record<string, TargetConfiguration>;
}

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
 * The parts of the installed Nx that the check runs, so that it decides as
 * Nx does (`DES-TARGET-DEFAULT-GUARD`). None is public API.
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
    specifiedSourceMaps: Record<string, Record<string, [string | null, string]>>,
  ): [string, string, { projects?: Record<string, RootMapProject> }][];
  /** What Nx's default plugins make of the `package.json` and `project.json` files given. */
  defaultLayer(
    files: string[],
    nxJson: object,
    workspaceRoot: string,
  ): Promise<Record<string, RootMapProject>>;
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

/** What `createDependencies` receives, as far as the check reads it. */
export type TargetDefaultsContext = Pick<
  CreateDependenciesContext,
  "projects" | "nxJsonConfiguration" | "workspaceRoot" | "fileMap"
>;

/**
 * Checks what the `targetDefaults` of `nx.json` did to the inferred targets
 * of one plugin entry's projects (`DES-TARGET-DEFAULT-GUARD`).
 *
 * Each inferred target is compared with the target that Nx made of it, as
 * `createDependencies` receives it: dependencies on other projects' tasks
 * that were added, inferred `dependsOn`, `inputs` or `outputs` entries that
 * are missing, and caching that is on where the plugin left it off. A
 * target whose executor is no longer the inferred one was replaced by
 * another file and is left alone.
 *
 * Only where something differs does the check learn who made the
 * difference, from Nx's own code: Nx's default plugins give what the
 * `package.json` and `project.json` in the project's folder declare, and
 * Nx's synthesis of target defaults, given the plugin's projects and those
 * declarations, gives the elements of `targetDefaults` that Nx laid over
 * the target. A field that the folder's files set without `"..."` is theirs
 * and is not reported; otherwise a difference is reported when the applied
 * elements set that field.
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
): Promise<TargetDefaultFinding[]> {
  const nxJson = context.nxJsonConfiguration ?? {};
  const targetDefaults: unknown = nxJson.targetDefaults;
  if (!isRecord(targetDefaults) || Object.keys(targetDefaults).length === 0) {
    return [];
  }
  const byRoot = new Map<string, ProjectConfiguration>();
  for (const project of Object.values(context.projects)) {
    byRoot.set(project.root, project);
  }
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
      const added = (target.dependsOn ?? []).filter(
        (entry) => entry !== spread && !includes(inferred.dependsOn, entry),
      );
      const differs = {
        // The plugin's `cache` comes from `cachedTargets`, the set that the
        // executor's check reads, and is off as well where `DES-OUTPUTS`
        // leaves a target of that set uncached.
        cache: inferred.cache !== true && target.cache === true,
        dependsOn: lost(inferred.dependsOn, target.dependsOn),
        inputs: lost(inferred.inputs, target.inputs),
        outputs: lost(inferred.outputs, target.outputs),
      };
      if (added.length > 0 || Object.values(differs).some(Boolean)) {
        pending.push({ project, merged, name, inferred, target, added, differs });
      }
    }
  }
  if (pending.length === 0) {
    return [];
  }
  const nx = internals();
  const roots = [...new Set(pending.map(({ project }) => project.root))];
  const defaults = await nx.defaultLayer(
    declarationFiles(roots, context.fileMap),
    nxJson,
    context.workspaceRoot,
  );
  const applied = appliedElements(
    nx.createTargetDefaultsResults(
      specifiedLayer(graph.projects.filter(({ root }) => roots.includes(root))),
      Object.fromEntries(roots.flatMap((root) => (defaults[root] ? [[root, defaults[root]]] : []))),
      nxJson,
      sourceMaps(
        graph.projects.filter(({ root }) => roots.includes(root)),
        plugin,
      ),
    ),
    targetDefaults,
  );
  const dependencyGraph: DependencyGraph = {
    nodes: Object.fromEntries(
      Object.entries(context.projects).map(([name, data]) => [name, { name, type: "lib", data }]),
    ),
  };
  const findings: TargetDefaultFinding[] = [];
  for (const { project, merged, name, target, added, differs } of pending) {
    const entry = applied.get(project.root)?.get(name);
    if (entry === undefined) {
      continue;
    }
    const declared = defaults[project.root]?.targets?.[name];
    // Whether the folder's files set the field themselves, so that the
    // value is theirs; with "..." they keep what lies below them.
    const theirs = (field: keyof TargetConfiguration) => {
      const value: unknown = declared?.[field];
      return value !== undefined && !(Array.isArray(value) && value.includes(spread));
    };
    const fromEntry = (field: keyof TargetConfiguration) =>
      theirs(field) ? undefined : layered(entry.elements, field);
    const finding = (change: TargetDefaultChange, extra: Partial<TargetDefaultFinding> = {}) =>
      findings.push({
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
    const dependsOn = fromEntry("dependsOn");
    if (differs.dependsOn && replaces(dependsOn)) {
      finding("replaces-dependsOn");
    }
    if (differs.inputs && replaces(fromEntry("inputs"))) {
      finding("replaces-inputs");
    }
    if (differs.outputs && replaces(fromEntry("outputs"))) {
      finding("replaces-outputs");
    }
    if (differs.cache && fromEntry("cache") === true) {
      finding("turns-on-cache");
    }
    const reaching = added.filter(
      (dependency) =>
        includes(Array.isArray(dependsOn) ? dependsOn : undefined, dependency) &&
        reachesOtherProjects(
          nx.normaliseDependency(dependency, merged.name as string, dependencyGraph),
          merged.name as string,
        ),
    );
    if (reaching.length > 0) {
      finding("adds-dependencies", { added: reaching });
    }
  }
  return findings;
}

/** An inferred target that differs from what Nx made of it, waiting to learn why. */
interface Pending {
  project: CargoProject;
  merged: ProjectConfiguration;
  name: string;
  inferred: TargetConfiguration;
  target: TargetConfiguration;
  /** The `dependsOn` entries of the merged target that the plugin did not declare. */
  added: unknown[];
  differs: { cache: boolean; dependsOn: boolean; inputs: boolean; outputs: boolean };
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
  const findings = await findTargetDefaultChanges(
    graph,
    context,
    plugin,
    () => (internals ??= loadInternals()),
  );
  return describeTargetDefaultChanges(findings);
}

/**
 * Prints the warnings of {@link checkTargetDefaults} and fails with its
 * error, for `createDependencies`.
 *
 * @param plugin Nx's copy of the plugin for the entry, whose `name` Nx set
 *   to the name it knows the entry by.
 * @throws {Error} When an entry replaces what the plugin inferred or turns
 *   on caching, naming each entry, target and project and how to narrow it.
 */
export async function failOnTargetDefaults(
  graph: CargoGraph,
  context: TargetDefaultsContext,
  plugin: unknown,
): Promise<void> {
  const name = isRecord(plugin) && typeof plugin.name === "string" ? plugin.name : undefined;
  const report = await checkTargetDefaults(graph, context, name, () =>
    loadTargetDefaultsInternals(context.workspaceRoot),
  );
  for (const warning of report.warnings) {
    console.warn(warning);
  }
  if (report.error !== undefined) {
    throw new Error(report.error);
  }
}

/**
 * The parts of the Nx installed in the repository, which is the Nx that
 * creates the graph, that the check runs: from `nx/src/devkit-internals`,
 * `createTargetDefaultsResults`, `expandDependencyConfigSyntaxSugar` and
 * `normalizeDependencyConfigProjects` and `mergeTargetConfigurations`, and
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
  const expand = part<(entry: unknown, graph: DependencyGraph, project: string) => unknown>(
    devkit,
    internalsPath,
    "expandDependencyConfigSyntaxSugar",
  );
  const normalise = part<
    (entry: unknown, project: string, graph: DependencyGraph) => NormalisedDependency
  >(devkit, internalsPath, "normalizeDependencyConfigProjects");
  const mergeTargets = part<
    (target: TargetConfiguration, base: TargetConfiguration) => TargetConfiguration
  >(devkit, internalsPath, "mergeTargetConfigurations");
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
    async defaultLayer(files, nxJson, root) {
      const context = { nxJsonConfiguration: nxJson, workspaceRoot: root };
      const layer: Record<string, RootMapProject> = {};
      // In the order in which Nx runs its default plugins; the later wins.
      for (const [createNodes, given] of [
        [packageJson, files],
        [projectJson, files.filter((file) => file.endsWith("project.json"))],
      ] as const) {
        if (given.length === 0) {
          continue;
        }
        for (const [, result] of await createNodes(given, undefined, context)) {
          for (const [projectRoot, project] of Object.entries(result?.projects ?? {})) {
            layer[projectRoot] = mergeDeclared(layer[projectRoot], {
              ...project,
              root: projectRoot,
            });
          }
        }
      }
      return layer;
    },
    normaliseDependency(entry, project, graph) {
      return normalise(expand(structuredClone(entry), graph, project), project, graph);
    },
  };

  // `project` declared on top of `base`, target by target as Nx merges them.
  function mergeDeclared(
    base: RootMapProject | undefined,
    project: RootMapProject,
  ): RootMapProject {
    if (base === undefined) {
      return project;
    }
    const targets: Record<string, TargetConfiguration> = { ...base.targets };
    for (const [name, target] of Object.entries(project.targets ?? {})) {
      targets[name] = targets[name] === undefined ? target : mergeTargets(target, targets[name]);
    }
    return {
      root: project.root,
      name: project.name ?? base.name,
      tags: [...new Set([...(base.tags ?? []), ...(project.tags ?? [])])],
      targets,
    };
  }
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

// What the plugin's createNodes returned for `projects`, by root, as Nx
// holds the layer of the plugins listed in nx.json.
function specifiedLayer(projects: readonly CargoProject[]): Record<string, RootMapProject> {
  const layer: Record<string, RootMapProject> = {};
  for (const [, result] of projectNodes(projects)) {
    for (const [root, project] of Object.entries(result.projects ?? {})) {
      layer[root] = { ...project, root } as RootMapProject;
    }
  }
  return layer;
}

// Which plugin each inferred target comes from, as Nx's source maps say it
// for `filter.plugin`.
function sourceMaps(
  projects: readonly CargoProject[],
  plugin: string | undefined,
): Record<string, Record<string, [string | null, string]>> {
  return Object.fromEntries(
    projects.map((project) => [
      project.root,
      Object.fromEntries(
        Object.keys(project.targets).flatMap((name) => [
          [`targets.${name}`, [project.manifest, plugin ?? ""]],
          [`targets.${name}.executor`, [project.manifest, plugin ?? ""]],
        ]),
      ),
    ]),
  );
}

/** The elements of one `targetDefaults` key that Nx laid over one target. */
interface AppliedEntry {
  key: string;
  /** Their positions in the key's list, where its value is a list. */
  indices?: number[];
  /** What they set, in the order Nx merges them, the later winning. */
  elements: TargetConfiguration[];
}

// The results of Nx's synthesis, by root and target. Each result's file
// names the key and, for a list, the element: `nx.json#targetDefaults.<key>`
// or `nx.json#targetDefaults.<key>[<index>]`.
function appliedElements(
  results: ReturnType<TargetDefaultsInternals["createTargetDefaultsResults"]>,
  targetDefaults: Record<string, unknown>,
): Map<string, Map<string, AppliedEntry>> {
  const prefix = "nx.json#targetDefaults.";
  const applied = new Map<string, Map<string, AppliedEntry>>();
  for (const [, file, result] of results) {
    if (!file.startsWith(prefix)) {
      continue;
    }
    const location = file.slice(prefix.length);
    const indexed = /^(.*)\[(\d+)\]$/.exec(location);
    const [key, index] =
      indexed !== null && Array.isArray(targetDefaults[indexed[1]])
        ? [indexed[1], Number(indexed[2])]
        : [location, undefined];
    for (const [root, project] of Object.entries(result.projects ?? {})) {
      const byTarget = applied.get(root) ?? new Map<string, AppliedEntry>();
      applied.set(root, byTarget);
      for (const [name, target] of Object.entries(project.targets ?? {})) {
        const entry = byTarget.get(name) ?? { key, elements: [] };
        entry.elements.push(target);
        if (index !== undefined) {
          entry.indices = [...(entry.indices ?? []), index];
        }
        byTarget.set(name, entry);
      }
    }
  }
  return applied;
}

// What the elements set for `field` together, merged as Nx merges them: a
// later element wins, and a list with "..." keeps the earlier one in its place.
function layered(
  elements: readonly TargetConfiguration[],
  field: keyof TargetConfiguration,
): unknown {
  let value: unknown;
  for (const element of elements) {
    const next: unknown = element[field];
    if (next === undefined) {
      continue;
    }
    value =
      Array.isArray(next) && Array.isArray(value) && next.includes(spread)
        ? next.flatMap((item) => (item === spread ? (value as unknown[]) : [item]))
        : next;
  }
  return value;
}

/**
 * The user-facing report of {@link findTargetDefaultChanges}: one paragraph
 * per entry and severity, which says what the entry does to which targets
 * of which projects and how to narrow it.
 */
export function describeTargetDefaultChanges(
  findings: readonly TargetDefaultFinding[],
): TargetDefaultReport {
  const byEntry = groupBy(findings, (finding) =>
    JSON.stringify([finding.severity, finding.key, finding.elements ?? null]),
  );
  const paragraphs = (severity: TargetDefaultFinding["severity"]) =>
    [...byEntry.values()]
      .filter(([first]) => first.severity === severity)
      .sort(([a], [b]) => compare(a.key, b.key))
      .map(paragraph);
  const errors = paragraphs("error");
  return {
    warnings: paragraphs("warning"),
    ...(errors.length === 0 ? {} : { error: errors.join("\n\n") }),
  };
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

// Whether an entry's list replaces the inferred one: it is a list without "...".
function replaces(list: unknown): boolean {
  return Array.isArray(list) && !list.includes(spread);
}

// Whether a list the plugin inferred has an entry that the merged list lacks.
function lost(inferred: readonly unknown[] | undefined, merged: readonly unknown[] | undefined) {
  return (inferred ?? []).some((entry) => !includes(merged, entry));
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
