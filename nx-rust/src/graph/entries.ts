import type { NxJsonConfiguration, PluginConfiguration } from "@nx/devkit";
import { existsSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import type { CargoDiscovery } from "./discovery";
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
