import type { ProjectGraph, Task } from "@nx/devkit";
import { join } from "node:path";
import {
  loadCreateTaskGraph,
  loadTaskEnv,
  NxBridgeError,
  type NxTaskEnv,
} from "../compatibility/nx-bridge";

/**
 * Why the batch cannot rebuild a task's environment: the installed Nx lacks,
 * or has changed, a part through which it does. Its message is the reason
 * alone.
 */
export class TaskEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskEnvironmentError";
  }
}

/** Converts a bridge failure into a {@link TaskEnvironmentError} with its diagnostic wording. */
export function toTaskEnvironmentError(error: NxBridgeError): TaskEnvironmentError {
  const { failure } = error;
  return new TaskEnvironmentError(
    failure.kind === "load"
      ? `${failure.module} cannot be loaded from the installed Nx (${failure.reason})`
      : `the installed Nx lacks ${failure.exportName} in ${failure.module}`,
  );
}

/**
 * The variables by which Nx 24 tells a task how it runs and records the
 * task, not what the task is, and whose value in the task's process depends
 * on the way the task runs: alone or in a batch, with which output style, in
 * a pseudo-terminal or the terminal UI, with `--verbose` or with analytics on
 * (`EVD-NX-24-BATCHES`, "Task environment"). The task's key, `NX_TASK_HASH`,
 * which Nx does not hand a batch; where Nx writes the task's terminal output,
 * whether it captures standard error into it, streams it or prefixes it,
 * which follow the output style and the task's key; `FORCE_COLOR`, which Nx
 * removes from a task whose output it writes to a file and sets for one whose
 * output it pipes; the variables of Nx's pseudo-terminal, which a task run
 * on its own in a terminal has and a task of a batch has not, one of them
 * empty where Nx's own process has no `execArgv`; and those that the `nx`
 * process sets from the command's options, the terminal UI's
 * `NX_TUI_AUTO_EXIT`, `--verbose`'s `NX_VERBOSE_LOGGING`, and the session of
 * Nx's analytics. Also the variables that Nx removes from every task, and
 * that Nx's pseudo-terminal, which lays the task's environment over the
 * `nx` process's own, gives back to a task run on its own in a terminal:
 * `NX_SET_CLI`, `NX_ORIGINAL_FORCE_COLOR` and the ready signal's socket and
 * task. The plugin leaves them out of every environment it runs cargo with,
 * for a task run on its own as in a batch, so that no cargo command, build
 * script or test sees them and no result can depend on them (`DES-BATCH`).
 */
export const nxRunVariables = [
  "NX_TASK_HASH",
  "NX_TERMINAL_OUTPUT_PATH",
  "NX_TERMINAL_CAPTURE_STDERR",
  "NX_STREAM_OUTPUT",
  "NX_PREFIX_OUTPUT",
  "FORCE_COLOR",
  "NX_PSEUDO_TERMINAL_EXEC_ARGV",
  "NX_PSEUDO_IPC_PATH",
  "NX_PSEUDO_IPC_FORK_ID",
  "NX_TUI_AUTO_EXIT",
  "NX_VERBOSE_LOGGING",
  "NX_ANALYTICS_SESSION_ID",
  "NX_SET_CLI",
  "NX_ORIGINAL_FORCE_COLOR",
  "NX_READY_SIGNAL_SOCKET",
  "NX_READY_SIGNAL_TASK",
] as const;

/**
 * The variables by which Nx names a task's project, which differ between the
 * tasks of any two crates of one target, so that tasks that share a cargo
 * command could not share an environment with them (`DES-BATCH`): Nx's
 * `NX_TASK_TARGET_PROJECT` and `LERNA_PACKAGE_NAME`. The maintainer decided
 * on 15 November 2026 that cargo never gets them, whether a task runs alone
 * or in a batch (`ADR-TASK-NAME-VARIABLES`); a build script or test that
 * needs its crate reads `CARGO_PKG_NAME`. The task's target and
 * configuration, which the tasks of a group share, stay.
 */
export const taskNameVariables = ["NX_TASK_TARGET_PROJECT", "LERNA_PACKAGE_NAME"] as const;

