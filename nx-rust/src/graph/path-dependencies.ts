import { dirname, isAbsolute, join, relative } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import type { CargoDiscovery } from "./discovery";
import { filesNxSees } from "./visibility";

/** A crate without an Nx project that a crate with a project reaches by path. */
export interface PathDependency {
  /** Its package name. */
  name: string;
  /** Its folder relative to the repository root, or its absolute path outside it. */
  folder: string;
  /** Whether Nx sees its files: it lies inside the repository and Nx does not ignore it. */
  seen: boolean;
}

/**
 * The path dependencies without a project that each crate with a project
 * reaches, directly or through other crates without a project, by the
 * crate's manifest path (`DES-INPUTS`, "Path dependencies"). A crate
 * without a project is excluded by `exclude` on the plugin's entry, ignored
 * by Nx, or outside the repository. What lies behind a crate with a project
 * reaches the crate through that project's own input.
 *
 * Whether Nx sees a crate's files is whether it sees its manifest.
 */
// @mara implements DES-INPUTS
export async function findPathDependencies(
  discovery: CargoDiscovery,
): Promise<Map<string, PathDependency[]>> {
  const { workspaceRoot } = discovery;
  const withProject = new Set(
    discovery.workspaces.flatMap((workspace) => workspace.members.map((pkg) => pkg.manifest_path)),
  );
  const known = new Map<string, CargoPackage>();
  for (const report of [
    ...discovery.workspaces.map((workspace) => workspace.report),
    ...discovery.pathDependencyReports.map((entry) => entry.report),
  ]) {
    for (const pkg of report.packages) {
      if (!known.has(pkg.manifest_path)) {
        known.set(pkg.manifest_path, pkg);
      }
    }
  }
  const reached = new Map<string, CargoPackage[]>();
  for (const workspace of discovery.workspaces) {
    for (const crate of workspace.members) {
      reached.set(crate.manifest_path, reachedWithoutProject(crate, withProject, known));
    }
  }
  const manifests = new Set(
    [...reached.values()]
      .flat()
      .map((pkg) => inside(workspaceRoot, pkg.manifest_path))
      .filter((path): path is string => path !== undefined),
  );
  const seen = await filesNxSees(workspaceRoot, [...manifests]);
  const result = new Map<string, PathDependency[]>();
  for (const [manifest, packages] of reached) {
    result.set(
      manifest,
      packages.map((pkg) => {
        const path = inside(workspaceRoot, pkg.manifest_path);
        return {
          name: pkg.name,
          folder: path === undefined ? dirname(pkg.manifest_path) : dirname(path),
          seen: path !== undefined && seen.has(path),
        };
      }),
    );
  }
  return result;
}

/**
 * The warning for a path dependency without a project whose files Nx does
 * not see (`DES-DIAGNOSTICS`), naming the crate and the dependency.
 *
 * @param crate The crate with a project that reaches it.
 * @param manifest The crate's manifest, relative to the repository root.
 */
// @mara implements DES-DIAGNOSTICS
export function unseenPathDependencyWarning(
  crate: string,
  manifest: string,
  dependency: PathDependency,
): string {
  const outside = isAbsolute(dependency.folder);
  return [
    `nx-rust: the crate "${crate}" (${manifest}) depends by path on "${dependency.name}" in ${dependency.folder}, which has no Nx project and whose files Nx cannot see, because ${outside ? "it lies outside the repository" : ".gitignore or .nxignore leaves it out"}.`,
    `A change there changes no cache key of "${crate}" or of the crates that depend on it, so Nx can restore results built from the old files.`,
    outside
      ? `Move the crate into the repository, or add a command whose output changes with its files to runtimeInputs in the [package.metadata.nx] table of ${manifest}.`
      : `Stop ignoring ${dependency.folder}, or add a command whose output changes with its files to runtimeInputs in the [package.metadata.nx] table of ${manifest}.`,
  ].join(" ");
}

// The crates without a project that `crate` reaches through path
// dependencies, directly or through other crates without a project, in the
// order the walk meets them.
function reachedWithoutProject(
  crate: CargoPackage,
  withProject: ReadonlySet<string>,
  known: ReadonlyMap<string, CargoPackage>,
): CargoPackage[] {
  const reached: CargoPackage[] = [];
  const visited = new Set<string>([crate.manifest_path]);
  const queue = [crate];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependency of current.dependencies) {
      if (typeof dependency.path !== "string") {
        continue;
      }
      const manifest = join(dependency.path, "Cargo.toml");
      if (visited.has(manifest) || withProject.has(manifest)) {
        continue;
      }
      visited.add(manifest);
      const pkg = known.get(manifest);
      if (pkg !== undefined) {
        reached.push(pkg);
        queue.push(pkg);
      }
    }
  }
  return reached;
}

// The path relative to the repository root, or `undefined` outside it.
function inside(workspaceRoot: string, path: string): string | undefined {
  const relativePath = relative(workspaceRoot, path);
  return relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)
    ? undefined
    : relativePath;
}
