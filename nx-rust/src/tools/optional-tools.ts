import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import { producesArtifact, reportedArtifacts } from "../graph/artifact-kinds";
import type { ArtifactKind } from "../graph/settings";
import { wasmTriple } from "../graph/wasm";
import { installedNapiCli } from "./napi-cli";

/** A Cargo workspace as far as the table of tools needs it. */
export interface ToolWorkspace {
  /** The folder of the root manifest, relative to the repository root: `.` for the root itself. */
  root: string;
  /** The workspace's members, where the table needs to know which crates produce an artifact. */
  members?: readonly CargoPackage[];
  /** The workspace's test runner (`testRunner`), where its settings choose nextest. */
  testRunner?: "nextest";
  /** Whether the workspace's settings turn on the selection of affected tests (`affectedTests`). */
  affectedTests?: true;
  /**
   * The feature-unification strategy that graph creation chose for the
   * workspace (`DES-UNIFICATION`); `workspace-build` where absent.
   */
  featureUnification?: "hakari" | "cargo" | "workspace-build";
}

/** What the table of tools looks at. */
export interface ToolContext {
  /** The absolute path of the repository root. */
  workspaceRoot: string;
  /** The Cargo workspaces of the repository. */
  workspaces: ToolWorkspace[];
  /** The environment whose `PATH` and `CARGO_HOME` say where tools are installed. */
  env: NodeJS.ProcessEnv;
  /**
   * The absolute path of the folder where a task's cargo runs, against which
   * relative entries of `PATH` and a relative `CARGO_HOME` count, and whose
   * toolchain counts for the wasm target; the repository root when absent.
   */
  folder?: string;
}

/** How code refers to each tool of {@link optionalTools}. */
export type OptionalToolId =
  | "cargo-nextest"
  | "cargo-affected"
  | "llvm-tools"
  | "cargo-hakari"
  | "wasm-bindgen"
  | "wasm-target"
  | "napi"
  | "cargo-deny"
  | "cargo-audit";

/**
 * A tool that a feature of the plugin runs and that the plugin never
 * installs (`ADR-V1-SCOPE`).
 */
export interface OptionalTool {
  id: OptionalToolId;
  /** How messages name the tool. */
  name: string;
  /** How to get it. */
  install: string;
  /** Whether the tool is installed. */
  installed(context: ToolContext): boolean;
  /**
   * What in the repository's configuration needs the tool, one phrase each,
   * such as "the deny target that rust/deny.toml gives the Cargo workspace in
   * rust". Empty when nothing needs it.
   */
  neededBy(context: ToolContext): string[];
}

/** The configuration files of cargo-deny that give a workspace project its `deny` target. */
export const cargoDenyConfigurationFiles = ["deny.toml", ".deny.toml", ".cargo/deny.toml"];

/** The triple that `wasm-build` compiles for. */
export { wasmTriple };

/**
 * The tools of the table in `DES-GENERATORS`, in its order. `init` reports
 * the missing ones, and a task that runs a missing one fails
 * ({@link requireTool}); the rows of the wasm tools are one row there.
 *
 * Which tool the configuration needs follows the features that exist:
 * cargo-nextest where a workspace's settings choose the nextest runner,
 * cargo-affected where they turn on `affectedTests`, cargo-hakari for every
 * workspace that uses the `hakari` strategy, the napi CLI where a crate has
 * a `napi-build` target, and the `wasm-bindgen` CLI and the wasm target
 * where a crate has a `wasm-build` target.
 */