/**
 * What Nx sets for the process of a task run on its own after the task's
 * dotenv files and its own variables (`EVD-NX-24-BATCHES`, "Task
 * environment"): the fork's `NX_FORKED_TASK_EXECUTOR`
 * (`forked-process-task-runner.js`) and then `NX_CLI_SET`, which the task's
 * process sets when it starts (`bin/run-executor.js`). A batch process has
 * both from its start, before the batch lays each task's dotenv files over
 * them, so the batch sets them again after its task's own variables, in the
 * same order ({@link batchTaskEnvironment}), and a dotenv file that defines
 * one changes the value for neither.
 */
export const afterTaskLayer: Readonly<Record<string, string>> = {
  NX_FORKED_TASK_EXECUTOR: "true",
  NX_CLI_SET: "true",
};

/** What the plugin knows of a task for {@link cargoTaskEnvironment}. */
export interface TaskShape {
  /** The task's configuration, as Nx gives it to the task's own variables. */
  configuration: string | undefined;
  /**
   * Whether the task waits for a continuous task that reports ready by
   * signal, for which Nx sets `NX_READY_URL` ({@link readyUrlProducers}).
   */
  readyUrlDependency: boolean;
}

/** The parts of Nx's task graph that {@link readyUrlProducers} reads. */
interface ReadinessTaskGraph {
  tasks: Record<string, { continuous?: boolean; target: { project: string; target: string } }>;
  continuousDependencies?: Record<string, unknown[]>;
}

/** The parts of Nx's project graph that {@link readyUrlProducers} reads. */
interface ReadinessProjectGraph {
  nodes: Record<string, { data?: { targets?: Record<string, { readyWhen?: unknown }> } }>;
}

/**
 * The continuous tasks from which Nx 24 gives the task `taskId`, run on its
 * own, `NX_READY_URL`: those that an edge with `waitFor: "ready"` leads to
 * and whose `readyWhen` reports ready by `signal`, the only check of Nx 24
 * that reports a URL (`getReadyUrlEnv` in `task-orchestrator.js` and
 * `mayReportReadyUrl` in `readiness/ready-when.js`, `EVD-NX-24-BATCHES`,
 * "Continuous tasks"). Every other continuous dependency, with another check
 * or none, gives the task nothing that a batch lacks (`DES-BATCH`).
 */
// @mara implements DES-BATCH
export function readyUrlProducers(
  taskId: string,
  taskGraph: ReadinessTaskGraph,
  projectGraph: ReadinessProjectGraph,
): string[] {
  const edges: unknown[] = taskGraph.continuousDependencies?.[taskId] ?? [];
  return edges.flatMap((edge) => {
    if (typeof edge !== "object" || edge === null) {
      return [];
    }
    const { id, waitFor } = edge as { id?: unknown; waitFor?: unknown };
    if (typeof id !== "string" || waitFor !== "ready") {
      return [];
    }
    const producer = taskGraph.tasks[id];
    if (producer === undefined || producer.continuous === false) {
      return [];
    }
    const readyWhen =
      projectGraph.nodes[producer.target.project]?.data?.targets?.[producer.target.target]
        ?.readyWhen;
    return typeof readyWhen === "object" &&
      readyWhen !== null &&
      (readyWhen as { signal?: unknown }).signal != null
      ? [id]
      : [];
  });
}

/**
 * Why the value of each variable that Nx 24 sets, changes or removes on the
 * way from the `nx` command to the process of a task or of a batch depends
 * on how the task runs, in the process where Nx expands a task's dotenv
 * files or where the plugin checks them (`EVD-NX-24-BATCHES`, "Task
 * environment"). Nx expands the dotenv files of a task run on its own in the
 * `nx` process, before it adds the task's own variables, and a batch expands
 * them in its own process, which Nx gives variables of its own; the plugin
 * checks them in the task's process or in the batch's. A task whose dotenv
 * files make Nx look one of them up fails, alone as in a batch
 * ({@link dotenvProblem}, `DES-BATCH`).
 *
 * Each of them is also left out of cargo's environment
 * ({@link nxRunVariables}), set or removed by Nx after the dotenv files for
 * every task, set by the batch after them as Nx sets it after them for a
 * task run on its own ({@link afterTaskLayer}), or made the same for every
 * way of running by {@link cargoTaskEnvironment}: so a dotenv file that only
 * defines one changes nothing that cargo sees.
 */
