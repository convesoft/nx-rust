import type { NxJsonConfiguration, TargetConfiguration } from "@nx/devkit";
import { dirname, isAbsolute, relative } from "node:path";
import type { CargoDiscovery, CargoWorkspace } from "./discovery";
import {
  defaultInputSettings,
  hostTriples,
  InputContext,
  InputSettings,
  InputSubject,
  targetInputs,
} from "./inputs";
import { ArtifactDirectory, isCached, targetOutputs } from "./outputs";
import { findCrateFolders, unseenPathDependencyWarning } from "./path-dependencies";
import { pluginInput } from "./plugin-package";
import { redirectedUses } from "./redirected-uses";
import type { InferredTargetName } from "./targets";

/** What the caching of every project of one graph computation shares. */
export interface CacheContext extends InputContext {
  /** Where each workspace's artifact directory lies, by the workspace's root folder. */
  artifactDirectories: ReadonlyMap<string, ArtifactDirectory>;
  /** The warnings for each project, by the manifest path of its crate or of its workspace. */
  warnings: ReadonlyMap<string, readonly string[]>;
}

/**
 * Works out what the inputs and outputs of the projects that `discovery`
 * found need beyond each project: how the plugin's version reaches the keys,
 * the crates without a project that path dependencies and redirections
 * reach, the redirected crates whose edges are left out, and where each
 * workspace's artifact directory lies; and the warnings of `DES-DIAGNOSTICS`
 * that these give, which it also prints.
 *
 * The redirected uses come from `redirectedUses`, which `createDependencies`
 * asks again with the projects of every plugin and entry. Here it knows only
 * the projects of this entry, so a crate that another entry gives a project
 * counts as one without a project, and its folder joins the inputs beside
 * the edge that `createDependencies` adds.
 */
export async function cacheContext(
  discovery: CargoDiscovery,
  nxJson: NxJsonConfiguration | undefined,
): Promise<CacheContext> {
  const { workspaceRoot } = discovery;
  const uses = redirectedUses({ discovery, projects: [] }, projectRoots(discovery));
  const [plugin, folders] = await Promise.all([
    pluginInput(workspaceRoot, nxJson),
    findCrateFolders(discovery, uses),
  ]);
  const warnings = new Map<string, string[]>();
  const warn = (key: string, message: string) => {
    warnings.set(key, [...(warnings.get(key) ?? []), message]);
  };
  const pathDependencyFolders = new Map<string, string[]>();
  for (const workspace of discovery.workspaces) {
    for (const crate of workspace.members) {
      const dependencies = folders.withoutProject.get(crate.manifest_path) ?? [];
      pathDependencyFolders.set(
        crate.manifest_path,
        dependencies.filter((dependency) => dependency.seen).map((dependency) => dependency.folder),
      );
      for (const dependency of dependencies.filter((dependency) => !dependency.seen)) {
        warn(
          crate.manifest_path,
          unseenPathDependencyWarning(
            crate.name,
            relative(workspaceRoot, crate.manifest_path),
            dependency,
          ),
        );
      }
    }
  }
  const artifactDirectories = locateArtifactDirectories(discovery);
  for (const workspace of discovery.workspaces) {
    const message = artifactDirectoryWarning(workspace, discovery, artifactDirectories);
    if (message !== undefined) {
      for (const manifest of workspaceManifests(workspace)) {
        warn(manifest, message);
      }
    }
  }
  for (const message of new Set([...warnings.values()].flat())) {
    console.warn(message);
  }
  return {
    repositoryRoot: workspaceRoot,
    plugin,
    hostTriples: hostTriples(),
    pathDependencyFolders,
    redirectedFolders: folders.leftOutEdges,
    artifactDirectories,
    warnings,
  };
}

/** What caching needs to know about a project. */
export type CacheSubject = InputSubject;

/**
 * Gives each of a project's inferred targets its caching: whether it is
 * cached, its inputs and its outputs (`DES-INPUTS`, `DES-OUTPUTS`), and the
 * plugin's version as the option `pluginVersion` where no npm node carries
 * it. Every inferred target gets `cache` and `outputs`; the targets that
 * `DES-INPUTS` covers get their inputs, and `audit`, `deny` and `update`
 * keep the inputs that `inferTargets` gave them.
 */
// @mara implements DES-INPUTS
// @mara implements DES-OUTPUTS
export function configureCaching(
  targets: Map<InferredTargetName, TargetConfiguration>,
  subject: CacheSubject,
  context: CacheContext,
  settings: InputSettings = defaultInputSettings,
): void {
  const artifacts = context.artifactDirectories.get(subject.workspace.root) ?? { inside: false };
  for (const [name, target] of targets) {
    target.cache = isCached(name, artifacts);
    const inputs = targetInputs(name, subject, context, configuredTriples(target), settings);
    if (inputs !== undefined) {
      target.inputs = inputs;
    }
    target.outputs = targetOutputs(name, subject.pkg, artifacts);
    if (context.plugin.kind === "option") {
      target.options = { ...target.options, pluginVersion: context.plugin.version };
    }
  }
}

