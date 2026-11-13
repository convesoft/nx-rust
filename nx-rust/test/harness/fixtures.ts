import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { testEnvironment } from "./environment";

/**
 * The fixture repositories in `nx-rust/test/fixtures`, one per situation.
 * The README there describes each of them.
 */
export const fixtureNames = [
  "subfolder-workspace",
  "two-workspaces",
  "standalone-crate",
  "excluded-member",
  "cross-workspace-path",
  "vendored-crate",
  "name-collision",
  "dev-dependency-cycle",
  "different-toolchains",
] as const;

export type FixtureName = (typeof fixtureNames)[number];

/**
 * The toolchain that `different-toolchains/pinned/rust-toolchain.toml`
 * names. The tests never install it, and without it cargo fails in
 * `different-toolchains/pinned`.
 */
export const pinnedToolchain = "1.91.0";

/**
 * Whether checks of `different-toolchains` can run: rustup has
 * {@link pinnedToolchain}, or the tests run in CI, which installs it.
 */
export function pinnedToolchainAvailable(): boolean {
  if (process.env.CI) {
    return true;
  }
  const result = spawnSync("rustup", ["toolchain", "list"], {
    env: testEnvironment(),
    encoding: "utf8",
  });
  return (
    result.status === 0 &&
    result.stdout.split("\n").some((line) => line.startsWith(`${pinnedToolchain}-`))
  );
}

/** The folder that holds the fixture repositories. */
export const fixturesDirectory = join(__dirname, "..", "fixtures");

/** The name under which a fixture's `nx.json` registers the plugin. */
export const pluginPackageName = "@convesoft/nx-rust";

/** The folder of the plugin's package in this repository, with its `package.json` and `generators.json`. */
export const pluginPackageDirectory = join(__dirname, "..", "..");

/** The plugin's entry point in this repository, which Nx can load from source. */
export const pluginSourceEntry = join(__dirname, "..", "..", "src", "index.ts");

/**
 * A plugin that behaves as the plugin at {@link pluginSourceEntry} and also
 * records what each entry's `createDependencies` sees, in the file that the
 * environment variable `DISCOVERY_PROBE_LOG` names (`discovery-probe.ts`).
 */
export const discoveryProbeEntry = join(__dirname, "discovery-probe.ts");

/** What one entry's `createDependencies` saw, as {@link discoveryProbeEntry} records it. */
export interface ProbeRecord {
  /** The workspace roots, each with the folders of the members that get a project. */
  workspaces: [root: string, members: string[]][];
  /** The manifests of the reports for path dependencies without a project. */
  pathDependencies: string[];
}

/**
 * A change to one file: its new content, `null` to delete it, or a function
 * from the current content (`undefined` if the file does not exist) to either.
 */
export type FileChange = string | null | ((current: string | undefined) => string | null);

/** Changes to files, by path relative to the repository root, with `/` separators. */
export type FileChanges = Record<string, FileChange>;

export interface CopyFixtureOptions {
  /**
   * How `nx.json` names the plugin: {@link pluginPackageName} where the
   * plugin is installed, or the path of its source entry.
   */
  plugin: string;
  /** Changes applied in order after the fixture is copied. */
  files?: (FileChanges | undefined)[];
}

/**
 * Copies a fixture repository into `destination` and registers the plugin in
 * its `nx.json`. A fixture without `nx.json` gets one that registers the
 * plugin with default options; in one that has it, every entry for
 * {@link pluginPackageName} is pointed at `options.plugin`. Build output
 * (`target` folders) left in the fixture folder is not copied.
 */
export function copyFixture(
  fixture: FixtureName,
  destination: string,
  options: CopyFixtureOptions,
): void {
  const source = join(fixturesDirectory, fixture);
  if (!existsSync(source)) {
    throw new Error(`There is no fixture "${fixture}" in ${fixturesDirectory}`);
  }
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => basename(path) !== "target",
  });
  registerPlugin(destination, options.plugin);
  for (const changes of options.files ?? []) {
    applyFileChanges(destination, changes ?? {});
  }
}

/**
 * Replaces the content of an end-to-end test project with a fixture,
 * keeping the installed packages, and registers the installed plugin.
 * A fixture must therefore not contain any of the kept files.
 */
export function installFixture(
  projectDirectory: string,
  fixture: FixtureName,
  files?: FileChanges,
): void {
  const kept = new Set(["node_modules", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);
  for (const entry of readdirSync(projectDirectory)) {
    if (!kept.has(entry)) {
      rmSync(join(projectDirectory, entry), { recursive: true, force: true });
    }
  }
  copyFixture(fixture, projectDirectory, { plugin: pluginPackageName, files: [files] });
}

/** Writes, rewrites or deletes files below `root`. */
export function applyFileChanges(root: string, changes: FileChanges): void {
  for (const [path, change] of Object.entries(changes)) {
    const file = join(root, ...path.split("/"));
    const content =
      typeof change === "function"
        ? change(existsSync(file) ? readFileSync(file, "utf8") : undefined)
        : change;
    if (content === null) {
      rmSync(file, { recursive: true, force: true });
    } else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }
}

function registerPlugin(root: string, plugin: string): void {
  const file = join(root, "nx.json");
  const nxJson = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { plugins: [pluginPackageName] };
  nxJson.plugins = (nxJson.plugins ?? []).map((entry: string | { plugin: string }) => {
    if (entry === pluginPackageName) {
      return plugin;
    }
    if (typeof entry === "object" && entry.plugin === pluginPackageName) {
      return { ...entry, plugin };
    }
    return entry;
  });
  writeFileSync(file, `${JSON.stringify(nxJson, null, 2)}\n`);
}
