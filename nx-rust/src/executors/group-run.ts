import type { ExecutorContext } from "@nx/devkit";
import type { CargoPackage } from "../cargo/metadata";
import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { type CargoInvocation, cargoEnvironment, printCommand } from "./cargo-invocation";
import {
  type CommandEnd,
  commandEnd,
  type CrateOutcome,
  type OutputCrate,
  type OutputScope,
  readJsonStep,
  readTestStep,
} from "./cargo-output";
import type { CrateSelection } from "./affected";
import { affectedSelection } from "./affected-run";
import {
  type CargoStep,
  nextestListArguments,
  reportsLibrary,
  withToolConfiguration,
} from "./command";
import {
  type ListedTests,
  type NextestToolConfiguration,
  nextestEnd,
  parseNextestList,
  readJunitReport,
  readNextestStep,
  removeToolConfiguration,
  writeToolConfiguration,
} from "./nextest";
import { type DeniedWarnings, deniedWarnings } from "../cargo/warnings-setting";
import { withDeniedWarnings } from "./denied-warnings";
import { resetNxWorkspaceContext } from "./nx-task-files";
import { checksAfterCargo, type GroupInvocation, type PreparedTask } from "./task";
import { packagesVariable, type RecordEntry, recordVariable } from "./test-runner";
import {
  readDoctestStep,
  readTestBinariesStep,
  readTestsBuildStep,
  type RunnerRecord,
  type RunnerRecords,
} from "./test-steps";

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
 * What a batch shows of cargo's output while a group's command runs, besides
 * each task's result (`DES-BATCH`, "Cargo's output while a batch runs"):
 *
 * - `lines`: cargo's lines as they arrive, on the batch process's standard
 *   error, where Nx's terminal UI shows them in the batch's pane;
 * - `status`: one line each time a cargo command starts, naming the command,
 *   its crates and the step;
 * - `none`: nothing, as for a task run on its own, whose output is its own.
 *
 * Neither line belongs to a task: no task's stored output changes.
 */
export type LiveOutput = "lines" | "status" | "none";

/**
 * What a batch process shows of cargo's output while it runs
 * ({@link LiveOutput}): its lines under Nx's terminal UI, which Nx tells the
 * batch process with `NX_TUI=true`, and a status line in every other output
 * style, which the batch process cannot tell apart (`EVD-NX-24-BATCHES`,
 * "Terminal output"). The maintainer chose this on 15 November 2026.
 *
 * @param batchEnv The batch process's own environment.
 */
// @mara implements DES-BATCH
export function batchLiveOutput(batchEnv: NodeJS.ProcessEnv): LiveOutput {
  return batchEnv.NX_TUI === "true" ? "lines" : "status";
}

/**
 * Runs a group of tasks (`TERM-GROUP`): one cargo command for each step of
 * their target, in the workspace root with the group's environment, and the
 * checks that follow cargo for each task whose crate passed every step
 * (`DES-BATCH`).
 *
 * Cargo's standard output and error go to one file, so that the output
 * keeps the order in which cargo and the test executables wrote it, and only
 * what {@link LiveOutput} asks for reaches the batch process's own output,
 * which belongs to no task (`EVD-NX-24-BATCHES`).
 *
 * Each step runs even where a step before it failed for some crates, and a
 * step is left out where no crate of the group can take part any more:
 * where every task has failed, and for the doctests where no crate of the
 * group has a library. A group of one crate, and a group of one task that
 * selects its crate, runs the command that its task runs on its own and
 * passes where cargo exits with status 0, with the whole output as its own.
 * A group that selects the whole workspace, and a group of several crates,
 * reads which crates passed from cargo's output ({@link readJsonStep},
 * {@link readTestStep} and the steps of `test-steps.ts`); a step whose
 * output shows no result per crate, such as that of `cargo fmt`, fails
 * every task of the group when cargo fails. A task passes only where cargo's
 * output shows that its crate passed.
 *
 * Then each task whose crate passed runs the checks that a task run on its
 * own runs after cargo (`DES-LOCKFILE-HASHING`, "Post-check";
 * `DES-BUILD-INPUT-CHECK`), so that no task of a batch skips one.
 *
 * In a verbose run, each command's lines are printed once, before cargo
 * starts, with a first line that names the tasks of the command, so that
 * they belong to no task's output in a batch (`DES-INVOCATION`, "Printing
 * the command"): from the invocation that cargo is started with, through
 * {@link printCommand}.
 *
 * @param members The tasks of one group, all with the same command.
 * @param verbose Whether the run is verbose: as `batchRunsVerbosely`
 *   decides once for the batch, or `taskRunsVerbosely` for a task on its own.
 * @param live What the batch shows of cargo's output while it runs.
 * @param observe Receives each step's whole output once cargo has ended, as
 *   `napi-build` and `wasm-build` need it for the library that cargo
 *   reports (`DES-NAPI`, `DES-WASM`).
 * @returns One result per member, in order.
 */
