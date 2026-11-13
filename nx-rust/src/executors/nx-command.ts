import type { PreTasksExecutionContext } from "@nx/devkit";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { runIdVariable } from "../graph/lockfile-task";

/**
 * The variable in which the plugin's `preTasksExecution` hook records the
 * arguments of the `nx` command for the command's tasks, as a JSON list of
 * strings (`DES-UNKNOWN-OPTIONS`, paragraph "Record").
 */
export const nxCommandVariable = "NX_RUST_NX_COMMAND";

/**
 * The longest record, in bytes. Linux refuses to start a process with an
 * environment variable longer than 128 KiB, so a longer record would fail
 * every task of the command; it is left empty instead, which counts as no
 * record.
 */
export const maxRecordBytes = 64 * 1024;

/**
 * The variables that the hook sets for the tasks of a command, each computed
 * from the command's arguments as Nx gives them to the hook: `process.argv`
 * of the `nx` process, `--` included.
 *
 * Every variable here is set on every command, so that a value left in the
 * environment by an earlier command, such as in the Nx daemon, which runs the
 * hook in its own process, never reaches a task:
 *
 * - `NX_RUST_NX_COMMAND`, the arguments as a JSON list (`DES-UNKNOWN-OPTIONS`);
 * - `NX_RUST_RUN_ID`, a value that no other run has when the command excludes
 *   task dependencies, and the empty string otherwise
 *   (`DES-LOCKFILE-HASHING`, "Excluded dependencies"). Every cached target
 *   that depends on the lockfile task hashes it, so that such a run, which
 *   runs no lockfile task, runs those tasks and stores nothing that is
 *   restored again, while a normal run keeps its keys.
 */
// @mara implements DES-LOCKFILE-HASHING
export function commandRecords(argv: readonly string[]): Record<string, string> {
  const record = JSON.stringify(argv);
  return {
    [nxCommandVariable]: Buffer.byteLength(record) <= maxRecordBytes ? record : "",
    [runIdVariable]: excludesTaskDependencies(argv) ? randomUUID() : "",
  };
}

/**
 * Whether the arguments of an `nx` command exclude task dependencies, as
 * Nx reads its boolean option `excludeTaskDependencies`: with the
 * `yargs-parser` of the installed `nx` package, which takes
 * `--exclude-task-dependencies`, `--excludeTaskDependencies`, `=true`,
 * `=false` and `--no-exclude-task-dependencies` as Nx does. Words after
 * `--` go to the tasks and do not count.
 */
export function excludesTaskDependencies(argv: readonly string[]): boolean {
  const parsed = nxParser()([...argv], {
    boolean: ["excludeTaskDependencies"],
    configuration: { "populate--": true },
  });
  return parsed.excludeTaskDependencies === true;
}

/**
 * The plugin's `preTasksExecution` hook, which Nx calls once per entry of the
 * plugin before a command such as `nx run`, `nx run-many` or `nx affected`
 * runs its tasks.
 *
 * It assigns each of {@link commandRecords} to `process.env`. Nx carries
 * such an assignment to the `nx` process, whose tasks inherit it, also when
 * the hook runs in the daemon or in a plugin worker, where Nx records the
 * assignment and applies it to the `nx` process; a deletion would not be
 * carried (`EVD-NX-OPTION-VALIDATION`). The command's record enters no
 * task's cache key; `NX_RUST_RUN_ID` enters the keys of the targets that
 * depend on the lockfile task. Every task of a command gets the same values.
 */
// @mara implements DES-UNKNOWN-OPTIONS
export function preTasksExecution(_options: unknown, context: PreTasksExecutionContext): void {
  for (const [name, value] of Object.entries(commandRecords(context.argv ?? []))) {
    process.env[name] = value;
  }
}

/**
 * The arguments of the `nx` command that started the task, as the hook
 * recorded them in `env`, or `undefined` when there is no record, when it is
 * empty, or when it is not a JSON list of strings.
 */
export function recordedNxCommand(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const value = env[nxCommandVariable];
  if (value === undefined || value === "") {
    return undefined;
  }
  try {
    const argv: unknown = JSON.parse(value);
    return Array.isArray(argv) && argv.every((word) => typeof word === "string") ? argv : undefined;
  } catch {
    return undefined;
  }
}

/** The options that Nx parses from arguments it hands a task, keyed as Nx keys them. */
export type ParsedOverrides = Record<string, unknown> & { _?: unknown[] };

type YargsParser = (
  args: string[],
  options: { boolean?: string[]; configuration: Record<string, boolean> },
) => Record<string, unknown> & { _: unknown[] };

let nxYargsParser: YargsParser | undefined;

// The `yargs-parser` that the installed `nx` package uses.
function nxParser(): YargsParser {
  nxYargsParser ??= createRequire(require.resolve("nx/package.json"))("yargs-parser");
  return nxYargsParser;
}

/**
 * The options that Nx parses from `args` when it hands them to a task as
 * overrides: with the `yargs-parser` that the installed `nx` package uses,
 * configured as Nx configures it there (`createOverrides` in
 * `utils/command-line-utils.js` of `nx` 24), and without `_` when no
 * positional word is left.
 */
export function parseAsNx(args: readonly string[]): ParsedOverrides {
  const parsed: ParsedOverrides = nxParser()([...args], {
    configuration: { "camel-case-expansion": false, "dot-notation": true },
  });
  if (parsed._ === undefined || parsed._.length === 0) {
    delete parsed._;
  }
  return parsed;
}
