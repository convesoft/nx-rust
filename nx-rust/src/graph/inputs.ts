import type { TargetConfiguration } from "@nx/devkit";
import { posix, relative } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import type { CargoWorkspace } from "./discovery";
import { digestFile, digestFolder, runIdVariable } from "./lockfile-task";
import type { InferredTargetName } from "./targets";

/**
 * The name of the crate's own named input: the files that decide what the
 * crate is when another crate builds it, the folders of the crates without a
 * project that it reaches, what the repository adds to its key, and the
 * repository's own `default` apart from its patterns under the project's
 * folder (`DES-INPUTS`). Dependents hash it through `^default`.
 *
 * It is `default` because a `^` input fails the hash of a task when a project
 * that the task's project depends on has no named input of that name
 * (`EVD-NX-24-INPUTS-OUTPUTS`), and a crate can depend on a project of another
 * plugin, such as a JS project. Every project has a `default`: Nx's own,
 * `{projectRoot}/**\/*`, or the one in `nx.json`.
 */
export const crateInputName = "default";

/** An input as a target or a named input lists it. */
export type Input = NonNullable<TargetConfiguration["inputs"]>[number];

/** An input that is not a named input or a file pattern written as a string. */
export type InputDefinition = Exclude<Input, string>;

/** The feature-unification strategies of `DES-UNIFICATION`. */
export type FeatureUnification = "hakari" | "cargo" | "workspace-build";

/** The test runners of `DES-TEST-RUN`. */
export type TestRunner = "cargo" | "nextest";

/**
 * The settings of `DES-PLUGIN-OPTIONS` that change a crate's inputs. Reading
 * them from the plugin options and the metadata tables is nxr-xyq7c8, and the
 * `hakari` default where a workspace has a cargo-hakari configuration is
 * nxr-k64tm5.
 */
export interface InputSettings {
  /**
   * The workspace's strategy. Until the settings are read, every workspace
   * counts as `workspace-build`, whose inputs include those of `hakari`.
   */
  featureUnification: FeatureUnification;
  /** The workspace's test runner. */
  testRunner: TestRunner;
  /**
   * What the repository adds to the crate's key with `envInputs`,
   * `runtimeInputs` and `fileInputs`, at every level that sets them
   * (`DES-PLUGIN-OPTIONS`, "Added inputs"). They go into the crate's own
   * named input, so that its dependents hash them too.
   */
  added: AddedInputs;
}

/** What the repository adds to a crate's key. */
export interface AddedInputs {
  /** Names of environment variables. */
  envInputs: readonly string[];
  /** Commands whose output joins the key. */
  runtimeInputs: readonly string[];
  /**
   * Filesets for the patterns of `fileInputs`, already resolved against the
   * folder of the manifest that holds them, with `includeIgnored`
   * (`declaredFiles` in `declared-files.ts`).
   */
  fileInputs: readonly InputDefinition[];
}

/** The settings of a workspace that sets none of them. */
export const defaultInputSettings: InputSettings = {
  featureUnification: "workspace-build",
  testRunner: "cargo",
  added: { envInputs: [], runtimeInputs: [], fileInputs: [] },
};

/**
 * How the plugin's own version reaches the key (`DES-INPUTS`, "Plugin"):
 * through the npm node that Nx has for its package, or through the target
 * option `pluginVersion`.
 */
export type PluginInput =
  | { kind: "node"; packageName: string }
  | { kind: "option"; version: string };

/** What the inputs of a project's targets need to know about the project. */
export interface InputSubject {
  /** The project's folder, relative to the repository root: `.` for the root itself. */
  root: string;
  /** The workspace the project belongs to. */
  workspace: CargoWorkspace;
  /** The crate; absent for a workspace project without a crate. */
  pkg?: CargoPackage;
  /** Whether the project hosts the workspace's own targets. */
  isWorkspaceProject: boolean;
}