export const runDependentVariables: Readonly<Record<string, string>> = {
  FORCE_COLOR:
    "Nx sets it for a batch and for a task whose output it pipes, and removes it from a task whose output it writes to a file",
  NX_ORIGINAL_FORCE_COLOR:
    "Nx sets it in its own process where the command has FORCE_COLOR=0, and removes it from batches and tasks",
  NX_WORKSPACE_ROOT: "Nx sets it for a batch, and for a task only after its dotenv files",
  NX_SKIP_NX_CACHE: "Nx sets it for a batch, and for a task only after its dotenv files",
  NX_INVOCATION_ANCESTOR_PIDS:
    "Nx adds its own process to it for a batch, and for a task only after its dotenv files",
  NX_READY_URL:
    "Nx sets it for a task that waits for a continuous task that reports ready by signal, and removes it from batches",
  NX_READY_SIGNAL_SOCKET:
    "Nx sets it for a task with continuous dependencies and removes it from batches",
  NX_READY_SIGNAL_TASK:
    "Nx sets it for a task with continuous dependencies and removes it from batches",
  NX_FORKED_TASK_EXECUTOR:
    "Nx sets it in the process of a batch and of a task, but not in its own, where it expands the dotenv files of a task run on its own",
  NX_TUI: "Nx sets it from the output style and the terminal UI, and to false for every task",
  NX_TUI_AUTO_EXIT: "Nx sets it from the command's --tui-auto-exit",
  NX_STREAM_OUTPUT: "Nx sets it from the output style, the terminal UI and --batch",
  NX_PREFIX_OUTPUT: "Nx sets it from the output style and --batch",
  NX_VERBOSE_LOGGING: "Nx sets it from the command's --verbose",
  NX_ANALYTICS_SESSION_ID: "Nx sets it for each command where its analytics are on",
  NX_TASK_HASH: "Nx sets it for each task only after its dotenv files",
  NX_TERMINAL_OUTPUT_PATH: "Nx sets it, by output style, for each task only after its dotenv files",
  NX_TERMINAL_CAPTURE_STDERR:
    "Nx sets it, by output style, for each task only after its dotenv files",
  NX_TASK_TARGET_PROJECT: "Nx sets it for each task only after its dotenv files",
  NX_TASK_TARGET_TARGET: "Nx sets it for each task only after its dotenv files",
  NX_TASK_TARGET_CONFIGURATION: "Nx sets it for each task only after its dotenv files",
  LERNA_PACKAGE_NAME: "Nx sets it for each task only after its dotenv files",
  NX_SET_CLI: "Nx removes it from each task only after its dotenv files",
  NX_PSEUDO_TERMINAL_EXEC_ARGV:
    "Nx's pseudo-terminal sets it for a task that runs in a terminal, alone, after its dotenv files",
  NX_PSEUDO_IPC_PATH:
    "Nx's pseudo-terminal sets it for a task that runs in a terminal, alone, after its dotenv files",
  NX_PSEUDO_IPC_FORK_ID:
    "Nx's pseudo-terminal sets it for a task that runs in a terminal, alone, after its dotenv files",
};

/**
 * A task's environment as the plugin runs cargo with it, and asks cargo for
 * reports with it, as a new object: `env` without {@link nxRunVariables}
 * and {@link taskNameVariables}, and with the variables that Nx gives the task in its own layer as that
 * layer gives them in every way of running the task. Nx's pseudo-terminal
 * lays the environment that Nx built for a task run on its own over the
 * `nx` process's own, so that a variable which that layer leaves without a
 * value comes back with the `nx` process's value in a terminal
 * (`EVD-NX-24-BATCHES`, "Task environment"): `NX_SKIP_NX_CACHE` is `true`
 * for a run that skips the cache and absent otherwise, and
 * `NX_TASK_TARGET_CONFIGURATION` names the task's configuration or is
 * absent. `NX_READY_URL`, which Nx sets only for a task that waits for a
 * continuous task that reports ready by signal ({@link readyUrlProducers}),
 * can otherwise only be the value of a task that runs the `nx` command, and
 * is left out.
 */
