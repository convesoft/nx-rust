import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse } from "smol-toml";

/**
 * A crate folder that cargo may build in place of a registry or git
 * dependency when it builds a workspace, as one of its tables says.
 *
 * The tables cannot say whether cargo uses the crate: that depends on the
 * versions the dependencies ask for and on `Cargo.lock`. A redirection is
 * therefore only a crate that cargo may use.
 */
export interface Redirection {
  /**
   * The table it comes from: `[patch]` or `[replace]` in the workspace's
   * root manifest, or `[patch]` or `paths` in a configuration file.
   */
  table: "patch" | "replace" | "paths";
  /**
   * The absolute path of the folder. For `[patch]` and `[replace]` it is the
   * crate's own folder; for `paths`, cargo takes every crate at or below it.
   */
  folder: string;
  /** The absolute path of the manifest or configuration file that holds it. */
  file: string;
}

/**
 * Reads the redirections that cargo applies when it builds the workspace
 * whose root manifest is in `workspaceRoot`, without running cargo:
 *
 * - every `[patch.<source>]` and `[replace]` entry with a `path` in the root
 *   manifest, resolved against the manifest's folder; cargo ignores these
 *   tables in other manifests;
 * - every `[patch.<source>]` entry with a `path`, and every `paths` entry, in
 *   `.cargo/config.toml` and `.cargo/config` in `workspaceRoot` and in every
 *   folder above it, and in `config.toml` and `config` in the Cargo home,
 *   following `include`. Cargo resolves a path there against the folder
 *   above the one that holds the file.
 *
 * The plugin's cargo commands start in the workspace root, so cargo reads
 * these configuration files for them. An `include` is followed whatever the
 * Cargo version: Cargo 1.91 ignores it, and a redirection that cargo does
 * not apply only adds edges. A file that does not exist is skipped.
 *
 * @param env Where `CARGO_HOME` is read from; without it, the Cargo home is
 *   `~/.cargo`.
 * @throws {Error} When a file exists but is no valid TOML, naming the file.
 */
// @mara implements DES-METADATA-REPORT
export async function readRedirections(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Redirection[]> {
  const manifest = join(workspaceRoot, "Cargo.toml");
  const redirections: Redirection[] = [];
  const table = await readToml(manifest);
  if (table !== undefined) {
    redirections.push(...patchEntries(table.patch, dirname(manifest), manifest));
    for (const entry of Object.values(asTable(table.replace))) {
      const path = asTable(entry).path;
      if (typeof path === "string") {
        redirections.push({
          table: "replace",
          folder: resolve(workspaceRoot, path),
          file: manifest,
        });
      }
    }
  }
  const read = new Set<string>();
  for (const file of configFiles(workspaceRoot, env)) {
    redirections.push(...(await readConfig(file, read)));
  }
  return redirections;
}

// The configuration files cargo reads for a command started in `folder`, as
// candidates that may not exist: `.cargo/config` and `.cargo/config.toml` in
// the folder and each one above it, then those of the Cargo home.
function configFiles(folder: string, env: NodeJS.ProcessEnv): string[] {
  const files: string[] = [];
  let current = resolve(folder);
  for (;;) {
    files.push(join(current, ".cargo", "config"), join(current, ".cargo", "config.toml"));
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  const cargoHome = env.CARGO_HOME ? resolve(folder, env.CARGO_HOME) : join(homedir(), ".cargo");
  files.push(join(cargoHome, "config"), join(cargoHome, "config.toml"));
  return files;
}

// The redirections in a configuration file and the files it includes, each
// file read once.
async function readConfig(file: string, read: Set<string>): Promise<Redirection[]> {
  if (read.has(file)) {
    return [];
  }
  read.add(file);
  const table = await readToml(file);
  if (table === undefined) {
    return [];
  }
  const base = dirname(dirname(file));
  const redirections = patchEntries(table.patch, base, file);
  if (Array.isArray(table.paths)) {
    for (const path of table.paths) {
      if (typeof path === "string") {
        redirections.push({ table: "paths", folder: resolve(base, path), file });
      }
    }
  }
  const includes = Array.isArray(table.include) ? table.include : [table.include];
  for (const include of includes) {
    const path = typeof include === "string" ? include : asTable(include).path;
    if (typeof path === "string") {
      redirections.push(...(await readConfig(resolve(dirname(file), path), read)));
    }
  }
  return redirections;
}

// The `[patch.<source>]` entries with a path, resolved against `base`.
function patchEntries(patch: unknown, base: string, file: string): Redirection[] {
  const redirections: Redirection[] = [];
  for (const source of Object.values(asTable(patch))) {
    for (const entry of Object.values(asTable(source))) {
      const path = asTable(entry).path;
      if (typeof path === "string") {
        redirections.push({ table: "patch", folder: resolve(base, path), file });
      }
    }
  }
  return redirections;
}

// The parsed file, or undefined when it does not exist.
async function readToml(file: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
      return undefined;
    }
    throw error;
  }
  try {
    return parse(text) as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `nx-rust could not parse ${file}: ${reason}`,
        "nx-rust reads this file for the [patch], [replace] and paths entries that cargo applies, because a crate that cargo may build in place of a dependency needs an edge in the graph.",
        "If cargo accepts the file, please report this at https://github.com/convesoft/nx-rust/issues.",
      ].join("\n"),
    );
  }
}

function asTable(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
