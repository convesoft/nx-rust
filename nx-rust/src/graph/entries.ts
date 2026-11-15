import type { NxJsonConfiguration, PluginConfiguration } from "@nx/devkit";
import { existsSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { ComputationReports } from "./computation-reports";
import {
  type CargoDiscovery,
  type CargoWorkspace,
  discoverReportedWorkspaces,
  type ReportedWorkspace,
} from "./discovery";
import { nxGraphInternals } from "./nx-internals";

const packageName = "@convesoft/nx-rust";

/** The pattern of the plugin's `createNodes`, with which Nx chooses the files it hands an entry. */
export const manifestPattern = "**/Cargo.toml";

/**
 * Where an entry of the plugin stands among the entries of the plugin in
 * `nx.json`, once {@link checkEntries} has found that no two of them receive
 * manifests of one Cargo workspace.
 */
export interface EntryView {
  /**
   * This entry's place in the `plugins` of `nx.json`; `undefined` where it
   * found no workspace, and so has no warnings and compares no workspaces.
   */
  readonly self: number | undefined;
  /** The entries of the plugin, by place, each with the manifests that Nx hands it. */
  readonly entries: readonly ReceivingEntry[];
}

/** An entry of the plugin in `nx.json` with the manifests that Nx hands it. */
interface ReceivingEntry {
  /** The entry's place in the `plugins` of `nx.json`. */
  index: number;
  /** The manifests, relative to the repository root. */
  manifests: ReadonlySet<string>;
}

/**
 * Fails where two or more entries of the plugin in `nx.json` receive
 * manifests of one Cargo workspace, its root manifest or a member's: each
 * workspace belongs to one entry (`DES-PLUGIN-OPTIONS`, "Several entries").
 *
 * Each entry learns of the others from the `plugins` of `nx.json`, which
 * the context of its `createNodes` holds, also under plugin isolation. It
 * works out the manifests that each entry receives with Nx's own steps for
 * choosing an entry's files: `globPluginFiles`, which globs a narrow
 * `include` natively and keeps the files that the `createNodes` pattern
 * matches, then `findMatchingConfigFiles` with the entry's `include` and
 * `exclude` (`EVD-NX-24-ENTRY-CONTEXT`). It compares them with the root
 * manifests and members of the workspaces that it discovered. An entry that
 * receives a manifest of a workspace discovers that workspace, so every
 * entry that takes part fails, with the same paragraph for the workspace,
 * whatever the order in which Nx runs them.
 *
 * It fails as well where it cannot tell which manifests the entries
 * receive: where Nx's steps fail for an entry, as for an `include` or
 * `exclude` that is no list of patterns, or where no entry gets exactly the
 * manifests that Nx handed this one, as where a manifest was added or
 * removed in between (`GOAL-TRUSTED-CACHE`).
 *
 * @param handed The manifests that Nx handed this entry, relative to the repository root.
 * @returns Where this entry stands among the entries of the plugin, for
 *   warnings that name crates of several entries ({@link warnsHere});
 *   `undefined` where it is the plugin's only entry.
 * @throws {Error} Naming each workspace and the entries that receive its
 *   manifests by their place, or what could not be determined.
 */
// @mara implements DES-PLUGIN-OPTIONS
export async function checkEntries(
  discovery: CargoDiscovery,
  handed: readonly string[],
  nxJson: NxJsonConfiguration | undefined,
): Promise<EntryView | undefined> {
  const { workspaceRoot } = discovery;
  const own = (nxJson?.plugins ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isOwnEntry(entry, workspaceRoot));
  if (own.length < 2) {
    return undefined;
  }
  const nx = nxGraphInternals(workspaceRoot);
  const entries: ReceivingEntry[] = [];
  for (const { entry, index } of own) {
    const include = typeof entry === "string" ? undefined : entry.include;
    const exclude = typeof entry === "string" ? undefined : entry.exclude;
    try {
      const files = await nx.pluginFiles(workspaceRoot, manifestPattern, include, exclude);
      entries.push({
        index,
        manifests: new Set(nx.findMatchingConfigFiles(files, include, exclude)),
      });
    } catch (error) {
      throw cannotTell(
        `it could not work out as Nx does which Cargo.toml files Nx hands plugins[${index}] (${reason(error)})`,
        'Give the "include" and "exclude" of each entry as lists of glob patterns, such as ["rust/**"]. If they are, run nx reset and try again, and if the error remains, please report it at https://github.com/convesoft/nx-rust/issues together with the Nx version and command.',
      );
    }
  }
  // This entry is one whose files, worked out as Nx works them out, are
  // exactly those that Nx handed it.
  const given = new Set(handed);
  const self = entries.find(
    (entry) =>
      entry.manifests.size === given.size &&
      [...given].every((manifest) => entry.manifests.has(manifest)),
  );
  if (self === undefined) {
    throw cannotTell(
      `working out the Cargo.toml files of each of them as Nx does gives none of them exactly the ${given.size} that Nx handed this entry${differenceExample(given, entries)}`,
      `Where a Cargo.toml was added or removed while Nx created the graph, run the command again; otherwise name the plugin in nx.json by its package name, ${packageName}, and if the error remains, please report it at https://github.com/convesoft/nx-rust/issues together with the Nx version and command.`,
    );
  }
  const problems: string[] = [];
  // By root folder, so that every entry words its error alike.
  const byRoot = [...discovery.workspaces].sort((a, b) =>
    a.root < b.root ? -1 : a.root > b.root ? 1 : 0,
  );
  for (const workspace of byRoot) {
    // A root manifest that defines a crate is a member's manifest as well.
    const members = new Set(workspace.report.workspace_members);
    const workspaceManifests = [
      ...new Set([
        workspace.rootManifest,
        ...workspace.report.packages
          .filter((pkg) => members.has(pkg.id))
          .map((pkg) => relative(workspaceRoot, pkg.manifest_path))
          .sort(),
      ]),
    ];
    const receiving = entries.flatMap(({ index, manifests: received }) => {
      const first = workspaceManifests.find((manifest) => received.has(manifest));
      return first === undefined
        ? []
        : [{ index, first, count: workspaceManifests.filter((m) => received.has(m)).length }];
    });
    if (receiving.length > 1) {
      problems.push(overlapMessage(workspace, receiving));
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join("\n\n"));
  }
  return { self: discovery.workspaces.length > 0 ? self.index : undefined, entries };
}

/**
 * The workspaces that the other entries of the plugin in `nx.json` receive,
 * each with its root folder and report, for the comparison of artifact
 * directories (`DES-OUTPUTS`, "Files of one name"). They are read from the
 * manifests that {@link checkEntries} works out for the other entries, none
 * of which is a manifest of this entry's workspaces, so every entry
 * compares the same workspaces, whatever the order in which Nx runs them.
 * An entry that found no workspace compares nothing, and with one entry
 * there are no others.
 *
 * The reports come from those of the graph computation, so that entries in
 * one process request each once. A workspace whose report fails is left
 * out: the entry that receives it fails graph creation with that error.
 */
// @mara implements DES-OUTPUTS
export async function otherEntriesWorkspaces(
  discovery: CargoDiscovery,
  view: EntryView | undefined,
  reports: ComputationReports | undefined,
): Promise<ReportedWorkspace[]> {
  if (view === undefined || view.self === undefined) {
    return [];
  }
  const { workspaceRoot } = discovery;
  const shared = reports ?? new ComputationReports();
  const others: ReportedWorkspace[] = [];
  const claimed = new Set<string>();
  const depth = (path: string) => path.split("/").length;
  const remaining = [
    ...new Set(
      view.entries
        .filter((entry) => entry.index !== view.self)
        .flatMap((entry) => [...entry.manifests]),
    ),
  ].sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));
  for (const manifest of remaining) {
    if (claimed.has(manifest)) {
      continue;
    }
    try {
      for (const found of await discoverReportedWorkspaces([manifest], workspaceRoot, shared)) {
        claimed.add(relative(workspaceRoot, join(found.report.workspace_root, "Cargo.toml")));
        for (const pkg of found.report.packages) {
          claimed.add(relative(workspaceRoot, pkg.manifest_path));
        }
        if (!others.some((other) => other.root === found.root)) {
          others.push(found);
        }
      }
    } catch {
      // The entry that receives the manifest reports the failure.
    }
  }
  return others;
}