/** What the inputs of every project share. */
export interface InputContext {
  /** The absolute path of the repository root. */
  repositoryRoot: string;
  /** How the plugin's version reaches the keys. */
  plugin: PluginInput;
  /**
   * The entries of the repository's `default` named input that the crate's
   * own keeps ({@link repositoryDefaultInputs}).
   */
  repositoryDefault: readonly Input[];
  /**
   * The inputs for the crates without a project that each crate reaches, by
   * the crate's manifest path: each one's folder and the root manifest of its
   * workspace (`findCrateFolders` in `path-dependencies.ts`).
   */
  pathDependencyInputs: ReadonlyMap<string, readonly Input[]>;
  /**
   * The inputs for the redirected crates with a project that each crate may
   * use but has no edge to, by the crate's manifest path: each one's folder
   * and the root manifest of its workspace.
   */
  redirectedInputs: ReadonlyMap<string, readonly Input[]>;
  /**
   * The manifests inside the repository of the path packages that each
   * workspace's members reach, by the workspace's root folder relative to
   * the repository root, as `{workspaceRoot}` paths: the crates of path
   * dependencies, with a project or without, and those of the workspace's
   * `[patch]` and `[replace]` entries, with the path packages behind them.
   * The lockfile task reads them as inputs (`DES-WORKSPACE-TARGETS`).
   */
  pathPackageManifests?: ReadonlyMap<string, readonly string[]>;
}

/**
 * The environment variables of `DES-INPUTS` that every cached target hashes,
 * apart from those for a triple and those for some targets only.
 */
export const environmentVariables = [
  "RUSTFLAGS",
  "CARGO_ENCODED_RUSTFLAGS",
  "RUSTDOCFLAGS",
  "CARGO_ENCODED_RUSTDOCFLAGS",
  "RUSTC",
  "RUSTC_WRAPPER",
  "RUSTC_WORKSPACE_WRAPPER",
  "RUSTDOC",
  "RUSTC_BOOTSTRAP",
  "CARGO_BUILD_TARGET",
  "CARGO_BUILD_RUSTFLAGS",
  "CARGO_BUILD_RUSTDOCFLAGS",
  "CARGO_BUILD_RUSTC",
  "CARGO_BUILD_RUSTC_WRAPPER",
  "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
  "CARGO_BUILD_RUSTDOC",
  "CC",
  "CXX",
  "AR",
  "CFLAGS",
  "CXXFLAGS",
  "PKG_CONFIG_PATH",
  "MACOSX_DEPLOYMENT_TARGET",
  "OPENSSL_DIR",
  "OPENSSL_LIB_DIR",
  "OPENSSL_INCLUDE_DIR",
  "OPENSSL_STATIC",
  "OPENSSL_NO_VENDOR",
] as const;

/** The targets that compile, which hash `CARGO_BUILD_WARNINGS` (`DES-INPUTS`). */
const compilingTargets: ReadonlySet<InferredTargetName> = new Set([
  "build",
  "check",
  "lint",
  "test",
  "bench",
  "run",
  "doc",
]);

/**
 * The targets that get the inputs of `DES-INPUTS`: the cached targets of
 * `DES-TARGETS`, and `fmt`, `bench` and `run`, which are not cached but
 * whose inputs make `nx affected` select them.
 */
export const crateInputTargets: ReadonlySet<InferredTargetName> = new Set([
  "build",
  "check",
  "lint",
  "test",
  "fmt-check",
  "fmt",
  "bench",
  "run",
  "doc",
]);

/**
 * The files of the toolchain and of Cargo's configuration that apply in a
 * folder and below it. Cargo reads `.cargo/config`, the older name, where it
 * exists, in place of `.cargo/config.toml`.
 */
const workspaceFileNames = [
  "rust-toolchain.toml",
  "rust-toolchain",
  ".cargo/config.toml",
  ".cargo/config",
];

/** The configuration files of the tool that a target runs, looked up from the crate up to the root. */
const toolFileNames: Partial<Record<InferredTargetName, readonly string[]>> = {
  lint: ["clippy.toml", ".clippy.toml"],
  "fmt-check": ["rustfmt.toml", ".rustfmt.toml"],
  fmt: ["rustfmt.toml", ".rustfmt.toml"],
};

