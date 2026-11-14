import { CargoWorkspace, describeWorkspaces } from "./discovery";
import { nxIgnoreRules } from "./nx-internals";
import { folderInside } from "./real-path";

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
 * A directory is the folder that cargo writes to, which the system reaches
 * through the path that cargo reports ({@link folderInside}): that folder
 * decides whether it lies inside the repository and whether Nx ignores it,
 * and the warning names it, adding the reported path where symbolic links
 * make the two differ.
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
    { roles: Set<CargoDirectoryRole>; workspaces: CargoWorkspace[]; written: Set<string> }
  >();
  for (const workspace of workspaces) {
    const { build_directory: build, target_directory: artifact } = workspace.report;
    const found: [CargoDirectoryRole, unknown][] = [
      ["build", build],
      ["artifact", artifact],
    ];
    for (const [role, path] of found) {
      const folder = typeof path === "string" ? folderInside(path, workspaceRoot) : undefined;
      if (folder === undefined || folder.path === ".") {
        continue;
      }
      const directory = folder.path;
      const entry = directories.get(directory) ?? {
        roles: new Set(),
        workspaces: [],
        written: new Set(),
      };
      entry.roles.add(role);
      if (folder.written !== undefined) {
        entry.written.add(folder.written);
      }
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
  for (const [directory, { roles, workspaces: owners, written }] of directories) {
    if (ignores(directory)) {
      continue;
    }
    const role = roles.size === 2 ? "build and artifact directory" : `${[...roles][0]} directory`;
    const through = written.size === 0 ? "" : ` (reached through ${list([...written])})`;
    const message = [
      `nx-rust: ${directory}${through}, Cargo's ${role} of ${describeWorkspaces(owners.map((owner) => owner.root))}, lies inside the repository, and no .gitignore or .nxignore leaves it out of the files that Nx reads.`,
      "Nx then hashes every file that Cargo writes there, counts those inside a project's folder among the project's files, so that a build can change the cache keys of its tasks, and hands nx-rust the Cargo.toml files that `cargo package` leaves there.",
      `Add the line /${directory}/ to the .gitignore at the repository root.`,
    ].join("\n");
    for (const owner of owners) {
      warnings.set(owner, [...(warnings.get(owner) ?? []), message]);
    }
  }
  return warnings;
}

// "a", "a and b", "a, b and c"
function list(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
