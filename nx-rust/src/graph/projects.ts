import type { CreateNodesResultArray } from "@nx/devkit";
import { dirname, join, relative } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import { cargoMetadata, cargoMetadataKey, failOnCollisions } from "./collisions";
import type { CargoDiscovery, CargoWorkspace } from "./discovery";
import { projectName } from "./names";

/**
 * A project that the plugin creates: a crate, or the workspace project of a
 * workspace whose root manifest defines no crate.
 *
 * Commands address a crate by {@link CargoProject.pkg}'s real name and by
 * {@link CargoProject.manifest}, never by {@link CargoProject.name}, which a
 * user can override and Nx can replace.
 */
export interface CargoProject {
  /**
   * The name the plugin gives the project ({@link projectName}). Where the
   * folder also is a JS project, Nx names the project after its
   * `package.json` or `project.json` instead, so the graph is searched by
   * {@link CargoProject.root}, not by this name.
   */
  name: string;
  /** The project's folder, relative to the repository root: `.` for the root itself. */
  root: string;
  /**
   * The manifest the project comes from, relative to the repository root:
   * the crate's own, or the workspace's root manifest for a workspace
   * project without a crate.
   */
  manifest: string;
  /** The workspace the project belongs to, in whose root folder its cargo commands run. */
  workspace: CargoWorkspace;
  /** The crate, with its real package name; absent for a workspace project without a crate. */
  pkg?: CargoPackage;
  /**
   * Whether the project hosts the workspace's own tasks and depends on every
   * member: the workspace project, or the crate of a root manifest that
   * defines one, as for a standalone crate.
   */
  isWorkspaceProject: boolean;
}

/** What one `createNodes` call of a plugin entry found, kept for its `createDependencies`. */
export interface CargoGraph {
  discovery: CargoDiscovery;
  projects: CargoProject[];
}

/**
 * The projects for the workspaces that discovery found: one per member whose
 * manifest Nx handed to the plugin, rooted at the crate, and one workspace
 * project per workspace whose root manifest defines no crate and was handed
 * to the plugin, rooted at the workspace folder. Where the root manifest
 * defines a crate, that crate's project has the workspace project's role.
 *
 * @throws {Error} When two of the projects would have the same name. The
 *   plugin never renames a project on its own.
 */
// @mara implements DES-PROJECT-GRAPH
export function inferProjects(discovery: CargoDiscovery): CargoProject[] {
  const projects: CargoProject[] = [];
  for (const workspace of discovery.workspaces) {
    const rootManifest = join(workspace.report.workspace_root, "Cargo.toml");
    for (const pkg of workspace.members) {
      projects.push({
        name: projectName({ kind: "crate", pkg, workspace }),
        root: relative(discovery.workspaceRoot, dirname(pkg.manifest_path)) || ".",
        manifest: relative(discovery.workspaceRoot, pkg.manifest_path),
        workspace,
        pkg,
        isWorkspaceProject: pkg.manifest_path === rootManifest,
      });
    }
    const rootIsCrate = workspace.report.packages.some((pkg) => pkg.manifest_path === rootManifest);
    if (!rootIsCrate && workspace.rootManifestHanded) {
      projects.push({
        name: projectName({ kind: "workspace", workspace }),
        root: workspace.root,
        manifest: workspace.rootManifest,
        workspace,
        isWorkspaceProject: true,
      });
    }
  }
  failOnCollisions(projects);
  return projects;
}

/**
 * The result of `createNodes` for the projects: each project under the
 * manifest it comes from, with its name and, in its metadata, what another
 * entry of the plugin needs to recognise it ({@link cargoMetadata}).
 */
export function projectNodes(projects: readonly CargoProject[]): CreateNodesResultArray {
  return projects.map((project) => [
    project.manifest,
    {
      projects: {
        [project.root]: {
          name: project.name,
          metadata: { [cargoMetadataKey]: cargoMetadata(project) },
        },
      },
    },
  ]);
}
