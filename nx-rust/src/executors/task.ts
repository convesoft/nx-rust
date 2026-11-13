import type { ExecutorContext, Task } from "@nx/devkit";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import type { PackageVersion } from "../cargo/lockfile";
import { cargoMetadataOf } from "../graph/collisions";
import { digestFolder, runIdVariable } from "../graph/lockfile-task";
import { uncachedByDesign } from "../graph/outputs";
import {
  cachedTargets,
  type InferredTargetName,
  inferredTargetNames,
  type TargetCargoMetadata,
  targetCargoMetadataKey,
} from "../graph/targets";
import { cargoArguments, type CargoTargetOptions } from "./command";
import { checkDigests, DigestCheck, writeDigests } from "./digests";
import { recordedNxCommand } from "./nx-command";
import { type ExecutorOptions, OptionError, type TaskOptions, taskOptions } from "./task-options";

/**
 * The profiles whose artifacts Cargo puts in another profile's folder, which
 * the outputs of `build` and `doc` cannot name (`DES-OUTPUTS`), with what to
 * build with instead.
 */
const renamedProfiles: Readonly<Record<string, string>> = {
  dev: "no profile: dev is cargo's default profile, whose folder is debug",
  test: "no profile, which builds the dev profile into the same folder, debug, or a custom profile that inherits from test",
  bench:
    "the profile release, whose folder cargo uses for bench too, or a custom profile that inherits from bench",
};

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
  /**
   * What the task does with the workspace's lockfile once cargo has succeeded
   * (`DES-LOCKFILE-HASHING`): the lockfile task writes the members' digests,
   * and a task whose key holds digests checks them again.
   */
  digests?: DigestStep;
}

/** What a task does with digests after its cargo call ({@link TaskInvocation.digests}). */
export type DigestStep =
  | {
      kind: "write";
      /** The absolute path of the workspace's `Cargo.lock`. */
      lockfile: string;
      /** The absolute path of the workspace's digest folder. */
      folder: string;
      /** The members whose digests the task writes. */
      members: PackageVersion[];
    }
  | ({ kind: "check" } & DigestCheck);

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
  if (!(await runCargo(invocation))) {
    return { success: false };
  }
  const step = invocation.digests;
  const failure =
    step === undefined
      ? undefined
      : step.kind === "write"
        ? writeDigests(`${context.projectName ?? ""}:${context.targetName ?? ""}`, step)
        : checkDigests(step);
  if (failure !== undefined) {
    console.error(failure);
    return { success: false };
  }
  return { success: true };
}

/**
 * The cargo command of a task, from the options that its target takes
 * ({@link taskOptions}), the metadata that the plugin gave the target and its
 * project, and locked mode, together with the warning lines for the options
 * that it ignores.
 *
 * @param env The task's environment, with `NX_RUST_LOCKED`, `NX_RUST_RUN_ID`
 *   and the record of the `nx` command ({@link recordedNxCommand}).
 * @throws {TaskError} When the target is no inferred target of this
 *   executor, when its configuration caches a target that the plugin leaves
 *   uncached in this project, when `build` or `doc` gets the profile `dev`,
 *   `test` or `bench`, or is cached while `CARGO_BUILD_TARGET` or
 *   `build.target` in Cargo's configuration chooses its triple and the
 *   task's options name none (`DES-OUTPUTS`), when `NX_RUST_LOCKED` is neither `true` nor
 *   `false`, when `args` does not split into words, or when a task whose
 *   target hashes digests does not depend on its workspace's lockfile task
 *   in a run that does not exclude task dependencies (`DES-LOCKFILE-HASHING`).
 */