// @mara implements DES-BATCH
export function cargoTaskEnvironment(env: NodeJS.ProcessEnv, task: TaskShape): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  for (const name of [...nxRunVariables, ...taskNameVariables]) {
    delete copy[name];
  }
  if (copy.NX_SKIP_NX_CACHE !== "true") {
    delete copy.NX_SKIP_NX_CACHE;
  }
  if (task.configuration === undefined) {
    delete copy.NX_TASK_TARGET_CONFIGURATION;
  } else {
    copy.NX_TASK_TARGET_CONFIGURATION = task.configuration;
  }
  if (!task.readyUrlDependency) {
    delete copy.NX_READY_URL;
  }
  return copy;
}

/**
 * The variables that Nx sets or removes for a task after its dotenv layer:
 * those of `getEnvVariablesForTask`, `NX_READY_URL` of `getReadyUrlEnv`,
 * and {@link afterTaskLayer}.
 */
const taskLayerVariables = [
  "FORCE_COLOR",
  "NX_WORKSPACE_ROOT",
  "NX_SKIP_NX_CACHE",
  "NX_INVOCATION_ANCESTOR_PIDS",
  "NX_TERMINAL_OUTPUT_PATH",
  "NX_TERMINAL_CAPTURE_STDERR",
  "NX_STREAM_OUTPUT",
  "NX_PREFIX_OUTPUT",
  "NX_TASK_TARGET_PROJECT",
  "NX_TASK_TARGET_TARGET",
  "NX_TASK_TARGET_CONFIGURATION",
  "NX_TASK_HASH",
  "LERNA_PACKAGE_NAME",
  "NX_TUI",
  "NX_SET_CLI",
  "NX_ORIGINAL_FORCE_COLOR",
  "NX_READY_SIGNAL_SOCKET",
  "NX_READY_SIGNAL_TASK",
  "NX_READY_URL",
  ...Object.keys(afterTaskLayer),
];

/**
 * `env` as the plugin gives it to cargo where Nx loads no dotenv files for
 * the task, its `NX_LOAD_DOT_ENV_FILES` not being `true` (`DES-BATCH`,
 * "Dotenv files"). Nx's `getTaskSpecificEnv` then still removes each variable
 * whose value the root `.env`, `.local.env` or `.env.local` gives, without
 * loading any file back, while Nx's pseudo-terminal gives a task run on its
 * own in a terminal the `nx` process's values back (`EVD-NX-24-BATCHES`,
 * "Task environment"). So the plugin removes them again, with Nx's own
 * `unloadDotEnvFile`, from every variable apart from those that Nx sets
 * after the dotenv layer: a task run on its own without a terminal and a
 * task of a batch lack them already, and a task in a terminal loses what the
 * pseudo-terminal gave back. Where Nx loads the files, `env` comes back as
 * it is.
 *
 * @throws {TaskEnvironmentError} When the installed Nx lacks `unloadDotEnvFile`.
 */
// @mara implements DES-BATCH
export function withoutUnloadedRootValues(env: NodeJS.ProcessEnv, root: string): NodeJS.ProcessEnv {
  if (env.NX_LOAD_DOT_ENV_FILES === "true") {
    return env;
  }
  let unload: NxTaskEnv["unloadDotEnvFile"];
  try {
    unload = loadTaskEnv(root, ["unloadDotEnvFile"]).unloadDotEnvFile;
  } catch (error) {
    if (error instanceof NxBridgeError) {
      throw toTaskEnvironmentError(error);
    }
    throw error;
  }
  const rest: NodeJS.ProcessEnv = { ...env };
  const kept: NodeJS.ProcessEnv = {};
  for (const name of taskLayerVariables) {
    if (Object.prototype.hasOwnProperty.call(rest, name)) {
      kept[name] = rest[name];
      delete rest[name];
    }
  }
  for (const file of [".env", ".local.env", ".env.local"]) {
    unload(join(root, file), rest);
  }
  return { ...rest, ...kept };
}