// @mara implements DES-BATCH
// @mara implements DES-INVOCATION
// @mara implements DES-TEST-RUN
export async function runGroup(
  members: readonly GroupMember[],
  verbose = false,
  live: LiveOutput = "none",
  observe?: (step: CargoStep, output: string) => void,
): Promise<MemberResult[]> {
  const [first] = members;
  if (first === undefined) {
    return [];
  }
  const { cwd } = first.invocation;
  const steps: CargoStep[] = (
    first.invocation.steps ?? [{ kind: "command", args: first.invocation.args }]
  ).filter(
    (step) =>
      step.kind !== "doctests" || members.some((member) => hasLibrary(member.invocation.package)),
  );
  const crates: OutputCrate[] = members.map(({ prepared, invocation }) => ({
    task: prepared.task,
    name: prepared.crate ?? "",
    spec: invocation.crate?.spec ?? "",
    ...(invocation.package === undefined ? {} : { package: invocation.package }),
    selection: prepared.options,
  }));
  const scope: OutputScope | undefined =
    first.invocation.workspaceMembers === undefined
      ? undefined
      : { members: first.invocation.workspaceMembers, root: cwd };
  const state = members.map(() => ({ failed: false, lines: [] as string[] }));
  const label = members.map((member) => member.prepared.task).join(", ");
  // Steps 1 and 2 of `DES-TEST-RUN` where the group selects affected tests:
  // the selection goes into the nextest step's `-E` arguments, and an empty
  // one leaves the step out.
  const selected = await selectAffected(members, steps, state, verbose);
  for (const [index, step] of steps.entries()) {
    if (state.every((entry) => entry.failed)) {
      break;
    }
    if (selected === "none" && (step.kind === "nextest" || index === 0)) {
      continue;
    }
    const record =
      step.kind === "test-binaries" ? mkdtempSync(join(tmpdir(), "nx-rust-record-")) : undefined;
    const toolConfiguration: NextestToolConfiguration | undefined =
      step.kind === "nextest" ? writeToolConfiguration() : undefined;
    const packages = `:${crates.map((crate) => crate.name).join(":")}:`;
    const invocation: CargoInvocation = {
      args:
        toolConfiguration === undefined
          ? step.args
          : withToolConfiguration(step.args, toolConfiguration.file),
      cwd,
      ...(record === undefined
        ? first.invocation.env === undefined
          ? {}
          : { env: first.invocation.env }
        : {
            env: {
              ...first.invocation.env,
              [packagesVariable]: packages,
              [recordVariable]: record,
            },
          }),
    };
    try {
      if (live === "status") {
        await writeStderr(
          `@convesoft/nx-rust: cargo ${step.args[0]} for ${members
            .map((member) => member.prepared.crate ?? member.prepared.task.split(":")[0])
            .join(", ")} (step ${index + 1} of ${steps.length})\n`,
        );
      }
      if (verbose) {
        await printCommand(label, invocation);
      }
      const run = await runCaptured(invocation, first.prepared.env, live === "lines");
      observe?.(step, run.output);
      let unexplained: string | undefined;
      let outcomes: CrateOutcome[];
      if (toolConfiguration !== undefined) {
        const end = nextestEnd(run.code, run.signal, run.failure);
        unexplained = end.kind === "unexplained" ? end.reason : undefined;
        const report = readJunitReport(toolConfiguration.report);
        // Where nextest exits with 100, a test failed or the run ended early:
        // its list says which tests the run was to run (`DES-TEST-RUN`).
        let listed: ListedTests | undefined;
        if (end.kind === "tests-failed" && "cases" in report && step.listArgs !== undefined) {
          const list: CargoInvocation = { ...invocation, args: step.listArgs };
          if (verbose) {
            await printCommand(label, list);
          }
          listed = await listNextestTests(list, first.prepared.env);
        }
        outcomes = readNextestStep(
          run.output,
          end,
          crates,
          scope,
          report,
          listed,
          selected === "some",
        );
      } else {
        const end = commandEnd(run.code, run.signal, run.failure);
        unexplained = end.kind === "unexplained" ? end.reason : undefined;
        outcomes = readStep(
          step,
          run.output,
          end,
          crates,
          members,
          scope,
          record,
          packages,
          first.invocation.runner,
          () => deniedWarnings(cwd, cargoEnvironment(invocation, first.prepared.env)),
        );
      }
      outcomes.forEach((outcome, at) => {
        const entry = state[at];
        if (outcome.output !== "") {
          entry.lines.push(outcome.output);
        }
        if (unexplained !== undefined) {
          entry.lines.push(`${members[at].prepared.task}: ${unexplained}.`);
        }
        if (outcome.message !== undefined) {
          entry.lines.push(outcome.message);
        }
        if (!outcome.passed) {
          entry.failed = true;
        }
      });
    } finally {
      if (record !== undefined) {
        removeRecord(record);
      }
      if (toolConfiguration !== undefined) {
        removeToolConfiguration(toolConfiguration);
      }
    }
  }
  // The build input checks read the repository's files from Nx's workspace
  // context, which this process keeps from its first use, also across the
  // groups of a batch. Cleared once here, after the group's cargo calls and
  // before any member's check, it is listed again from the files as these
  // calls left them (`DES-BUILD-INPUT-CHECK`, point 5). The members' checks
  // run at the same time, so none clears it for itself.
  if (
    members.some(
      (member, index) => !state[index].failed && member.invocation.inputCheck !== undefined,
    )
  ) {
    resetNxWorkspaceContext(first.context.root);
  }
  return Promise.all(
    members.map(async (member, index) => {
      const { failed, lines } = state[index];
      if (failed) {
        return { success: false, output: lines.join("\n") };
      }
      const { failures, warnings } = await checksAfterCargo(
        members.length > 1 ? sharedCommandChecks(member.invocation) : member.invocation,
        member.context,
      );
      return {
        success: failures.length === 0,
        output: [...lines, ...warnings, ...failures].join("\n"),
      };
    }),
  );
}