// @mara implements DES-OUTPUTS
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
  // What the plugin decided for this project's target; a graph from before
  // that decision was recorded falls back to the target's default name.
  const uncached =
    metadata.uncached ??
    (cachedTargets.has(metadata.target)
      ? undefined
      : (uncachedByDesign[metadata.target] ?? "the plugin does not cache this target"));
  if (context.target?.cache === true && uncached !== undefined) {
    throw new TaskError(
      [
        `${task}: the configuration of this target sets "cache": true, but @convesoft/nx-rust leaves \`${metadata.target}\` uncached in this project, because ${uncached}. The task does not run, so that Nx stores no result for it.`,
        `The setting comes from the workspace's configuration: run \`nx show target ${task} --json\` and look under \`sourceMap\` for the file and entry. If it is a \`targetDefaults\` entry in nx.json, add a \`filter\` to it or add an empty entry keyed by "${context.target.executor ?? executor.name}".`,
      ].join("\n"),
    );
  }
  if (metadata.target === "build" || metadata.target === "doc") {
    const replacement =
      options.profile === undefined ? undefined : renamedProfiles[options.profile];
    if (replacement !== undefined) {
      throw new TaskError(
        `${task}: the profile ${options.profile} puts cargo's artifacts in the folder of another profile, which @convesoft/nx-rust cannot name for the cache. Build with ${replacement}.`,
      );
    }
    // The outputs name the triple's folder only through the option; where
    // the environment or Cargo's configuration chooses the triple instead,
    // cargo writes elsewhere and Nx would store no artifact.
    const namesTriple = typeof options.targetTriple === "string" && options.targetTriple !== "";
    const triple = env.CARGO_BUILD_TARGET;
    if (context.target?.cache === true && !namesTriple && triple !== undefined && triple !== "") {
      throw new TaskError(
        `${task}: CARGO_BUILD_TARGET is ${JSON.stringify(triple)}, and @convesoft/nx-rust cannot cache ${metadata.target} for a target triple that comes from the environment, because it cannot name the folder where cargo puts the artifacts. Give the triple as the targetTriple option instead: --targetTriple=${triple} on the command line, or in the crate's or the workspace's configuration. The task does not run, so that Nx stores no result for it.`,
      );
    }
    if (context.target?.cache === true && !namesTriple && metadata.buildTargetFile !== undefined) {
      throw new TaskError(
        `${task}: build.target in ${metadata.buildTargetFile} chooses the target triple, and this run of the cached ${metadata.target} names none in the targetTriple option, so @convesoft/nx-rust cannot name the folder where cargo puts the artifacts. Run it with the triple that the target's options give, and remove what clears the option for this run, such as a configuration, a project.json, a targetDefaults entry or a value on the command line; \`nx show target ${task} --json\` shows where each option comes from. The task does not run, so that Nx stores no result for it.`,
      );
    }
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
  const workspaceRoot = dirname(cargo.workspaceManifest);
  const cwd = join(context.root, workspaceRoot);
  const lockfile = join(cwd, "Cargo.lock");
  const folder = join(context.root, digestFolder(workspaceRoot));
  let digests: DigestStep | undefined;
  if (metadata.target === "lockfile") {
    digests = { kind: "write", lockfile, folder, members: metadata.members ?? [] };
  } else if (
    metadata.digests !== undefined &&
    keyHoldsDigests(context, cargo.workspaceManifest, env)
  ) {
    digests = {
      kind: "check",
      task,
      lockfile,
      folder,
      members: metadata.digests,
      workspace: workspaceRoot,
    };
  }
  return {
    args,
    cwd,
    warnings: examined.warnings,
    ...(digests === undefined ? {} : { digests }),
  };
}

/**
 * Whether the key of a task whose target hashes digests holds them, so that
 * the task checks them after cargo's call (`DES-LOCKFILE-HASHING`,
 * "Post-check"). A run that excludes task dependencies, which the plugin's
 * hook marks with a new `NX_RUST_RUN_ID`, runs no lockfile task, and the
 * task's key, which holds that value, is never computed again, so nothing
 * is checked. A task invoked outside a task graph that holds it, such as
 * through another executor, is keyed as that graph says and is not checked
 * either.
 *
 * @throws {TaskError} When the task graph holds the task without its
 *   dependency on the lockfile task of its workspace while the run does not
 *   exclude task dependencies: its key then holds no digest, and the task
 *   fails before cargo runs, so that Nx stores no result for it.
 */
function keyHoldsDigests(
  context: ExecutorContext,
  workspaceManifest: string,
  env: NodeJS.ProcessEnv,
): boolean {
  if ((env[runIdVariable] ?? "") !== "") {
    return false;
  }
  const graphTask = graphTaskOf(context);
  if (graphTask === undefined) {
    return false;
  }
  const projects = context.projectsConfigurations?.projects ?? {};
  // An edge is an object with the task's id; older task graphs held the id itself.
  const edges: unknown[] = context.taskGraph?.dependencies?.[graphTask.id] ?? [];
  const dependsOnLockfile = edges.some((edge) => {
    const id = typeof edge === "string" ? edge : (edge as { id?: string } | null)?.id;
    const dependency = id === undefined ? undefined : context.taskGraph?.tasks?.[id]?.target;
    const project = dependency === undefined ? undefined : projects[dependency.project];
    const target = project?.targets?.[dependency?.target ?? ""];
    return (
      targetMetadata(target?.metadata?.[targetCargoMetadataKey])?.target === "lockfile" &&
      project !== undefined &&
      cargoMetadataOf(project)?.workspaceManifest === workspaceManifest
    );
  });
  if (!dependsOnLockfile) {
    const task = `${context.projectName ?? ""}:${context.targetName ?? ""}`;
    const folder = dirname(workspaceManifest);
    throw new TaskError(
      [
        `${task}: this task does not depend on the lockfile task of its Cargo workspace, ${folder === "." ? "at the repository root" : `in ${folder}`}, so its cache key holds no digest of the crate's locked dependencies, and Nx could restore its result after Cargo.lock has changed. The task does not run, so that Nx stores no result for it.`,
        `Make sure that the workspace's folder is an Nx project with the plugin's lockfile target, and that no configuration replaces the dependsOn of ${task}: run \`nx show target ${task} --json\` and look under \`sourceMap\` for the file and entry. A run with --exclude-task-dependencies runs the task without the lockfile task, and Nx never restores what it stores then.`,
      ].join("\n"),
    );
  }
  return true;
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
  const { target, locked, uncached, buildTargetFile, members, digests } = value as Partial<
    Record<keyof TargetCargoMetadata, unknown>
  >;
  return (inferredTargetNames as readonly unknown[]).includes(target)
    ? {
        target: target as InferredTargetName,
        locked: locked === true,
        ...(typeof uncached === "string" ? { uncached } : {}),
        ...(typeof buildTargetFile === "string" ? { buildTargetFile } : {}),
        ...(isPackageList(members) ? { members } : {}),
        ...(isPackageList(digests) ? { digests } : {}),
      }
    : undefined;
}

function isPackageList(value: unknown): value is PackageVersion[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as PackageVersion).name === "string" &&
        typeof (entry as PackageVersion).version === "string",
    )
  );
}