/**
 * The environment that the plugin gives cargo for a task of a batch, from
 * the task's dotenv layer as Nx's `getTaskSpecificEnv` builds it in the batch
 * process (`DES-BATCH`): Nx's `getEnvVariablesForTask` over it, as Nx calls it
 * for a task whose output it does not write to a file;
 * `NX_INVOCATION_ANCESTOR_PIDS` with the value that Nx gave the batch process,
 * which it gives a task run on its own too, where computed in the batch
 * process it would name that process as well; then {@link afterTaskLayer}, as
 * the fork and the task's process set them for a task run on its own; and
 * {@link cargoTaskEnvironment}. A task of a batch waits for no continuous
 * task that reports ready by signal ({@link refuseReadyUrl} in `batch.ts`).
 *
 * @param processEnv The batch process's environment.
 */
// @mara implements DES-BATCH
export function batchTaskEnvironment(
  base: NodeJS.ProcessEnv,
  task: Task,
  taskLayer: EnvVariablesForTask,
  processEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = environment(
    taskLayer(
      task,
      { ...base },
      base.FORCE_COLOR,
      processEnv.NX_SKIP_NX_CACHE === "true",
      false,
      null,
      null,
    ),
    "getEnvVariablesForTask",
    task,
  );
  if (processEnv.NX_INVOCATION_ANCESTOR_PIDS === undefined) {
    delete env.NX_INVOCATION_ANCESTOR_PIDS;
  } else {
    env.NX_INVOCATION_ANCESTOR_PIDS = processEnv.NX_INVOCATION_ANCESTOR_PIDS;
  }
  Object.assign(env, afterTaskLayer);
  return cargoTaskEnvironment(definedOnly(env), {
    configuration: task.target.configuration,
    readyUrlDependency: false,
  });
}

/** `getEnvVariablesForTask` of Nx 24, which lays the per-task layer over it. */
export type EnvVariablesForTask = NxTaskEnv["getEnvVariablesForTask"];

/**
 * The environment of each task of a batch, as Nx builds it for the task run
 * on its own (`DES-BATCH`; `EVD-NX-24-BATCHES`, "Task environment"), with
 * the functions that Nx uses for that, from `nx/src/tasks-runner/task-env`,
 * which are no public API (`RISK-UPSTREAM-CHANGES`):
 *
 * 1. `getTaskSpecificEnv`: the environment of the `nx` command without the
 *    values that the repository's root `.env`, `.local.env` and `.env.local`
 *    gave it, with the task's dotenv files loaded in the order Nx reads them,
 *    those in the project's folder and those at the repository root named for
 *    the target or a configuration, with the root files last. Nx hands a
 *    batch process the command's environment, so the batch builds this layer
 *    from its own, which Nx made for its child processes as it makes a
 *    task's: with `NX_WORKSPACE_ROOT`, `NX_SKIP_NX_CACHE`,
 *    `NX_INVOCATION_ANCESTOR_PIDS` and `NX_FORKED_TASK_EXECUTOR`, and with
 *    `NX_CLI_SET`, which the process of a task run on its own sets too.
 * 2. {@link batchTaskEnvironment}: Nx's `getEnvVariablesForTask` with the
 *    task's own variables, `NX_TASK_TARGET_PROJECT`, `NX_TASK_TARGET_TARGET`,
 *    `NX_TASK_TARGET_CONFIGURATION`, `LERNA_PACKAGE_NAME` and `NX_TUI=false`,
 *    and the removal of the variables that Nx keeps from every task; then
 *    what Nx sets after that layer for a task run on its own
 *    ({@link afterTaskLayer}); then {@link cargoTaskEnvironment} and
 *    {@link withoutUnloadedRootValues}, as for a task run on its own. What a
 *    task run on its own and a task of a batch give cargo is the same.
 *
 * @param root The repository root, from where the installed Nx is loaded.
 * @returns A function that gives a task's environment, as a new object.
 * @throws {TaskEnvironmentError} When the installed Nx lacks a function.
 */
