import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "smol-toml";
import { configFiles } from "./redirections";

/** One value of a key of the `[build]` table in a configuration file that cargo reads. */
export interface BuildSetting {
  /** The absolute path of the file. */
  file: string;
  /** The value as the file gives it. */
  value: unknown;
  /** Whether cargo reads the file only because another one includes it. */
  included: boolean;
}

/**
 * A configuration file that cargo reads but that exists and cannot be read
 * or parsed, so that whether it sets a key is unknown.
 */
export interface UnreadableFile {
  /** The absolute path of the file. */
  file: string;
  unreadable: true;
  /** Whether cargo reads the file only because another one includes it. */
  included: boolean;
}

/**
 * The values of `build.<key>` in the configuration files that cargo reads
 * for a command started in `folder`, in descending precedence:
 *
 * - The files are those of `folder`, of each folder above it and of the
 *   Cargo home ({@link configFiles}), with the files they include.
 * - A deeper folder comes before the folders above it, a file's own value
 *   before the files it includes, and a later include before an earlier
 *   one, each with its own includes after it.
 * - Each file of the walk counts in its own place, also where a deeper
 *   file includes it too: cargo loads each file of the walk with its own
 *   includes, so later versions read such a file in both places, and Cargo
 *   1.91, which ignores `include`, in its own place only
 *   (`EVD-CARGO-COMPILER-SELECTION`). Within one file of the walk, a file
 *   that several includes name counts once, and the Cargo home counts once
 *   where it is also one of the folders.
 * - Files that do not exist, or that exist and cannot be read or parsed,
 *   are skipped: graph creation reports the latter, and cargo fails on
 *   them. {@link buildSettingsAndUnreadable} names those in their place.
 *
 * Cargo 1.91 ignores `include` and later versions apply it, so each value
 * says whether cargo reads it only through an include: the values that
 * are not are those that Cargo 1.91 reads.
 *
 * @param env Where `CARGO_HOME` is read from.
 */
export function buildSettings(
  folder: string,
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): BuildSetting[] {
  return buildSettingsAndUnreadable(folder, env, key).filter(
    (entry): entry is BuildSetting => !("unreadable" in entry),
  );
}

/**
 * {@link buildSettings}, with each file that exists but cannot be read or
 * parsed in its place in the order, for a reader that must not guess past
 * it. Only a file that does not exist counts as absent; a file whose folder
 * is no folder, such as a `.cargo` that is a file, counts as unreadable.
 */
export function buildSettingsAndUnreadable(
  folder: string,
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): (BuildSetting | UnreadableFile)[] {
  const entries: (BuildSetting | UnreadableFile)[] = [];
  const walked = new Set<string>();
  for (const [legacy, current] of configFiles(folder, env)) {
    const file = existsSync(legacy) ? legacy : current;
    if (!walked.has(file)) {
      walked.add(file);
      // A record of its own, so that a file that a deeper file includes
      // still counts here, where Cargo 1.91 reads it.
      collect(file, key, false, new Set(), entries);
    }
  }
  return entries;
}

// Adds the value of `file` and of the files it includes, in descending
// precedence: the file's own value, then its includes from the last to the
// first, each with its own includes after it.
function collect(
  file: string,
  key: string,
  included: boolean,
  read: Set<string>,
  entries: (BuildSetting | UnreadableFile)[],
): void {
  if (read.has(file)) {
    return;
  }
  read.add(file);
  let table: Record<string, unknown>;
  try {
    table = parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      entries.push({ file, unreadable: true, included });
    }
    return;
  }
  const build = asTable(table.build);
  if (build[key] !== undefined) {
    entries.push({ file, value: build[key], included });
  }
  const includes = Array.isArray(table.include) ? table.include : [table.include];
  for (const include of [...includes].reverse()) {
    const path = typeof include === "string" ? include : asTable(include).path;
    if (typeof path === "string") {
      collect(resolve(dirname(file), path), key, true, read, entries);
    }
  }
}

function asTable(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
