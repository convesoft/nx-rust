import type { NxJsonConfiguration, TargetConfiguration } from "@nx/devkit";
import { dirname, isAbsolute, relative } from "node:path";
import type { CargoDiscovery, CargoWorkspace } from "./discovery";
import {
  defaultInputSettings,
  Input,
  InputContext,
  InputSettings,
  InputSubject,
  repositoryDefaultInputs,
  targetInputs,
} from "./inputs";
import { ArtifactDirectory, targetOutputs, uncachedByDesign, uncachedReason } from "./outputs";
import { crateInputs, findCrateFolders, unseenPathDependencyWarning } from "./path-dependencies";
import { pluginInput } from "./plugin-package";
import { redirectedUses } from "./redirected-uses";
import { InferredTargetName, TargetCargoMetadata, targetCargoMetadataKey } from "./targets";
import { unignoredDirectoryWarnings } from "./unignored-directories";

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
 * that these give, together with those about Cargo directories that Nx reads
 * ({@link unignoredDirectoryWarnings}), which it also prints, each once.
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
  const pathDependencyInputs = new Map<string, Input[]>();
  const redirectedInputs = new Map<string, Input[]>();
  for (const workspace of discovery.workspaces) {
    for (const crate of workspace.members) {
      const dependencies = folders.withoutProject.get(crate.manifest_path) ?? [];
      pathDependencyInputs.set(crate.manifest_path, [
        ...new Set(dependencies.flatMap(crateInputs)),
      ]);
      redirectedInputs.set(crate.manifest_path, [
        ...new Set((folders.leftOutEdges.get(crate.manifest_path) ?? []).flatMap(crateInputs)),
      ]);
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
  const directoryWarnings = unignoredDirectoryWarnings(discovery.workspaces, workspaceRoot);
  for (const workspace of discovery.workspaces) {
    const messages = [
      artifactDirectoryWarning(workspace, discovery, artifactDirectories),
      buildTargetWarning(workspace, workspaceRoot),
      ...(directoryWarnings.get(workspace) ?? []),
    ];
    for (const message of messages.filter((message) => message !== undefined)) {
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
    repositoryDefault: repositoryDefaultInputs(nxJson?.namedInputs),
    pathDependencyInputs,
    redirectedInputs,
    artifactDirectories,
    warnings,
  };
}

/** What caching needs to know about a project. */
export type CacheSubject = InputSubject;

/** What a project's settings change in the caching of its targets. */
export interface CacheOptions {
  /** The settings that change the project's inputs. */
  settings: InputSettings;
  /**
   * The target tables of the project for the target with this default name,
   * in the order in which they are laid over it (`applyTargetTables` in
   * `target-tables.ts`), as far as their options and configurations decide
   * whether every run of the target names a triple.
   */
  targetTables?: (target: InferredTargetName) => readonly TargetConfiguration[];
}

/**
 * Gives each of a project's inferred targets its caching: whether it is
 * cached, its inputs and its outputs (`DES-INPUTS`, `DES-OUTPUTS`), and the
 * plugin's version as the option `pluginVersion` where no npm node carries
 * it. A target arrives cached where `cachedTargets` names it, and stays so
 * unless {@link uncachedReason} gives a reason for this project. Every
 * inferred target gets `cache` and `outputs`, and an uncached one the
 * reason in `metadata.cargo.uncached`, from which the executor fails a task
 * that the configuration caches anyway. The targets that `DES-INPUTS`
 * covers get their inputs, and `audit`, `deny` and `update` keep the inputs
 * that `inferTargets` gave them.
 */
// @mara implements DES-INPUTS
// @mara implements DES-OUTPUTS
export function configureCaching(
  targets: Map<InferredTargetName, TargetConfiguration>,
  subject: CacheSubject,
  context: CacheContext,
  options: CacheOptions = { settings: defaultInputSettings },
): void {
  const { settings } = options;
  const artifacts = context.artifactDirectories.get(subject.workspace.root) ?? { inside: false };
  const place = { artifacts, buildTargetFiles: subject.workspace.buildTargetFiles ?? [] };
  const [buildTargetFile] = place.buildTargetFiles;
  for (const [name, target] of targets) {
    const reason =
      target.cache === true
        ? uncachedReason(
            name,
            place,
            alwaysNamesTriple([target, ...(options.targetTables?.(name) ?? [])]),
          )
        : (uncachedByDesign[name] ?? "the plugin does not cache this target");
    target.cache = reason === undefined;
    const metadata = target.metadata?.[targetCargoMetadataKey] as TargetCargoMetadata | undefined;
    if (metadata !== undefined && reason !== undefined) {
      metadata.uncached = reason;
    }
    if (
      metadata !== undefined &&
      buildTargetFile !== undefined &&
      (name === "build" || name === "doc")
    ) {
      metadata.buildTargetFile = shownPath(buildTargetFile, context.repositoryRoot);
    }
    const inputs = targetInputs(name, subject, context, settings);
    if (inputs !== undefined) {
      target.inputs = inputs;
    }
    target.outputs = targetOutputs(name, subject.pkg, artifacts, target.cache);
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

// The warning of `DES-OUTPUTS` for a workspace whose Cargo configuration
// chooses the target triple, which leaves `build` and `doc` uncached unless
// their options name a triple.
// @mara implements DES-DIAGNOSTICS
function buildTargetWarning(workspace: CargoWorkspace, workspaceRoot: string): string | undefined {
  const [file] = workspace.buildTargetFiles ?? [];
  if (file === undefined) {
    return undefined;
  }
  const shown = relative(workspaceRoot, file);
  const where = shown.startsWith("..") || isAbsolute(shown) ? file : shown;
  return [
    `nx-rust: ${where} sets build.target for ${describeWorkspace(workspace)}, so cargo puts the artifacts of its build and doc targets in a folder that the plugin cannot name unless the target's options name the triple.`,
    `Those targets run uncached where their options name none, and its other targets stay cached.`,
    `To cache them, give the triple as the targetTriple option in the options of their target tables, in the crate's or the workspace's Cargo metadata; a triple only in a configuration or on the command line leaves them uncached.`,
  ].join(" ");
}

// Whether every run of a target names a triple, as the layers give it, the
// inferred target first and then each target table laid over it: the
// options, merged key by key, name one, and no configuration, merged by name
// and key, sets the option to anything else. Nx's `cache` belongs to the
// target and not to a configuration, so a triple in a configuration that a
// run need not select does not count (`DES-OUTPUTS`).
function alwaysNamesTriple(layers: readonly TargetConfiguration[]): boolean {
  const isTriple = (value: unknown) => typeof value === "string" && value !== "";
  let triple: unknown;
  const configured = new Map<string, unknown>();
  for (const layer of layers) {
    if (layer.options !== undefined && layer.options !== null && "targetTriple" in layer.options) {
      triple = layer.options.targetTriple;
    }
    for (const [configuration, options] of Object.entries(layer.configurations ?? {})) {
      if (typeof options === "object" && options !== null && "targetTriple" in options) {
        configured.set(configuration, options.targetTriple);
      }
    }
  }
  return isTriple(triple) && [...configured.values()].every(isTriple);
}

// A file's path relative to the repository root, or as it is outside it.
function shownPath(file: string, repositoryRoot: string): string {
  const shown = relative(repositoryRoot, file);
  return shown === "" || shown.startsWith("..") || isAbsolute(shown) ? file : shown;
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
