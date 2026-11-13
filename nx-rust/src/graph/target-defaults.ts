import type {
  CreateDependenciesContext,
  ProjectConfiguration,
  TargetConfiguration,
} from "@nx/devkit";
import type { CargoGraph } from "./projects";

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
  /** The elements of the key's list that apply to the target, where its value is a list. */
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

/**
 * Nx's resolver for the target defaults that apply to a target,
 * `readTargetDefaultsForTarget` (`EVD-NX-TARGET-DEFAULTS`).
 */
export type ReadTargetDefaults = (
  targetName: string,
  targetDefaults: Record<string, unknown>,
  executor: string | undefined,
  context: {
    projectName: string;
    projectNode: { data: { root: string; tags: string[] } };
    sourcePlugin: string | undefined;
    command: string | undefined;
  },
) => Partial<TargetConfiguration> | null;

/** The section of the user guide that says how to narrow an entry. */
export const targetDefaultsGuide =
  "https://github.com/convesoft/nx-rust/blob/main/nx-rust/docs/targets.mara.md#target-defaults-that-reach-rust-targets";

const spread = "...";

/**
 * Checks what the `targetDefaults` of `nx.json` did to the inferred targets
 * of one plugin entry's projects (`DES-TARGET-DEFAULT-GUARD`).
 *
 * Each inferred target is compared with the target that Nx made of it, as
 * `createDependencies` receives it: dependencies on other projects' tasks
 * that were added, inferred `dependsOn`, `inputs` or `outputs` entries that
 * are missing, and caching that is on where the plugin left it off. A
 * target whose executor is no longer the inferred one was replaced by
 * another file and is left alone. Only where something differs does the
 * check ask Nx's resolver which entry applies to the target, and it reports
 * a difference only when that entry sets the field in question, so a
 * difference that a `project.json` or `package.json` made is not reported.
 *
 * @param projects The merged projects, as Nx hands them to `createDependencies`.
 * @param plugin The name under which Nx knows this plugin entry, which
 *   `filter.plugin` of an entry compares with.
 * @param resolver Nx's resolver, loaded only when it is needed.
 * @throws {Error} When the resolver is needed and the installed Nx lacks it.
 */
// @mara implements DES-TARGET-DEFAULT-GUARD
export function findTargetDefaultChanges(
  graph: CargoGraph,
  projects: Iterable<ProjectConfiguration>,
  targetDefaults: unknown,
  plugin: string | undefined,
  resolver: () => ReadTargetDefaults,
): TargetDefaultFinding[] {
  if (!isRecord(targetDefaults) || Object.keys(targetDefaults).length === 0) {
    return [];
  }
  const byRoot = new Map<string, ProjectConfiguration>();
  const names = new Set<string>();
  for (const project of projects) {
    byRoot.set(project.root, project);
    if (project.name !== undefined) {
      names.add(project.name);
    }
  }
  const findings: TargetDefaultFinding[] = [];
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
        (entry) =>
          !includes(inferred.dependsOn, entry) && reachesOtherProjects(entry, merged.name, names),
      );
      const candidates = {
        // The plugin's `cache` comes from `cachedTargets`, the set that the
        // executor's check reads, and is off as well where `DES-OUTPUTS`
        // leaves a target of that set uncached.
        cache: inferred.cache !== true && target.cache === true,
        dependsOn: lost(inferred.dependsOn, target.dependsOn),
        inputs: lost(inferred.inputs, target.inputs),
        outputs: lost(inferred.outputs, target.outputs),
        added: added.length > 0,
      };
      if (!Object.values(candidates).some(Boolean)) {
        continue;
      }
      const entry = applyingEntry(resolver(), targetDefaults, name, target, merged, plugin);
      if (entry === undefined) {
        continue;
      }
      const { config } = entry;
      const finding = (change: TargetDefaultChange, extra: Partial<TargetDefaultFinding> = {}) =>
        findings.push({
          change,
          severity: change === "adds-dependencies" ? "warning" : "error",
          key: entry.key,
          ...(entry.elements === undefined ? {} : { elements: entry.elements }),
          target: name,
          executor: target.executor as string,
          project: merged.name as string,
          manifest: project.manifest,
          ...extra,
        });
      if (candidates.dependsOn && replaces(config.dependsOn)) {
        finding("replaces-dependsOn");
      }
      if (candidates.inputs && replaces(config.inputs)) {
        finding("replaces-inputs");
      }
      if (candidates.outputs && replaces(config.outputs)) {
        finding("replaces-outputs");
      }
      if (candidates.cache && config.cache === true) {
        finding("turns-on-cache");
      }
      const fromEntry = added.filter((dependency) => includes(config.dependsOn, dependency));
      if (fromEntry.length > 0) {
        finding("adds-dependencies", { added: fromEntry });
      }
    }
  }
  return findings;
}

/**
 * {@link findTargetDefaultChanges}, worded for the user.
 *
 * @param nxJson `nx.json` as graph creation reads it.
 * @param loadResolver Loads Nx's resolver, at most once and only when it is needed.
 * @throws Whatever `loadResolver` throws.
 */
