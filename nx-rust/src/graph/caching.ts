import type { NxJsonConfiguration, TargetConfiguration } from "@nx/devkit";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { PackageVersion } from "../cargo/lockfile";
import { type PickedTriples, pickText, unnamedTripleProblem } from "../cargo/target-triples";
import type { CargoPackage } from "../cargo/metadata";
import { directoryVariables } from "../cargo/directories";
import { buildRecordSource, sharedRecordNames } from "./build-records";
import type { CargoDiscovery, CargoWorkspace } from "./discovery";
import { workspacesWithoutRootProject } from "./entries";
import {
  defaultInputSettings,
  Input,
  InputContext,
  InputSettings,
  InputSubject,
  lockfileInputs,
  pluginVersionInput,
  repositoryDefaultInputs,
  targetInputs,
  artifactFoldersCommand,
} from "./inputs";
import { digestFolder, lockfileDependency } from "./lockfile-task";
import { ArtifactDirectory, targetOutputs, uncachedByDesign, uncachedReason } from "./outputs";
import { crateInputs, findCrateFolders, unseenPathDependencyWarning } from "./path-dependencies";
import { pluginInput } from "./plugin-package";
import { physicalPath, realPath, repositoryFolder } from "./real-path";
import { redirectedUses } from "./redirected-uses";
import {
  cachedTargets,
  InferredTargetName,
  TargetCargoMetadata,
  targetCargoMetadataKey,
} from "./targets";
import { unignoredDirectoryWarnings } from "./unignored-directories";

