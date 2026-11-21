import type { ExecutorContext } from "@nx/devkit";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cargoMetadataOf } from "../graph/collisions";
import {
  defaultFullCollectThreshold,
  lockfileExecutor,
  targetCargoMetadataKey,
} from "../graph/targets";
import {
  describeFolder,
  MissingToolError,
  type OptionalToolId,
  requireTool,
} from "../tools/optional-tools";
import { diffRelativeVariables } from "./affected";
import { inputPlacement } from "./affected-inputs";
import { contextTriple } from "./affected-run";
import {
  baselineStatusArguments,
  collectArguments,
  type CollectionChoice,
  collectionLockFile,
  collectionChoice,
  collectionNextestArguments,
  previousRecordProblem,
  removeBeforeCollection,
  takeCollectionLock,
} from "./baseline";
import {
  type BaselineContext,
  cargoContext,
  contextRecordFile,
  contextRuntimeCommands,
  contextVariables,
  environmentContext,
  runtimeContext,
  writeContextRecord,
} from "./baseline-context";
import { type CargoInvocation, printCommand, taskRunsVerbosely } from "./cargo-invocation";
import type { CargoTargetOptions } from "./command";
import { declaredOptionsOf } from "./declared-options";
import { NxTaskFilesError } from "./nx-task-files";
import { type PreparedTask, prepareTask } from "./task";
import { runCargo } from "./task-execution";
import { type PluginExecutor, projectWarnings, singleTaskShape, TaskError } from "./task-guards";
import { cargoTaskEnvironment, TaskEnvironmentError, withoutUnloadedRootValues } from "./task-env";
import { baselineDatabase } from "./test-mode";

// The executor, with the options of its schema, read where graph creation
// reads them (`declaredExecutorOptions`).
const executor: PluginExecutor = {
  name: lockfileExecutor,
  shortName: "lockfile",
  declared: declaredOptionsOf(lockfileExecutor),
  serves: (target) => target === "coverage-baseline",
};

/**
 * The coverage baseline target on the workspace project of a workspace with
 * `affectedTests` (`REQ-BASELINE`, `DES-BASELINE`), which the lockfile
 * executor, `@convesoft/nx-rust:lockfile`, runs: it has no batch
 * implementation, so that a collection never joins a batch, and the empty
 * entry that `init` adds for it in `targetDefaults` covers the target.
 *
 * In the workspace root, it computes the context that the collection runs
 * in, the record that step 1 of `DES-TEST-RUN` compares
 * (`ADR-AFFECTED-BASELINE-CONTEXT`), takes the workspace's collection lock,
 * asks `cargo affected status` whether `collect --diff` can run
 * ({@link collectionChoice}), removes the record, and for a full collection
 * the database, runs `cargo affected collect` with git's `diff.relative`,
 * and writes the record only after cargo-affected has ended successfully
 * ("Order of writing"). A collection that fails or is interrupted leaves no
 * record. Collection sets no Cargo directory of its own unless
 * `separateBuildDir` is on.
 */
