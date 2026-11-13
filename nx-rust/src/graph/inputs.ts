import type { TargetConfiguration } from "@nx/devkit";
import { posix, relative } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import type { CargoWorkspace } from "./discovery";
import type { InferredTargetName } from "./targets";

/**
 * The name of the crate's own named input: its files, the folders of the
 * path dependencies without a project that it reaches, and what the
 * repository adds to its key (`DES-INPUTS`). Dependents hash it through
 * `^default`.
 *
 * It is `default` because a `^` input fails the hash of a task when a project
 * that the task's project depends on has no named input of that name
 * (`EVD-NX-24-NAMED-INPUTS`), and a crate can depend on a project of another
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
   * (nxr-d371vy).
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
  /** The host's target triples, whose `CARGO_TARGET_<TRIPLE>_*` variables count ({@link hostTriples}). */
  hostTriples: readonly string[];
  /**
   * The folders of the path dependencies without a project that each crate
   * reaches, by the crate's manifest path, relative to the repository root
   * and inside it (`findPathDependencies` in `path-dependencies.ts`).
   */
  pathDependencyFolders: ReadonlyMap<string, readonly string[]>;
  /**
   * The folders of the redirected crates with a project that each crate may
   * use but has no edge to, by the crate's manifest path, relative to the
   * repository root (`findCrateFolders` in `path-dependencies.ts`).
   */
  redirectedFolders: ReadonlyMap<string, readonly string[]>;
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
  "RUSTC_BOOTSTRAP",
  "CARGO_BUILD_TARGET",
  "CARGO_BUILD_RUSTFLAGS",
  "CARGO_BUILD_RUSTDOCFLAGS",
  "CARGO_BUILD_RUSTC",
  "CARGO_BUILD_RUSTC_WRAPPER",
  "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
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

/** The settings of Cargo's `[target.<triple>]` table whose variables count, for each triple. */
const tripleSettings = ["LINKER", "RUSTFLAGS", "RUNNER"] as const;

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

/** The files of the toolchain and of Cargo's configuration that apply in a folder and below it. */
const workspaceFileNames = ["rust-toolchain.toml", "rust-toolchain", ".cargo/config.toml"];

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
 * workspace root, which reaches the keys of the workspace's own targets
 * only ({@link externalDependencyInputs}); the folder of every path
 * dependency without a project that the crate reaches; and what the
 * repository adds. A pattern that the repository negates in a target's own
 * `inputs` takes files out of it, on the repository's responsibility.
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
  const pathDependencies = subject.pkg
    ? (context.pathDependencyFolders.get(subject.pkg.manifest_path) ?? [])
    : [];
  return {
    [crateInputName]: [
      ...crateFiles,
      ...pathDependencies.map((folder) => `{workspaceRoot}/${folder}/**/*`),
      ...settings.added.fileInputs,
      ...settings.added.envInputs.map((env) => ({ env })),
      ...settings.added.runtimeInputs.map((runtime) => ({ runtime })),
    ],
  };
}

/**
 * The inputs of one of the project's targets, in the order of the table in
 * `DES-INPUTS`: the crate's files and those of its dependencies, the
 * workspace files, the folders of the redirected crates that the crate may
 * use without an edge, the members' manifests, the tool's configuration,
 * the lockfile, the environment, the toolchain and the plugin.
 *
 * @param triples The target triples that the target's options and
 *   configurations name, whose `CARGO_TARGET_<TRIPLE>_*` variables count
 *   beside the host's.
 * @returns `undefined` for a target that `DES-INPUTS` gives no such inputs:
 *   `audit`, `deny` and `update` keep theirs from `DES-WORKSPACE-TARGETS`.
 */
// @mara implements DES-INPUTS
// @mara implements REQ-INPUT-FILES
// @mara implements REQ-ENV-ALLOWLIST
// @mara implements REQ-TOOLCHAIN-KEY
export function targetInputs(
  target: InferredTargetName,
  subject: InputSubject,
  context: InputContext,
  triples: readonly string[] = [],
  settings: InputSettings = defaultInputSettings,
): Input[] | undefined {
  if (!crateInputTargets.has(target)) {
    return undefined;
  }
  const workspaceRoot = workspaceFolder(subject, context);
  return [
    crateInputName,
    `^${crateInputName}`,
    ...workspaceFiles(subject, workspaceRoot),
    ...(subject.pkg === undefined
      ? []
      : (context.redirectedFolders.get(subject.pkg.manifest_path) ?? []).map((folder) =>
          fromRoot(folder, "**/*"),
        )),
    ...(settings.featureUnification === "hakari" ? [] : memberManifestInputs(subject, context)),
    ...toolConfigurationInputs(target, subject, workspaceRoot, settings),
    ...(target === "fmt" || target === "fmt-check"
      ? []
      : externalDependencyInputs(subject, workspaceRoot)),
    ...environmentInputs(target, [...context.hostTriples, ...triples]),
    { runtime: toolchainCommand(workspaceRoot) },
    pluginInput(context.plugin),
  ];
}

