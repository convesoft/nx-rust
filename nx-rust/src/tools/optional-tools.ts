import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** A Cargo workspace as far as the table of tools needs it. */
export interface ToolWorkspace {
  /** The folder of the root manifest, relative to the repository root: `.` for the root itself. */
  root: string;
}

/** What the table of tools looks at. */
export interface ToolContext {
  /** The absolute path of the repository root. */
  workspaceRoot: string;
  /** The Cargo workspaces of the repository. */
  workspaces: ToolWorkspace[];
  /** The environment whose `PATH` and `CARGO_HOME` say where tools are installed. */
  env: NodeJS.ProcessEnv;
}

/**
 * A tool that a feature of the plugin runs and that the plugin never
 * installs (`ADR-V1-SCOPE`).
 */
export interface OptionalTool {
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
export const wasmTriple = "wasm32-unknown-unknown";

/**
 * The tools of the table in `DES-GENERATORS`, in its order. `init` reports
 * the missing ones; the rows of the wasm tools are one row there.
 *
 * Which tool the configuration needs follows the features that exist. The
 * settings that ask for cargo-nextest, cargo-affected and cargo-hakari, and
 * the artifact targets that run the wasm and napi tools, are not implemented
 * yet, so nothing needs those tools until their issues add the condition:
 * nxr-jb6g5y (`testRunner`), nxr-tabkjx (`affectedTests`), nxr-k64tm5 (the
 * `hakari` strategy), nxr-0ap8n4 (`wasm-build`) and nxr-tv3r95 (`napi-build`).
 */
// @mara implements DES-GENERATORS
export const optionalTools: readonly OptionalTool[] = [
  {
    name: "cargo-nextest",
    install: "Install it as https://nexte.st/docs/installation/ describes.",
    installed: (context) => cargoSubcommandInstalled("nextest", context.env),
    neededBy: () => [],
  },
  {
    name: "cargo-affected",
    install: "Install it as https://github.com/max-sixty/cargo-affected describes.",
    installed: (context) => cargoSubcommandInstalled("affected", context.env),
    neededBy: () => [],
  },
  {
    name: "cargo-hakari",
    install:
      "Install it with `cargo install --locked cargo-hakari` (https://docs.rs/cargo-hakari).",
    installed: (context) => cargoSubcommandInstalled("hakari", context.env),
    neededBy: () => [],
  },
  {
    name: "the wasm-bindgen CLI",
    install:
      "Install the version of the wasm-bindgen crate in your Cargo.lock with `cargo install --locked wasm-bindgen-cli --version <version>`.",
    installed: (context) => findExecutable("wasm-bindgen", searchPath(context.env)) !== undefined,
    neededBy: () => [],
  },
  {
    name: `the ${wasmTriple} target`,
    install: `Install it with \`rustup target add ${wasmTriple}\`.`,
    installed: (context) => wasmTargetInstalled(context),
    neededBy: () => [],
  },
  {
    name: "the napi CLI",
    install: "Add @napi-rs/cli to the devDependencies of your package.json (https://napi.rs).",
    installed: (context) =>
      findExecutable("napi", [
        join(context.workspaceRoot, "node_modules", ".bin"),
        ...searchPath(context.env),
      ]) !== undefined,
    neededBy: () => [],
  },
  {
    name: "cargo-deny",
    install:
      "Install it with `cargo install --locked cargo-deny` (https://crates.io/crates/cargo-deny).",
    installed: (context) => cargoSubcommandInstalled("deny", context.env),
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
    name: "cargo-audit",
    install:
      "Install it with `cargo install --locked cargo-audit` (https://crates.io/crates/cargo-audit).",
    installed: (context) => cargoSubcommandInstalled("audit", context.env),
    neededBy: () => [],
  },
];

/** "the repository root" for `.`, the folder otherwise. */
export function describeFolder(folder: string): string {
  return folder === "." || folder === "" ? "the repository root" : folder;
}

/**
 * Whether cargo would find the subcommand `cargo <name>`: an executable
 * `cargo-<name>` in the `bin` folder of the Cargo home or on `PATH`, where
 * cargo looks for it.
 */
export function cargoSubcommandInstalled(name: string, env: NodeJS.ProcessEnv): boolean {
  const cargoHome = env.CARGO_HOME || join(env.HOME || homedir(), ".cargo");
  return (
    findExecutable(`cargo-${name}`, [join(cargoHome, "bin"), ...searchPath(env)]) !== undefined
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

function searchPath(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? "").split(delimiter);
}

// Whether the toolchain that rustc picks in the repository root has the
// standard library for the wasm triple. rustup may not install a toolchain
// that the folder names and that is missing.
function wasmTargetInstalled(context: ToolContext): boolean {
  const result = spawnSync("rustc", ["--print", "sysroot"], {
    cwd: context.workspaceRoot,
    env: { ...context.env, RUSTUP_AUTO_INSTALL: "0" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0) {
    return false;
  }
  return existsSync(join(result.stdout.trim(), "lib", "rustlib", wasmTriple));
}