/**
 * The project's named inputs: {@link crateInputName}, which its targets and
 * those of its dependents hash.
 *
 * It holds every file of the project's folder that belongs to no nested
 * project, except the workspace's `Cargo.lock` where the folder is the
 * workspace root, which reaches the keys of the crate and of those that
 * depend on it only through the digests of the lockfile task
 * ({@link externalDependencyInputs}); the root manifest of the crate's
 * workspace, whose fields the crate can inherit, also when another
 * workspace builds it (`EVD-CARGO-DEPENDENCY-SIDE`); the folder and
 * workspace manifest of every crate without a project that the crate
 * reaches; what the repository adds; and the repository's own `default`
 * without its patterns under the project's folder. A pattern that the
 * repository negates in a target's own `inputs` takes files out of it, on
 * the repository's responsibility.
 */
// @mara implements DES-INPUTS
// @mara implements REQ-INPUT-FILES
export function namedInputs(
  subject: InputSubject,
  context: InputContext,
  settings: InputSettings = defaultInputSettings,
): Record<string, Input[]> {
  const crateFiles: Input[] = ["{projectRoot}/**/*"];
  if (subject.isWorkspaceProject) {
    crateFiles.push("!{projectRoot}/Cargo.lock");
  }
  const workspaceRoot = workspaceFolder(subject, context);
  if (workspaceRoot !== subject.root) {
    crateFiles.push(fromRoot(workspaceRoot, "Cargo.toml"));
  }
  const pathDependencies = subject.pkg
    ? (context.pathDependencyInputs.get(subject.pkg.manifest_path) ?? [])
    : [];
  return {
    [crateInputName]: [
      ...crateFiles,
      ...pathDependencies,
      ...settings.added.fileInputs,
      ...settings.added.envInputs.map((env) => ({ env })),
      ...settings.added.runtimeInputs.map((runtime) => ({ runtime })),
      ...context.repositoryDefault,
    ],
  };
}

/**
 * The entries of the repository's `default` named input, from `nx.json`,
 * that a crate's own `default` keeps: every entry but a file set under
 * `{projectRoot}`, negated or not, and a reference to `default` itself.
 * Named inputs such as `sharedGlobals`, `env`, `runtime` and
 * `externalDependencies` entries and file sets under `{workspaceRoot}` thus
 * still reach a crate's key, while what the crate hashes of its own folder
 * is the plugin's to say (`DES-INPUTS`). Nx's own `default`, where `nx.json`
 * has none, holds nothing else.
 */
// @mara implements DES-INPUTS
export function repositoryDefaultInputs(namedInputs: unknown): Input[] {
  const entries = (namedInputs as Record<string, unknown> | undefined)?.[crateInputName];
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.filter((entry): entry is Input => {
    if (typeof entry === "string") {
      return entry !== crateInputName && !/^!?\{projectRoot\}/.test(entry);
    }
    if (typeof entry !== "object" || entry === null) {
      return false;
    }
    const fileset = (entry as { fileset?: unknown }).fileset;
    return typeof fileset !== "string" || !/^!?\{projectRoot\}/.test(fileset);
  });
}

/**
 * The inputs of one of the project's targets, in the order of the table in
 * `DES-INPUTS`: the crate's files and those of its dependencies, the
 * workspace files, the redirected crates that the crate may use without an
 * edge, the members' manifests, the tool's configuration, the external
 * dependencies, the environment, the toolchain with Cargo's profile and
 * target variables, and the plugin.
 *
 * @param readsDigest Whether the target depends on the workspace's lockfile
 *   task and hashes digests of it: a cached target other than `fmt-check`
 *   (`DES-LOCKFILE-HASHING`).
 * @returns `undefined` for a target that `DES-INPUTS` gives no such inputs:
 *   `lockfile`, `audit`, `deny` and `update` keep theirs from
 *   `DES-WORKSPACE-TARGETS`.
 */
