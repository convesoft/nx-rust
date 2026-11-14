import type { ExecutorContext, Task } from "@nx/devkit";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PackageVersion } from "../cargo/lockfile";
import {
  configuredTriples,
  describeFolders,
  describeTriples,
  type PickedTriples,
  pickedTriples,
  pickText,
  samePick,
  tripleSource,
  unnamedTripleProblem,
} from "../cargo/target-triples";
import type { BuildRecordSource } from "../graph/build-records";
import { nxVerdictFor } from "../compatibility/nx-version";
import { cargoMetadataOf } from "../graph/collisions";
import {
  commandDigestFolder,
  commandIdVariable,
  digestFolder,
  runIdVariable,
} from "../graph/lockfile-task";
import { uncachedByDesign } from "../graph/outputs";
import {
  cachedTargets,
  type InferredTargetName,
  inferredTargetNames,
  type TargetCargoMetadata,
  targetCargoMetadataKey,
} from "../graph/targets";
import {
  describeFolder,
  MissingToolError,
  type OptionalToolId,
  requireTool,
} from "../tools/optional-tools";
import { cargoArguments, type CargoTargetOptions, pluginVersionOption } from "./command";
import { checkDigests, DigestCheck, DigestWrite, writeDigests } from "./digests";
import { type BuildInputCheck, checkBuildInputs } from "./input-check";
import {
  NxTaskFilesError,
  nxTaskFileParts,
  nxTaskFiles,
  skippedCheckWarning,
} from "./nx-task-files";
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

/**
 * The tool besides cargo that a target runs, by the target's default name:
 * a cargo subcommand that the plugin never installs (`ADR-V1-SCOPE`).
 */
const targetTools: Partial<Record<InferredTargetName, OptionalToolId>> = {
  audit: "cargo-audit",
  deny: "cargo-deny",
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
  /**
   * On a crate's `build`: the check of the files that cargo recorded for the
   * crate against the task's inputs, after cargo has succeeded
   * (`DES-BUILD-INPUT-CHECK`).
   */
  inputCheck?: BuildInputCheck;
}

/** What a task does with digests after its cargo call ({@link TaskInvocation.digests}). */
export type DigestStep = ({ kind: "write" } & DigestWrite) | ({ kind: "check" } & DigestCheck);

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
 * warnings that graph creation found for its project, and the warning for
 * an Nx major newer than the supported ones that `NX_RUST_ALLOW_UNSUPPORTED_NX`
 * lets the plugin run with, which the Nx daemon keeps out of the terminal
 * (`DES-DIAGNOSTICS`, "Warnings where they are seen").
 */
// @mara implements DES-INVOCATION
// @mara implements REQ-CARGO-UNCHANGED
// @mara implements REQ-NO-MANIFEST-WRITES
export async function runTask(
  executor: PluginExecutor,
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  for (const warning of [...nxWarnings(context.root), ...projectWarnings(context)]) {
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
  const failures = await checksAfterCargo(invocation, context);
  for (const failure of failures) {
    console.error(failure);
  }
  return { success: failures.length === 0 };
}

/**
 * The checks of a task after its cargo call has succeeded, in one step
 * (`DES-LOCKFILE-HASHING`, "Post-check"): first what the task does with the
 * lockfile's digests, which the lockfile task writes and a cached task
 * computes again, then, on a crate's `build`, the comparison of the files
 * that cargo recorded with the task's inputs (`DES-BUILD-INPUT-CHECK`). Both
 * run, so that a failed task names every problem at once.
 *
 * @returns The failure messages; the task succeeds without any.
 */
// @mara implements DES-LOCKFILE-HASHING
// @mara implements DES-BUILD-INPUT-CHECK
async function checksAfterCargo(
  invocation: TaskInvocation,
  context: ExecutorContext,
): Promise<string[]> {
  const failures: string[] = [];
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
      console.warn(skippedCheckWarning(check.task, error));
    }
  }
  return failures;
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
 *   `test` or `bench`, or is cached while its options name no triple and
 *   the task's environment and Cargo's configuration pick a triple whose
 *   folder the plugin cannot name or other triples than its outputs name
 *   (`DES-OUTPUTS`), when `NX_RUST_LOCKED` is neither `true` nor
 *   `false`, when `args` does not split into words, when the run gives
 *   `pluginVersion` another value than the target's (`DES-PLUGIN-OPTIONS`),
 *   when a task whose target hashes digests does not depend on its
 *   workspace's lockfile task in a run that does not exclude task
 *   dependencies (`DES-LOCKFILE-HASHING`), or when the tool that the target
 *   runs besides cargo is not installed where `env` and the workspace root
 *   say (`DES-DIAGNOSTICS`). The checks of what reaches the task's key, the
 *   cache guard, `pluginVersion` and the lockfile dependency, all run before
 *   the cargo command is built, and the check for the tool after them.
 */