/**
 * The files that apply to every crate of the workspace: the root
 * `Cargo.toml`, and each `rust-toolchain.toml`, `rust-toolchain` and
 * `.cargo/config.toml` in the folders above the project's, up to the
 * repository root. Those in the project's own folder are among its files.
 * Each is named by its path, whether or not it exists, so that adding one
 * changes the key.
 */
function workspaceFiles(subject: InputSubject, workspaceRoot: string): string[] {
  const files: string[] = [];
  if (workspaceRoot !== subject.root) {
    files.push(fromRoot(workspaceRoot, "Cargo.toml"));
  }
  for (const folder of foldersAbove(subject.root)) {
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
 * The external dependencies of the crate. For now the workspace's whole
 * `Cargo.lock`, read also where Git ignores it: a change to it changes the
 * keys of every crate of the workspace, also where it leaves a crate's
 * resolved dependencies alone, and a lockfile that cargo would still change
 * is not handled. nxr-xq9ava replaces this input with the crate's digest
 * from the workspace's lockfile task (`DES-LOCKFILE-HASHING`).
 *
 * `fmt` and `fmt-check` do not have it: `cargo fmt` reads no lockfile.
 */
export function externalDependencyInputs(
  _subject: InputSubject,
  workspaceRoot: string,
): InputDefinition[] {
  return [{ fileset: fromRoot(workspaceRoot, "Cargo.lock"), includeIgnored: true }];
}

/**
 * One `env` input per variable of `DES-INPUTS` that applies to the target:
 * the fixed list, `CARGO_TARGET_<TRIPLE>_LINKER`, `_RUSTFLAGS` and
 * `_RUNNER` for each of `triples`, `CARGO_BUILD_WARNINGS` on the targets
 * that compile, and `CLIPPY_CONF_DIR` on `lint`.
 */
export function environmentInputs(
  target: InferredTargetName,
  triples: readonly string[],
): InputDefinition[] {
  const names: string[] = [...environmentVariables];
  for (const triple of new Set(triples)) {
    const key = triple.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    names.push(...tripleSettings.map((setting) => `CARGO_TARGET_${key}_${setting}`));
  }
  if (compilingTargets.has(target)) {
    names.push("CARGO_BUILD_WARNINGS");
  }
  if (target === "lint") {
    names.push("CLIPPY_CONF_DIR");
  }
  return names.map((env) => ({ env }));
}

/**
 * The command of the toolchain input: `rustc -Vv` in the workspace root,
 * where the plugin's cargo commands run, as cargo will resolve it there with
 * the task's environment (`DES-INPUTS`, `REQ-TOOLCHAIN-KEY`). Nx runs it
 * through `sh -c` in the repository root (`EVD-NX-24-INPUT-SEMANTICS`).
 *
 * rustup may not install a toolchain for it (`ADR-GRAPH-NO-TOOLCHAIN-INSTALL`).
 * When `rustc -Vv` fails, as for a pinned toolchain that is not installed,
 * the command prints a random value instead, new at each evaluation, so that
 * no result stored under the key is ever restored and the task runs as plain
 * cargo would (`EVD-RUSTUP-MISSING-TOOLCHAIN`).
 *
 * @param workspaceRoot The workspace's root folder, relative to the repository root.
 */
// @mara implements REQ-TOOLCHAIN-KEY
export function toolchainCommand(workspaceRoot: string): string {
  const folder = workspaceRoot === "." ? "." : `./${workspaceRoot}`;
  return `cd ${shellQuote(folder)} && RUSTUP_AUTO_INSTALL=0 rustc -Vv 2>/dev/null || od -An -N16 -tx1 /dev/urandom`;
}

/** The input that carries the plugin's own version into the key. */
function pluginInput(plugin: PluginInput): InputDefinition {
  return { externalDependencies: plugin.kind === "node" ? [plugin.packageName] : [] };
}

/** The node architectures that rustup's host triples name differently. */
const rustArchitectures: Readonly<Record<string, string>> = {
  x64: "x86_64",
  arm64: "aarch64",
  ia32: "i686",
  riscv64: "riscv64gc",
  s390x: "s390x",
  ppc64: "powerpc64le",
  loong64: "loongarch64",
};

/**
 * The triples that a Rust toolchain on this host can have as its host, from
 * Node's platform and architecture, without running a toolchain. On Linux
 * both the GNU and the musl triple count, because which C library the
 * toolchain uses cannot be read without it; a variable of a triple that does
 * not apply costs nothing. Empty on a platform or architecture that the
 * plugin does not know.
 */
export function hostTriples(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): string[] {
  const arch = rustArchitectures[architecture];
  if (arch === undefined) {
    return [];
  }
  if (platform === "darwin") {
    return arch === "x86_64" || arch === "aarch64" ? [`${arch}-apple-darwin`] : [];
  }
  if (platform === "linux") {
    return [`${arch}-unknown-linux-gnu`, `${arch}-unknown-linux-musl`];
  }
  return [];
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