/** What the caching of every project of one graph computation shares. */
export interface CacheContext extends InputContext {
  /** Where each workspace's artifact directory lies, by the workspace's root folder. */
  artifactDirectories: ReadonlyMap<string, ArtifactDirectory>;
  /** The warnings for each project, by the manifest path of its crate or of its workspace. */
  warnings: ReadonlyMap<string, readonly string[]>;
  /**
   * The problems of the files that the crates without an edge declare, each
   * once, which stop graph creation together with the projects' own
   * (`inferProjects` in `projects.ts`).
   */
  declaredFileProblems: readonly string[];
  /**
   * The root folders of the workspaces that have no lockfile task, because
   * Nx hands their root manifest to no entry of the plugin
   * ({@link workspacesWithoutRootProject}).
   */
  withoutLockfileTask?: ReadonlySet<string>;
  /**
   * The record names that targets of several crates with one artifact
   * directory give, by the workspace's root folder (`sharedRecordNames` in
   * `build-records.ts`), which the check of `DES-BUILD-INPUT-CHECK` does not read.
   */
  sharedRecordNames?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Works out what the inputs and outputs of the projects that `discovery`
 * found need beyond each project: how the plugin's version reaches the keys,
 * the crates without a project that path dependencies and redirections
 * reach, the redirected crates whose edges are left out, and where each
 * workspace's artifact directory lies; and the warnings of `DES-DIAGNOSTICS`
 * that these give, together with those about Cargo directories that Nx reads
 * ({@link unignoredDirectoryWarnings}), which it also prints, each once. A
 * path dependency whose report cargo refused adds its warning to the crates
 * that reach it, and the warnings about a workspace's redirections
 * ({@link CargoWorkspace.warnings}) go to every project of the workspace;
 * discovery has printed those already.
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
  const repositoryRoot = realPath(workspaceRoot);
  for (const workspace of discovery.workspaces) {
    for (const crate of workspace.members) {
      const dependencies = folders.withoutProject.get(crate.manifest_path) ?? [];
      for (const dependency of dependencies) {
        // Its folder relative to the repository's real path, or absolute.
        const folder = isAbsolute(dependency.folder)
          ? dependency.folder
          : join(repositoryRoot, dependency.folder);
        const message = discovery.unreportedPathDependencies.get(folder);
        if (message !== undefined) {
          warn(crate.manifest_path, message);
        }
      }
      pathDependencyInputs.set(crate.manifest_path, [
        ...uniqueInputs(dependencies.flatMap(crateInputs)),
      ]);
      redirectedInputs.set(crate.manifest_path, [
        ...uniqueInputs((folders.leftOutEdges.get(crate.manifest_path) ?? []).flatMap(crateInputs)),
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
  const reached = reachedArtifactDirectories(discovery.workspaces);
  const sharers = artifactDirectorySharers(discovery.workspaces, reached);
  const artifactDirectories = locateArtifactDirectories(discovery, sharers);
  const directoryWarnings = unignoredDirectoryWarnings(discovery.workspaces, workspaceRoot);
  const withoutLockfileTask = await workspacesWithoutRootProject(discovery, nxJson);
  for (const workspace of discovery.workspaces) {
    const messages = [
      ...workspace.warnings,
      artifactDirectoryWarning(workspace, artifactDirectories, reached, sharers),
      tripleWarning(workspace, workspaceRoot),
      ...(directoryWarnings.get(workspace) ?? []),
      withoutLockfileTask.has(workspace.root) ? noLockfileTaskWarning(workspace) : undefined,
    ];
    for (const message of messages.filter((message) => message !== undefined)) {
      for (const manifest of workspaceManifests(workspace)) {
        warn(manifest, message);
      }
    }
  }
  const printed = new Set(discovery.warnings);
  for (const message of new Set([...warnings.values()].flat())) {
    if (!printed.has(message)) {
      console.warn(message);
    }
  }
  return {
    repositoryRoot: workspaceRoot,
    plugin,
    repositoryDefault: repositoryDefaultInputs(nxJson?.namedInputs),
    pathDependencyInputs,
    redirectedInputs,
    declaredFileProblems: folders.problems,
    pathPackageManifests: pathPackageManifests(discovery),
    artifactDirectories,
    warnings,
    withoutLockfileTask,
    sharedRecordNames: sharedRecordNames(discovery.workspaces, reached),
  };
}

// The inputs once each, in order: a declared fileset of a workspace's table
// comes with every crate of the workspace that the crate reaches.
function uniqueInputs(inputs: readonly Input[]): Input[] {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = JSON.stringify(input);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// The warning of `DES-LOCKFILE-HASHING` for a workspace without a lockfile
// task, whose crates' targets that would read a digest run uncached.
// @mara implements DES-DIAGNOSTICS
function noLockfileTaskWarning(workspace: CargoWorkspace): string {
  return [
    `nx-rust: Nx hands the root manifest ${workspace.rootManifest} of ${describeWorkspace(workspace)} to no entry of @convesoft/nx-rust, so the workspace has no project and no lockfile task, which keys its crates' cached targets on their locked dependencies.`,
    `The build, check, lint and test targets of its crates therefore run uncached; fmt-check stays cached.`,
    `To cache them, let Nx hand ${workspace.rootManifest} to the plugin: remove what keeps it out, such as the "include" or "exclude" of the plugin's entry in nx.json, .gitignore or .nxignore.`,
  ].join(" ");
}

/**
 * Why the plugin leaves a target uncached because its workspace has no
 * lockfile task (`DES-LOCKFILE-HASHING`): the targets that would read a
 * digest, the cached ones but `fmt-check`, where Nx hands the workspace's
 * root manifest to no entry of the plugin. `undefined` otherwise.
 */
// @mara implements DES-LOCKFILE-HASHING
function noLockfileTaskReason(
  name: InferredTargetName,
  subject: CacheSubject,
  context: CacheContext,
): string | undefined {
  return context.withoutLockfileTask?.has(subject.workspace.root) &&
    cachedTargets.has(name) &&
    name !== "fmt-check"
    ? `its Cargo workspace has no lockfile task, because Nx hands the workspace's root manifest ${subject.workspace.rootManifest} to no entry of the plugin, so the plugin cannot key the target on the crate's locked dependencies`
    : undefined;
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
  /** The name that `targetNames` gives the lockfile task, on which cached targets depend. */
  lockfileTarget?: string;
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
 * covers get their inputs, the lockfile task those of
 * `DES-WORKSPACE-TARGETS` and its digest folder as its output, and `audit`,
 * `deny` and `update` keep the inputs that `inferTargets` gave them, with
 * the plugin's input added, which every inferred target has.
 *
 * A target that stays cached, other than `fmt-check`, depends on the
 * lockfile task of its workspace, the project at the workspace's root
 * folder, and hashes the digests it writes; where the workspace has no
 * lockfile task, such a target is left uncached instead; its metadata names the members
 * whose digests those are, for the executor's check after cargo's call
 * (`DES-LOCKFILE-HASHING`). It is the one dependency of a crate's target on
 * another task (`REQ-NO-RUST-TASK-DEPS`).
 */
// @mara implements DES-INPUTS
// @mara implements DES-OUTPUTS
// @mara implements DES-LOCKFILE-HASHING
// @mara implements REQ-NO-RUST-TASK-DEPS
export function configureCaching(
  targets: Map<InferredTargetName, TargetConfiguration>,
  subject: CacheSubject,
  context: CacheContext,
  options: CacheOptions = { settings: defaultInputSettings },
): void {
  const { settings } = options;
  const artifacts = context.artifactDirectories.get(subject.workspace.root) ?? { inside: false };
  const triples: PickedTriples = subject.workspace.triples ?? { kind: "none" };
  const tripleProblem =
    triples.kind === "unnamed" ? unnamedTripleProblem(triples, context.repositoryRoot) : undefined;
  const place = { artifacts, tripleProblem };
  const workspaceRoot = workspaceFolder(subject, context);
  const members = workspaceMembers(subject);
  for (const [name, target] of targets) {
    const reason =
      target.cache === true
        ? (uncachedReason(
            name,
            place,
            alwaysNamesTriple([target, ...(options.targetTables?.(name) ?? [])]),
          ) ?? noLockfileTaskReason(name, subject, context))
        : (uncachedByDesign[name] ?? "the plugin does not cache this target");
    target.cache = reason === undefined;
    const metadata = target.metadata?.[targetCargoMetadataKey] as TargetCargoMetadata | undefined;
    if (metadata !== undefined && reason !== undefined) {
      metadata.uncached = reason;
    }
    if (metadata !== undefined && (name === "build" || name === "doc")) {
      if (triples.kind === "triples") {
        metadata.triples = triples.triples;
      }
      if (tripleProblem !== undefined) {
        metadata.tripleProblem = tripleProblem;
      }
      const configuredPick = pickText(subject.workspace.configuredTriples ?? { kind: "none" });
      if (configuredPick !== "none") {
        metadata.configuredPick = configuredPick;
      }
      if (artifacts.inside) {
        metadata.artifactDirectory = artifacts.path;
      }
      const variables = directoryVariables(process.env);
      if (Object.keys(variables).length > 0) {
        metadata.directoryVariables = variables;
      }
    }
    if (metadata !== undefined && name === "build" && subject.pkg !== undefined) {
      metadata.records = buildRecordSource(
        subject.pkg,
        context.sharedRecordNames?.get(subject.workspace.root) ?? [],
      );
    }
    const readsDigest = target.cache && cachedTargets.has(name) && name !== "fmt-check";
    if (readsDigest) {
      target.dependsOn = [lockfileDependency(workspaceRoot, options.lockfileTarget ?? "lockfile")];
      if (metadata !== undefined) {
        metadata.digests =
          name === "doc" || subject.pkg === undefined ? members : [packageVersion(subject.pkg)];
      }
    }
    const inputs =
      name === "lockfile"
        ? lockfileInputs(subject, context)
        : targetInputs(name, subject, context, settings, readsDigest);
    target.inputs = inputs ?? [...(target.inputs ?? []), pluginVersionInput(context.plugin)];
    if (target.cache && (name === "build" || name === "doc")) {
      target.inputs = [...target.inputs, { runtime: artifactFoldersCommand(workspaceRoot) }];
    }
    if (name === "lockfile") {
      target.outputs = [`{workspaceRoot}/${digestFolder(workspaceRoot)}`];
      if (metadata !== undefined) {
        metadata.members = members;
      }
    } else {
      target.outputs = targetOutputs(name, subject.pkg, artifacts, target.cache, triples);
    }
    if (context.plugin.kind === "option") {
      target.options = { ...target.options, pluginVersion: context.plugin.version };
    }
  }
}

/** The workspace's root folder relative to the repository root, `.` for the root itself. */
function workspaceFolder(subject: CacheSubject, context: CacheContext): string {
  return relative(context.repositoryRoot, subject.workspace.report.workspace_root) || ".";
}

/** The members of the project's workspace, those without a project included, by package name. */
function workspaceMembers(subject: CacheSubject): PackageVersion[] {
  const ids = new Set(subject.workspace.report.workspace_members);
  return subject.workspace.report.packages
    .filter((pkg) => ids.has(pkg.id))
    .map(packageVersion)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function packageVersion(pkg: CargoPackage): PackageVersion {
  return { name: pkg.name, version: pkg.version };
}

/**
 * The manifests inside the repository of the path packages that each
 * workspace's members reach, by the workspace's root folder relative to the
 * repository root, as `{workspaceRoot}` paths ({@link CacheContext}): the
 * crates of path dependencies, with a project or without, directly or
 * through other path packages, and the crates of the workspace's `[patch]`
 * and `[replace]` entries with those behind them. A crate without a report
 * counts with its manifest alone. A `paths` override leaves no trace in the
 * lockfile and is not read. A path names the crate at the real path of its
 * folder, and its manifest is named there, also where the path passes a
 * symbolic link.
 */
function pathPackageManifests(discovery: CargoDiscovery): Map<string, string[]> {
  const folderOf = (manifest: string) => realPath(dirname(manifest));
  const known = new Map<string, CargoPackage>();
  for (const report of [
    ...discovery.workspaces.map((workspace) => workspace.report),
    ...discovery.pathDependencyReports.map((entry) => entry.report),
  ]) {
    for (const pkg of report.packages) {
      if (!known.has(folderOf(pkg.manifest_path))) {
        known.set(folderOf(pkg.manifest_path), pkg);
      }
    }
  }
  const repositoryRoot = realPath(discovery.workspaceRoot);
  const result = new Map<string, string[]>();
  for (const workspace of discovery.workspaces) {
    const ids = new Set(workspace.report.workspace_members);
    // Real folders of crates.
    const visited = new Set<string>();
    const queue: string[] = [
      ...workspace.report.packages
        .filter((pkg) => ids.has(pkg.id))
        .map((pkg) => folderOf(pkg.manifest_path)),
      ...workspace.redirections
        .filter((redirection) => redirection.table !== "paths")
        .map((redirection) => realPath(redirection.folder)),
    ];
    while (queue.length > 0) {
      const folder = queue.shift() as string;
      if (visited.has(folder)) {
        continue;
      }
      visited.add(folder);
      for (const dependency of known.get(folder)?.dependencies ?? []) {
        if (typeof dependency.path === "string") {
          queue.push(realPath(dependency.path));
        }
      }
    }
    const root = relative(discovery.workspaceRoot, workspace.report.workspace_root) || ".";
    result.set(
      root,
      [...visited]
        .map((folder) => relative(repositoryRoot, join(folder, "Cargo.toml")))
        .filter((path) => path !== "" && !path.startsWith("..") && !isAbsolute(path))
        .map((path) => `{workspaceRoot}/${path}`)
        .sort(),
    );
  }
  return result;
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

// The warning of `DES-OUTPUTS` for a workspace whose Cargo configuration or
// graph environment picks a triple whose folder the plugin cannot name,
// which leaves `build` and `doc` uncached unless their options name a
// triple.
// @mara implements DES-DIAGNOSTICS
function tripleWarning(workspace: CargoWorkspace, repositoryRoot: string): string | undefined {
  const triples = workspace.triples ?? { kind: "none" };
  if (triples.kind !== "unnamed") {
    return undefined;
  }
  return [
    `nx-rust: ${unnamedTripleProblem(triples, repositoryRoot)}.`,
    `The build and doc targets of ${describeWorkspace(workspace)} run uncached where their options name no triple, and its other targets stay cached.`,
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

// The folder that each workspace's artifact directory is, as the system
// reaches it through the path that cargo reports ({@link physicalPath}).
// Cargo reports the directory as the configuration or `CARGO_TARGET_DIR`
// spells it, `..`, symbolic links and a trailing separator included, and
// writes to the folder that the system reaches; where a link comes before a
// `..`, that is not the folder that the path names as text (`DES-OUTPUTS`).
// @mara implements DES-OUTPUTS
function reachedArtifactDirectories(
  workspaces: readonly CargoWorkspace[],
): Map<CargoWorkspace, string> {
  return new Map(
    workspaces.map((workspace) => [workspace, physicalPath(workspace.report.target_directory)]),
  );
}

// The workspaces with which each workspace shares its artifact directory.
// Two reports name one folder where their paths agree with `.` and `..`
// taken as text, or with symbolic links followed (`reached`); either
// counts, because two folders taken for one only leave `doc` uncached,
// while one folder taken for two lets a restored `doc` folder delete the
// pages of the other workspace (`DES-OUTPUTS`).
// @mara implements DES-OUTPUTS
function artifactDirectorySharers(
  workspaces: readonly CargoWorkspace[],
  reached: ReadonlyMap<CargoWorkspace, string>,
): Map<CargoWorkspace, CargoWorkspace[]> {
  const spellings = new Map<CargoWorkspace, string[]>();
  for (const workspace of workspaces) {
    const directory = workspace.report.target_directory;
    spellings.set(workspace, [resolve(directory), reached.get(workspace) ?? resolve(directory)]);
  }
  const sharers = new Map<CargoWorkspace, CargoWorkspace[]>();
  for (const workspace of workspaces) {
    const own = spellings.get(workspace) ?? [];
    sharers.set(
      workspace,
      workspaces.filter(
        (other) =>
          other !== workspace && (spellings.get(other) ?? []).some((path) => own.includes(path)),
      ),
    );
  }
  return sharers;
}

// Where each workspace's artifact directory lies, by the workspace's root
// folder: outside the repository, or inside it and shared with another
// workspace or not. The folder that the system reaches decides, relative to
// the repository's real path, and is the path that the outputs name
// ({@link repositoryFolder}, which the executor uses as well).
function locateArtifactDirectories(
  discovery: CargoDiscovery,
  sharers: ReadonlyMap<CargoWorkspace, readonly CargoWorkspace[]>,
): Map<string, ArtifactDirectory> {
  const located = new Map<string, ArtifactDirectory>();
  for (const workspace of discovery.workspaces) {
    const folder = repositoryFolder(workspace.report.target_directory, discovery.workspaceRoot);
    located.set(
      workspace.root,
      folder.inside
        ? { inside: true, path: folder.path, shared: (sharers.get(workspace) ?? []).length > 0 }
        : { inside: false },
    );
  }
  return located;
}

// The warning of `DES-OUTPUTS` for a workspace whose artifact directory lies
// outside the repository or is shared with another workspace.
// @mara implements DES-DIAGNOSTICS
function artifactDirectoryWarning(
  workspace: CargoWorkspace,
  located: ReadonlyMap<string, ArtifactDirectory>,
  reached: ReadonlyMap<CargoWorkspace, string>,
  sharers: ReadonlyMap<CargoWorkspace, readonly CargoWorkspace[]>,
): string | undefined {
  const artifacts = located.get(workspace.root);
  const directory = reached.get(workspace) ?? workspace.report.target_directory;
  const where = describeWorkspace(workspace);
  if (artifacts === undefined || !artifacts.inside) {
    return [
      `nx-rust: Cargo's artifact directory of ${where} is ${directory}, outside the repository, where Nx cannot store files.`,
      `Its build and doc targets run uncached, and its other targets stay cached.`,
      `To cache them, set build.target-dir in a .cargo/config.toml of the workspace to a folder inside the repository, or unset CARGO_TARGET_DIR.`,
    ].join(" ");
  }
  if (artifacts.shared) {
    const others = (sharers.get(workspace) ?? []).map(describeWorkspace);
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
