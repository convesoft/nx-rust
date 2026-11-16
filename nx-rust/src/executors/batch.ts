import type { ExecutorContext, Task, TaskGraph } from "@nx/devkit";
import { batchRunsVerbosely } from "./cargo-invocation";
import type { CargoTargetOptions } from "./command";
import { formGroups, type GroupSelection, planGroups } from "./groups";
import { batchLiveOutput, type GroupMember, type LiveOutput, runGroup } from "./group-run";
import { runNapiGroup } from "./napi-build";
import {
  groupInvocations,
  type PluginExecutor,
  type PreparedTask,
  prepareTask,
  projectWarnings,
  TaskError,
} from "./task";
import { dotenvDefinitions } from "./dotenv-check";
import {
  readyUrlProducers,
  runDependentVariables,
  TaskEnvironmentError,
  taskEnvironments,
} from "./task-env";

/** The result that a batch reports for one task, as Nx 24 takes it. */
export interface BatchTaskResult {
  success: boolean;
  /**
   * `skipped` for a task that did not run because a task of the batch that
   * it depends on failed, as Nx skips such a task outside a batch.
   */
  status?: "success" | "failure" | "skipped";
  /** The task's own output, which Nx prints, stores and replays with it. */
  terminalOutput: string;
  startTime: number;
  endTime: number;
}

/** What the batch reports, one entry for each task as soon as it is known. */
export interface BatchReport {
  task: string;
  result: BatchTaskResult;
}

/** A task of the batch whose checks before cargo passed. */
interface ReadyTask extends PreparedTask {
  /** The task's id in the task graph. */
  id: string;
  /** The task's own executor context. */
  context: ExecutorContext;
  /** What the task prints before cargo's output: its project's warnings and its ignored options. */
  head: string[];
}

/**
 * The batch implementation of the plugin's cargo executors (`DES-BATCH`):
 * Nx hands it the tasks of one executor that it runs together, and it
 * reports one result for each of them, each with its own terminal output,
 * as soon as the task's group has run, so that Nx prints it then.
 *
 * Every task first runs the checks that a task run on its own runs before
 * cargo, with its own options, environment and executor context: the
 * warnings of its project and the lines for the options it ignores, the
 * cache guards, the lockfile dependency and the guard of `test` after
 * `build` (`DES-TARGETS`, "Guard"). A task that fails one fails alone,
 * before any cargo command of the batch runs. The others form groups
 * ({@link formGroups}), which run one after another, a group only once the
 * groups of the tasks it depends on have run; a task whose dependency in
 * the batch failed is reported skipped, as Nx skips it outside a batch.
 *
 * The batch reports every task that it receives and throws for none
 * (`EVD-NX-24-BATCHES`: a throw fails every task of the batch, and a task
 * left out runs again). A failure of its own machinery fails the tasks it
 * concerns, with a message that says so: no task is reported successful
 * without cargo's output showing that its crate passed.
 *
 * @param inputs Each task's options, by task id, as Nx combines them for
 *   the task: the target's options, its configuration's and the command line's.
 */
