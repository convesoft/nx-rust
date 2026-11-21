import type { ExecutorContext } from "@nx/devkit";
import { spawn } from "node:child_process";
import { type CargoInvocation, cargoEnvironment, printCommand } from "./cargo-invocation";
import { checkDigests, writeDigests } from "./digests";
import { type BuildInputCheck, checkBuildInputs } from "./input-check";
import {
  NxTaskFilesError,
  nxTaskFileParts,
  nxTaskFiles,
  skippedCheckWarning,
} from "./nx-task-files";
import type { DigestStep } from "./task-guards";

/** The cargo command of one task and the lines it prints before cargo starts. */
export interface TaskInvocation extends CargoInvocation {
  /** One warning line per option that the task ignores (`DES-UNKNOWN-OPTIONS`). */
  warnings: string[];
  /**
   * What the task does with the workspace's lockfile once cargo has succeeded
   * (`DES-LOCKFILE-HASHING`): the lockfile task writes the members' digests,
   * and a task whose key holds digests checks them again.
   */
  digests?: DigestStep;
  /**
   * On a crate's `build`: the check of the files that cargo recorded for the
   * crate against the task's inputs, after cargo has succeeded
   * (`DES-BUILD-INPUT-CHECK`).
   */
  inputCheck?: BuildInputCheck;
}

/**
 * The message of a failed `hakari-check`, after cargo-hakari's own output
 * (`DES-UNIFICATION`, "Drift"; `DES-DIAGNOSTICS`): which command failed, and
 * that running `cargo hakari generate` and `cargo hakari manage-deps` and
 * committing the result brings the hack crate up to date.
 */
// @mara implements DES-DIAGNOSTICS
export function hakariCheckFailure(task: string, args: readonly string[]): string {
  return `${task}: \`cargo ${args.join(" ")}\` failed, so the hack crate of cargo-hakari is not current, or cargo-hakari could not read the package graph, as its output above says. No task of the workspace's crates that depends on this check runs, so that Nx stores no result for them. Run \`cargo hakari generate\` and \`cargo hakari manage-deps\` in the workspace root and commit the result.`;
}

/**
 * The checks of a task after its cargo call has succeeded, in one step
 * (`DES-LOCKFILE-HASHING`, "Post-check"): first what the task does with the
 * lockfile's digests, which the lockfile task writes and a cached task
 * computes again, then, on a crate's `build`, the comparison of the files
 * that cargo recorded with the task's inputs (`DES-BUILD-INPUT-CHECK`). Both
 * run, so that a failed task names every problem at once.
 *
 * @returns The failure messages, without which the task succeeds, and the
 *   warning that the input check did not run, for the task's output.
 */
// @mara implements DES-LOCKFILE-HASHING
// @mara implements DES-BUILD-INPUT-CHECK
export async function checksAfterCargo(
  invocation: Pick<TaskInvocation, "digests" | "inputCheck">,
  context: ExecutorContext,
): Promise<{ failures: string[]; warnings: string[] }> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const step = invocation.digests;
  const digestFailure =
    step === undefined
      ? undefined
      : step.kind === "write"
        ? writeDigests(`${context.projectName ?? ""}:${context.targetName ?? ""}`, step)
        : checkDigests(step);
  if (digestFailure !== undefined) {
    failures.push(digestFailure);
  }
  const check = invocation.inputCheck;
  if (check !== undefined) {
    // Where the installed Nx lacks a part that the check needs, which only
    // an Nx that the plugin does not support can, the task warns and the
    // check does not run (`DES-DIAGNOSTICS`).
    try {
      const parts = nxTaskFileParts(context.root);
      const inputFailure = await checkBuildInputs(check, context.root, () =>
        nxTaskFiles(parts, context),
      );
      if (inputFailure !== undefined) {
        failures.push(inputFailure);
      }
    } catch (error) {
      if (!(error instanceof NxTaskFilesError)) {
        throw error;
      }
      warnings.push(skippedCheckWarning(check.task, error));
    }
  }
  return { failures, warnings };
}

/**
 * Runs cargo for a task with the task's environment and the variables of the
 * invocation, which no command of this version has, and with the task's
 * standard streams. Signals that stop the executor reach cargo too.
 *
 * @param taskEnv The task's environment without the variables by which Nx
 *   tells it how it runs and records it (`cargoTaskEnvironment`).
 *
 * Unlike graph creation (`runCargoForGraph`), a task sets no
 * `RUSTUP_AUTO_INSTALL`, so rustup behaves as for plain cargo.
 *
 * @param shownFor In a verbose run, the task whose command it is: the
 *   command's lines ({@link printCommand}), built from the same invocation,
 *   go to standard error before cargo starts (`DES-INVOCATION`, "Printing the
 *   command"). Undefined in every other run, which prints nothing of it.
 * @returns Whether cargo exited with status 0.
 */
// @mara implements DES-INVOCATION
export async function runCargo(
  invocation: CargoInvocation,
  taskEnv: NodeJS.ProcessEnv,
  shownFor?: string,
): Promise<boolean> {
  if (shownFor !== undefined) {
    // Written out before cargo starts, whose output goes to the same streams.
    await printCommand(shownFor, invocation);
  }
  return new Promise((resolve) => {
    const child = spawn("cargo", invocation.args, {
      cwd: invocation.cwd,
      env: cargoEnvironment(invocation, taskEnv),
      stdio: "inherit",
    });
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    for (const signal of signals) {
      process.on(signal, forward);
    }
    const finish = (success: boolean) => {
      for (const signal of signals) {
        process.off(signal, forward);
      }
      resolve(success);
    };
    child.on("error", (error: NodeJS.ErrnoException) => {
      console.error(
        error.code === "ENOENT"
          ? `cargo was not found on PATH (${error.message}).`
          : `cargo could not be started: ${error.message}`,
      );
      finish(false);
    });
    child.on("close", (code) => finish(code === 0));
  });
}