/**
 * Steps 1 and 2 of `DES-TEST-RUN` for a nextest group of the `test` target
 * whose tasks select affected tests ({@link affectedSelection}): where they
 * give a selection, the first step, `cargo nextest run`, gets its `-E`
 * arguments in place of the group's package filterset, and its list command
 * the same; each task's output says what it runs and why. Where they give
 * the full suite, each selecting task says why, and the steps stay as they
 * are.
 *
 * @returns `"some"` where the nextest step runs a selection, `"none"` where
 *   no test is selected, so that the group leaves the nextest step out, and
 *   `undefined` where the group runs its full suite.
 */
// @mara implements DES-TEST-RUN
async function selectAffected(
  members: readonly GroupMember[],
  steps: CargoStep[],
  state: { failed: boolean; lines: string[] }[],
  verbose: boolean,
): Promise<"some" | "none" | undefined> {
  const [first] = members;
  const step = steps[0];
  if (
    first === undefined ||
    step === undefined ||
    first.prepared.target !== "test" ||
    first.prepared.testRunner !== "nextest" ||
    !members.some((member) => member.prepared.testMode?.selects === true)
  ) {
    return undefined;
  }
  const outcome = await affectedSelection(
    members.map(({ prepared, context }) => ({ prepared, context })),
    first.invocation.affectedMembers ?? [],
    step.args,
    verbose,
  );
  const mode = first.prepared.testMode?.mode;
  const baseline = mode?.kind === "affected" ? mode.commits.join(",") : "";
  if (outcome.kind === "full") {
    members.forEach((member, index) => {
      if (member.prepared.testMode?.selects === true) {
        state[index].lines.push(
          `${member.prepared.task}: runs the full suite, because ${outcome.reason}.`,
        );
      }
    });
    return undefined;
  }
  members.forEach((member, index) => {
    state[index].lines.push(
      selectionLine(
        member.prepared.task,
        member.prepared.crate ?? "",
        outcome.crates.get(member.prepared.crate ?? ""),
        baseline,
      ),
    );
  });
  if (outcome.filtersets.length === 0) {
    return "none";
  }
  const args = [...withoutFiltersets(step.args), ...outcome.filtersets];
  steps[0] = {
    ...step,
    args,
    ...(step.listArgs === undefined ? {} : { listArgs: nextestListArguments(args) }),
  };
  return "some";
}

