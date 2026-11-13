import type { CargoPackage } from "../cargo/metadata";
import type { CargoWorkspace } from "./discovery";

/** The name of a workspace project whose workspace lies at the root of the Nx workspace. */
export const rootWorkspaceProjectName = "cargo-workspace";

/** What a project of the plugin stands for, which decides its name. */
export type NamedProject =
  /** A crate: a member of `workspace`. */
  | { kind: "crate"; pkg: CargoPackage; workspace: CargoWorkspace }
  /** The workspace project of a workspace whose root manifest defines no crate. */
  | { kind: "workspace"; workspace: CargoWorkspace };

/**
 * The name the plugin gives a project. Where the project's folder also is a
 * JS project, Nx replaces it with the name from `package.json` or
 * `project.json`, which the plugin cannot prevent.
 *
 * A crate is named after its package. A workspace project is named after
 * the path of the workspace folder from the root of the Nx workspace, with
 * each `/` replaced by `-` and nothing else changed, and
 * {@link rootWorkspaceProjectName} at that root.
 *
 * This is the one place for the name rule: the crate's `name` override, the
 * workspace's name prefix and the `name` of the workspace project's own
 * table apply here (nxr-xyq7c8). Commands never use this name.
 */
// @mara implements REQ-PROJECT-NAMES
// @mara implements DES-PROJECT-GRAPH
export function projectName(project: NamedProject): string {
  if (project.kind === "crate") {
    return project.pkg.name;
  }
  const { root } = project.workspace;
  return root === "." ? rootWorkspaceProjectName : root.split("/").join("-");
}
