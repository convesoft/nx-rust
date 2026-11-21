import type { TargetWarning } from "./collisions";
import { type AppliedEntry, compare, isGlobPattern, isRecord } from "./target-defaults-layers";
import { listFields, type OtherLayerLoss } from "./target-defaults-meaning";

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

/** What `findTargetDefaultChanges` found. */
export interface TargetDefaultChanges {
  findings: TargetDefaultFinding[];
  unattributed: UnattributedChange[];
  /** Losses that another layer made, which fail graph creation. */
  otherLayers?: OtherLayerLoss[];
  /** The plugins that `nx.json` lists after this one, as it writes them. */
  laterPlugins?: string[];
}

/** What `checkTargetDefaults` found: warnings to print and an error to fail with. */
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

/** The section of the user guide that says how to narrow an entry. */
export const targetDefaultsGuide =
  "https://github.com/convesoft/nx-rust/blob/main/nx-rust/docs/targets.mara.md#target-defaults-that-reach-rust-targets";

/** The section of the user guide about what other plugins may do to Rust targets. */
export const otherPluginsGuide =
  "https://github.com/convesoft/nx-rust/blob/main/nx-rust/docs/targets.mara.md#other-plugins-that-reach-rust-targets";

/** An entry as messages name it, such as `the targetDefaults entry "build" in nx.json (its element 1)`. */
export function entryName({ key, indices }: AppliedEntry): string {
  return `the targetDefaults entry "${key}" in nx.json${elements(indices)}`;
}

/**
 * The user-facing report of `findTargetDefaultChanges`: one paragraph
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

// "a", "a and b", "a, b and c"
function list(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