// @mara implements DES-BATCH
// @mara implements REQ-BATCHING
export async function* runBatch(
  executor: PluginExecutor,
  taskGraph: TaskGraph,
  inputs: Record<string, CargoTargetOptions>,
  context: ExecutorContext,
): AsyncGenerator<BatchReport> {
  const ids = Object.keys(taskGraph.tasks);
  const reported = new Set<string>();
  const report = (id: string, result: BatchTaskResult): BatchReport => {
    reported.add(id);
    // Ended by a newline, as the output of a task run on its own, so that
    // what Nx prints next starts on a line of its own.
    const output = result.terminalOutput;
    return {
      task: id,
      result: {
        ...result,
        status: result.status ?? (result.success ? "success" : "failure"),
        terminalOutput: output === "" || output.endsWith("\n") ? output : `${output}\n`,
      },
    };
  };
  try {
    const started = Date.now();
    // Decided once for the batch, from the batch process's own environment,
    // which Nx copies from the nx command's: never from a task's rebuilt
    // environment, where a crate's .env can disagree with the run
    // (`DES-INVOCATION`, "Printing the command").
    const verbose = batchRunsVerbosely(process.env);
    // What the batch shows of cargo while it runs, also decided once from
    // the batch process's own environment, which Nx sets from the style.
    const live = batchLiveOutput(process.env);
    let environmentOf: (task: Task) => NodeJS.ProcessEnv;
    try {
      if (context.projectGraph === undefined) {
        throw new TaskEnvironmentError("Nx gave the batch no project graph");
      }
      const graph = context.projectGraph;
      environmentOf = taskEnvironments(context.root, graph, (task) =>
        dotenvDefinitions(task, graph, context.root).filter((name) =>
          Object.prototype.hasOwnProperty.call(runDependentVariables, name),
        ),
      );
    } catch (error) {
      if (!(error instanceof TaskEnvironmentError)) {
        throw error;
      }
      // Without each task's own environment, no task may run in the batch.
      for (const id of ids) {
        yield report(id, {
          success: false,
          terminalOutput: `${taskLabel(taskGraph.tasks[id])}: @convesoft/nx-rust cannot rebuild this task's environment in a batch, because ${error.message}. The task does not run, so that Nx stores no result for it. Run the tasks with --batch=false, or use an Nx version that @convesoft/nx-rust supports.`,
          startTime: started,
          endTime: Date.now(),
        });
      }
      return;
    }

    // The checks of every task before any cargo command of the batch runs.
    // Each task is prepared on its own: whatever goes wrong while one is
    // prepared, an unexpected error of the plugin's included, fails that
    // task and no other, as it would fail the task run on its own.
    const ready = new Map<string, ReadyTask>();
    for (const id of ids) {
      const task = taskGraph.tasks[id];
      const start = Date.now();
      let head: string[] = [];
      try {
        const taskContext = contextOf(task, context);
        head = projectWarnings(taskContext);
        refuseReadyUrl(task, context);
        const env = environmentOf(
          task.projectRoot === undefined
            ? {
                ...task,
                projectRoot: context.projectsConfigurations?.projects?.[task.target.project]?.root,
              }
            : task,
        );
        const prepared = prepareTask(executor, inputs[id] ?? {}, taskContext, env);
        ready.set(id, {
          ...prepared,
          id,
          context: taskContext,
          head: [...head, ...prepared.warnings],
        });
      } catch (error) {
        const message =
          error instanceof TaskError || error instanceof TaskEnvironmentError
            ? error.message
            : [
                `${taskLabel(task)}: @convesoft/nx-rust could not prepare this task in its batch. The task does not run, so that Nx stores no result for it.`,
                error instanceof Error ? (error.stack ?? error.message) : String(error),
              ].join("\n");
        yield report(id, {
          success: false,
          terminalOutput: [...head, message].join("\n"),
          startTime: start,
          endTime: Date.now(),
        });
      }
    }

    // The groups, in waves of tasks whose dependencies in the batch have run.
    const done = new Map<string, boolean>(
      ids.filter((id) => !ready.has(id)).map((id) => [id, false]),
    );
    // Tasks that this batch leaves unreported, so that Nx runs them in a
    // following batch once it has stored this one's (writesStoredFiles), and
    // the folders that the build groups of this batch have written.
    const deferred = new Set<string>();
    // The crates whose stored files a build group of this batch has
    // written, by workspace root.
    const written = new Map<string, Set<string>>();
    const dependencies = (id: string): string[] =>
      (taskGraph.dependencies?.[id] ?? []).flatMap((edge: unknown) => {
        const dependency = typeof edge === "string" ? edge : (edge as { id?: string } | null)?.id;
        return dependency !== undefined && dependency in taskGraph.tasks ? [dependency] : [];
      });
    while (done.size + deferred.size < ids.length) {
      const wave: ReadyTask[] = [];
      for (const [id, task] of ready) {
        if (done.has(id) || deferred.has(id)) {
          continue;
        }
        const deps = dependencies(id);
        if (deps.some((dependency) => deferred.has(dependency))) {
          deferred.add(id);
          continue;
        }
        const failed = deps.filter((dependency) => done.get(dependency) === false);
        if (failed.length > 0) {
          done.set(id, false);
          const now = Date.now();
          yield report(id, {
            success: false,
            status: "skipped",
            terminalOutput: `${task.task}: not run, because ${failed.join(" and ")}, on which it depends, failed.`,
            startTime: now,
            endTime: now,
          });
          continue;
        }
        if (deps.every((dependency) => done.get(dependency) === true)) {
          wave.push(task);
        }
      }
      if (wave.length === 0 && done.size + deferred.size >= ids.length) {
        break;
      }
      if (wave.length === 0) {
        // Only a cycle, which Nx does not create, leaves tasks here.
        for (const id of ids.filter((id) => !done.has(id) && !deferred.has(id))) {
          done.set(id, false);
          const now = Date.now();
          yield report(id, {
            success: false,
            terminalOutput: `${taskLabel(taskGraph.tasks[id])}: @convesoft/nx-rust found no order in which the tasks of this batch can run. The task does not run, so that Nx stores no result for it.`,
            startTime: now,
            endTime: now,
          });
        }
        break;
      }
      for (const group of wholeWorkspaceFirst(planGroups(formGroups(wave)))) {
        const writes = writesStoredFiles(group);
        if (writes !== undefined) {
          const before = written.get(writes.root) ?? new Set<string>();
          if (
            writes.crates === "all"
              ? before.size > 0
              : writes.crates.some((crate) => before.has(crate))
          ) {
            for (const task of group.tasks) {
              deferred.add(task.id);
            }
            continue;
          }
          for (const task of group.tasks) {
            before.add(task.crate ?? "");
          }
          written.set(writes.root, before);
        }
        for (const entry of await runReadyGroup(
          group.tasks,
          group.selection,
          context.root,
          verbose,
          live,
        )) {
          done.set(entry.task, entry.result.success);
          yield report(entry.task, entry.result);
        }
      }
    }
  } catch (error) {
    // A failure of the batch's own machinery: every task that has no result
    // yet fails with it, and none is left out.
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const now = Date.now();
    for (const id of ids.filter((id) => !reported.has(id))) {
      yield report(id, {
        success: false,
        terminalOutput: `${taskLabel(taskGraph.tasks[id])}: @convesoft/nx-rust could not run this task in its batch. The task does not run, so that Nx stores no result for it.\n${message}`,
        startTime: now,
        endTime: now,
      });
    }
  }
}