// @mara implements DES-INPUTS
// @mara implements REQ-INPUT-FILES
// @mara implements REQ-ENV-ALLOWLIST
// @mara implements REQ-TOOLCHAIN-KEY
export function targetInputs(
  target: InferredTargetName,
  subject: InputSubject,
  context: InputContext,
  settings: InputSettings = defaultInputSettings,
  readsDigest = false,
): Input[] | undefined {
  if (!crateInputTargets.has(target)) {
    return undefined;
  }
  const workspaceRoot = workspaceFolder(subject, context);
  return [
    crateInputName,
    `^${crateInputName}`,
    ...workspaceFiles(subject, context.repositoryRoot),
    ...(subject.pkg === undefined
      ? []
      : (context.redirectedInputs.get(subject.pkg.manifest_path) ?? [])),
    ...(settings.featureUnification === "hakari" ? [] : memberManifestInputs(subject, context)),
    ...toolConfigurationInputs(target, subject, workspaceRoot, settings),
    ...(target === "fmt" || target === "fmt-check"
      ? []
      : externalDependencyInputs(target, subject, workspaceRoot, readsDigest)),
    ...environmentInputs(target),
    { runtime: toolchainCommand(workspaceRoot) },
    pluginVersionInput(context.plugin),
  ];
}

/**
 * The files of the context that cargo runs in: each `rust-toolchain.toml`,
 * `rust-toolchain`, `.cargo/config.toml` and `.cargo/config` in the folders
 * above the project's, up to the repository root. Those in the project's own
 * folder are among its files, and the workspace's root manifest is in its
 * named input. The files that a configuration's `include` adds count too.
 * Each is named by its path, whether or not it exists, so that
 * adding one changes the key. They stay out of the named input: cargo takes
 * them from the folder it starts in, not from a dependency's
 * (`EVD-CARGO-DEPENDENCY-SIDE`).
 *
 * @param own Whether the files in the project's own folder count too.
 */
function workspaceFiles(subject: InputSubject, repositoryRoot: string, own = false): string[] {
  const files: string[] = [];
  // The files that a configuration's `include` adds, inside the repository.
  for (const included of subject.workspace.configIncludes ?? []) {
    const path = repositoryPath(repositoryRoot, included);
    if (path !== undefined && path !== "") {
      files.push(`{workspaceRoot}/${path}`);
    }
  }
  for (const folder of [...(own ? [subject.root] : []), ...foldersAbove(subject.root)]) {
    files.push(...workspaceFileNames.map((name) => fromRoot(folder, name)));
  }
  return files;
}

/**
 * The manifests of the workspace's other members inside the repository,
 * which the `cargo` and `workspace-build` strategies make inputs of every
 * member (`DES-INPUTS`, "Member manifests").
 */
function memberManifestInputs(subject: InputSubject, context: InputContext): string[] {
  const own = subject.pkg?.manifest_path;
  return memberManifests(subject.workspace, context.repositoryRoot, own);
}

/**
 * The manifests of the workspace's members as `{workspaceRoot}` paths, those
 * inside the repository only, because Nx hashes no file outside it; sorted,
 * and without `except`.
 */
export function memberManifests(
  workspace: CargoWorkspace,
  repositoryRoot: string,
  except?: string,
): string[] {
  const members = new Set(workspace.report.workspace_members);
  return workspace.report.packages
    .filter((pkg) => members.has(pkg.id) && pkg.manifest_path !== except)
    .map((pkg) => repositoryPath(repositoryRoot, pkg.manifest_path))
    .filter((path): path is string => path !== undefined && path !== "")
    .sort()
    .map((path) => `{workspaceRoot}/${path}`);
}

/**
 * The configuration of the tool the target runs: clippy's for `lint`,
 * rustfmt's for `fmt-check` and `fmt`, in each folder above the crate's, and
 * the workspace's `.config/nextest.toml` for a `test` that nextest runs.
 */
function toolConfigurationInputs(
  target: InferredTargetName,
  subject: InputSubject,
  workspaceRoot: string,
  settings: InputSettings,
): string[] {
  if (target === "test") {
    return settings.testRunner === "nextest" && workspaceRoot !== subject.root
      ? [fromRoot(workspaceRoot, ".config/nextest.toml")]
      : [];
  }
  const names = toolFileNames[target] ?? [];
  return foldersAbove(subject.root).flatMap((folder) =>
    names.map((name) => fromRoot(folder, name)),
  );
}