// @mara implements DES-GENERATORS
export const optionalTools: readonly OptionalTool[] = [
  {
    id: "cargo-nextest",
    name: "cargo-nextest",
    install: "Install it as https://nexte.st/docs/installation/ describes.",
    installed: (context) => cargoSubcommandInstalled("nextest", context.env, toolFolder(context)),
    neededBy: (context) =>
      context.workspaces
        .filter((workspace) => workspace.testRunner === "nextest")
        .map(
          (workspace) =>
            `the nextest runner that the Cargo workspace in ${describeFolder(workspace.root)} chooses for its test targets (testRunner)`,
        ),
  },
  {
    id: "cargo-affected",
    name: "cargo-affected",
    install: "Install it as https://github.com/max-sixty/cargo-affected describes.",
    installed: (context) => cargoSubcommandInstalled("affected", context.env, toolFolder(context)),
    neededBy: (context) =>
      context.workspaces
        .filter((workspace) => workspace.affectedTests === true)
        .map(
          (workspace) =>
            `the selection of affected tests that the Cargo workspace in ${describeFolder(workspace.root)} turns on for its test targets (affectedTests)`,
        ),
  },
  {
    // cargo-affected runs llvm-profdata and llvm-cov to collect coverage; it
    // looks for them in the toolchain's sysroot, then through xcrun on macOS,
    // then on PATH (`DES-BASELINE`).
    id: "llvm-tools",
    name: "the llvm-tools component (llvm-cov and llvm-profdata)",
    install:
      "Install it with `rustup component add llvm-tools` for the toolchain of the workspace, or put the llvm-cov and llvm-profdata of that toolchain's LLVM version on PATH.",
    installed: (context) => llvmToolsInstalled(context),
    neededBy: (context) =>
      context.workspaces
        .filter((workspace) => workspace.affectedTests === true)
        .map(
          (workspace) =>
            `the coverage collection that the Cargo workspace in ${describeFolder(workspace.root)} gets with the selection of affected tests (affectedTests)`,
        ),
  },
  {
    id: "cargo-hakari",
    name: "cargo-hakari",
    install:
      "Install it with `cargo install --locked cargo-hakari` (https://docs.rs/cargo-hakari).",
    installed: (context) => cargoSubcommandInstalled("hakari", context.env, toolFolder(context)),
    neededBy: (context) =>
      context.workspaces
        .filter((workspace) => workspace.featureUnification === "hakari")
        .map(
          (workspace) =>
            `the hakari-check target of the Cargo workspace in ${describeFolder(workspace.root)}`,
        ),
  },
  {
    id: "wasm-bindgen",
    name: "the wasm-bindgen CLI",
    install:
      "Install the version of the wasm-bindgen crate in your Cargo.lock with `cargo install --locked wasm-bindgen-cli --version <version>`.",
    installed: (context) =>
      findExecutable("wasm-bindgen", searchPath(context.env, toolFolder(context))) !== undefined,
    neededBy: (context) => wasmBuildTargets(context),
  },
  {
    id: "wasm-target",
    name: `the ${wasmTriple} target`,
    install: `Install it with \`rustup target add ${wasmTriple}\`.`,
    installed: (context) => wasmTargetInstalled(context),
    neededBy: (context) => wasmBuildTargets(context),
  },
  {
    id: "napi",
    name: "the napi CLI",
    install:
      "Add @napi-rs/cli 3.4.0 or a later 3.x release to the devDependencies of the crate's package.json or of the repository's (https://napi.rs).",
    // `napi-build` uses the package that Node resolves from the crate's
    // folder, so each crate with the target has to reach one.
    installed: (context) => {
      const folders = artifactCrates(context, "napi").map(({ folder }) =>
        join(context.workspaceRoot, folder),
      );
      return folders.length > 0
        ? folders.every((folder) => installedNapiCli(folder) !== undefined)
        : installedNapiCli(context.workspaceRoot) !== undefined ||
            findExecutable("napi", [
              join(context.workspaceRoot, "node_modules", ".bin"),
              ...searchPath(context.env, toolFolder(context)),
            ]) !== undefined;
    },
    neededBy: (context) =>
      artifactCrates(context, "napi").map(
        ({ name, folder }) =>
          `the napi-build target of the crate ${name} in ${describeFolder(folder)}`,
      ),
  },
  {
    id: "cargo-deny",
    name: "cargo-deny",
    install:
      "Install it with `cargo install --locked cargo-deny` (https://crates.io/crates/cargo-deny).",
    installed: (context) => cargoSubcommandInstalled("deny", context.env, toolFolder(context)),
    neededBy: (context) =>
      context.workspaces.flatMap((workspace) => {
        const file = cargoDenyConfigurationFiles.find((name) =>
          existsSync(join(context.workspaceRoot, workspace.root, name)),
        );
        return file === undefined
          ? []
          : [
              `the deny target that ${join(workspace.root, file)} gives the Cargo workspace in ${describeFolder(workspace.root)}`,
            ];
      }),
  },
  {
    // No setting asks for `audit`, which every workspace project has, so a
    // missing cargo-audit is reported as not needed; an `audit` task still
    // fails without it.
    id: "cargo-audit",
    name: "cargo-audit",
    install:
      "Install it with `cargo install --locked cargo-audit` (https://crates.io/crates/cargo-audit).",
    installed: (context) => cargoSubcommandInstalled("audit", context.env, toolFolder(context)),
    neededBy: () => [],
  },
];

