import { existsSync } from "node:fs";
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
  /**
   * The key of the entry's table: the source of a `[patch.<source>]` entry,
   * such as `crates-io`, a registry's name or a URL, or the package id
   * specification of a `[replace]` entry. Absent for `paths`.
   */
  key?: string;
}

/**
 * A folder that a `[source.<name>]` table names as its `directory`, such as
 * the one `cargo vendor` writes: cargo takes the packages of the source that
 * this one replaces from there. Its crates are no crates of the repository.
 */
export interface SourceDirectory {
  /** The absolute path of the folder. */
  folder: string;
  /** The absolute path of the configuration file that names it. */
  file: string;
  /** The name of the source, such as `vendored-sources`. */
  name: string;
}

/** What {@link readRedirections} found. */
export interface WorkspaceRedirections {
  redirections: Redirection[];
  /**
   * The folders that `[source.<name>]` tables in the same configuration
   * files name as their `directory`.
   */
  sourceDirectories: SourceDirectory[];
  /** One message for each included file that the plugin skipped. */
  warnings: string[];
}

/**
 * Reads the redirections that cargo applies when it builds the workspace
 * whose root manifest is in `workspaceRoot`, without running cargo:
 *
 * - every `[patch.<source>]` and `[replace]` entry with a `path` in the root
 *   manifest, resolved against the manifest's folder; cargo ignores these
 *   tables in other manifests;
 * - every `[patch.<source>]` entry with a `path`, and every `paths` entry, in
 *   the configuration of `workspaceRoot`, of every folder above it and of the
 *   Cargo home, following `include`. In each of these folders cargo reads
 *   `.cargo/config` where it exists, and `.cargo/config.toml` otherwise; in
 *   the Cargo home, `config` or `config.toml` in the same way. It resolves a
 *   path in such a file against the folder above the one that holds the file.
 *
 * From the same configuration files it also takes the `directory` of every
 * `[source.<name>]` table, resolved in the same way.
 *
 * The plugin's cargo commands start in the workspace root, so cargo reads
 * these configuration files for them. An `include` is followed whatever the
 * Cargo version: Cargo 1.91 ignores it, and a redirection that cargo does
 * not apply only adds edges. For the same reason, an included file that
 * cannot be read or parsed is skipped with a warning instead of failing.
 * A file that does not exist is skipped.
 *
 * @param env Where `CARGO_HOME` is read from; without it, the Cargo home is
 *   `~/.cargo`.
 * @throws {Error} When the root manifest or a configuration file that cargo
 *   reads in any version is no valid TOML, naming the file.
 */