/**
 * The external dependencies of the crate (`DES-INPUTS`, "External
 * dependencies"). A target that depends on the workspace's lockfile task
 * hashes the crate's digest among that task's outputs, and on `doc` the
 * digests of every member, through a `dependentTasksOutputFiles` input,
 * with an `env` input for `NX_RUST_RUN_ID`, which a run that excludes task
 * dependencies sets to a new value (`DES-LOCKFILE-HASHING`). It has no
 * `Cargo.lock` as a file input: Nx hashes such an input before the run
 * starts, before the lockfile task can update the file
 * (`EVD-NX-24-LOCKFILE-UPDATE`).
 *
 * A target that is not cached, `bench` and `run`, or `build` and `doc`
 * where the plugin leaves them uncached, does not depend on the lockfile
 * task. Its inputs only decide what `nx affected` selects, so it names the
 * workspace's `Cargo.lock`, read also where Git ignores it, as `audit` and
 * `update` do (`DES-INPUTS`, "Uncached targets").
 *
 * `fmt` and `fmt-check` have neither: `cargo fmt` reads no lockfile.
 */
// @mara implements DES-LOCKFILE-HASHING
// @mara implements REQ-EXTERNAL-DEPS
export function externalDependencyInputs(
  target: InferredTargetName,
  subject: InputSubject,
  workspaceRoot: string,
  readsDigest: boolean,
): InputDefinition[] {
  if (!readsDigest) {
    return [{ fileset: fromRoot(workspaceRoot, "Cargo.lock"), includeIgnored: true }];
  }
  const digests =
    target === "doc" || subject.pkg === undefined
      ? `${digestFolder(workspaceRoot)}/*.digest`
      : digestFile(workspaceRoot, subject.pkg.name);
  return [{ dependentTasksOutputFiles: digests }, { env: runIdVariable }];
}

/**
 * The inputs of the lockfile task (`DES-WORKSPACE-TARGETS`), which only
 * decide what `nx affected` selects, since the task is not cached: the
 * workspace's `Cargo.lock`, read also where Git ignores it, its root
 * manifest, the manifests of its members and of the path packages they
 * reach inside the repository, the workspace files that apply in the
 * workspace root, where the task's cargo runs, and the plugin's input
 * ({@link pluginVersionInput}). The files are named from the repository
 * root, because a pattern under the workspace project's root misses the
 * files of the crate projects nested in it (`EVD-NX-24-LOCKFILE-UPDATE`).
 */
// @mara implements DES-WORKSPACE-TARGETS
// @mara implements DES-LOCKFILE-HASHING
export function lockfileInputs(subject: InputSubject, context: InputContext): Input[] {
  const workspaceRoot = workspaceFolder(subject, context);
  const manifests = new Set([
    ...memberManifests(subject.workspace, context.repositoryRoot),
    ...(context.pathPackageManifests?.get(workspaceRoot) ?? []),
  ]);
  manifests.delete(fromRoot(workspaceRoot, "Cargo.toml"));
  return [
    { fileset: fromRoot(workspaceRoot, "Cargo.lock"), includeIgnored: true },
    fromRoot(workspaceRoot, "Cargo.toml"),
    ...[...manifests].sort(),
    ...workspaceFiles({ ...subject, root: workspaceRoot }, context.repositoryRoot, true),
    pluginVersionInput(context.plugin),
  ];
}

/**
 * One `env` input per variable of `DES-INPUTS` that applies to the target:
 * the fixed list, `CARGO_BUILD_WARNINGS` on the targets that compile, and
 * `CLIPPY_CONF_DIR` on `lint`. The variables whose names start with
 * `CARGO_PROFILE_` or `CARGO_TARGET_` are in the toolchain command instead
 * ({@link toolchainCommand}).
 */
export function environmentInputs(target: InferredTargetName): InputDefinition[] {
  const names: string[] = [...environmentVariables];
  if (compilingTargets.has(target)) {
    names.push("CARGO_BUILD_WARNINGS");
  }
  if (target === "lint") {
    names.push("CLIPPY_CONF_DIR");
  }
  return names.map((env) => ({ env }));
}

