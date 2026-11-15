import type { ExecutorContext } from "@nx/devkit";
import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CargoInvocation, cargoEnvironment, printCommand } from "./cargo-invocation";
import {
  type CommandEnd,
  commandEnd,
  type CrateOutcome,
  type OutputCrate,
  readJsonStep,
  readTestStep,
} from "./cargo-output";
import { checksAfterCargo, type GroupInvocation, type PreparedTask } from "./task";

/** A task of a group whose checks before cargo passed, with the group's command. */
export interface GroupMember {
  /** The task as its checks before cargo left it. */
  prepared: PreparedTask;
  /** The group's command, and what the task does after it ({@link groupInvocations}). */
  invocation: GroupInvocation;
  /** The task's own executor context, for the checks after cargo. */
  context: ExecutorContext;
}

/** The result of one task of a group. */
export interface MemberResult {
  /** Whether the task passed every step of its group and the checks after them. */
  success: boolean;
  /** The task's part of each step's output, in order, with the plugin's lines after it. */
  output: string;
}

/**
 * Runs a group of tasks (`TERM-GROUP`): one cargo command for each step of
 * their target, in the workspace root with the group's environment, and the
 * checks that follow cargo for each task whose crate passed (`DES-BATCH`).
 * Every target has one step for now: the `test` of the nextest runner,
 * which has more (`DES-TEST-RUN`), is not implemented yet.
 *
 * Cargo's standard output and error go to one file, so that the output
 * keeps the order in which cargo and the test executables wrote it, and
 * nothing of it reaches the batch process's own output, which belongs to no
 * task (`EVD-NX-24-BATCHES`).
 *
 * A group of one crate runs the command that the task runs on its own and
 * passes where cargo exits with status 0, with the whole output as its
 * own. A group of several crates reads which crates passed from cargo's
 * output ({@link readJsonStep}, {@link readTestStep}); a step whose output
 * shows no result per crate, such as that of `cargo fmt`, fails every task
 * of the group when cargo fails. A task passes only where cargo's output
 * shows that its crate passed.
 *
 * Then each task whose crate passed runs the checks that a task run on its
 * own runs after cargo (`DES-LOCKFILE-HASHING`, "Post-check";
 * `DES-BUILD-INPUT-CHECK`), so that no task of a batch skips one.
 *
 * In a verbose run, the batch process prints each command's lines itself,
 * once, before cargo starts, with a first line that names the tasks of the
 * command, so that they belong to no task's output (`DES-INVOCATION`,
 * "Printing the command"): from the invocation that cargo is started with,
 * through {@link printCommand}, as a task run on its own prints them.
 *
 * @param members The tasks of one group, all with the same command.
 * @param verbose Whether the batch runs verbosely, as `batchRunsVerbosely`
 *   decides once for the batch from the batch process's own environment.
 * @returns One result per member, in order.
 */
// @mara implements DES-BATCH
// @mara implements DES-INVOCATION
export async function runGroup(
  members: readonly GroupMember[],
  verbose = false,
): Promise<MemberResult[]> {
  const [first] = members;
  if (first === undefined) {
    return [];
  }
  // The group's command, which cargo is started with and which a verbose
  // run prints.
  const invocation: CargoInvocation = {
    args: first.invocation.args,
    cwd: first.invocation.cwd,
    ...(first.invocation.env === undefined ? {} : { env: first.invocation.env }),
  };
  if (verbose) {
    await printCommand(members.map((member) => member.prepared.task).join(", "), invocation);
  }
  const run = await runCaptured(invocation, first.prepared.env);
  const end = commandEnd(run.code, run.signal, run.failure);
  const outcomes: CrateOutcome[] =
    members.length === 1
      ? [{ passed: end.kind === "succeeded", output: run.output }]
      : sharedOutcomes(members, run.output, end);
  return Promise.all(
    members.map(async (member, index) => {
      const outcome = outcomes[index];
      const lines = [
        ...(outcome.output === "" ? [] : [outcome.output]),
        ...(end.kind === "unexplained" ? [`${member.prepared.task}: ${end.reason}.`] : []),
        ...(outcome.message === undefined ? [] : [outcome.message]),
      ];
      if (!outcome.passed) {
        return { success: false, output: lines.join("\n") };
      }
      const { failures, warnings } = await checksAfterCargo(member.invocation, member.context);
      return {
        success: failures.length === 0,
        output: [...lines, ...warnings, ...failures].join("\n"),
      };
    }),
  );
}

