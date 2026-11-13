import { isAbsolute, relative } from "node:path";
import { CargoWorkspace, describeWorkspaces } from "./discovery";
import { nxIgnoreRules } from "./nx-internals";

/** One of Cargo's two directories of a workspace. */
type CargoDirectoryRole = "build" | "artifact";

/**
 * The warnings for Cargo's build and artifact directories that lie inside
 * the repository and that no `.gitignore` or `.nxignore` file and none of
 * Nx's fixed folders leave out of the files that Nx reads, as Nx itself
 * applies those rules ({@link nxIgnoreRules}): Nx then hashes Cargo's
 * output with the sources, and hands the plugin the manifests that
 * `cargo package` leaves there. A directory that the repository root itself
 * is, or that lies outside the repository, is not one of them.
 *
 * Each directory gets one warning, which names it, its role and the
 * workspaces whose directory it is, and advises the line to add to the
 * root `.gitignore`. Every workspace whose directory it is gets that
 * warning; none gets one where the installed Nx cannot tell what it
 * ignores.
 *
 * @returns The warnings of each workspace that has any.
 */
// @mara implements DES-DIAGNOSTICS
export function unignoredDirectoryWarnings(
  workspaces: readonly CargoWorkspace[],
  workspaceRoot: string,
): Map<CargoWorkspace, string[]> {
  const directories = new Map<
    string,
    { roles: Set<CargoDirectoryRole>; workspaces: CargoWorkspace[] }
  >();
  for (const workspace of workspaces) {
    const { build_directory: build, target_directory: artifact } = workspace.report;
    const found: [CargoDirectoryRole, unknown][] = [
      ["build", build],
      ["artifact", artifact],
    ];
    for (const [role, path] of found) {
      const directory =
        typeof path === "string" ? insideRepository(workspaceRoot, path) : undefined;
      if (directory === undefined) {
        continue;
      }
      const entry = directories.get(directory) ?? { roles: new Set(), workspaces: [] };
      entry.roles.add(role);
      if (!entry.workspaces.includes(workspace)) {
        entry.workspaces.push(workspace);
      }
      directories.set(directory, entry);
    }
  }
  const warnings = new Map<CargoWorkspace, string[]>();
  const ignores = directories.size === 0 ? undefined : nxIgnoreRules(workspaceRoot);
  if (ignores === undefined) {
    return warnings;
  }
  for (const [directory, { roles, workspaces: owners }] of directories) {
    if (ignores(directory)) {
      continue;
    }
    const role = roles.size === 2 ? "build and artifact directory" : `${[...roles][0]} directory`;
    const message = [
      `nx-rust: ${directory}, Cargo's ${role} of ${describeWorkspaces(owners.map((owner) => owner.root))}, lies inside the repository, and no .gitignore or .nxignore leaves it out of the files that Nx reads.`,
      "Nx then hashes every file that Cargo writes there, counts those inside a project's folder among the project's files, so that a build can change the cache keys of its tasks, and hands nx-rust the Cargo.toml files that `cargo package` leaves there.",
      `Add the line /${directory}/ to the .gitignore at the repository root.`,
    ].join("\n");
    for (const owner of owners) {
      warnings.set(owner, [...(warnings.get(owner) ?? []), message]);
    }
  }
  return warnings;
}

// The path relative to the repository root of a directory strictly inside
// it, or undefined for the root itself and for a directory outside it.
function insideRepository(workspaceRoot: string, path: string): string | undefined {
  const inside = relative(workspaceRoot, path);
  return inside === "" || inside === ".." || inside.startsWith("../") || isAbsolute(inside)
    ? undefined
    : inside;
}