/**
 * Whether this entry prints a warning that concerns the crates of
 * `manifests`, relative to the repository root, which can belong to the
 * workspaces of several entries of the plugin, as a warning about files of
 * one name does (`DES-DIAGNOSTICS`, "Warnings where they are seen"): it
 * does where it is the first of those entries by its place in `nx.json`, so
 * that each such warning is printed once. As the plugin's only entry, it
 * prints every warning.
 */
// @mara implements DES-DIAGNOSTICS
export function warnsHere(view: EntryView | undefined, manifests: readonly string[]): boolean {
  if (view === undefined) {
    return true;
  }
  const places = manifests
    .map((manifest) => view.entries.find((entry) => entry.manifests.has(manifest))?.index)
    .filter((place) => place !== undefined);
  return places.length === 0 || Math.min(...places) === view.self;
}

// The paragraph of the error of `checkEntries` for one workspace.
function overlapMessage(
  workspace: CargoWorkspace,
  receiving: readonly { index: number; first: string; count: number }[],
): string {
  const places = receiving.map(({ index }) => `plugins[${index}]`);
  const listed =
    places.length === 2
      ? `${places[0]} and ${places[1]}`
      : `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}`;
  const where = workspace.root === "." ? "the repository root" : `${workspace.root}/`;
  const what = receiving
    .map(
      ({ index, first, count }) =>
        `plugins[${index}] receives ${first}${count > 1 ? ` and ${count - 1} more of its manifests` : ""}`,
    )
    .join(", ");
  const exclude =
    workspace.root === "."
      ? `an "exclude" that leaves out its manifests, ${workspace.rootManifest} and those of its members`
      : `an "exclude" that leaves out the workspace, such as "${workspace.root}/**"`;
  return [
    `nx-rust: the entries ${listed} of ${packageName} in nx.json ${places.length === 2 ? "both" : "all"} receive manifests of the Cargo workspace in ${where} (${what}), so that each would create projects of that workspace with its own options, which Nx would merge.`,
    `A Cargo workspace belongs to one entry of the plugin. Give all but one of these entries ${exclude}, or narrow their "include", so that one entry receives all its manifests.`,
  ].join("\n");
}

