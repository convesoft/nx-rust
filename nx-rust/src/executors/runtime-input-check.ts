import { spawnSync } from "node:child_process";
import { commandIdVariable } from "../graph/lockfile-task";
import { failedInputLine, inputErrorsVariable } from "../graph/script-input";

/**
 * What each command gave in this process, by its text and environment, so
 * that the tasks of a batch with the same command and environment run it
 * once.
 */
const outcomes = new Map<string, string | undefined>();

/**
 * One warning for each runtime input of the task's target that runs one of
 * the plugin's Node scripts and fails when the executor runs its command
 * again, in the repository root with the task's environment, as Nx runs it
 * when it hashes the task (`DES-INPUTS`, "Failing runtime inputs"). Nx shows
 * nothing of a runtime input, neither its status nor its standard error, and
 * keys the task on what it prints (`EVD-RUNTIME-INPUT-SCRIPTS`), so where
 * the script fails, the command prints a value that never repeats and Nx
 * never restores the task. The executor cannot see what Nx hashed, so the
 * warning says what this run of the command gave, the command and what the
 * script wrote to its standard error, and that a failure the same way when
 * Nx computed the key keeps the result from being restored.
 *
 * The commands are recognised by the line they print when they fail
 * ({@link failedInputLine}). The environment leaves out the command id of
 * the plugin's hook, so that the mode command of `DES-TEST-MODE` adds
 * nothing to the command's record. A failure that is gone by the time the
 * task runs gives no warning.
 *
 * @param inputs The `inputs` of the task's target, as Nx resolved them.
 * @param root The repository root.
 * @param env The task's environment.
 */
// @mara implements DES-INPUTS
export function failedInputWarnings(
  task: string,
  inputs: readonly unknown[] | undefined,
  root: string,
  env: NodeJS.ProcessEnv,
): string[] {
  const commands = (inputs ?? []).flatMap((input) =>
    typeof input === "object" &&
    input !== null &&
    "runtime" in input &&
    typeof input.runtime === "string" &&
    input.runtime.includes(failedInputLine)
      ? [input.runtime]
      : [],
  );
  const warnings: string[] = [];
  for (const command of new Set(commands)) {
    const error = failure(command, root, env);
    if (error !== undefined) {
      warnings.push(
        [
          `${task}: a runtime input that @convesoft/nx-rust gives this task failed when the executor ran it for this task, in the repository root with the task's environment. The command`,
          `  ${command}`,
          error === ""
            ? "printed the line that says so, and its script wrote nothing to standard error."
            : `printed the line that says so, and its script wrote to standard error:\n${error}`,
          "If it failed the same way when Nx computed the task's cache key, that key repeats in no other run, and Nx does not restore this result from its cache.",
        ].join("\n"),
      );
    }
  }
  return warnings;
}

// What the script of `command` wrote to its standard error where the
// command prints the line of a failure, and `undefined` where it does not.
function failure(command: string, root: string, env: NodeJS.ProcessEnv): string | undefined {
  const runEnv: NodeJS.ProcessEnv = { ...env, [inputErrorsVariable]: "2" };
  delete runEnv[commandIdVariable];
  const key = JSON.stringify([
    command,
    root,
    Object.entries(runEnv).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
  if (outcomes.has(key)) {
    return outcomes.get(key);
  }
  const run = spawnSync("sh", ["-c", command], {
    cwd: root,
    env: runEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Where no shell starts, the executor cannot tell, and says nothing.
  const outcome =
    run.error === undefined && run.stdout.split("\n").includes(failedInputLine)
      ? run.stderr.trim()
      : undefined;
  outcomes.set(key, outcome);
  return outcome;
}
