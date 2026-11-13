import type { ExecutorContext, Task } from "@nx/devkit";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { cargoMetadataOf } from "../graph/collisions";
import {
  cachedTargets,
  type InferredTargetName,
  inferredTargetNames,
  type TargetCargoMetadata,
  targetCargoMetadataKey,
} from "../graph/targets";
import { cargoArguments, type CargoTargetOptions } from "./command";
import { recordedNxCommand } from "./nx-command";
import { type ExecutorOptions, OptionError, type TaskOptions, taskOptions } from "./task-options";

/** A problem that stops a task before cargo runs; its message is what the task prints. */
export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskError";
  }
}

/**
 * One of the plugin's executors, by the name under which `executors.json`
 * lists it, with the options that its schema declares.
 */
export interface PluginExecutor extends ExecutorOptions {
  /** Whether the executor runs the target with this default name. */
  serves(target: InferredTargetName): boolean;
}

/** The cargo command of one task. */
export interface CargoInvocation {
  /** The arguments after `cargo`. */
  args: string[];
  /** The absolute path of the workspace root, where cargo starts. */
  cwd: string;
}

/** The cargo command of one task and the lines it prints before cargo starts. */
export interface TaskInvocation extends CargoInvocation {
  /** One warning line per option that the task ignores (`DES-UNKNOWN-OPTIONS`). */
  warnings: string[];
}

/**
 * Runs one task of an inferred target as one cargo command: in the root
 * folder of the crate's workspace, with the environment that Nx gives the
 * task and nothing added, and with cargo's standard streams as the task's
 * own, so that Nx shows and stores what cargo prints. The task succeeds when
 * cargo exits with status 0.
 *
 * A problem found before cargo starts fails the task with a message that
 * names it and runs no cargo. An option that the task ignores gets a warning
 * line at the top of its output. Before anything else, the task prints the
 * warnings that graph creation found for its project, which the Nx daemon
 * keeps out of the terminal (`DES-DIAGNOSTICS`, "Warnings where they are
 * seen").
 */
// @mara implements DES-INVOCATION
// @mara implements REQ-CARGO-UNCHANGED
// @mara implements REQ-NO-MANIFEST-WRITES
export async function runTask(
  executor: PluginExecutor,
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  for (const warning of projectWarnings(context)) {
    console.warn(warning);
  }
  let invocation: TaskInvocation;
  try {
    invocation = taskInvocation(executor, options, context, process.env);
  } catch (error) {
    if (error instanceof TaskError) {
      console.error(error.message);
      return { success: false };
    }
    throw error;
  }
  for (const warning of invocation.warnings) {
    console.warn(warning);
  }
  return { success: await runCargo(invocation) };
}

/**
 * The cargo command of a task, from the options that its target takes
 * ({@link taskOptions}), the metadata that the plugin gave the target and its
 * project, and locked mode, together with the warning lines for the options
 * that it ignores.
 *
 * @param env The task's environment, with `NX_RUST_LOCKED` and the record of
 *   the `nx` command ({@link recordedNxCommand}).
 * @throws {TaskError} When the target is no inferred target of this
 *   executor, when its configuration caches a target that the plugin does
 *   not cache, when `NX_RUST_LOCKED` is neither `true` nor `false`, or when
 *   `args` does not split into words.
 */
