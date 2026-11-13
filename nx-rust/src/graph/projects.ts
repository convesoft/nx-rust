import type { CreateNodesResultArray, TargetConfiguration } from "@nx/devkit";
import { dirname, join, relative } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import { CacheContext, projectWarnings } from "./caching";
import { cargoMetadata, cargoMetadataKey } from "./collisions";
import type { CargoDiscovery, CargoWorkspace } from "./discovery";
import { Input, InputSettings, namedInputs } from "./inputs";
import { projectName } from "./names";
import type { GraphSettings, ProjectSettings } from "./settings";
import { applyTargetTables } from "./target-tables";
import { inferTargets, nameTargets } from "./targets";

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
  /**
   * The inferred targets, under the names that `targetNames` gives them,
   * with the target tables of the metadata tables laid over them.
   */
  targets: Record<string, TargetConfiguration>;
  /** What the plugin options and the metadata tables give the project. */
  settings: ProjectSettings;
  /** The project's named inputs, which its targets and its dependents hash (`DES-INPUTS`). */
  namedInputs: Record<string, Input[]>;
  /**
   * The warnings found while creating the graph that concern the project,
   * which the executor prints again at the start of each of its tasks
   * (`DES-DIAGNOSTICS`).
   */
  warnings: string[];
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
 * Each has the targets of its shape (`inferTargets` in `targets.ts`), with
 * the target tables of its settings laid over them (`applyTargetTables` in
 * `target-tables.ts`), and is named by its settings.
 *
 * Two of them may get one name: whether they keep it is known only once Nx
 * has applied `package.json` and `project.json`, so `createDependencies`
 * checks it (`failOnNameCollisions` in `collisions.ts`).
 *
 * @param settings The settings of the plugin options and metadata tables (`readSettings` in `settings.ts`).
 * @param context What the caching of the projects shares (`cacheContext` in `caching.ts`).
 * @throws {Error} When `targetNames` gives two targets of one project the
 *   same name, or a target table breaks a rule of `applyTargetTables`.
 */
// @mara implements DES-PROJECT-GRAPH
export function inferProjects(
  discovery: CargoDiscovery,
  settings: GraphSettings,
  context: CacheContext,
): CargoProject[] {
  const projects: Omit<CargoProject, "targets" | "namedInputs" | "warnings">[] = [];
  for (const workspace of discovery.workspaces) {
    const rootManifest = join(workspace.report.workspace_root, "Cargo.toml");
    for (const pkg of workspace.members) {
      const own = settings.crate(pkg);
      projects.push({
        name: projectName({
          kind: "crate",
          pkg,
          workspace,
          name: own.name,
          namePrefix: own.workspace.namePrefix,
        }),
        root: relative(discovery.workspaceRoot, dirname(pkg.manifest_path)) || ".",
        manifest: relative(discovery.workspaceRoot, pkg.manifest_path),
        workspace,
        pkg,
        isWorkspaceProject: pkg.manifest_path === rootManifest,
        settings: own,
      });
    }
    const rootIsCrate = workspace.report.packages.some((pkg) => pkg.manifest_path === rootManifest);
    if (!rootIsCrate && workspace.rootManifestHanded) {
      const own = settings.workspaceProject(workspace);
      projects.push({
        name: projectName({ kind: "workspace", workspace, name: own.name }),
        root: workspace.root,
        manifest: workspace.rootManifest,
        workspace,
        isWorkspaceProject: true,
        settings: own,
      });
    }
  }
  const named = nameTargets(
    projects.map((project) => ({
      project,
      targets: inferTargets(project, context, settings.options.locked, {
        settings: inputSettings(project.settings),
        targetTables: (target) =>
          targetTables(project.settings, settings.options.targetNames[target] ?? target),
        lockfileTarget: settings.options.targetNames.lockfile ?? "lockfile",
      }),
    })),
    settings.options.targetNames,
  );
  const targets = applyTargetTables(
    projects.map((project, index) => ({ project, targets: named[index] })),
    discovery.workspaceRoot,
    settings.options.targetNames,
  );
  return projects.map((project, index) => ({
    ...project,
    targets: targets[index],
    namedInputs: namedInputs(project, context, inputSettings(project.settings)),
    warnings: projectWarnings(project, context),
  }));
}

/**
 * The settings that change a project's inputs: the variables and commands
 * that the plugin options and the metadata tables add (`DES-PLUGIN-OPTIONS`,
 * "Added inputs") and the workspace's test runner. Every workspace counts
 * as `workspace-build`, whose inputs include those of the other strategies,
 * until the strategies exist (nxr-k64tm5). The files of `fileInputs` are
 * nxr-d371vy's.
 */
function inputSettings(settings: ProjectSettings): InputSettings {
  return {
    featureUnification: "workspace-build",
    testRunner: settings.workspace.testRunner,
    added: { envInputs: settings.envInputs, runtimeInputs: settings.runtimeInputs, fileInputs: [] },
  };
}

// The target tables of the project for the target of this final name, in
// the order in which they are laid over it.
function targetTables(settings: ProjectSettings, name: string): TargetConfiguration[] {
  return settings.targets.filter((table) => table.name === name).map((table) => table.target);
}

/**
 * The result of `createNodes` for the projects: each project under the
 * manifest it comes from, with its name, its tags, its implicit
 * dependencies, its named inputs, its targets and, in its metadata, what
 * another entry of the plugin needs to recognise it ({@link cargoMetadata})
 * and the warnings that concern it.
 */
export function projectNodes(projects: readonly CargoProject[]): CreateNodesResultArray {
  return projects.map((project) => [
    project.manifest,
    {
      projects: {
        [project.root]: {
          name: project.name,
          ...(project.settings.tags.length > 0 ? { tags: [...project.settings.tags] } : {}),
          ...(project.settings.implicitDependencies.length > 0
            ? { implicitDependencies: [...project.settings.implicitDependencies] }
            : {}),
          namedInputs: project.namedInputs,
          targets: project.targets,
          metadata: {
            [cargoMetadataKey]: {
              ...cargoMetadata(project),
              ...(project.warnings.length > 0 ? { warnings: project.warnings } : {}),
            },
          },
        },
      },
    },
  ]);
}