// @mara implements DES-METADATA-REPORT
export async function readRedirections(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkspaceRedirections> {
  const manifest = join(workspaceRoot, "Cargo.toml");
  const found: WorkspaceRedirections = { redirections: [], sourceDirectories: [], warnings: [] };
  const table = await readToml(manifest);
  if (table !== undefined) {
    found.redirections.push(...patchEntries(table.patch, dirname(manifest), manifest));
    for (const [key, entry] of Object.entries(asTable(table.replace))) {
      const path = asTable(entry).path;
      if (typeof path === "string") {
        found.redirections.push({
          table: "replace",
          folder: resolve(workspaceRoot, path),
          file: manifest,
          key,
        });
      }
    }
  }
  const read = new Set<string>();
  for (const file of configFiles([workspaceRoot], env)) {
    await readConfig(file, read, found);
  }
  return found;
}

/**
 * The folders that a `[source.<name>]` table names as its `directory` in any
 * configuration file that cargo reads for a command started in one of
 * `folders`, read as {@link readRedirections} reads them. These are
 * candidates: a file in a folder applies only to the workspaces in and below
 * that folder, and only {@link readRedirections} says which files cargo
 * reads for a workspace. A file that cannot be read or parsed is passed
 * over, because cargo may read it for no workspace at all.
 *
 * @param env Where `CARGO_HOME` is read from.
 */
// @mara implements DES-DISCOVERY
export async function sourceDirectoryCandidates(
  folders: Iterable<string>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const found: WorkspaceRedirections = { redirections: [], sourceDirectories: [], warnings: [] };
  const read = new Set<string>();
  for (const file of configFiles(folders, env)) {
    try {
      await readConfig(file, read, found);
    } catch {
      // Reported by readRedirections where cargo reads the file.
    }
  }
  return [...new Set(found.sourceDirectories.map(({ folder }) => folder))];
}

// The configuration files cargo reads for a command started in any of
// `folders`, each once: those of each folder and of every folder above it,
// then the Cargo home's, which a relative `CARGO_HOME` places against the
// folder. In each of these folders cargo reads the older name where it
// exists, and the current one otherwise.
function configFiles(folders: Iterable<string>, env: NodeJS.ProcessEnv): string[] {
  const files: string[] = [];
  const visited = new Set<string>();
  const cargoHomes = new Set<string>();
  for (const folder of folders) {
    cargoHomes.add(env.CARGO_HOME ? resolve(folder, env.CARGO_HOME) : join(homedir(), ".cargo"));
    for (let current = resolve(folder); !visited.has(current); current = dirname(current)) {
      visited.add(current);
      files.push(configFile(join(current, ".cargo")));
      if (dirname(current) === current) {
        break;
      }
    }
  }
  for (const cargoHome of cargoHomes) {
    files.push(configFile(cargoHome));
  }
  return files;
}

// The configuration file that cargo reads in a `.cargo` folder or a Cargo
// home: `config` where it exists, and `config.toml` otherwise.
function configFile(folder: string): string {
  const legacy = join(folder, "config");
  return existsSync(legacy) ? legacy : join(folder, "config.toml");
}

// Adds the redirections and source directories of a configuration file and
// of the files it includes, reading each file once. An included file that
// cannot be read or parsed adds a warning instead.
async function readConfig(
  file: string,
  read: Set<string>,
  found: WorkspaceRedirections,
  includedFrom?: string,
): Promise<void> {
  if (read.has(file)) {
    return;
  }
  read.add(file);
  let table: Record<string, unknown> | undefined;
  try {
    table = await readToml(file);
  } catch (error) {
    if (includedFrom === undefined) {
      throw error;
    }
    const reason = error instanceof TomlError ? error.reason : String(error);
    found.warnings.push(
      [
        `nx-rust: ${file}, which ${includedFrom} includes, cannot be read: ${reason}`,
        "nx-rust skips it, so a [patch] or paths entry in it gives no edges. Cargo 1.91 ignores include, and later versions fail on such a file.",
      ].join("\n"),
    );
    return;
  }
  if (table === undefined) {
    return;
  }
  const base = dirname(dirname(file));
  found.redirections.push(...patchEntries(table.patch, base, file));
  if (Array.isArray(table.paths)) {
    for (const path of table.paths) {
      if (typeof path === "string") {
        found.redirections.push({ table: "paths", folder: resolve(base, path), file });
      }
    }
  }
  for (const [name, source] of Object.entries(asTable(table.source))) {
    const directory = asTable(source).directory;
    if (typeof directory === "string") {
      found.sourceDirectories.push({ folder: resolve(base, directory), file, name });
    }
  }
  const includes = Array.isArray(table.include) ? table.include : [table.include];
  for (const include of includes) {
    const path = typeof include === "string" ? include : asTable(include).path;
    if (typeof path === "string") {
      await readConfig(resolve(dirname(file), path), read, found, file);
    }
  }
}

// The `[patch.<source>]` entries with a path, resolved against `base`.
function patchEntries(patch: unknown, base: string, file: string): Redirection[] {
  const redirections: Redirection[] = [];
  for (const [key, source] of Object.entries(asTable(patch))) {
    for (const entry of Object.values(asTable(source))) {
      const path = asTable(entry).path;
      if (typeof path === "string") {
        redirections.push({ table: "patch", folder: resolve(base, path), file, key });
      }
    }
  }
  return redirections;
}

/** A file that exists but is no valid TOML. */
class TomlError extends Error {
  constructor(
    file: string,
    /** The parser's message. */
    readonly reason: string,
  ) {
    super(
      [
        `nx-rust could not parse ${file}: ${reason}`,
        "nx-rust reads this file for the [patch], [replace] and paths entries that cargo applies, because a crate that cargo may build in place of a dependency needs an edge in the graph.",
        "If cargo accepts the file, please report this at https://github.com/convesoft/nx-rust/issues.",
      ].join("\n"),
    );
    this.name = "TomlError";
  }
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
    throw new TomlError(file, error instanceof Error ? error.message : String(error));
  }
}

function asTable(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