/**
 * The message for a tool that is not installed and that `neededBy` need,
 * one phrase each, such as "the deny target that rust/deny.toml gives the
 * Cargo workspace in rust": it names the tool, what needs it and how to get
 * it. `init` reports it as a warning, a task that starts without the tool
 * fails with it (`DES-DIAGNOSTICS`).
 */
export function missingToolMessage(tool: OptionalTool, neededBy: readonly string[]): string {
  const needs = neededBy.length === 1 ? "needs" : "need";
  return `${sentenceStart(tool.name)} is not installed, but ${list(neededBy)} ${needs} it. ${tool.install}`;
}

/** A tool that a task needs is not installed. */
export class MissingToolError extends Error {
  constructor(
    readonly tool: OptionalTool,
    /** What needs the tool. */
    readonly neededBy: string,
  ) {
    super(missingToolMessage(tool, [neededBy]));
    this.name = "MissingToolError";
  }
}

/**
 * Fails when the tool `id` is not installed. The executors call it when a
 * task that runs the tool starts, before cargo runs, so that the task fails
 * with a message that names the tool, what needs it and how to get it; the
 * plugin installs nothing (`DES-DIAGNOSTICS`, `ADR-V1-SCOPE`).
 *
 * @param neededBy What needs the tool, such as "the audit target of the
 *   Cargo workspace in rust".
 * @param context Where to look: the environment of the task and, for the
 *   wasm target, the folder its cargo runs in.
 * @throws {MissingToolError} When the tool is not installed.
 */
// @mara implements DES-DIAGNOSTICS
export function requireTool(
  id: OptionalToolId,
  neededBy: string,
  context: ToolContext,
  tools: readonly OptionalTool[] = optionalTools,
): void {
  const tool = tools.find((candidate) => candidate.id === id);
  if (tool === undefined) {
    throw new Error(`nx-rust has no tool "${id}" in its table of tools.`);
  }
  if (!tool.installed(context)) {
    throw new MissingToolError(tool, neededBy);
  }
}

/**
 * The crates of the context's workspaces that have the artifact target of
 * the kind, `napi-build` or `wasm-build` (`producesArtifact` in
 * `artifact-kinds.ts`), by package name and folder relative to the
 * repository root, the `artifacts` of their `[package.metadata.nx]`
 * included, in the order of their folders.
 */
function artifactCrates(
  context: ToolContext,
  kind: ArtifactKind,
): { name: string; folder: string }[] {
  return context.workspaces.flatMap((workspace) =>
    (workspace.members ?? [])
      .filter((pkg) => {
        const artifacts = reportedArtifacts(pkg);
        return producesArtifact(
          { pkg, settings: artifacts === undefined ? {} : { artifacts } },
          kind,
        );
      })
      .map((pkg) => ({
        name: pkg.name,
        folder: relative(context.workspaceRoot, dirname(pkg.manifest_path)) || ".",
      }))
      .sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0)),
  );
}