export function checkTargetDefaults(
  graph: CargoGraph,
  projects: Iterable<ProjectConfiguration>,
  nxJson: { targetDefaults?: unknown } | undefined,
  plugin: string | undefined,
  loadResolver: () => ReadTargetDefaults,
): TargetDefaultReport {
  let resolver: ReadTargetDefaults | undefined;
  const findings = findTargetDefaultChanges(
    graph,
    projects,
    nxJson?.targetDefaults,
    plugin,
    () => (resolver ??= loadResolver()),
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
export function failOnTargetDefaults(
  graph: CargoGraph,
  context: Pick<CreateDependenciesContext, "projects" | "nxJsonConfiguration" | "workspaceRoot">,
  plugin: unknown,
): void {
  const name = isRecord(plugin) && typeof plugin.name === "string" ? plugin.name : undefined;
  const report = checkTargetDefaults(
    graph,
    Object.values(context.projects),
    context.nxJsonConfiguration,
    name,
    () => loadTargetDefaultsResolver(context.workspaceRoot),
  );
  for (const warning of report.warnings) {
    console.warn(warning);
  }
  if (report.error !== undefined) {
    throw new Error(report.error);
  }
}

/**
 * Nx's `readTargetDefaultsForTarget` from the Nx installed in the
 * repository, which is the Nx that creates the graph.
 *
 * @param load Loads a module by its resolved path; replaced in tests.
 * @throws {Error} When that Nx does not have it, naming the Nx version.
 */
export function loadTargetDefaultsResolver(
  workspaceRoot: string,
  load: (path: string) => unknown = require,
): ReadTargetDefaults {
  let internals: unknown;
  let problem: string | undefined;
  try {
    internals = load(require.resolve("nx/src/devkit-internals", { paths: [workspaceRoot] }));
  } catch (error) {
    problem = `nx/src/devkit-internals could not be loaded (${error instanceof Error ? error.message : String(error)})`;
  }
  const read = isRecord(internals) ? internals.readTargetDefaultsForTarget : undefined;
  if (typeof read === "function") {
    return read as ReadTargetDefaults;
  }
  const nx = nxVersion(workspaceRoot, load);
  throw new Error(
    [
      `nx-rust cannot check what the targetDefaults in nx.json do to Rust targets with ${nx === undefined ? "the installed Nx" : `the installed Nx ${nx}`}: ${problem ?? "readTargetDefaultsForTarget from nx/src/devkit-internals is not a function"}.`,
      "nx-rust uses that part of Nx, which is not public API, to find the entry that applies to a target. This version of @convesoft/nx-rust supports Nx 24.",
      "Use a supported Nx version, or a version of @convesoft/nx-rust that supports the installed one.",
    ].join("\n"),
  );
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

/**
 * The entry that Nx applies to `target`: the first key in Nx's order with an
 * element whose filter matches, the elements of its list that match and
 * that Nx does not drop for naming another executor, and what they merge to. Each key is asked about alone, so that Nx's own
 * resolver decides whether it applies; Nx tries the key that names the
 * target's executor first, then the target's name, then glob keys, longest
 * first (`EVD-NX-TARGET-DEFAULTS`).
 */
function applyingEntry(
  read: ReadTargetDefaults,
  targetDefaults: Record<string, unknown>,
  targetName: string,
  target: TargetConfiguration,
  project: ProjectConfiguration,
  plugin: string | undefined,
): { key: string; elements?: number[]; config: Partial<TargetConfiguration> } | undefined {
  const context = {
    projectName: project.name as string,
    projectNode: { data: { root: project.root, tags: project.tags ?? [] } },
    sourcePlugin: plugin,
    command: target.command,
  };
  const probe = (key: string, value: unknown) =>
    read(targetName, { [key]: value }, target.executor, context);
  const rank = (key: string) => (key === target.executor ? 0 : key === targetName ? 1 : 2);
  const [key] = Object.keys(targetDefaults)
    .filter((candidate) => probe(candidate, targetDefaults[candidate]) !== null)
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.length - a.length : 0));
  if (key === undefined) {
    return undefined;
  }
  const value = targetDefaults[key];
  const elements: unknown[] = Array.isArray(value) ? value : [value];
  const applying = elements.flatMap((element, index) =>
    probe(key, [element]) !== null && compatible(element, target) ? [index] : [],
  );
  if (applying.length === 0) {
    return undefined;
  }
  const config =
    probe(
      key,
      applying.map((index) => elements[index]),
    ) ?? {};
  return Array.isArray(value) ? { key, elements: applying, config } : { key, config };
}

// Whether Nx lays an element of a key over `target`: Nx drops an element that
// names another executor, or a `command`, which stands for `nx:run-commands`,
// for a target of an executor other than that (`EVD-NX-TARGET-DEFAULTS`).
function compatible(element: unknown, target: TargetConfiguration): boolean {
  return (
    !isRecord(element) ||
    (!element.command && (!element.executor || element.executor === target.executor))
  );
}

// Whether an entry's list replaces the inferred one: it is a list without "...".
function replaces(list: unknown): boolean {
  return Array.isArray(list) && !list.includes(spread);
}

// Whether a list the plugin inferred has an entry that the merged list lacks.
function lost(inferred: readonly unknown[] | undefined, merged: readonly unknown[] | undefined) {
  return (inferred ?? []).some((entry) => !includes(merged, entry));
}

// Whether a `dependsOn` entry names tasks of projects other than `project`:
// "^target", "<project>:target" for another project, or an object with
// `dependencies: true` or with `projects`.
function reachesOtherProjects(entry: unknown, project: string, names: ReadonlySet<string>) {
  if (typeof entry === "string") {
    if (entry.startsWith("^")) {
      return true;
    }
    const separator = entry.indexOf(":");
    const named = separator > 0 ? entry.slice(0, separator) : undefined;
    return named !== undefined && named !== project && names.has(named);
  }
  if (!isRecord(entry)) {
    return false;
  }
  if (entry.dependencies === true) {
    return true;
  }
  const projects = typeof entry.projects === "string" ? [entry.projects] : entry.projects;
  return Array.isArray(projects) && projects.some((named) => named !== project);
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
