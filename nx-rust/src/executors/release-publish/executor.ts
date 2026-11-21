import type { ExecutorContext, ProjectGraph, Task, TaskGraph } from "@nx/devkit";
import { type PublishInput, type PublishReport, publishTasks } from "../../release/publish";
import { batchRunsVerbosely, printCommand, taskRunsVerbosely } from "../cargo-invocation";
import { dotenvDefinitions, dotenvProblem } from "../dotenv-check";
import { graphTaskOf, singleTaskShape } from "../task-guards";
import {
  cargoTaskEnvironment,
  runDependentVariables,
  TaskEnvironmentError,
  taskEnvironments,
  withoutUnloadedRootValues,
} from "../task-env";

/**
 * The executor of `nx-release-publish`, `@convesoft/nx-rust:release-publish`,
 * for a task that Nx runs on its own, as with `NX_BATCH_MODE=false`: the task
 * runs the same checks as in a batch and one `cargo publish --locked -p
 * <crate>` for its own crate, with its target registry (`DES-RELEASE`,
 * "Without a batch"), after the dotenv check of the cargo executors
 * (`DES-RELEASE`, "Dotenv files").
 */
// @mara implements DES-RELEASE
export default async function releasePublish(
  options: Record<string, unknown>,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const project = context.projectName ?? "";
  const target = context.targetName ?? "";
  const task: Task = graphTaskOf(context) ?? {
    id: `${project}:${target}`,
    target: {
      project,
      target,
      ...(context.configurationName === undefined
        ? {}
        : { configuration: context.configurationName }),
    },
    overrides: {},
    outputs: [],
    cache: false,
    parallelism: true,
  };
  let env: PublishInput["env"];
  try {
    env = checkedEnvironment(
      withProjectRoot(task, context),
      context.projectGraph,
      context.root,
      withoutUnloadedRootValues(
        cargoTaskEnvironment(process.env, singleTaskShape(context)),
        context.root,
      ),
    );
  } catch (error) {
    if (!(error instanceof TaskEnvironmentError)) {
      throw error;
    }
    env = {
      failure: `${task.target.project}:${task.target.target}: @convesoft/nx-rust cannot build this task's environment, because ${error.message}. Nothing was published. Use an Nx version that @convesoft/nx-rust supports.`,
    };
  }
  let success = false;
  for await (const report of publishTasks([{ id: task.id, task, options, env }], {
    context,
    ...(taskRunsVerbosely(context) ? { announce: printCommand } : {}),
  })) {
    success = report.result.success;
    const stream = success ? process.stdout : process.stderr;
    await new Promise<void>((resolve) =>
      stream.write(report.result.terminalOutput, () => resolve()),
    );
  }
  return { success };
}

/**
 * The batch implementation of `@convesoft/nx-rust:release-publish`, which
 * receives the runnable `nx-release-publish` tasks of one release group
 * (`EVD-NX-24-PUBLISH-BATCHES`) and publishes the crates of each Cargo
 * workspace and registry with one `cargo publish` (`DES-RELEASE`, "Batch";
 * `ADR-BATCHED-PUBLISH`). Each task gets the environment that it gets when
 * it runs on its own (`DES-BATCH`), checked as there (`DES-RELEASE`,
 * "Dotenv files"), and a result of its own, also where its environment cannot
 * be rebuilt.
 */
// @mara implements DES-RELEASE
// @mara implements DES-BATCH
export async function* batch(
  taskGraph: TaskGraph,
  inputs: Record<string, Record<string, unknown>>,
  _overrides: unknown,
  context: ExecutorContext,
): AsyncGenerator<PublishReport> {
  const ids = Object.keys(taskGraph.tasks);
  let environmentOf: ((task: Task) => NodeJS.ProcessEnv) | { failure: string };
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
    environmentOf = { failure: reason(error) };
  }
  const publishInputs: PublishInput[] = ids.map((id) => {
    const task = taskGraph.tasks[id];
    const label = `${task.target.project}:${task.target.target}`;
    let env: PublishInput["env"];
    if ("failure" in environmentOf) {
      env = {
        failure: `${label}: @convesoft/nx-rust cannot rebuild this task's environment in a batch, because ${environmentOf.failure}. Nothing was published. Run the tasks with NX_BATCH_MODE=false, or use an Nx version that @convesoft/nx-rust supports.`,
      };
    } else {
      const shaped = withProjectRoot(task, context);
      try {
        env = checkedEnvironment(shaped, context.projectGraph, context.root, environmentOf(shaped));
      } catch (error) {
        env = {
          failure: `${label}: @convesoft/nx-rust cannot rebuild this task's environment in a batch, because ${reason(error)}. Nothing was published. Run the tasks with NX_BATCH_MODE=false, or use an Nx version that @convesoft/nx-rust supports.`,
        };
      }
    }
    return { id, task, options: inputs[id] ?? {}, env };
  });
  // Decided once for the batch, from the batch process's own environment
  // (`DES-INVOCATION`, "Printing the command").
  const verbose = batchRunsVerbosely(process.env);
  yield* publishTasks(publishInputs, { context, ...(verbose ? { announce: printCommand } : {}) });
}

/**
 * The task's environment, or why its dotenv files fail the check that the
 * cargo executors run on a task's environment before cargo runs
 * (`DES-RELEASE`, "Dotenv files"; `DES-BATCH`, "Dotenv files").
 */
function checkedEnvironment(
  task: Task,
  graph: ProjectGraph | undefined,
  root: string,
  env: NodeJS.ProcessEnv,
): PublishInput["env"] {
  const label = `${task.target.project}:${task.target.target}`;
  let problem: string | undefined;
  try {
    if (graph === undefined) {
      throw new TaskEnvironmentError("Nx gave the task no project graph");
    }
    problem = dotenvProblem(task, graph, root, env);
  } catch (error) {
    if (!(error instanceof TaskEnvironmentError)) {
      throw error;
    }
    return {
      failure: `${label}: @convesoft/nx-rust cannot check the dotenv files of this task, because ${error.message}. Nothing was published. Use an Nx version that @convesoft/nx-rust supports.`,
    };
  }
  return problem === undefined ? env : { failure: `${label}: ${problem}` };
}

// The task with the root of its project, which Nx's dotenv files of the task
// depend on, where the task graph leaves it out.
function withProjectRoot(task: Task, context: ExecutorContext): Task {
  return task.projectRoot === undefined
    ? {
        ...task,
        projectRoot: context.projectsConfigurations?.projects?.[task.target.project]?.root,
      }
    : task;
}

// Why the environment cannot be rebuilt: the reason of the plugin's own
// error, or the whole error of an unexpected one.
function reason(error: unknown): string {
  if (error instanceof TaskEnvironmentError) {
    return error.message;
  }
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
