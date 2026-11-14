import type { NxJsonConfiguration, PluginConfiguration } from "@nx/devkit";
import { existsSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { ComputationReports } from "./computation-reports";
import {
  type CargoDiscovery,
  discoverReportedWorkspaces,
  type ReportedWorkspace,
} from "./discovery";
import { nxGraphInternals } from "./nx-internals";
import { GraphSettings, WorkspaceWideSetting, workspaceWideSettings } from "./settings";

const packageName = "@convesoft/nx-rust";

/** What an entry gives a workspace-wide setting: a valid value, or nothing. */
interface Given {
  /** The entry's place in the `plugins` of `nx.json`. */
  index: number;
  /** Whether the entry is a plain string, which has no options. */
  plain: boolean;
  /** The value of its options; `undefined` where it does not set one. */
  value: string | boolean | undefined;
}

/**
 * Fails when entries of the plugin in `nx.json` that receive manifests of
 * one workspace give different values of `testRunner`, `affectedTests` or
 * `featureUnification`, which hold for a whole workspace, and the
 * workspace's own table does not set it. An entry without the option counts
 * as giving the default.
 *
 * Each entry learns of the others from the `plugins` of `nx.json`, which
 * the context of its `createNodes` holds, also under plugin isolation. It
 * finds the manifests another entry receives by applying that entry's
 * `include` and `exclude` to the `Cargo.toml` files of Nx's workspace
 * context, as Nx does (`EVD-NX-24-ENTRY-CONTEXT`). Every entry checks the
 * workspaces it found, so between them they check every workspace.
 *
 * The default of `featureUnification` depends on whether the workspace has a
 * cargo-hakari configuration, which the plugin does not detect yet
 * (nxr-k64tm5). Until then an entry without that option disagrees only
 * with one that sets `cargo`, which is never the default.
 *
 * An entry whose value is invalid fails with its own error and is left out.
 *
 * @throws {Error} Naming each workspace, setting and the entries by their place.
 */
// @mara implements DES-PLUGIN-OPTIONS
export async function checkEntries(
  discovery: CargoDiscovery,
  settings: GraphSettings,
  nxJson: NxJsonConfiguration | undefined,
): Promise<void> {
  const { workspaceRoot } = discovery;
  const entries = (nxJson?.plugins ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isOwnEntry(entry, workspaceRoot));
  if (entries.length < 2) {
    return;
  }
  const nx = nxGraphInternals(workspaceRoot);
  const manifests = await nx.globWithWorkspaceContext(workspaceRoot, ["**/Cargo.toml"]);
  const received = entries.map(({ entry, index }) => ({
    index,
    entry,
    manifests: new Set(
      typeof entry === "string"
        ? manifests
        : nx.findMatchingConfigFiles(manifests, entry.include, entry.exclude),
    ),
  }));
  const problems: string[] = [];
  for (const workspace of discovery.workspaces) {
    const own = [
      workspace.rootManifest,
      ...workspace.report.packages.map((pkg) => relative(workspaceRoot, pkg.manifest_path)),
    ];
    const sharing = received.filter((entry) =>
      own.some((manifest) => entry.manifests.has(manifest)),
    );
    if (sharing.length < 2) {
      continue;
    }
    const { setInTable } = settings.workspace(workspace);
    for (const setting of workspaceWideSettings) {
      if (setInTable.includes(setting)) {
        continue;
      }
      const given = sharing
        .map(({ entry, index }) => givenBy(entry, index, setting))
        .filter((value) => value !== undefined);
      if (disagree(setting, given)) {
        problems.push(message(workspace.root, workspace.rootManifest, setting, given));
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join("\n\n"));
  }
}

/**
 * The root folders of the workspaces whose root manifest Nx hands to no
 * entry of the plugin in `nx.json`, because the entries' `include` and
 * `exclude`, `.gitignore` or `.nxignore` keep it out. No project of the
 * plugin lies at such a workspace's root folder, so the workspace has no
 * lockfile task (`DES-LOCKFILE-HASHING`). With one entry, that is this
 * entry's own view; with several, each entry's `include` and `exclude` is
 * applied to the `Cargo.toml` files of Nx's workspace context, as Nx does
 * ({@link checkEntries}).
 */
// @mara implements DES-LOCKFILE-HASHING
export async function workspacesWithoutRootProject(
  discovery: CargoDiscovery,
  nxJson: NxJsonConfiguration | undefined,
): Promise<Set<string>> {
  const unhanded = discovery.workspaces.filter((workspace) => !workspace.rootManifestHanded);
  if (unhanded.length === 0) {
    return new Set();
  }
  const { workspaceRoot } = discovery;
  const entries = (nxJson?.plugins ?? []).filter((entry) => isOwnEntry(entry, workspaceRoot));
  if (entries.length < 2) {
    return new Set(unhanded.map((workspace) => workspace.root));
  }
  const nx = nxGraphInternals(workspaceRoot);
  const manifests = await nx.globWithWorkspaceContext(workspaceRoot, ["**/Cargo.toml"]);
  const received = new Set(
    entries.flatMap((entry) =>
      typeof entry === "string"
        ? manifests
        : nx.findMatchingConfigFiles(manifests, entry.include, entry.exclude),
    ),
  );
  return new Set(
    unhanded
      .filter((workspace) => !received.has(workspace.rootManifest))
      .map((workspace) => workspace.root),
  );
}

/**
 * The workspaces that the other entries of the plugin in `nx.json` receive
 * and this entry does not, each with its root folder and report, for the
 * comparison of artifact directories (`DES-OUTPUTS`, "Files of one name").
 * An entry does not know its own place among the entries, so it reads the
 * manifests that every entry receives, applying each entry's `include` and
 * `exclude` to the `Cargo.toml` files of Nx's workspace context as Nx does
 * ({@link checkEntries}), and leaves out those that its own workspaces
 * claim. Every entry thereby compares the same workspaces, whatever the
 * order in which Nx runs them. With one entry there are no others, and
 * nothing is read.
 *
 * The reports come from those of the graph computation, so that entries in
 * one process request each once. A workspace whose report fails is left
 * out: the entry that receives it fails graph creation with that error.
 */
// @mara implements DES-OUTPUTS
export async function otherEntriesWorkspaces(
  discovery: CargoDiscovery,
  nxJson: NxJsonConfiguration | undefined,
  reports: ComputationReports | undefined,
): Promise<ReportedWorkspace[]> {
  const { workspaceRoot } = discovery;
  const entries = (nxJson?.plugins ?? []).filter((entry) => isOwnEntry(entry, workspaceRoot));
  if (entries.length < 2) {
    return [];
  }
  const nx = nxGraphInternals(workspaceRoot);
  const manifests = await nx.globWithWorkspaceContext(workspaceRoot, ["**/Cargo.toml"]);
  const received = new Set(
    entries.flatMap((entry) =>
      typeof entry === "string"
        ? manifests
        : nx.findMatchingConfigFiles(manifests, entry.include, entry.exclude),
    ),
  );
  const own = new Set(
    discovery.workspaces.flatMap((workspace) => [
      workspace.rootManifest,
      ...workspace.report.packages.map((pkg) => relative(workspaceRoot, pkg.manifest_path)),
    ]),
  );
  const ownRoots = new Set(discovery.workspaces.map((workspace) => workspace.root));
  const shared = reports ?? new ComputationReports();
  const others: ReportedWorkspace[] = [];
  const claimed = new Set<string>();
  const depth = (path: string) => path.split("/").length;
  const remaining = [...received]
    .filter((manifest) => !own.has(manifest))
    .sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));
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
        if (!ownRoots.has(found.root) && !others.some((other) => other.root === found.root)) {
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
 * Which entry of the plugin in `nx.json` is the first, by its place, to
 * receive each manifest, and which entry this one is: for warnings that
 * several entries find about one project, so that one entry prints each and
 * one attaches them to the project (`DES-DIAGNOSTICS`, "Warnings where they
 * are seen"). Nx merges the projects that several entries create for one
 * folder and joins the lists in their metadata, so a list that every such
 * entry attached would hold each warning once per entry.
 */
export interface EntryView {
  /** This entry's place among the entries of `nx.json`; `undefined` where it cannot tell. */
  readonly self: number | undefined;
  /**
   * The place of the first entry of the plugin that receives `manifest`,
   * relative to the repository root; `undefined` where none does or this
   * entry cannot tell.
   */
  firstReceiver(manifest: string): number | undefined;
}

/** The view of an entry that is the plugin's only one, or that cannot tell its place. */
const soleEntry: EntryView = { self: undefined, firstReceiver: () => undefined };

/**
 * The {@link EntryView} of the entry that receives `handed` with `options`.
 * An entry does not know its own place, so it takes the first entry of the
 * plugin whose options are the same and that receives the same manifests,
 * applying each entry's `include` and `exclude` to the `Cargo.toml` files of
 * Nx's workspace context as Nx does ({@link checkEntries}). Two entries that
 * agree in both create the same projects and each take the first place; the
 * view then cannot tell them apart.
 *
 * @param handed The manifests that Nx hands this entry, relative to the repository root.
 * @param options The options that Nx hands this entry.
 */
// @mara implements DES-DIAGNOSTICS
export async function entryView(
  workspaceRoot: string,
  nxJson: NxJsonConfiguration | undefined,
  handed: readonly string[],
  options: unknown,
): Promise<EntryView> {
  const entries = (nxJson?.plugins ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isOwnEntry(entry, workspaceRoot));
  if (entries.length < 2) {
    return soleEntry;
  }
  const nx = nxGraphInternals(workspaceRoot);
  const manifests = await nx.globWithWorkspaceContext(workspaceRoot, ["**/Cargo.toml"]);
  const received = entries.map(({ entry, index }) => ({
    index,
    options: typeof entry === "string" ? undefined : entry.options,
    manifests: new Set(
      typeof entry === "string"
        ? manifests
        : nx.findMatchingConfigFiles(manifests, entry.include, entry.exclude),
    ),
  }));
  const own = new Set(handed);
  const self = received.find(
    (entry) =>
      stableJson(entry.options ?? {}) === stableJson(options ?? {}) &&
      entry.manifests.size === own.size &&
      [...own].every((manifest) => entry.manifests.has(manifest)),
  );
  if (self === undefined) {
    return soleEntry;
  }
  return {
    self: self.index,
    firstReceiver: (manifest) => received.find((entry) => entry.manifests.has(manifest))?.index,
  };
}

/**
 * Whether this entry prints, or attaches to its projects, a warning that
 * concerns the projects of `manifests`: where it is the first entry of the
 * plugin, by its place in `nx.json`, that receives any of them, or where it
 * cannot tell, as the plugin's only entry ({@link EntryView}).
 */
export function warnsHere(view: EntryView, manifests: readonly string[]): boolean {
  if (view.self === undefined) {
    return true;
  }
  const places = manifests
    .map((manifest) => view.firstReceiver(manifest))
    .filter((place) => place !== undefined);
  return places.length === 0 || Math.min(...places) === view.self;
}

// JSON with the keys of every object sorted, so that options compare by value.
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

const defaults: Record<WorkspaceWideSetting, string | boolean | undefined> = {
  testRunner: "cargo",
  affectedTests: false,
  // Depends on the workspace (DES-UNIFICATION, nxr-k64tm5).
  featureUnification: undefined,
};

const validValues: Record<WorkspaceWideSetting, readonly (string | boolean)[]> = {
  testRunner: ["cargo", "nextest"],
  affectedTests: [true, false],
  featureUnification: ["hakari", "cargo", "workspace-build"],
};

// What one entry gives a setting, or `undefined` for an invalid value, which
// that entry reports itself.
function givenBy(
  entry: PluginConfiguration,
  index: number,
  setting: WorkspaceWideSetting,
): Given | undefined {
  if (typeof entry === "string") {
    return { index, plain: true, value: undefined };
  }
  const options = entry.options as Record<string, unknown> | undefined;
  const value = typeof options === "object" && options !== null ? options[setting] : undefined;
  if (value !== undefined && !validValues[setting].includes(value as string | boolean)) {
    return undefined;
  }
  return { index, plain: false, value: value as string | boolean | undefined };
}

function disagree(setting: WorkspaceWideSetting, given: readonly Given[]): boolean {
  const effective = new Set(given.map(({ value }) => value ?? defaults[setting]));
  if (setting !== "featureUnification") {
    return effective.size > 1;
  }
  const explicit = new Set(given.flatMap(({ value }) => (value === undefined ? [] : [value])));
  const someDefault = given.some(({ value }) => value === undefined);
  return explicit.size > 1 || (someDefault && explicit.has("cargo"));
}

function message(
  root: string,
  rootManifest: string,
  setting: WorkspaceWideSetting,
  given: readonly Given[],
): string {
  const describe = ({ index, plain, value }: Given) => {
    const entry = `plugins[${index}]`;
    if (value !== undefined) {
      return `${entry} sets ${JSON.stringify(value)}`;
    }
    const without = plain ? "names the plugin without options" : "does not set it";
    const fallback = defaults[setting];
    return fallback === undefined
      ? `${entry} ${without}, which gives the default strategy, never "cargo"`
      : `${entry} ${without}, which gives the default ${JSON.stringify(fallback)}`;
  };
  return [
    `nx-rust: the entries ${given.map(({ index }) => `plugins[${index}]`).join(", ")} of @convesoft/nx-rust in nx.json receive manifests of the Cargo workspace in ${root === "." ? "the repository root" : `${root}/`}, but give it different values of "${setting}": ${given.map(describe).join("; ")}.`,
    `"${setting}" holds for a whole workspace. Give these entries the same value, or set ${setting} under [workspace.metadata.nx] in ${rootManifest}, which wins over the plugin options.`,
  ].join("\n");
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