// Runs one group: completes its command, runs it and the checks after it,
// and gives each task its result, a task that failed before cargo included.
// A failure of the plugin's own code fails every task of the group.
async function runReadyGroup(
  group: readonly ReadyTask[],
  selection: GroupSelection,
  root: string,
  verbose: boolean,
  live: LiveOutput,
): Promise<BatchReport[]> {
  const start = Date.now();
  // A group of one crate says why where its output names it.
  const head = (task: ReadyTask): string[] =>
    selection.kind === "alone" && selection.note !== undefined
      ? [...task.head, selection.note]
      : task.head;
  try {
    const invocations = groupInvocations(group, root, selection);
    const members: { task: ReadyTask; member: GroupMember }[] = [];
    const reports: BatchReport[] = [];
    group.forEach((task, index) => {
      const invocation = invocations[index];
      if (typeof invocation === "string") {
        reports.push({
          task: task.id,
          result: {
            success: false,
            status: "failure",
            terminalOutput: [...head(task), invocation].join("\n"),
            startTime: start,
            endTime: Date.now(),
          },
        });
      } else {
        members.push({ task, member: { prepared: task, invocation, context: task.context } });
      }
    });
    // `napi-build` runs its compile with variables of its own and its
    // post-processing after it (`DES-NAPI`).
    const results = await (group[0]?.target === "napi-build" ? runNapiGroup : runGroup)(
      members.map(({ member }) => member),
      verbose,
      live,
    );
    const end = Date.now();
    members.forEach(({ task }, index) => {
      const { success, output } = results[index];
      reports.push({
        task: task.id,
        result: {
          success,
          status: success ? "success" : "failure",
          terminalOutput: [...head(task), ...(output === "" ? [] : [output])].join("\n"),
          startTime: start,
          endTime: end,
        },
      });
    });
    return reports;
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const end = Date.now();
    return group.map((task) => ({
      task: task.id,
      result: {
        success: false,
        status: "failure",
        terminalOutput: [
          ...head(task),
          `${task.task}: @convesoft/nx-rust could not run the cargo command of this task's group. The task does not run, so that Nx stores no result for it.`,
          message,
        ].join("\n"),
        startTime: start,
        endTime: end,
      },
    }));
  }
}

/**
 * Fails a task of a batch, before cargo runs, where Nx gives the task run on
 * its own an environment that a batch cannot give it (`DES-BATCH`): where an
 * edge that waits for readiness (`waitFor: "ready"`) leads to a continuous
 * task whose `readyWhen` reports ready by `signal`, the one check that
 * reports a URL, which Nx then gives the task run on its own as
 * `NX_READY_URL` and tells a batch nothing of (`EVD-NX-24-BATCHES`,
 * "Continuous tasks"). Its tests could then pass or skip on a missing URL
 * under the key that a run on its own fills in. Every other continuous
 * dependency gives the task run on its own nothing that a batch lacks, and
 * runs in the batch. The maintainer chose this on 15 November 2026.
 *
 * @throws {TaskError} Naming the producers and how to run the task on its
 *   own, for one command and for the repository (`DES-DIAGNOSTICS`).
 */