export function taskInvocation(
  executor: PluginExecutor,
  options: CargoTargetOptions,
  context: ExecutorContext,
  env: NodeJS.ProcessEnv,
): TaskInvocation {
  const projectName = context.projectName ?? "";
  const targetName = context.targetName ?? "";
  const task = `${projectName}:${targetName}`;
  const metadata = targetMetadata(context.target?.metadata?.[targetCargoMetadataKey]);
  if (metadata === undefined || !executor.serves(metadata.target)) {
    throw new TaskError(
      `${task}: ${executor.name} runs only the targets that @convesoft/nx-rust infers for a crate or a Cargo workspace, and ${task} is not one of them. To run another cargo command, define a target with a "command" under a name of its own.`,
    );
  }
  if (context.target?.cache === true && !cachedTargets.has(metadata.target)) {
    throw new TaskError(
      [
        `${task}: the configuration of this target sets "cache": true, but @convesoft/nx-rust does not declare the cache inputs of its targets yet, so Nx would restore results that miss changes to Cargo.lock, the toolchain or the environment. The task does not run, so that Nx stores no result for it.`,
        `The setting comes from the workspace's configuration: run \`nx show target ${task} --json\` and look under \`sourceMap\` for the file and entry. If it is a \`targetDefaults\` entry in nx.json, add a \`filter\` to it or add an empty entry keyed by "${context.target.executor ?? executor.name}".`,
      ].join("\n"),
    );
  }
  const project = context.projectsConfigurations?.projects?.[projectName];
  const cargo = project === undefined ? undefined : cargoMetadataOf(project);
  if (cargo === undefined) {
    throw new TaskError(
      `${task}: the project carries no Cargo workspace in its metadata, which @convesoft/nx-rust gives each project that it creates. Make sure that a project.json or package.json in the folder ${project?.root ?? projectName} does not replace the project's "metadata".`,
    );
  }
  const locked = lockedMode(metadata.locked, env.NX_RUST_LOCKED);
  let examined: TaskOptions;
  try {
    examined = taskOptions({
      task,
      target: metadata.target,
      executor,
      options: options as Record<string, unknown>,
      configured: configuredOptions(context),
      graphTask: graphTaskOf(context),
      record: recordedNxCommand(env),
    });
  } catch (error) {
    throw error instanceof OptionError ? new TaskError(error.message) : error;
  }
  const args = cargoArguments(
    {
      target: metadata.target,
      packageName: cargo.packageName,
      locked,
      binaryArguments: examined.binaryArguments,
    },
    examined.options,
  );
  return {
    args,
    cwd: join(context.root, dirname(cargo.workspaceManifest)),
    warnings: examined.warnings,
  };
}

/**
 * The task that the task graph in the executor's context holds for this
 * invocation: the one of the same project, target and configuration. Nx
 * gives a task's configuration, its target's `defaultConfiguration` where the
 * command names none, to the task in the graph and to the context alike.
 */
export function graphTaskOf(context: ExecutorContext): Task | undefined {
  const configuration = context.configurationName || undefined;
  return Object.values(context.taskGraph?.tasks ?? {}).find(
    ({ target }) =>
      target.project === context.projectName &&
      target.target === context.targetName &&
      (target.configuration || undefined) === configuration,
  );
}

// The target's options with those of the active configuration laid over
// them, as Nx merges them before the options of the invocation
// (`combineOptionsForExecutor` in `utils/params.js` of `nx` 24).
function configuredOptions(context: ExecutorContext): Record<string, unknown> {
  const configuration = context.configurationName;
  return {
    ...context.target?.options,
    ...(configuration ? context.target?.configurations?.[configuration] : undefined),
  };
}

/**
 * Whether a task runs in locked mode: the `locked` option of the plugin
 * entry, unless `NX_RUST_LOCKED` is set to `true` or `false` for the run
 * (`DES-INVOCATION`). An empty variable counts as unset.
 *
 * @throws {TaskError} When the variable has any other value.
 */
// @mara implements DES-INVOCATION
export function lockedMode(option: boolean, variable: string | undefined): boolean {
  switch (variable) {
    case undefined:
    case "":
      return option;
    case "true":
      return true;
    case "false":
      return false;
  }
  throw new TaskError(
    `NX_RUST_LOCKED is ${JSON.stringify(variable)}, but it has to be true or false. Unset it to use the "locked" option of the @convesoft/nx-rust entry in nx.json.`,
  );
}

/**
 * Runs cargo for a task with the task's environment, unchanged, and its
 * standard streams. Signals that stop the executor reach cargo too.
 *
 * Unlike graph creation (`runCargoForGraph`), a task sets no
 * `RUSTUP_AUTO_INSTALL`, so rustup behaves as for plain cargo.
 *
 * @returns Whether cargo exited with status 0.
 */
export function runCargo({ args, cwd }: CargoInvocation): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("cargo", args, { cwd, stdio: "inherit" });
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

// The warnings that graph creation recorded for the task's project.
// @mara implements DES-DIAGNOSTICS
function projectWarnings(context: ExecutorContext): string[] {
  const project = context.projectsConfigurations?.projects?.[context.projectName ?? ""];
  const warnings = project === undefined ? undefined : cargoMetadataOf(project)?.warnings;
  return Array.isArray(warnings)
    ? warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
}

// The target's metadata from the plugin, or undefined where it is missing.
function targetMetadata(value: unknown): TargetCargoMetadata | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { target, locked } = value as Partial<Record<keyof TargetCargoMetadata, unknown>>;
  return (inferredTargetNames as readonly unknown[]).includes(target)
    ? { target: target as InferredTargetName, locked: locked === true }
    : undefined;
}