// What needs the wasm tools: the `wasm-build` target of each crate that has one.
function wasmBuildTargets(context: ToolContext): string[] {
  return artifactCrates(context, "wasm").map(
    ({ name, folder }) => `the wasm-build target of the crate ${name} in ${describeFolder(folder)}`,
  );
}

/** "the repository root" for `.`, the folder otherwise. */
export function describeFolder(folder: string): string {
  return folder === "." || folder === "" ? "the repository root" : folder;
}

/**
 * Whether cargo, started in the folder `cwd`, would find the subcommand
 * `cargo <name>`: an executable `cargo-<name>` in the `bin` folder of the
 * Cargo home or on `PATH`, where cargo looks for it. Cargo resolves a
 * relative `CARGO_HOME` and relative entries of `PATH` against the folder
 * it runs in.
 */
export function cargoSubcommandInstalled(
  name: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): boolean {
  const cargoHome = env.CARGO_HOME
    ? resolve(cwd, env.CARGO_HOME)
    : join(env.HOME || homedir(), ".cargo");
  return (
    findExecutable(`cargo-${name}`, [join(cargoHome, "bin"), ...searchPath(env, cwd)]) !== undefined
  );
}

/**
 * The first executable file called `name` in `folders`, or `undefined`.
 */
export function findExecutable(name: string, folders: readonly string[]): string | undefined {
  for (const folder of folders) {
    if (folder === "") {
      continue;
    }
    const candidate = join(folder, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Not in this folder.
    }
  }
  return undefined;
}

/**
 * The folders of `PATH` for a command started in `cwd`, where the operating
 * system and cargo look for an executable: a relative entry counts from
 * `cwd`, and an empty one stands for `cwd` itself. Without `PATH`, none.
 */
export function searchPath(env: NodeJS.ProcessEnv, cwd: string): string[] {
  return env.PATH === undefined
    ? []
    : env.PATH.split(delimiter).map((entry) => resolve(cwd, entry));
}

// The folder where the command that runs a tool starts.
function toolFolder(context: ToolContext): string {
  return context.folder ?? context.workspaceRoot;
}

// Whether the toolchain that rustc picks in the context's folder has the
// standard library for the wasm triple. rustup may not install a toolchain
// that the folder names and that is missing.
function wasmTargetInstalled(context: ToolContext): boolean {
  const result = spawnSync("rustc", ["--print", "sysroot"], {
    cwd: context.folder ?? context.workspaceRoot,
    env: { ...context.env, RUSTUP_AUTO_INSTALL: "0" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0) {
    return false;
  }
  return existsSync(join(result.stdout.trim(), "lib", "rustlib", wasmTriple));
}

// Whether cargo-affected, started in the context's folder, finds both
// llvm-cov and llvm-profdata as it looks for them: in the `lib/rustlib/<host>/bin`
// of the sysroot that rustc names there, through `xcrun --find` on macOS, or
// on PATH.
function llvmToolsInstalled(context: ToolContext): boolean {
  const folder = toolFolder(context);
  const env = { ...context.env, RUSTUP_AUTO_INSTALL: "0" };
  const rustc = (args: string[]) =>
    spawnSync("rustc", args, {
      cwd: folder,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  const sysroot = rustc(["--print", "sysroot"]);
  const host = /^host: (\S+)$/m.exec(rustc(["-vV"]).stdout ?? "")?.[1];
  const sysrootBin =
    sysroot.status === 0 && host !== undefined
      ? join(sysroot.stdout.trim(), "lib", "rustlib", host, "bin")
      : undefined;
  return ["llvm-cov", "llvm-profdata"].every(
    (tool) =>
      (sysrootBin !== undefined && findExecutable(tool, [sysrootBin]) !== undefined) ||
      (process.platform === "darwin" &&
        spawnSync("xcrun", ["--find", tool], { env, stdio: "ignore" }).status === 0) ||
      findExecutable(tool, searchPath(context.env, folder)) !== undefined,
  );
}

// "The" at the start of a sentence; a tool's own name keeps its case.
function sentenceStart(name: string): string {
  return name.startsWith("the ") ? `The ${name.slice(4)}` : name;
}

function list(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