/** The warnings that concern a project, for its crate's manifest path or its workspace's root manifest. */
export function projectWarnings(subject: CacheSubject, context: CacheContext): string[] {
  const key = subject.pkg?.manifest_path ?? rootManifestPath(subject.workspace);
  return [...new Set(context.warnings.get(key) ?? [])];
}

// The roots of the projects that this entry creates (`inferProjects` in
// `projects.ts`): each member's folder, and the folder of each root manifest
// that Nx hands to the plugin.
function projectRoots(discovery: CargoDiscovery): string[] {
  const root = (path: string) => relative(discovery.workspaceRoot, path) || ".";
  return [
    ...new Set(
      discovery.workspaces.flatMap((workspace) => [
        ...workspace.members.map((pkg) => root(dirname(pkg.manifest_path))),
        ...(workspace.rootManifestHanded ? [workspace.root] : []),
      ]),
    ),
  ];
}

// The target triples that a target's options and configurations name.
function configuredTriples(target: TargetConfiguration): string[] {
  return [target.options, ...Object.values(target.configurations ?? {})]
    .map((options) => options?.targetTriple)
    .filter((triple): triple is string => typeof triple === "string" && triple !== "");
}

// Where each workspace's artifact directory lies, by the workspace's root
// folder: outside the repository, or inside it and shared with another
// workspace or not.
function locateArtifactDirectories(discovery: CargoDiscovery): Map<string, ArtifactDirectory> {
  const workspacesByDirectory = new Map<string, number>();
  for (const workspace of discovery.workspaces) {
    const directory = workspace.report.target_directory;
    workspacesByDirectory.set(directory, (workspacesByDirectory.get(directory) ?? 0) + 1);
  }
  const located = new Map<string, ArtifactDirectory>();
  for (const workspace of discovery.workspaces) {
    const directory = workspace.report.target_directory;
    const path = relative(discovery.workspaceRoot, directory);
    located.set(
      workspace.root,
      path === "" || path === ".." || path.startsWith("../") || isAbsolute(path)
        ? { inside: false }
        : { inside: true, path, shared: (workspacesByDirectory.get(directory) ?? 0) > 1 },
    );
  }
  return located;
}

// The warning of `DES-OUTPUTS` for a workspace whose artifact directory lies
// outside the repository or is shared with another workspace.
// @mara implements DES-DIAGNOSTICS
function artifactDirectoryWarning(
  workspace: CargoWorkspace,
  discovery: CargoDiscovery,
  located: ReadonlyMap<string, ArtifactDirectory>,
): string | undefined {
  const artifacts = located.get(workspace.root);
  const directory = workspace.report.target_directory;
  const where = describeWorkspace(workspace);
  if (artifacts === undefined || !artifacts.inside) {
    return [
      `nx-rust: Cargo's artifact directory of ${where} is ${directory}, outside the repository, where Nx cannot store files.`,
      `Its build and doc targets run uncached, and its other targets stay cached.`,
      `To cache them, set build.target-dir in a .cargo/config.toml of the workspace to a folder inside the repository, or unset CARGO_TARGET_DIR.`,
    ].join(" ");
  }
  if (artifacts.shared) {
    const others = discovery.workspaces
      .filter((other) => other !== workspace && other.report.target_directory === directory)
      .map(describeWorkspace);
    return [
      `nx-rust: ${where} shares Cargo's artifact directory ${artifacts.path} with ${others.join(" and ")}.`,
      `Its doc target runs uncached, because restoring one workspace's doc folder from the cache would delete the pages of the others; its other targets stay cached.`,
      `To cache it, give each workspace an artifact directory of its own with build.target-dir in its .cargo/config.toml.`,
    ].join(" ");
  }
  return undefined;
}

function describeWorkspace(workspace: CargoWorkspace): string {
  return workspace.root === "."
    ? "the Cargo workspace at the repository root"
    : `the Cargo workspace in ${workspace.root}`;
}

// The keys of {@link CacheContext.warnings} for the projects of a workspace:
// its members' manifests and its root manifest.
function workspaceManifests(workspace: CargoWorkspace): string[] {
  return [
    ...new Set([...workspace.members.map((pkg) => pkg.manifest_path), rootManifestPath(workspace)]),
  ];
}

function rootManifestPath(workspace: CargoWorkspace): string {
  return `${workspace.report.workspace_root}/Cargo.toml`;
}
