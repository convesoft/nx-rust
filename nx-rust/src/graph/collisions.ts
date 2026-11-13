import type { CreateDependenciesContext, ProjectConfiguration } from "@nx/devkit";
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
}

/** The metadata that {@link ProjectCargoMetadata} describes, for one project. */
export function cargoMetadata(project: CargoProject): ProjectCargoMetadata {
  return {
    projectName: project.name,
    manifest: project.manifest,
    workspaceManifest: project.workspace.rootManifest,
    ...(project.pkg === undefined ? {} : { packageName: project.pkg.name }),
  };
}

/**
 * Fails when two projects of one entry would have the same name.
 *
 * @throws {Error} Naming each name with every manifest and its remedy.
 */
// @mara implements DES-PROJECT-GRAPH
export function failOnCollisions(projects: readonly CargoProject[]): void {
  const byName = new Map<string, ProjectCargoMetadata[]>();
  for (const project of projects) {
    byName.set(project.name, [...(byName.get(project.name) ?? []), cargoMetadata(project)]);
  }
  throwCollisions(
    [...byName].filter(([, named]) => named.length > 1),
    false,
  );
}

/**
 * Fails when a project of this entry has the name that the plugin gave a
 * project of another entry, as the projects that `createDependencies`
 * receives show.
 *
 * Nx merges the projects of all entries before it calls `createDependencies`,
 * and lists only one project for a name that two have. When that one is
 * another entry's project, this entry finds it by its
 * {@link ProjectCargoMetadata}, so that exactly one entry reports the
 * collision. A project that only a `package.json` or `project.json` gave the
 * name, or another plugin's project, is left to Nx's own error.
 *
 * @param projects The projects that `createDependencies` receives, by name.
 * @throws {Error} Naming each name with both manifests and their remedies.
 */
// @mara implements DES-PROJECT-GRAPH
export function failOnCollisionsAcrossEntries(
  graph: CargoGraph,
  projects: CreateDependenciesContext["projects"],
): void {
  const collisions: [string, ProjectCargoMetadata[]][] = [];
  for (const project of graph.projects) {
    const other = projects[project.name];
    if (other === undefined || other.root === project.root) {
      continue;
    }
    const theirs = cargoMetadataOf(other);
    if (theirs?.projectName === project.name) {
      collisions.push([project.name, [cargoMetadata(project), theirs]]);
    }
  }
  throwCollisions(collisions, true);
}

function cargoMetadataOf(project: ProjectConfiguration): ProjectCargoMetadata | undefined {
  const value = project.metadata?.[cargoMetadataKey] as Partial<ProjectCargoMetadata> | undefined;
  return typeof value?.projectName === "string" &&
    typeof value.manifest === "string" &&
    typeof value.workspaceManifest === "string"
    ? (value as ProjectCargoMetadata)
    : undefined;
}

// Fails with one message that covers every name that more than one project
// would get, naming each project's manifest and how to rename it.
function throwCollisions(
  collisions: readonly [string, ProjectCargoMetadata[]][],
  acrossEntries: boolean,
): void {
  if (collisions.length === 0) {
    return;
  }
  throw new Error(
    collisions
      .map(([name, named]) =>
        [
          `nx-rust would give ${named.length} projects the name "${name}", and Nx needs every project name to be unique:`,
          ...named.map((project) => `- ${describeProject(project)}: ${remedy(project)}`),
          ...(acrossEntries
            ? ["The projects come from two entries of @convesoft/nx-rust in nx.json."]
            : []),
          "nx-rust never renames a project on its own. Rename all of them but one.",
        ].join("\n"),
      )
      .join("\n\n"),
  );
}

function describeProject(project: ProjectCargoMetadata): string {
  return project.packageName === undefined
    ? `the workspace project of the Cargo workspace in ${project.manifest}`
    : `the crate ${project.packageName} in ${project.manifest}`;
}

function remedy(project: ProjectCargoMetadata): string {
  return project.packageName === undefined
    ? "set `name` under [workspace.metadata.nx.project] in that manifest."
    : `set \`name\` under [package.metadata.nx] in that manifest, or \`namePrefix\` under [workspace.metadata.nx] in ${project.workspaceManifest} for every member of its workspace.`;
}