// @mara implements DES-BASELINE
// @mara implements REQ-BASELINE
export async function collectBaseline(
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  for (const warning of projectWarnings(context)) {
    console.warn(warning);
  }
  let env: NodeJS.ProcessEnv;
  let prepared: PreparedTask;
  let collected: BaselineContext;
  try {
    try {
      env = withoutUnloadedRootValues(
        cargoTaskEnvironment(process.env, singleTaskShape(context)),
        context.root,
      );
    } catch (error) {
      if (!(error instanceof TaskEnvironmentError)) {
        throw error;
      }
      throw new TaskError(
        `${context.projectName}:${context.targetName}: @convesoft/nx-rust cannot build this task's environment, because ${error.message}. The task does not run. Use an Nx version that @convesoft/nx-rust supports.`,
      );
    }
    prepared = prepareTask(executor, options, context, env);
    for (const warning of prepared.warnings) {
      console.warn(warning);
    }
    // cargo-affected runs nextest and the LLVM tools; prepareTask has
    // checked cargo-affected itself.
    for (const tool of ["cargo-nextest", "llvm-tools"] satisfies OptionalToolId[]) {
      try {
        requireTool(
          tool,
          `the coverage collection of the ${context.targetName} target of the Cargo workspace in ${describeFolder(prepared.workspaceRoot)}`,
          { workspaceRoot: context.root, workspaces: [], env, folder: prepared.cwd },
        );
      } catch (error) {
        throw error instanceof MissingToolError
          ? new TaskError(`${prepared.task}: ${error.message}`)
          : error;
      }
    }
    collected = await collectionContext(prepared, context, env);
  } catch (error) {
    if (error instanceof TaskError) {
      console.error(error.message);
      return { success: false };
    }
    throw error;
  }
  const { task, cwd } = prepared;
  const lock = takeCollectionLock(cwd);
  if ("holder" in lock) {
    console.error(
      `${task}: another collection of the coverage baseline runs in this checkout (process ${lock.holder}), which holds ${join(prepared.workspaceRoot, collectionLockFile)}. Two collections at once could leave the record of one beside the coverage of the other, so this one does not start, and the baseline and its record stay as they are. Run it again once the other has ended.`,
    );
    return { success: false };
  }
  if ("problem" in lock) {
    console.error(
      `${task}: this collection does not start, and the baseline and its record stay as they are, because, in the Cargo workspace in ${describeFolder(prepared.workspaceRoot)}, ${lock.problem}.`,
    );
    return { success: false };
  }
  try {
    const nextestArgs = collectionNextestArguments(prepared.options, {
      locked: prepared.locked,
      workspaceUnification: prepared.featureUnification === "cargo",
    });
    const verbose = taskRunsVerbosely(context);
    const threshold = prepared.options.fullCollectThreshold ?? defaultFullCollectThreshold;
    // The record that is there before the collection, read before it is
    // removed: `--diff` keeps old rows, which the new record then vouches
    // for, so it runs only where that record equals this collection's
    // context (`DES-BASELINE`, `ADR-AFFECTED-BASELINE-CONTEXT`).
    const previous =
      prepared.options.fullCollect === true ? undefined : previousRecordProblem(cwd, collected);
    const choice: CollectionChoice | { kind: "stopped"; signal: string } =
      prepared.options.fullCollect === true
        ? { kind: "full", reason: "the option fullCollect asks for it" }
        : previous !== undefined
          ? { kind: "full", reason: previous }
          : await statusChoice(prepared, env, nextestArgs, threshold, verbose);
    if (choice.kind === "stopped") {
      console.error(
        `${task}: cargo affected status was stopped by ${choice.signal}, so no collection started, and the baseline and the record of its context stay as they are.`,
      );
      return { success: false };
    }
    if (
      choice.kind === "full" &&
      prepared.options.fullCollect !== true &&
      prepared.options.diffOnly === true
    ) {
      console.warn(
        `${task}: collects nothing, because ${choice.reason}, which needs a full collection, and the option diffOnly leaves that to a run with --fullCollect. The baseline and the record of its context stay as they are.`,
      );
      return { success: true };
    }
    console.log(
      `${task}: ${choice.kind === "diff" ? "re-collects the coverage of the affected and new tests with cargo affected collect --diff" : "collects the coverage of every test into an empty database with cargo affected collect"}, because ${choice.reason}.`,
    );
    // Order of writing: the record goes first, and with a full collection
    // the database; the new record follows only a successful collection.
    removeBeforeCollection(cwd, choice.kind === "full");
    const invocation: CargoInvocation = {
      args: collectArguments(choice.kind === "diff", nextestArgs),
      cwd,
      env: {
        ...diffRelativeVariables(env),
        ...(prepared.options.separateBuildDir === true
          ? { CARGO_BUILD_BUILD_DIR: join(cwd, "target", "affected", "build") }
          : {}),
      },
    };
    const succeeded = await runCargo(invocation, env, verbose ? task : undefined);
    if (!succeeded) {
      console.error(
        `${task}: cargo affected collect failed or was stopped, as its output above says, so the baseline has no record of its context (${contextRecordFile}) and every test run in affected mode runs its full suite until a collection succeeds. A failing test fails the collection too: fix it, commit, and run the target again.`,
      );
      return { success: false };
    }
    writeContextRecord(cwd, collected);
    console.log(
      `${task}: the baseline ${join(prepared.workspaceRoot, baselineDatabase)} is up to date, and ${join(prepared.workspaceRoot, contextRecordFile)} records the context it was collected in. Save both together.`,
    );
    return { success: true };
  } finally {
    lock.release();
  }
}

/**
 * The context of the collection, as the record holds it
 * (`ADR-AFFECTED-BASELINE-CONTEXT`, `DES-BASELINE`): its cargo options, the
 * target triple that cargo builds for, and, from the inputs of the `test`
 * tasks of the workspace's crates as Nx expands them, the hash of each
 * environment input and of the output of each runtime input but the test
 * mode's, evaluated in the collection task's environment as the `test`
 * tasks' executor evaluates them (`baseline-context.ts`).
 */