// The arguments of a nextest command without its `-E` arguments.
function withoutFiltersets(args: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-E") {
      index += 1;
      continue;
    }
    kept.push(args[index]);
  }
  return kept;
}

/**
 * The line that says what a task of an affected group runs and why
 * (`REQ-AFFECTED-TESTS`): all its tests, the tests that cargo-affected
 * selected, with every integration test where its binary may have changed,
 * or none, and why that is enough.
 */
export function selectionLine(
  task: string,
  crate: string,
  selection: CrateSelection | undefined,
  baseline: string,
): string {
  if (selection?.kind === "all") {
    return `${task}: runs all tests of ${crate}, because ${selection.reasons.slice(0, 3).join("; ")}${selection.reasons.length > 3 ? `; and ${selection.reasons.length - 3} more` : ""}.`;
  }
  const count = [...(selection?.tests.values() ?? [])].reduce((sum, tests) => sum + tests.size, 0);
  if (count === 0 && selection?.integration === undefined) {
    return `${task}: no test of ${crate} is selected: the coverage baseline ${baseline} shows no test of ${crate} that runs the changed code, and no change that coverage cannot follow is among the inputs of its tests, so no test of ${crate} can be affected as far as the plugin can see. Its doctests still run. This result stands for affected mode only, never for the full suite.`;
  }
  const parts = [
    ...(count === 0
      ? []
      : [
          `${count} ${count === 1 ? "test" : "tests"} of ${crate} that cargo-affected selected against the coverage baseline ${baseline}`,
        ]),
    ...(selection?.integration === undefined
      ? []
      : [`every integration test of ${crate}, because ${selection.integration}`]),
  ];
  return `${task}: runs a subset of its tests for this change: ${parts.join(", and ")}. This result stands for affected mode only, never for the full suite.`;
}

/**
 * The checks after cargo of a task that shared its group's command with
 * other tasks: under `hakari`, the post-check compares the digests of every
 * member, although the task's key holds its own, because its result rests
 * on the drift check, which judged the whole lockfile (`DES-LOCKFILE-HASHING`,
 * "Post-check"). Under the other strategies the key holds them already.
 */
// @mara implements DES-LOCKFILE-HASHING
export function sharedCommandChecks(invocation: GroupInvocation): GroupInvocation {
  const digests = invocation.digests;
  return digests?.kind === "check" && digests.sharedMembers !== undefined
    ? { ...invocation, digests: { ...digests, members: digests.sharedMembers } }
    : invocation;
}

/**
 * Whether a crate has a library, whose doctests the doctest step runs; cargo
 * fails `cargo test --doc` for a crate without one.
 */
export function hasLibrary(pkg: CargoPackage | undefined): boolean {
  return (pkg?.targets ?? []).some(
    (target) =>
      !target.kind.some((kind) =>
        ["bin", "test", "example", "bench", "custom-build"].includes(kind),
      ),
  );
}

