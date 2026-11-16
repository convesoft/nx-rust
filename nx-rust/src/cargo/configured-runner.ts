import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "smol-toml";
import { configFiles } from "./redirections";

/** Where a runner for the host is or may be configured, as a task's output names it. */
export interface ConfiguredRunner {
  /** The variable or the absolute path of the file. */
  source: string;
  /** What it sets, or why it counts. */
  detail: string;
}

/**
 * The name of the variable through which cargo takes a runner for `triple`:
 * `CARGO_TARGET_<TRIPLE>_RUNNER`, with the triple in capitals and `-` and `.`
 * replaced by `_`.
 */
export function runnerVariable(triple: string): string {
  return `CARGO_TARGET_${triple.toUpperCase().replace(/[-.]/g, "_")}_RUNNER`;
}

/**
 * Where a runner for the host is or may be configured for a cargo command
 * started in `workspaceRoot` with `env` (`DES-TEST-RUN`, "A runner the user
 * configured"), the first that the plugin finds, or `undefined`:
 *
 * - `CARGO_TARGET_<HOST>_RUNNER` in `env`, whatever its value;
 * - a configuration file that cargo may read there that sets `runner` in the
 *   table `target.<host>`, or in any table under `target` whose key starts
 *   with `cfg(`, whether or not its expression matches the host. The files
 *   are `.cargo/config` and `.cargo/config.toml` in `workspaceRoot` and in
 *   each folder above it, both where both exist; `config` and `config.toml`
 *   in the Cargo home that `CARGO_HOME` in `env` names, or else in `.cargo`
 *   in the home folder; and every file that one of them adds with
 *   `include`, in any form and whatever the cargo version reads, with paths
 *   taken from the folder of the file that includes it;
 * - such a file that exists and cannot be read or parsed, so that whether it
 *   sets a runner is unknown.
 *
 * Reading the user's runner as cargo applies it is not attempted: no reading
 * gives what cargo uses in every case on Cargo 1.91 and 1.100
 * (`EVD-WORKSPACE-TEST-SELECTION`), so every place where one may be counts.
 */
// @mara implements DES-TEST-RUN
export function configuredRunner(
  workspaceRoot: string,
  env: Readonly<Record<string, string | undefined>>,
  host: string,
): ConfiguredRunner | undefined {
  const variable = runnerVariable(host);
  if (env[variable] !== undefined) {
    return { source: variable, detail: "is set" };
  }
  const read = new Set<string>();
  for (const pair of configFiles(workspaceRoot, env)) {
    for (const file of pair) {
      const found = fileRunner(file, host, read);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

// The runner that `file`, or a file that it includes, sets or may set.
function fileRunner(file: string, host: string, read: Set<string>): ConfiguredRunner | undefined {
  if (read.has(file) || !existsSync(file)) {
    return undefined;
  }
  read.add(file);
  let table: Record<string, unknown>;
  try {
    table = parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (error) {
    return {
      source: file,
      detail: `cannot be read or parsed (${error instanceof Error ? error.message.split("\n")[0] : String(error)}), so it may set one`,
    };
  }
  const targets = asTable(table.target);
  for (const [key, value] of Object.entries(targets)) {
    if ((key === host || key.startsWith("cfg(")) && asTable(value).runner !== undefined) {
      return { source: file, detail: `sets runner under [target.${quotedKey(key)}]` };
    }
  }
  const includes = Array.isArray(table.include) ? table.include : [table.include];
  for (const include of includes) {
    const path = typeof include === "string" ? include : asTable(include).path;
    if (typeof path === "string") {
      const found = fileRunner(resolve(dirname(file), path), host, read);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

// A key of the `target` table as a TOML table header writes it.
function quotedKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : `'${key}'`;
}

function asTable(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
