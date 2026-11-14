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
 * The values of `build.<key>` in the configuration files that cargo reads
 * for a command started in `folder`, in descending precedence:
 *
 * - The files are those of `folder`, of each folder above it and of the
 *   Cargo home ({@link configFiles}), with the files they include.
 * - A deeper folder comes before the folders above it, a file's own value
 *   before the files it includes, and a later include before an earlier
 *   one, each with its own includes after it.
 * - Every file is read once. Files that do not exist or cannot be parsed are
 *   skipped: graph creation reports the latter, and cargo fails on them.
 *
 * Cargo 1.91 ignores `include` and later versions apply it, so each value
 * says whether cargo reads its file only through an include.
 *
 * @param env Where `CARGO_HOME` is read from.
 */
export function buildSettings(folder: string, env: NodeJS.ProcessEnv, key: string): BuildSetting[] {
  const settings: BuildSetting[] = [];
  const read = new Set<string>();
  for (const [legacy, current] of configFiles(folder, env)) {
    collect(existsSync(legacy) ? legacy : current, key, false, read, settings);
  }
  return settings;
}

// Adds the value of `file` and of the files it includes, in descending
// precedence: the file's own value, then its includes from the last to the
// first, each with its own includes after it.
function collect(
  file: string,
  key: string,
  included: boolean,
  read: Set<string>,
  settings: BuildSetting[],
): void {
  if (read.has(file)) {
    return;
  }
  read.add(file);
  let table: Record<string, unknown>;
  try {
    table = parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  const build = asTable(table.build);
  if (build[key] !== undefined) {
    settings.push({ file, value: build[key], included });
  }
  const includes = Array.isArray(table.include) ? table.include : [table.include];
  for (const include of [...includes].reverse()) {
    const path = typeof include === "string" ? include : asTable(include).path;
    if (typeof path === "string") {
      collect(resolve(dirname(file), path), key, true, read, settings);
    }
  }
}

function asTable(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