/**
 * The command of the toolchain input, one process per task's key: first
 * `rustc -Vv` in the workspace root, where the plugin's cargo commands run,
 * as cargo will resolve it there with the task's environment (`DES-INPUTS`,
 * `REQ-TOOLCHAIN-KEY`); then every variable of the task's environment whose
 * name starts with `CARGO_PROFILE_` or `CARGO_TARGET_`, with its value,
 * sorted, apart from `CARGO_TARGET_DIR`, which says where the artifacts go
 * and not what they are (`REQ-ENV-ALLOWLIST`). Those two families are open
 * ended, with a profile's or a triple's name in each variable, so no list of
 * `env` inputs can name them. Nx runs the command through `sh -c` in the
 * repository root, with the task's dotenv files loaded
 * (`EVD-NX-24-INPUT-SEMANTICS`).
 *
 * rustup may not install a toolchain for it (`ADR-GRAPH-NO-TOOLCHAIN-INSTALL`).
 * When `rustc -Vv` fails, as for a pinned toolchain that is not installed,
 * or the folder is missing, the command prints a random value in its place,
 * new at each evaluation, so that no result stored under the key is ever
 * restored and the task runs as plain cargo would
 * (`EVD-RUSTUP-MISSING-TOOLCHAIN`). The command always ends with status 0;
 * Nx keys a task on what a runtime input prints whatever its status.
 *
 * @param workspaceRoot The workspace's root folder, relative to the repository root.
 */
// @mara implements REQ-TOOLCHAIN-KEY
// @mara implements REQ-ENV-ALLOWLIST
export function toolchainCommand(workspaceRoot: string): string {
  const folder = workspaceRoot === "." ? "." : `./${workspaceRoot}`;
  return [
    `{ cd ${shellQuote(folder)} && RUSTUP_AUTO_INSTALL=0 rustc -Vv 2>/dev/null || od -An -N16 -tx1 /dev/urandom; }`,
    `env | grep -E '^CARGO_(PROFILE|TARGET)_' | grep -v '^CARGO_TARGET_DIR=' | LC_ALL=C sort`,
    "true",
  ].join("; ");
}

/**
 * The input that carries the plugin's own version into the key
 * (`DES-INPUTS`, "Plugin"): the plugin's package, where Nx has an npm node
 * for it, and no external node otherwise. Every inferred target has it. On
 * an uncached target it only decides what `nx affected` selects: an upgrade
 * of the plugin selects the target, and a change to the JS lockfile outside
 * the plugin's package does not, as it would without an
 * `externalDependencies` input (`EVD-NX-24-EXTERNAL-NODES`).
 */
export function pluginVersionInput(plugin: PluginInput): InputDefinition {
  return { externalDependencies: plugin.kind === "node" ? [plugin.packageName] : [] };
}

/** The workspace's root folder relative to the repository root, `.` for the root itself. */
function workspaceFolder(subject: InputSubject, context: InputContext): string {
  return repositoryPath(context.repositoryRoot, subject.workspace.report.workspace_root) || ".";
}

/** The folders above `folder`, from its parent up to the repository root `.`; none for the root. */
function foldersAbove(folder: string): string[] {
  const folders: string[] = [];
  let current = folder;
  while (current !== ".") {
    current = posix.dirname(current);
    folders.push(current);
  }
  return folders;
}

/** `{workspaceRoot}/<folder>/<file>`, without a `.` segment. */
function fromRoot(folder: string, file: string): string {
  return folder === "." ? `{workspaceRoot}/${file}` : `{workspaceRoot}/${folder}/${file}`;
}

/** The path relative to the repository root, or `undefined` outside it. */
function repositoryPath(repositoryRoot: string, path: string): string | undefined {
  const inside = relative(repositoryRoot, path);
  return inside === ".." || inside.startsWith("../") || posix.isAbsolute(inside)
    ? undefined
    : inside;
}

function shellQuote(value: string): string {
  return `'${value.split("'").join(`'"'"'`)}'`;
}