// @mara implements DES-BATCH
// @mara implements DES-DIAGNOSTICS
function refuseReadyUrl(task: Task, context: ExecutorContext): void {
  const producers =
    context.taskGraph === undefined || context.projectGraph === undefined
      ? []
      : readyUrlProducers(task.id, context.taskGraph, context.projectGraph);
  if (producers.length === 0) {
    return;
  }
  const named = producers.join(" and ");
  throw new TaskError(
    `${taskLabel(task)}: this task waits for ${named} to be ready, and ${producers.length === 1 ? "that continuous task reports" : "those continuous tasks report"} ready by signal (readyWhen: { "signal": true }), so Nx gives the task NX_READY_URL when it runs on its own, which a batch cannot give it. The task does not run in this batch, so that Nx stores no result for it under an environment that differs from the one a run on its own has. Run the command with --batch=false, or, to run every task of the repository on its own, set NX_BATCH_MODE=false in the root .env; that turns batching off for every task, of @convesoft/nx-rust and of every other plugin.`,
  );
}

/**
 * The groups of a wave with those that select the whole workspace first,
 * each kind in the order in which they were formed, so that a group of one
 * crate writes its crate's files after the whole-workspace group that
 * writes them too (`DES-BATCH`, "Files that a batch stores").
 */
function wholeWorkspaceFirst<T extends { selection: GroupSelection }>(groups: readonly T[]): T[] {
  return [
    ...groups.filter((group) => group.selection.kind === "workspace"),
    ...groups.filter((group) => group.selection.kind !== "workspace"),
  ];
}

/**
 * Where a group's cargo command writes files that the `build` tasks of a
 * batch store, or `undefined` for a group that writes none (`DES-BATCH`,
 * "Files that a batch stores"): the workspace root, and the crates whose
 * files it writes. A group of `build` writes the executables, `cdylib` and
 * `staticlib` files of `build`'s outputs in the folder of its profile and
 * triple: every member's where it selects the whole workspace, and only
 * those of the crates it selects with `-p` otherwise, as a group of one
 * crate and a group under `hakari` or `cargo` do, also where its feature set
 * changes that of crates they depend on, as Cargo 1.91.0 and 1.100.0 do
 * (`EVD-CARGO-ARTIFACT-WRITERS`). The crates count by workspace root alone,
 * so that two groups whose profiles or triples share a folder under other
 * names, such as `dev` and `test`, count as writing the same files.
 *
 * `doc` is not concerned: it belongs to the workspace project, one task per
 * Cargo workspace, and writes only its workspace's `doc` folder, which no
 * `build` writes. `check`, `lint` and `test` run in the other batch executor
 * and store no files; a `test` waits for every `build` whose executables its
 * commands replace (`ADR-WORKSPACE-TEST-EXECUTABLES`).
 *
 * Nx stores a batch's outputs once the whole batch has ended
 * (`EVD-NX-24-BATCHES`). So a group runs only where no `build` group of this
 * batch has run before it in the same workspace root for a crate whose files
 * it writes: a group that selects the whole workspace only where none has
 * run there at all. Otherwise its tasks are left unreported, and Nx runs them
 * in a following batch once it has stored this one's ("Tasks left
 * unreported").
 */
// @mara implements DES-BATCH
function writesStoredFiles(group: {
  tasks: readonly PreparedTask[];
  selection: GroupSelection;
}): { root: string; crates: string[] | "all" } | undefined {
  const [first] = group.tasks;
  if (first === undefined || (first.target !== "build" && first.target !== "napi-build")) {
    return undefined;
  }
  return {
    root: first.cwd,
    crates:
      group.selection.kind === "workspace" ? "all" : group.tasks.map((task) => task.crate ?? ""),
  };
}

/**
 * The executor context of one task of a batch, as Nx gives it to the task
 * run on its own: the batch's context, whose task graph is the whole one,
 * with the task's project, target, configuration and target configuration.
 */
export function contextOf(task: Task, context: ExecutorContext): ExecutorContext {
  const { project, target, configuration } = task.target;
  return {
    ...context,
    projectName: project,
    targetName: target,
    ...(configuration === undefined ? {} : { configurationName: configuration }),
    target: context.projectsConfigurations?.projects?.[project]?.targets?.[target],
  };
}

function taskLabel(task: Task | undefined): string {
  return task === undefined ? "?" : `${task.target.project}:${task.target.target}`;
}
