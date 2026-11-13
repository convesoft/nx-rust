import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { GeneratorCallback, joinPathFragments, logger, normalizePath, Tree } from "@nx/devkit";
import { enclosingWorkspace, excludingEntry } from "./enclosing-workspace";

/** The options of `library` and `binary`. */
export interface CrateGeneratorSchema {
  /** The crate's folder, relative to the folder `nx` runs in. */
  directory: string;
  /** The package name; cargo takes the folder's name without it. */
  name?: string;
  /**
   * The Rust edition; cargo chooses without it. A number when the command
   * line gives it, as in `--edition 2024`, which Nx does not turn into text.
   */
  edition?: string | number;
}

/** Creates a library crate with `cargo new --lib`. */
// @mara implements DES-GENERATORS
export function libraryGenerator(
  tree: Tree,
  options: CrateGeneratorSchema,
): Promise<GeneratorCallback> {
  return crateGenerator(tree, options, "lib");
}

/** Creates a binary crate with `cargo new --bin`. */
// @mara implements DES-GENERATORS
export function binaryGenerator(
  tree: Tree,
  options: CrateGeneratorSchema,
): Promise<GeneratorCallback> {
  return crateGenerator(tree, options, "bin");
}

/**
 * Creates one crate with `cargo new --vcs none`, which cargo adds to the
 * members of the enclosing workspace. The generator writes nothing through
 * Nx's file tree: the callback it returns runs cargo, and Nx runs that
 * callback only without `--dry-run`.
 *
 * @throws {Error} When the enclosing workspace's `exclude` leaves the folder
 *   out, before cargo runs.
 */
async function crateGenerator(
  tree: Tree,
  options: CrateGeneratorSchema,
  kind: "lib" | "bin",
): Promise<GeneratorCallback> {
  const directory = resolveDirectory(tree.root, options.directory);
  const folder = join(tree.root, directory);
  const workspace = enclosingWorkspace(folder);
  if (workspace === undefined) {
    logger.info(
      `${directory} lies outside every Cargo workspace, so the crate will be a standalone crate, with its own Cargo.lock and build directory.`,
    );
  } else {
    const entry = excludingEntry(workspace, folder);
    if (entry !== undefined) {
      const manifest = displayPath(tree.root, workspace.manifest);
      throw new Error(
        [
          `nx-rust did not create a crate in ${directory}: ${manifest} lists "${entry}" under [workspace] exclude, which leaves the folder out of that workspace.`,
          "cargo new would add the folder to the workspace's members, which overrides exclude.",
          `Choose a folder that "${entry}" does not cover, or remove "${entry}" from exclude in ${manifest} first.`,
        ].join("\n"),
      );
    }
  }
  const args = [
    "new",
    "--vcs",
    "none",
    `--${kind}`,
    ...(options.name ? ["--name", options.name] : []),
    ...(options.edition ? ["--edition", String(options.edition)] : []),
    directory,
  ];
  const command = ["cargo", ...args].map(shellWord).join(" ");
  if (process.env.NX_DRY_RUN === "true") {
    logger.info(`Without --dry-run, nx-rust would run \`${command}\` in the repository root.`);
  }
  return () => runCargoNew(args, command, tree.root);
}

/**
 * Resolves `directory` as Nx's own generators resolve it: against the
 * folder `nx` runs in, unless it already starts with that folder.
 *
 * @returns The path relative to the repository root, with `/` separators.
 */
export function resolveDirectory(workspaceRoot: string, directory: string): string {
  const initCwd = process.env.INIT_CWD;
  const cwd = initCwd?.startsWith(workspaceRoot) ? initCwd : process.cwd();
  const relativeCwd = normalizePath(relative(workspaceRoot, cwd));
  const path = normalizePath(directory);
  return path === relativeCwd || path.startsWith(`${relativeCwd}/`) || relativeCwd === ""
    ? joinPathFragments(path)
    : joinPathFragments(relativeCwd, path);
}

function runCargoNew(args: string[], command: string, workspaceRoot: string): void {
  const result = spawnSync("cargo", args, {
    cwd: workspaceRoot,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(
      [
        `nx-rust could not run \`${command}\`: ${result.error.message}.`,
        "Install a Rust toolchain or put cargo on PATH, then run the generator again.",
      ].join("\n"),
    );
  }
  if (result.status !== 0) {
    const reason = result.signal
      ? `was stopped by ${result.signal}`
      : `failed with status ${result.status}`;
    throw new Error([`\`${command}\` ${reason}:`, result.stderr.trimEnd()].join("\n"));
  }
  process.stderr.write(result.stderr);
}

function displayPath(workspaceRoot: string, path: string): string {
  const inside = relative(workspaceRoot, path);
  return inside.startsWith("..") ? path : inside;
}

function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.split("'").join(`'"'"'`)}'`;
}