async function collectionContext(
  prepared: PreparedTask,
  context: ExecutorContext,
  env: NodeJS.ProcessEnv,
): Promise<BaselineContext> {
  const { task } = prepared;
  const graph = context.projectGraph;
  if (graph === undefined) {
    throw new TaskError(
      `${task}: Nx gave the executor no project graph, so the plugin cannot read the inputs of the test tasks for the record of the baseline's context. The task does not run.`,
    );
  }
  const own = context.projectsConfigurations?.projects?.[context.projectName ?? ""];
  const manifest = own === undefined ? undefined : cargoMetadataOf(own)?.workspaceManifest;
  // The test target of each crate of the workspace, under the name that
  // `targetNames` gives it.
  const byTarget = new Map<string, string[]>();
  for (const [name, project] of Object.entries(context.projectsConfigurations?.projects ?? {})) {
    if (manifest === undefined || cargoMetadataOf(project)?.workspaceManifest !== manifest) {
      continue;
    }
    for (const [targetName, target] of Object.entries(project.targets ?? {})) {
      const metadata = target.metadata?.[targetCargoMetadataKey] as
        | { target?: unknown }
        | undefined;
      if (metadata?.target === "test") {
        byTarget.set(targetName, [...(byTarget.get(targetName) ?? []), name]);
      }
    }
  }
  const names = new Set<string>();
  const commands = new Set<string>();
  try {
    for (const [target, projects] of byTarget) {
      const placement = await inputPlacement(
        context.root,
        graph,
        context.nxJsonConfiguration,
        projects,
        target,
      );
      for (const inputs of placement.inputs.values()) {
        for (const name of inputs.environment) {
          names.add(name);
        }
        for (const command of inputs.runtime) {
          commands.add(command);
        }
      }
    }
  } catch (error) {
    if (error instanceof NxTaskFilesError) {
      throw new TaskError(
        `${task}: @convesoft/nx-rust cannot read the inputs of the test tasks from the installed Nx (${error.message}), which the record of the baseline's context needs. The task does not run. Use an Nx version that @convesoft/nx-rust supports.`,
      );
    }
    throw error;
  }
  const runtime = runtimeContext(contextRuntimeCommands(commands), context.root, env);
  if ("problem" in runtime) {
    throw new TaskError(
      `${task}: ${runtime.problem.replace("so the plugin cannot compare it with the baseline's", "so the plugin cannot record it for the baseline")}. The task does not run, and the baseline stays as it is. Make the command succeed in this environment.`,
    );
  }
  return {
    version: 2,
    cargo: cargoContext(prepared.options),
    triple: contextTriple(prepared.cwd, env),
    env: environmentContext(contextVariables(names, env), env),
    runtime: runtime.runtime,
  };
}

/**
 * Runs `cargo affected status` in the workspace root, with the task's
 * environment and git's `diff.relative`, into a report in a folder of its
 * own under the system's temporary folder, which is removed afterwards, and
 * gives the collection that its report asks for.
 */
async function statusChoice(
  prepared: PreparedTask,
  env: NodeJS.ProcessEnv,
  nextestArgs: readonly string[],
  threshold: number,
  verbose: boolean,
): Promise<CollectionChoice | { kind: "stopped"; signal: string }> {
  const folder = mkdtempSync(join(tmpdir(), "nx-rust-baseline-"));
  const file = join(folder, "report.json");
  const invocation: CargoInvocation = {
    args: baselineStatusArguments(file, nextestArgs),
    cwd: prepared.cwd,
    env: diffRelativeVariables(env),
  };
  try {
    if (verbose) {
      await printCommand(prepared.task, invocation);
    }
    const run = await new Promise<{
      code: number | null;
      signal: string | null;
      failure?: string;
      stderr: string;
    }>((resolve) => {
      const child = spawn("cargo", invocation.args, {
        cwd: invocation.cwd,
        env: { ...env, ...invocation.env },
        stdio: ["ignore", "ignore", "pipe"],
      });
      const stderr: Buffer[] = [];
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
      const forward = (signal: NodeJS.Signals) => child.kill(signal);
      for (const signal of signals) {
        process.on(signal, forward);
      }
      const finish = (result: { code: number | null; signal: string | null; failure?: string }) => {
        for (const signal of signals) {
          process.off(signal, forward);
        }
        resolve({ ...result, stderr: Buffer.concat(stderr).toString("utf8") });
      };
      child.on("error", (error) => finish({ code: null, signal: null, failure: error.message }));
      child.on("close", (code, signal) => finish({ code, signal }));
    });
    if (run.signal !== null) {
      return { kind: "stopped", signal: run.signal };
    }
    let text: string | undefined;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      text = undefined;
    }
    return collectionChoice(run, text, run.stderr, threshold);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