// @mara implements DES-BATCH
export function taskEnvironments(
  root: string,
  graph: ProjectGraph,
  shielded: (task: Task) => readonly string[] = () => [],
): (task: Task) => NodeJS.ProcessEnv {
  let dotenvLayer: NxTaskEnv["getTaskSpecificEnv"];
  let taskLayer: EnvVariablesForTask;
  try {
    const loaded = loadTaskEnv(root, ["getTaskSpecificEnv", "getEnvVariablesForTask"]);
    dotenvLayer = loaded.getTaskSpecificEnv;
    taskLayer = loaded.getEnvVariablesForTask;
  } catch (error) {
    if (error instanceof NxBridgeError) {
      throw toTaskEnvironmentError(error);
    }
    throw error;
  }
  return (task) => {
    // Nx's getTaskSpecificEnv reads the batch process's own environment.
    const saved = new Map<string, string | undefined>();
    for (const name of shielded(task)) {
      saved.set(name, process.env[name]);
      process.env[name] = shieldValue;
    }
    let base: NodeJS.ProcessEnv;
    try {
      base = environment(dotenvLayer(task, graph), "getTaskSpecificEnv", task);
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
    return withoutUnloadedRootValues(
      batchTaskEnvironment(base, task, taskLayer, process.env),
      root,
    );
  };
}

/**
 * The value that the batch gives, while Nx's `getTaskSpecificEnv` builds a
 * task's dotenv layer, to each variable of {@link runDependentVariables} that
 * the task's dotenv files define (`DES-BATCH`, "Dotenv files"). dotenv-expand
 * then takes this value, which no file gives, instead of expanding the
 * file's, as it takes the `nx` process's own value where that process has
 * one: so a definition whose expansion would not end, as
 * `NX_ORIGINAL_FORCE_COLOR=${CMD}z` with `CMD=x${CMD}` in the command, which
 * the `nx` process does not expand where the command has `FORCE_COLOR=0`,
 * cannot exhaust the batch process's memory either. The value never reaches
 * cargo: each of those variables is left out of cargo's environment or set
 * after the dotenv layer in both paths.
 */
export const shieldValue = "\u0001@convesoft/nx-rust";

// The variables that have a value: Node leaves an undefined one out of a
// child's environment, as it does for the process of a task run on its own.
function definedOnly(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

// A result of Nx's that has the shape of an environment, as a new object.
function environment(value: unknown, part: string, task: Task): NodeJS.ProcessEnv {
  if (
    typeof value !== "object" ||
    value === null ||
    !Object.values(value).every((entry) => entry === undefined || typeof entry === "string")
  ) {
    throw new TaskEnvironmentError(
      `${part} of the installed Nx gives no environment for ${task.id}`,
    );
  }
  // Nx keeps the object for later calls; the batch must not change it.
  return { ...(value as NodeJS.ProcessEnv) };
}

/**
 * The configuration with which Nx 24 would run `target` of `project` for a
 * command that passes `configuration`, by the installed Nx's own rule
 * (`ProcessTasks.resolveConfiguration` in `create-task-graph.js`): the
 * configuration passed where the target declares it, otherwise the target's
 * `defaultConfiguration`, and none where that is empty.
 *
 * @throws {TaskEnvironmentError} When the installed Nx lacks the rule.
 */
// @mara implements DES-RELEASE
export function nxTaskConfiguration(
  root: string,
  graph: ProjectGraph,
  project: string,
  target: string,
  configuration: string | undefined,
): string | undefined {
  let resolve: ReturnType<typeof loadCreateTaskGraph>["resolveConfiguration"];
  try {
    resolve = loadCreateTaskGraph(root).resolveConfiguration;
  } catch (error) {
    if (error instanceof NxBridgeError) {
      throw toTaskEnvironmentError(error);
    }
    throw error;
  }
  const node = graph.nodes[project];
  if (node === undefined) {
    throw new TaskEnvironmentError(`the project graph has no project ${project}`);
  }
  const resolved: unknown = resolve.call({ projectGraph: graph }, node, target, configuration);
  return typeof resolved === "string" && resolved !== "" ? resolved : undefined;
}
