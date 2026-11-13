import type { CreateDependenciesContext, ProjectConfiguration } from "@nx/devkit";
import { basename, dirname } from "node:path";
import type { CargoGraph, CargoProject } from "./projects";

/** The key of {@link ProjectCargoMetadata} in the metadata of each project of the plugin. */
export const cargoMetadataKey = "cargo";

/**
 * What each project of the plugin carries in its Nx metadata, under
 * {@link cargoMetadataKey}. It lets one entry of the plugin in `nx.json`
 * recognise a project that another entry created, which may run in another
 * process, and name its manifest.
 */
export interface ProjectCargoMetadata {
  /**
   * The name the plugin gives the project. A `package.json` or
   * `project.json` in its folder may have given it another one.
   */
  projectName: string;
  /** The manifest the project comes from, relative to the repository root. */
  manifest: string;
  /** The root manifest of the project's workspace, relative to the repository root. */
  workspaceManifest: string;
  /** The crate's real package name; absent for a workspace project without a crate. */
  packageName?: string;
  /**
   * `true` where the `name` of the crate's `[package.metadata.nx]` gave the
   * name, which `namePrefix` then does not change; absent otherwise.
   */
  nameOverride?: true;
  /**
   * The warnings that graph creation found for the project, which the
   * executor prints again at the start of each of its tasks
   * (`DES-DIAGNOSTICS`, "Warnings where they are seen"); absent without any.
   */
  warnings?: string[];
}

/** The metadata that {@link ProjectCargoMetadata} describes, for one project. */
export function cargoMetadata(project: CargoProject): ProjectCargoMetadata {
  return {
    projectName: project.name,
    manifest: project.manifest,
    workspaceManifest: project.workspace.rootManifest,
    ...(project.pkg === undefined ? {} : { packageName: project.pkg.name }),
    ...(project.pkg !== undefined && project.settings.name !== undefined
      ? { nameOverride: true }
      : {}),
  };
}

/**
 * Fails when projects of the plugin still hold one name after Nx has merged
 * the projects of all plugins, which it has done when it calls
 * `createDependencies`.
 *
 * A project holds the name it has among the merged projects, so a name
 * that a `package.json` or `project.json` gave it replaces the plugin's.
 * Nx lists one project per name there, and reports a name that several
 * projects hold with its own error first. A project of this entry that is
 * not listed lost its name to another project; the name it held is the one
 * under which Nx lists the files of its folder.
 *
 * An entry reports a name only when it can see every project that holds
 * it, and they are all the plugin's: its own projects, together with the
 * project Nx lists under the name when that one is another entry's project
 * that still holds the name the plugin gave it, and then only one of its
 * own. The name must hold no file outside their folders, and no
 * `project.json` in a subfolder. Otherwise, as when a project that is not
 * the plugin's holds the name too, Nx's error stands alone. So one entry
 * at most reports a name, whatever order Nx merged the projects in.
 *
 * @throws {Error} Naming each name with every manifest and its remedy.
 */
// @mara implements DES-PROJECT-GRAPH
export function failOnNameCollisions(
  graph: CargoGraph,
  context: Pick<CreateDependenciesContext, "projects" | "fileMap">,
): void {
  const { projects, fileMap } = context;
  const nameByRoot = new Map(
    Object.entries(projects).map(([name, project]) => [project.root, name] as const),
  );
  const fileOwners = lazyFileOwners(graph, fileMap.projectFileMap);
  const holders = new Map<string, CargoProject[]>();
  for (const project of graph.projects) {
    const held = nameByRoot.get(project.root) ?? fileOwners().get(project.manifest);
    if (held === project.name) {
      holders.set(held, [...(holders.get(held) ?? []), project]);
    }
  }
  const collisions: Collision[] = [];
  for (const [name, own] of holders) {
    const listed = projects[name];
    const named = own.map(cargoMetadata);
    const roots = own.map((project) => project.root);
    let acrossEntries = false;
    if (listed !== undefined && !roots.includes(listed.root)) {
      const theirs = cargoMetadataOf(listed);
      if (theirs?.projectName !== name || own.length > 1) {
        continue;
      }
      named.push(theirs);
      roots.push(listed.root);
      acrossEntries = true;
    }
    if (named.length > 1 && !heldElsewhere(fileMap.projectFileMap[name] ?? [], roots)) {
      collisions.push({ name, named, acrossEntries });
    }
  }
  if (collisions.length > 0) {
    throw new Error(collisionMessage(collisions));
  }
}