// What the output of a command for several crates shows for each of them.
function sharedOutcomes(
  members: readonly GroupMember[],
  output: string,
  end: CommandEnd,
): CrateOutcome[] {
  const crates: OutputCrate[] = members.map(({ prepared, invocation }) => ({
    task: prepared.task,
    name: prepared.crate ?? "",
    spec: invocation.crate?.spec ?? "",
    ...(invocation.package === undefined ? {} : { package: invocation.package }),
    selection: prepared.options,
  }));
  switch (members[0].prepared.target) {
    case "build":
      return readJsonStep(output, end, crates, false);
    case "check":
    case "lint":
      return readJsonStep(output, end, crates, members[0].prepared.options.allTargets === true);
    case "test":
      return readTestStep(output, end, crates);
    default:
      return crates.map((crate) =>
        end.kind === "succeeded"
          ? { passed: true, output }
          : {
              passed: false,
              output,
              message: `${crate.task}: cargo failed, and its output does not show which of the crates of this cargo command failed, so it does not show that ${crate.name} passed.`,
            },
      );
  }
}

/** What a cargo command printed and how it ended. */
interface CapturedRun {
  /** Cargo's exit status; null where a signal stopped it or it did not start. */
  code: number | null;
  /** The signal that stopped cargo, if one did. */
  signal: string | null;
  /** What cargo wrote to its standard output and error, in order. */
  output: string;
  /** Why cargo did not run or end, where it did not exit. */
  failure?: string;
}

/**
 * Runs cargo with the group's environment and the variables of the
 * invocation, which no command of this version has, as for a task run on its
 * own (`DES-INVOCATION`), and its standard output and error both written to
 * one file in a folder of its own under the system's temporary folder, which
 * is removed afterwards. Signals that stop the batch reach cargo too.
 */
// @mara implements DES-INVOCATION
async function runCaptured(
  invocation: CargoInvocation,
  taskEnv: NodeJS.ProcessEnv,
): Promise<CapturedRun> {
  const folder = mkdtempSync(join(tmpdir(), "nx-rust-"));
  const file = join(folder, "output");
  let fd: number | undefined = openSync(file, "w");
  try {
    const end = await new Promise<{
      code: number | null;
      signal: string | null;
      failure?: string;
    }>((resolve) => {
      const child = spawn("cargo", invocation.args, {
        cwd: invocation.cwd,
        env: cargoEnvironment(invocation, taskEnv),
        stdio: ["ignore", fd, fd],
      });
      const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
      const forward = (signal: NodeJS.Signals) => child.kill(signal);
      for (const signal of signals) {
        process.on(signal, forward);
      }
      const finish = (result: { code: number | null; signal: string | null; failure?: string }) => {
        for (const signal of signals) {
          process.off(signal, forward);
        }
        resolve(result);
      };
      child.on("error", (error: NodeJS.ErrnoException) =>
        finish({
          code: null,
          signal: null,
          failure:
            error.code === "ENOENT"
              ? `cargo was not found on PATH (${error.message})`
              : `cargo could not be started: ${error.message}`,
        }),
      );
      child.on("close", (code, signal) => finish({ code, signal }));
    });
    closeSync(fd);
    fd = undefined;
    return {
      code: end.code,
      signal: end.signal,
      output: readFileSync(file, "utf8").replace(/\n$/, ""),
      ...(end.failure === undefined ? {} : { failure: end.failure }),
    };
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
    rmSync(folder, { recursive: true, force: true });
  }
}