// A manifest that tells the files that Nx handed this entry from those
// worked out for the entry that shares most of them, for the error of
// `checkEntries`.
function differenceExample(given: ReadonlySet<string>, entries: readonly ReceivingEntry[]): string {
  const shared = (entry: ReceivingEntry) =>
    [...given].filter((manifest) => entry.manifests.has(manifest)).length;
  const closest = [...entries].sort((a, b) => shared(b) - shared(a))[0];
  if (closest === undefined) {
    return "";
  }
  const missing = [...given].find((manifest) => !closest.manifests.has(manifest));
  if (missing !== undefined) {
    return `: it was handed ${missing}, which Nx would not hand plugins[${closest.index}]`;
  }
  const extra = [...closest.manifests].find((manifest) => !given.has(manifest));
  return extra === undefined
    ? ""
    : `: it was not handed ${extra}, which Nx would hand plugins[${closest.index}]`;
}

// The error for an overlap that `checkEntries` cannot rule out.
function cannotTell(because: string, remedy: string): Error {
  return new Error(
    [
      `nx-rust could not tell whether entries of ${packageName} in nx.json receive manifests of one Cargo workspace, which it refuses, because ${because}.`,
      remedy,
    ].join("\n"),
  );
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a `plugins` entry is this plugin: named by its package, or by a
 * path that resolves from the repository to this plugin's entry point, as
 * when a repository loads it from source.
 */
function isOwnEntry(entry: PluginConfiguration, workspaceRoot: string): boolean {
  const plugin = typeof entry === "string" ? entry : entry?.plugin;
  if (plugin === packageName) {
    return true;
  }
  if (typeof plugin !== "string") {
    return false;
  }
  try {
    return ownEntryPoints().has(realpathSync(require.resolve(plugin, { paths: [workspaceRoot] })));
  } catch {
    return false;
  }
}

let entryPoints: Set<string> | undefined;

// The plugin's entry point, `src/index.js` in the built package and
// `src/index.ts` in the source tree.
function ownEntryPoints(): Set<string> {
  entryPoints ??= new Set(
    ["index.js", "index.ts"]
      .map((file) => join(__dirname, "..", file))
      .filter((path) => existsSync(path))
      .map((path) => realpathSync(path)),
  );
  return entryPoints;
}