// @mara implements DES-OUTPUTS
// @mara implements DES-PLUGIN-OPTIONS
// @mara implements DES-DIAGNOSTICS
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
    // The outputs name the folder of the triple in the option, and else of
    // what the configuration and the graph's environment picked, unless
    // the plugin cannot name that (`DES-OUTPUTS`).
    if (
      context.target?.cache === true &&
      !namesTriple(options) &&
      metadata.tripleProblem !== undefined
    ) {
      throw new TaskError(
        `${task}: ${metadata.tripleProblem}, and this run of the cached ${metadata.target} names no triple in the targetTriple option. Run it with the triple that the target's options give, and remove what clears the option for this run, such as a configuration, a project.json, a targetDefaults entry or a value on the command line; \`nx show target ${task} --json\` shows where each option comes from. The task does not run, so that Nx stores no result for it.`,
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
  const configured = configuredOptions(context);
  let examined: TaskOptions;
  try {
    examined = taskOptions({
      task,
      target: metadata.target,
      executor,
      options: options as Record<string, unknown>,
      configured,
      graphTask: graphTaskOf(context),
      record: recordedNxCommand(env),
    });
  } catch (error) {
    throw error instanceof OptionError ? new TaskError(error.message) : error;
  }
  // Graph creation has checked the target's own value; a value for this run
  // alone comes from the command line or from a task that forwards its
  // options. Words after `--` that `run` passes to its binary are no option.
  const given = examined.options.pluginVersion;
  if (given !== undefined && !isDeepStrictEqual(given, configured[pluginVersionOption])) {
    throw new TaskError(
      `${task}: this run gives the option "pluginVersion" the value ${JSON.stringify(given)}, but only @convesoft/nx-rust sets that option, to carry its version into the cache key. The value comes from the command line, such as --pluginVersion, or from a task that forwards its options to this one: leave it out. The task does not run, so that Nx stores no result for it.`,
    );
  }
  // Whether the key holds the lockfile task's digests, which the task then
  // checks after cargo's call; a key without them fails the task here.
  const workspaceRoot = dirname(cargo.workspaceManifest);
  const cwd = join(context.root, workspaceRoot);
  if (
    (metadata.target === "build" || metadata.target === "doc") &&
    context.target?.cache === true &&
    !namesTriple(options)
  ) {
    checkPickedTriples(task, metadata, cwd, context.root, env);
  }
  const lockfile = join(cwd, "Cargo.lock");
  const folder = join(context.root, digestFolder(workspaceRoot));
  // The private copies of this nx command's lockfile tasks.
  const commandId = (env[commandIdVariable] ?? "").replace(/[^A-Za-z0-9-]/g, "");
  const commandFolder =
    commandId === ""
      ? undefined
      : join(context.root, commandDigestFolder(workspaceRoot, commandId));
  let digests: DigestStep | undefined;
  if (metadata.target === "lockfile") {
    digests = { kind: "write", lockfile, folder, commandFolder, members: metadata.members ?? [] };
  } else if (
    metadata.digests !== undefined &&
    keyHoldsDigests(context, cargo.workspaceManifest, env)
  ) {
    digests = {
      kind: "check",
      task,
      lockfile,
      folder,
      commandFolder,
      members: metadata.digests,
      workspace: workspaceRoot,
    };
  }
  const tool = targetTools[metadata.target];
  if (tool !== undefined) {
    const neededBy = `the ${targetName} target of the Cargo workspace in ${describeFolder(workspaceRoot)}`;
    try {
      requireTool(tool, neededBy, {
        workspaceRoot: context.root,
        workspaces: [],
        env,
        folder: cwd,
      });
    } catch (error) {
      throw error instanceof MissingToolError ? new TaskError(`${task}: ${error.message}`) : error;
    }
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
  const inputCheck: BuildInputCheck | undefined =
    metadata.target === "build" && metadata.records !== undefined && cargo.packageName !== undefined
      ? {
          task,
          crate: cargo.packageName,
          manifest: cargo.manifest,
          records: metadata.records,
          selection: examined.options,
          env,
          cwd,
        }
      : undefined;
  return {
    args,
    cwd,
    warnings: examined.warnings,
    ...(digests === undefined ? {} : { digests }),
    ...(inputCheck === undefined ? {} : { inputCheck }),
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
// @mara implements DES-LOCKFILE-HASHING
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

// The warning for an unsupported Nx that the plugin runs with, which graph
// creation printed where the daemon may have kept it from the terminal. An
// unsupported Nx without the variable has failed graph creation already.
// @mara implements DES-DIAGNOSTICS
function nxWarnings(workspaceRoot: string): string[] {
  const verdict = nxVerdictFor(workspaceRoot, process.env);
  return verdict.kind === "warning" ? [verdict.message] : [];
}

// Whether a task's options name a triple, which `--target` then gives cargo
// in place of what the configuration and the environment pick.
function namesTriple(options: CargoTargetOptions): boolean {
  return typeof options.targetTriple === "string" && options.targetTriple !== "";
}

// Fails a cached `build` or `doc` whose run names no triple when the task's
// environment and Cargo's configuration, as they are now, pick other
// triples than those whose folders its outputs name, which graph creation
// recorded: cargo would write elsewhere, and Nx would store no artifact
// (`DES-OUTPUTS`). Where the configuration alone picks other triples than
// at graph creation, the graph is out of date, as when a file that Nx does
// not watch changed under the Nx daemon; otherwise the task's environment
// differs from the graph's, as through a dotenv file of the task.
// @mara implements DES-OUTPUTS
// @mara implements DES-DIAGNOSTICS
function checkPickedTriples(
  task: string,
  metadata: TargetCargoMetadata,
  cwd: string,
  root: string,
  env: NodeJS.ProcessEnv,
): void {
  const now = pickedTriples(cwd, env);
  const named: PickedTriples =
    metadata.triples === undefined
      ? { kind: "none" }
      : { kind: "triples", triples: metadata.triples, files: [], fromEnv: false };
  if (samePick(now, named)) {
    return;
  }
  const end = "The task does not run, so that Nx stores no result for it.";
  const configured = configuredTriples(cwd, env);
  if (pickText(configured) !== (metadata.configuredPick ?? "none")) {
    const source =
      configured.kind === "none"
        ? "no file sets build.target any more"
        : `${tripleSource(configured, root)} now ${configured.kind === "unnamed" ? `picks ${JSON.stringify(configured.value)}` : `picks ${describeTriples(configured)}`}`;
    throw new TaskError(
      [
        `${task}: Cargo's configuration has changed since Nx created the project graph: ${source}, while the outputs of the cached ${metadata.target} name ${describeFolders(named)}.`,
        `Nx does not watch a configuration file outside the repository, such as the Cargo home's, so the graph that the Nx daemon keeps is out of date. Run \`nx reset\`, or stop the daemon with \`nx daemon --stop\`, and run the task again. ${end}`,
      ].join("\n"),
    );
  }
  if (now.kind === "unnamed") {
    throw new TaskError(
      `${task}: ${unnamedTripleProblem(now, root)}, and this run of the cached ${metadata.target} names no triple in the targetTriple option. Give the triple as the targetTriple option instead. ${end}`,
    );
  }
  const source = now.kind === "none" ? "" : `, as ${tripleSource(now, root)} picks`;
  const option =
    now.kind === "triples" && now.triples.length === 1 ? `, --targetTriple=${now.triples[0]}` : "";
  throw new TaskError(
    [
      `${task}: cargo builds this run of the cached ${metadata.target} for ${describeTriples(now)}${source}, but its outputs name ${describeFolders(named)}, as Cargo's configuration and the environment picked them when Nx created the graph.`,
      `A CARGO_BUILD_TARGET that only a dotenv file of the task sets, such as a .env file in the crate's folder, is unknown when Nx creates the graph. Set it in the environment of the nx command or in the repository's root .env file, or give the triple as the targetTriple option${option}. ${end}`,
    ].join("\n"),
  );
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
  const {
    target,
    locked,
    uncached,
    triples,
    tripleProblem,
    configuredPick,
    members,
    digests,
    records,
  } = value as Partial<Record<keyof TargetCargoMetadata, unknown>>;
  return (inferredTargetNames as readonly unknown[]).includes(target)
    ? {
        target: target as InferredTargetName,
        locked: locked === true,
        ...(typeof uncached === "string" ? { uncached } : {}),
        ...(Array.isArray(triples) && triples.every((triple) => typeof triple === "string")
          ? { triples: triples as string[] }
          : {}),
        ...(typeof tripleProblem === "string" ? { tripleProblem } : {}),
        ...(typeof configuredPick === "string" ? { configuredPick } : {}),
        ...(isPackageList(members) ? { members } : {}),
        ...(isPackageList(digests) ? { digests } : {}),
        ...(isRecordSource(records) ? { records } : {}),
      }
    : undefined;
}

// Whether a value has the shape of the record source that graph creation
// gives a crate's `build` (`buildRecordSource` in `build-records.ts`).
function isRecordSource(value: unknown): value is BuildRecordSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const {
    artifactDirectory,
    buildDirectory,
    library,
    binaries,
    features,
    optionalDependencies,
    shared,
  } = value as Partial<Record<keyof BuildRecordSource, unknown>>;
  const isStrings = (list: unknown): list is string[] =>
    Array.isArray(list) && list.every((item) => typeof item === "string");
  return (
    typeof artifactDirectory === "string" &&
    typeof buildDirectory === "string" &&
    (library === undefined ||
      (typeof library === "object" &&
        library !== null &&
        typeof (library as { name?: unknown }).name === "string" &&
        typeof (library as { procMacro?: unknown }).procMacro === "boolean")) &&
    Array.isArray(binaries) &&
    binaries.every(
      (binary) =>
        typeof binary === "object" &&
        binary !== null &&
        typeof binary.name === "string" &&
        isStrings(binary.requiredFeatures),
    ) &&
    typeof features === "object" &&
    features !== null &&
    Object.values(features).every(isStrings) &&
    (optionalDependencies === undefined || isStrings(optionalDependencies)) &&
    isStrings(shared)
  );
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
