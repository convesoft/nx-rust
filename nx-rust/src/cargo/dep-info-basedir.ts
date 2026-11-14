import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse } from "smol-toml";

/**
 * The folder that `build.dep-info-basedir` gives a cargo command started in
 * `folder` with the environment `env`, as an absolute path; `undefined`
 * where nothing sets it or a file that would decide cannot be read.
 *
 * Cargo takes the setting from `CARGO_BUILD_DEP_INFO_BASEDIR`, relative to
 * the folder it starts in, or else from the first configuration file that
 * sets it: that of `folder` and of each folder above it, then that of the
 * Cargo home, reading `.cargo/config` where it exists and
 * `.cargo/config.toml` otherwise. A file's own value comes before those of
 * the files it includes, and a later include before an earlier one. A path
 * in a file is relative to the folder above the one that holds the file.
 * The plugin's `build` passes cargo no `--config`, so nothing else sets it.
 */
export function configuredDepInfoBasedir(
  folder: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const fromEnvironment = env.CARGO_BUILD_DEP_INFO_BASEDIR;
  if (fromEnvironment !== undefined && fromEnvironment !== "") {
    return resolve(folder, fromEnvironment);
  }
  for (const [legacy, current] of configFiles(folder, env)) {
    const found = valueIn(existsSync(legacy) ? legacy : current, new Set());
    if (found !== null) {
      return found;
    }
  }
  return undefined;
}

// The configuration files of a command started in `folder`, as pairs of the
// older and the current name.
function configFiles(
  folder: string,
  env: Readonly<Record<string, string | undefined>>,
): [string, string][] {
  const files: [string, string][] = [];
  let current = resolve(folder);
  for (;;) {
    files.push([join(current, ".cargo", "config"), join(current, ".cargo", "config.toml")]);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  const cargoHome = env.CARGO_HOME ? resolve(folder, env.CARGO_HOME) : join(homedir(), ".cargo");
  files.push([join(cargoHome, "config"), join(cargoHome, "config.toml")]);
  return files;
}

// The value that a file gives, its includes considered: a path, `undefined`
// where the file cannot be read, or `null` where it sets nothing.
function valueIn(file: string, read: Set<string>): string | undefined | null {
  if (read.has(file)) {
    return null;
  }
  read.add(file);
  let table: Record<string, unknown>;
  try {
    table = parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : undefined;
  }
  const build = table.build;
  const value =
    typeof build === "object" && build !== null
      ? (build as Record<string, unknown>)["dep-info-basedir"]
      : undefined;
  if (typeof value === "string") {
    return resolve(dirname(dirname(file)), value);
  }
  const includes = Array.isArray(table.include) ? table.include : [table.include];
  for (const include of [...includes].reverse()) {
    const path =
      typeof include === "string"
        ? include
        : typeof include === "object" && include !== null
          ? (include as Record<string, unknown>).path
          : undefined;
    if (typeof path === "string") {
      const found = valueIn(resolve(dirname(file), path), read);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}
