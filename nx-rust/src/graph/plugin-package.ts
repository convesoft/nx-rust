import type { NxJsonConfiguration } from "@nx/devkit";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PluginInput } from "./inputs";
import { filesNxSees } from "./visibility";

/** The plugin's npm package name. */
export const pluginPackageName = "@convesoft/nx-rust";

// The folder of this package: `src/graph` is two levels below it, in the
// source and in the published package alike.
const packageFolder = join(__dirname, "..", "..");

/** The version in the plugin's own `package.json`. */
export function pluginVersion(): string {
  return JSON.parse(readFileSync(join(packageFolder, "package.json"), "utf8")).version;
}

/**
 * How the plugin's version reaches each task's key (`DES-INPUTS`, "Plugin").
 *
 * Through `externalDependencies` naming the plugin's package wherever the
 * plugin can establish that Nx has an npm node for it: Nx analyses the JS
 * lockfile, and that lockfile lists the package with a version from a
 * registry. Naming a package without a node would fail the hash of every
 * Rust task (`EVD-NX-24-PLUGIN-VERSION`), so in any other case, and also
 * when the plugin runs from another folder than the installed package, as
 * when `nx.json` names it by path, the plugin's version goes into the target
 * option `pluginVersion` instead.
 *
 * The lockfile counts as analysed as Nx's JS plugin decides it in Nx 24: the
 * `analyzeLockfile` of `pluginsConfig["@nx/js"]` in `nx.json`, which by
 * default is on wherever the repository root has a `package.json`; the
 * lockfile of the package manager that `nx.json` names or whose lockfile is
 * in the repository root, looked for in the order bun, yarn, pnpm, npm; and
 * only where Nx sees that file. The plugin establishes a listing in
 * `pnpm-lock.yaml`, `package-lock.json` and `yarn.lock`, not in bun's
 * lockfiles.
 */
// @mara implements DES-INPUTS
export async function pluginInput(
  workspaceRoot: string,
  nxJson: NxJsonConfiguration | undefined,
): Promise<PluginInput> {
  const option: PluginInput = { kind: "option", version: pluginVersion() };
  if (!runsFromInstalledPackage(workspaceRoot) || !analysesLockfile(workspaceRoot, nxJson)) {
    return option;
  }
  const lockfile = lockfileName(workspaceRoot, nxJson);
  if (lockfile === undefined || !existsSync(join(workspaceRoot, lockfile))) {
    return option;
  }
  if (!(await filesNxSees(workspaceRoot, [lockfile])).has(lockfile)) {
    return option;
  }
  const contents = readFileSync(join(workspaceRoot, lockfile), "utf8");
  return listsPackage(lockfile, contents, pluginPackageName)
    ? { kind: "node", packageName: pluginPackageName }
    : option;
}

/**
 * Whether a JS lockfile lists `name` as an npm package with a version from a
 * registry, for which Nx creates a node of that name: not as a workspace
 * package, a link or a local file.
 *
 * @param lockfile The lockfile's name: `pnpm-lock.yaml`, `package-lock.json` or `yarn.lock`.
 */
export function listsPackage(lockfile: string, contents: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  switch (lockfile) {
    case "pnpm-lock.yaml":
      // `'@scope/name@1.0.0':` (v9), `/@scope/name@1.0.0:` (v6), `/@scope/name/1.0.0:` (v5).
      return new RegExp(`^\\s+['"]?/?${escaped}[@/]\\d`, "m").test(contents);
    case "package-lock.json": {
      try {
        const entry = JSON.parse(contents)?.packages?.[`node_modules/${name}`];
        return typeof entry?.version === "string" && entry.link !== true;
      } catch {
        return false;
      }
    }
    case "yarn.lock":
      // `"@scope/name@^1.0.0":` (classic), `"@scope/name@npm:1.0.0":` (berry).
      return new RegExp(`^"?${escaped}@(npm:)?[\\^~>=<]*\\d`, "m").test(contents);
    default:
      return false;
  }
}

// Whether this module belongs to the package that the repository installs
// under the plugin's name. The installed package's `src` is the folder that
// this module's `src` resolves to; a plugin that `nx.json` names by path has
// another.
function runsFromInstalledPackage(workspaceRoot: string): boolean {
  try {
    const installed = dirname(
      require.resolve(`${pluginPackageName}/package.json`, { paths: [workspaceRoot] }),
    );
    return realpathSync(join(installed, "src")) === realpathSync(join(packageFolder, "src"));
  } catch {
    return false;
  }
}

// Nx's `analyzeLockfile`, as `jsPluginConfig` in Nx 24 derives it, for a
// repository with an `nx.json`.
function analysesLockfile(workspaceRoot: string, nxJson: NxJsonConfiguration | undefined): boolean {
  const config = (
    nxJson?.pluginsConfig as Record<string, { analyzeLockfile?: boolean }> | undefined
  )?.["@nx/js"];
  if (config !== undefined) {
    return config.analyzeLockfile ?? true;
  }
  return existsSync(join(workspaceRoot, "package.json"));
}

// The lockfile that Nx's JS plugin reads, as `detectPackageManager` and
// `getLockFileName` in Nx 24 choose it.
function lockfileName(
  workspaceRoot: string,
  nxJson: NxJsonConfiguration | undefined,
): string | undefined {
  const byManager: Record<string, string> = {
    yarn: "yarn.lock",
    pnpm: "pnpm-lock.yaml",
    npm: "package-lock.json",
  };
  const named = nxJson?.cli?.packageManager;
  if (named !== undefined) {
    return byManager[named];
  }
  if (["bun.lockb", "bun.lock"].some((file) => existsSync(join(workspaceRoot, file)))) {
    return undefined;
  }
  return ["yarn.lock", "pnpm-lock.yaml", "package-lock.json"].find((file) =>
    existsSync(join(workspaceRoot, file)),
  );
}