// What one step's output shows for each crate.
function readStep(
  step: CargoStep,
  output: string,
  end: CommandEnd,
  crates: readonly OutputCrate[],
  members: readonly GroupMember[],
  scope: OutputScope | undefined,
  record: string | undefined,
  packages: string,
  runner: readonly string[] | undefined,
  denied: () => DeniedWarnings | undefined,
): CrateOutcome[] {
  // A group of one crate that selects it runs the command that its task runs
  // on its own, and passes each step where cargo exits with status 0. The
  // compiles of the artifact targets print JSON messages also for one crate
  // (`DES-NAPI`, `DES-WASM`), which their output is read from.
  if (members.length === 1 && scope === undefined && !reportsLibrary(members[0].prepared.target)) {
    return [{ passed: end.kind === "succeeded", output }];
  }
  switch (step.kind) {
    case "tests-build":
      return readTestsBuildStep(output, end, crates, scope as OutputScope);
    case "test-binaries":
      return readTestBinariesStep(
        output,
        end,
        crates,
        scope as OutputScope,
        readRecords(record as string),
        { command: runner ?? [], packages },
      );
    case "doctests":
      // Crates selected with `-p` show their failed doctest targets in
      // cargo's list as a `cargo test` of those crates does.
      return scope === undefined
        ? readTestStep(output, end, crates)
        : readDoctestStep(output, end, crates, scope);
    case "nextest":
      throw new Error("A nextest step is read from its JUnit report (readNextestStep).");
    case "command":
      return sharedOutcomes(members, crates, output, end, scope, denied);
  }
}