interface Collision {
  name: string;
  named: ProjectCargoMetadata[];
  acrossEntries: boolean;
}

// The merged project that lists each manifest of this entry among its files,
// computed once and only when a project of this entry is not listed.
function lazyFileOwners(
  graph: CargoGraph,
  projectFileMap: CreateDependenciesContext["fileMap"]["projectFileMap"],
): () => Map<string, string> {
  let owners: Map<string, string> | undefined;
  return () => {
    if (owners === undefined) {
      const manifests = new Set(graph.projects.map((project) => project.manifest));
      owners = new Map();
      for (const [name, files] of Object.entries(projectFileMap)) {
        for (const { file } of files) {
          if (manifests.has(file)) {
            owners.set(file, name);
          }
        }
      }
    }
    return owners;
  };
}

// Whether a project in no folder of `roots` holds the name as well: a file of
// the name lies outside those folders, or a project.json lies in a subfolder
// of one of them, which Nx makes a project of its own.
function heldElsewhere(files: readonly { file: string }[], roots: readonly string[]): boolean {
  const inside = (file: string, root: string) =>
    root === "." || file === root || file.startsWith(`${root}/`);
  return files.some(
    ({ file }) =>
      !roots.some((root) => inside(file, root)) ||
      (basename(file) === "project.json" && !roots.includes(dirname(file))),
  );
}

/**
 * The {@link ProjectCargoMetadata} of a project, or `undefined` for a
 * project that the plugin did not create.
 */
export function cargoMetadataOf(
  project: Pick<ProjectConfiguration, "metadata">,
): ProjectCargoMetadata | undefined {
  const value = project.metadata?.[cargoMetadataKey] as Partial<ProjectCargoMetadata> | undefined;
  return typeof value?.projectName === "string" &&
    typeof value.manifest === "string" &&
    typeof value.workspaceManifest === "string"
    ? (value as ProjectCargoMetadata)
    : undefined;
}

// One message that covers every name, naming each project's manifest and how
// to rename it.
function collisionMessage(collisions: readonly Collision[]): string {
  return collisions
    .map(({ name, named, acrossEntries }) =>
      [
        `nx-rust would give ${named.length} projects the name "${name}", and Nx needs every project name to be unique:`,
        ...[...named]
          .sort((a, b) => (a.manifest < b.manifest ? -1 : a.manifest > b.manifest ? 1 : 0))
          .map((project) => `- ${describeProject(project)}: ${remedy(project)}`),
        ...(acrossEntries
          ? ["The projects come from two entries of @convesoft/nx-rust in nx.json."]
          : []),
        "nx-rust never renames a project on its own. Rename all of them but one.",
      ].join("\n"),
    )
    .join("\n\n");
}

function describeProject(project: ProjectCargoMetadata): string {
  return project.packageName === undefined
    ? `the workspace project of the Cargo workspace in ${project.manifest}`
    : `the crate ${project.packageName} in ${project.manifest}`;
}

// The settings that rename the project, offered only where they apply to it
// (DES-PLUGIN-OPTIONS): `namePrefix` does not change a crate with a `name`
// of its own, nor a workspace project.
function remedy(project: ProjectCargoMetadata): string {
  if (project.packageName === undefined) {
    return "set `name` under [workspace.metadata.nx.project] in that manifest.";
  }
  if (project.nameOverride === true) {
    return "change `name` under [package.metadata.nx] in that manifest.";
  }
  return `set \`name\` under [package.metadata.nx] in that manifest, or \`namePrefix\` under [workspace.metadata.nx] in ${project.workspaceManifest} for every member of its workspace.`;
}
