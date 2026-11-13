import type { CreateNodesResultArray } from "@nx/devkit";
import { dirname, join, relative } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
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

/** The result of `createNodes` for the projects: each project under the manifest it comes from. */
export function projectNodes(projects: readonly CargoProject[]): CreateNodesResultArray {
  return projects.map((project) => [
    project.manifest,
    { projects: { [project.root]: { name: project.name } } },
  ]);
}

// Fails with one message that covers every name that more than one project
// would get, naming each project's manifest and how to rename it.
function failOnCollisions(projects: readonly CargoProject[]): void {
  const byName = new Map<string, CargoProject[]>();
  for (const project of projects) {
    byName.set(project.name, [...(byName.get(project.name) ?? []), project]);
  }
  const collisions = [...byName].filter(([, named]) => named.length > 1);
  if (collisions.length === 0) {
    return;
  }
  throw new Error(
    collisions
      .map(([name, named]) =>
        [
          `nx-rust would give ${named.length} projects the name "${name}", and Nx needs every project name to be unique:`,
          ...named.map((project) => `- ${describeProject(project)}: ${remedy(project)}`),
          "nx-rust never renames a project on its own. Rename all of them but one.",
        ].join("\n"),
      )
      .join("\n\n"),
  );
}

function describeProject(project: CargoProject): string {
  return project.pkg === undefined
    ? `the workspace project of the Cargo workspace in ${project.manifest}`
    : `the crate ${project.pkg.name} in ${project.manifest}`;
}

function remedy(project: CargoProject): string {
  if (project.pkg === undefined) {
    return "set `name` under [workspace.metadata.nx.project] in that manifest.";
  }
  const own = "set `name` under [package.metadata.nx] in that manifest";
  // A prefix renames every member, which only helps in a workspace of several.
  return project.workspace.report.workspace_members.length > 1
    ? `${own}, or \`namePrefix\` under [workspace.metadata.nx] in ${project.workspace.rootManifest} for every member of its workspace.`
    : `${own}.`;
}
