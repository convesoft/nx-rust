import type { ExecutorContext } from "@nx/devkit";
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

/** A problem that stops a task before cargo runs; its message is what the task prints. */
export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskError";
  }
}

/** One of the plugin's executors, by the name under which `executors.json` lists it. */
export interface PluginExecutor {
  /** The executor's full name, such as `@convesoft/nx-rust:cargo`. */
  name: string;
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

/**
 * Runs one task of an inferred target as one cargo command: in the root
 * folder of the crate's workspace, with the environment that Nx gives the
 * task and nothing added, and with cargo's standard streams as the task's
 * own, so that Nx shows and stores what cargo prints. The task succeeds when
 * cargo exits with status 0.
 *
 * A problem found before cargo starts fails the task with a message that
 * names it and runs no cargo.
 */
// @mara implements DES-INVOCATION
// @mara implements REQ-CARGO-UNCHANGED
// @mara implements REQ-NO-MANIFEST-WRITES
export async function runTask(
  executor: PluginExecutor,
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  let invocation: CargoInvocation;
  try {
    invocation = taskInvocation(executor, options, context, process.env.NX_RUST_LOCKED);
  } catch (error) {
    if (error instanceof TaskError) {
      console.error(error.message);
      return { success: false };
    }
    throw error;
  }
  return { success: await runCargo(invocation) };
}

/**
 * The cargo command of a task, from the target's options, the metadata that
 * the plugin gave the target and its project, and locked mode.
 *
 * @param lockedVariable The value of `NX_RUST_LOCKED`.
 * @throws {TaskError} When the target is no inferred target of this
 *   executor, when its configuration caches a target that the plugin does
 *   not cache, or when `NX_RUST_LOCKED` is neither `true` nor `false`.
 */
export function taskInvocation(
  executor: PluginExecutor,
  options: CargoTargetOptions,
  context: ExecutorContext,
  lockedVariable: string | undefined,
): CargoInvocation {
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
  const args = cargoArguments(
    {
      target: metadata.target,
      packageName: cargo.packageName,
      locked: lockedMode(metadata.locked, lockedVariable),
    },
    options,
  );
  return { args, cwd: join(context.root, dirname(cargo.workspaceManifest)) };
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