// What the output of a command for several crates, or for the whole
// workspace, shows for each crate. A command with JSON messages also fails
// every task that passed where its messages report a warning and Cargo
// denies warnings (`DES-BATCH`, "Denied warnings").
function sharedOutcomes(
  members: readonly GroupMember[],
  crates: readonly OutputCrate[],
  output: string,
  end: CommandEnd,
  scope: OutputScope | undefined,
  denied: () => DeniedWarnings | undefined,
): CrateOutcome[] {
  const withWarnings = (outcomes: CrateOutcome[]) =>
    withDeniedWarnings(
      outcomes,
      output,
      crates.map((crate) => crate.task),
      denied,
    );
  switch (members[0].prepared.target) {
    case "build":
    case "napi-build":
      return withWarnings(readJsonStep(output, end, crates, false, scope));
    case "wasm-build":
      // Its compile builds the libraries alone, with `--lib` (`DES-WASM`).
      return withWarnings(readJsonStep(output, end, crates, false, scope, true));
    case "check":
    case "lint":
      return withWarnings(
        readJsonStep(
          output,
          end,
          crates,
          members[0].prepared.options.allTargets === true,
          scope,
        ),
      );
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

/**
 * Runs `cargo nextest list --message-format json` with the group's
 * environment, as its nextest step ran, and reads the tests that it lists
 * as matching the run's filters from its standard output
 * ({@link parseNextestList}); cargo's own lines on its standard error are
 * left out of every task's output, since the step's output already holds
 * the build.
 */
// @mara implements DES-TEST-RUN
async function listNextestTests(
  invocation: CargoInvocation,
  taskEnv: NodeJS.ProcessEnv,
): Promise<ListedTests> {
  return new Promise((resolve) => {
    const child = spawn("cargo", invocation.args, {
      cwd: invocation.cwd,
      env: cargoEnvironment(invocation, taskEnv),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) =>
      resolve({ unreadable: `cargo nextest list could not be started: ${error.message}` }),
    );
    child.on("close", (code, signal) => {
      if (code !== 0) {
        const tail = Buffer.concat(stderr).toString("utf8").trim().split("\n").slice(-3).join(" ");
        resolve({
          unreadable: `cargo nextest list ${signal === null ? `exited with status ${code}` : `was stopped by ${signal}`}${tail === "" ? "" : `: ${tail}`}`,
        });
        return;
      }
      resolve(parseNextestList(Buffer.concat(stdout).toString("utf8")));
    });
  });
}

/**
 * What the selecting runner recorded in `folder` ({@link RunnerRecords}):
 * one record per file, each a start followed by what came after it.
 */
export function readRecords(folder: string): RunnerRecords {
  let files: string[];
  try {
    files = readdirSync(folder).sort();
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
  const records: RunnerRecord[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(folder, file), "utf8");
    } catch (error) {
      return { unreadable: error instanceof Error ? error.message : String(error) };
    }
    const record: RunnerRecord = { file, after: [] };
    const lines = text.split("\n").filter((line) => line !== "");
    for (const [index, line] of lines.entries()) {
      let entry: RecordEntry;
      try {
        entry = JSON.parse(line) as RecordEntry;
      } catch {
        record.malformed ??= line;
        continue;
      }
      if (index === 0 && "start" in entry) {
        record.start = entry.start;
      } else if (index > 0 && !("start" in entry)) {
        record.after.push(entry);
      } else {
        record.malformed ??= line;
      }
    }
    records.push(record);
  }
  return { records };
}

// Removes a record folder, also one whose permissions a test took away.
function removeRecord(folder: string): void {
  try {
    chmodSync(folder, 0o700);
  } catch {
    // Already gone or not ours: rmSync reports nothing either way.
  }
  rmSync(folder, { recursive: true, force: true });
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
 * invocation, as for a task run on its own (`DES-INVOCATION`), and its
 * standard output and error both written to one file in a folder of its own
 * under the system's temporary folder, which is removed afterwards. Signals
 * that stop the process reach cargo too.
 *
 * @param showLines Whether cargo's lines also go to this process's standard
 *   error as they arrive ({@link LiveOutput}): read back from the file, so
 *   that the file, and with it every task's output, is the same either way.
 */
// @mara implements DES-INVOCATION
async function runCaptured(
  invocation: CargoInvocation,
  taskEnv: NodeJS.ProcessEnv,
  showLines: boolean,
): Promise<CapturedRun> {
  const folder = mkdtempSync(join(tmpdir(), "nx-rust-"));
  const file = join(folder, "output");
  let fd: number | undefined = openSync(file, "w");
  const shown = showLines ? new LineForwarder(file) : undefined;
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
    await shown?.stop();
    return {
      code: end.code,
      signal: end.signal,
      output: readFileSync(file, "utf8").replace(/\n$/, ""),
      ...(end.failure === undefined ? {} : { failure: end.failure }),
    };
  } finally {
    shown?.close();
    if (fd !== undefined) {
      closeSync(fd);
    }
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Writes the lines that cargo adds to a file to this process's standard
 * error while cargo runs: each line of text as it is, the rendered
 * diagnostic of a JSON `compiler-message`, and no other JSON message, which
 * is for the plugin and not for people.
 */
class LineForwarder {
  private readonly fd: number;
  private offset = 0;
  private partial = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly timer: NodeJS.Timeout;

  constructor(file: string) {
    this.fd = openSync(file, "r");
    this.timer = setInterval(() => this.pump(), 100);
  }

  /** Writes what is left once cargo has ended, and resolves once it is out. */
  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.pump();
    this.partial += this.decoder.end();
    if (this.partial !== "") {
      this.emit(this.partial);
      this.partial = "";
    }
    await writeStderr("");
  }

  close(): void {
    clearInterval(this.timer);
    try {
      closeSync(this.fd);
    } catch {
      // Closed already.
    }
  }

  private pump(): void {
    const size = fstatSync(this.fd).size;
    if (size <= this.offset) {
      return;
    }
    const buffer = Buffer.alloc(size - this.offset);
    const read = readSync(this.fd, buffer, 0, buffer.length, this.offset);
    this.offset += read;
    const text = this.partial + this.decoder.write(buffer.subarray(0, read));
    const lines = text.split("\n");
    this.partial = lines.pop() ?? "";
    for (const line of lines) {
      this.emit(line);
    }
  }

  private emit(line: string): void {
    if (line.startsWith('{"reason":')) {
      try {
        const message = JSON.parse(line) as {
          reason?: string;
          message?: { rendered?: string | null };
        };
        const rendered = message.reason === "compiler-message" ? message.message?.rendered : null;
        if (typeof rendered === "string" && rendered !== "") {
          process.stderr.write(rendered.endsWith("\n") ? rendered : `${rendered}\n`);
        }
        return;
      } catch {
        // Not cargo's: shown as text.
      }
    }
    process.stderr.write(`${line}\n`);
  }
}

// Writes to this process's standard error and resolves once it is out.
function writeStderr(text: string): Promise<void> {
  return new Promise((resolve) => process.stderr.write(text, () => resolve()));
}
