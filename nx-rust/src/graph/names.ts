import type { CargoPackage } from "../cargo/metadata";
import type { CargoWorkspace } from "./discovery";

/** The name of a workspace project whose workspace lies at the root of the Nx workspace. */
export const rootWorkspaceProjectName = "cargo-workspace";

/** What a project of the plugin stands for, which decides its name. */
export type NamedProject =
  /**
   * A crate: a member of `workspace`, with the `name` of its
   * `[package.metadata.nx]` and the `namePrefix` of its workspace, if set.
   */
  | {
      kind: "crate";
      pkg: CargoPackage;
      workspace: CargoWorkspace;
      name?: string;
      namePrefix?: string;
    }
  /**
   * The workspace project of a workspace whose root manifest defines no
   * crate, with the `name` of `[workspace.metadata.nx.project]`, if set.
   */
  | { kind: "workspace"; workspace: CargoWorkspace; name?: string };

/**
 * The name the plugin gives a project. Where the project's folder also is a
 * JS project, Nx replaces it with the name from `package.json` or
 * `project.json`, which the plugin cannot prevent.
 *
 * A crate is named by its `name` setting, used as it is, or else after its
 * package, with the workspace's `namePrefix` put in front as it is. A
 * workspace project is named by its `name` setting, or else after the path
 * of the workspace folder from the root of the Nx workspace, with each `/`
 * replaced by `-` and nothing else changed, and
 * {@link rootWorkspaceProjectName} at that root; no prefix applies to it.
 *
 * This is the one place for the name rule. Commands never use this name.
 */
// @mara implements REQ-PROJECT-NAMES
// @mara implements DES-PROJECT-GRAPH
export function projectName(project: NamedProject): string {
  if (project.name !== undefined) {
    return project.name;
  }
  if (project.kind === "crate") {
    return `${project.namePrefix ?? ""}${project.pkg.name}`;
  }
  const { root } = project.workspace;
  return root === "." ? rootWorkspaceProjectName : root.split("/").join("-");
}
