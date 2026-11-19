import type { ExecutorContext, Task } from "@nx/devkit";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  type CargoDirectories,
  DirectoryReportError,
  directoryVariableNames,
  directoryVariables,
  reportedDirectories,
} from "../cargo/directories";
import type { PackageVersion } from "../cargo/lockfile";
import type { CargoPackage } from "../cargo/metadata";
import { hostTriple } from "../cargo/host-triple";
import { memberPackages, PackageSpecReportError } from "../cargo/package-specs";
import {
  configuredTriples,
  describeFolders,
  describeTriples,
  optionTripleReason,
  type PickedTriples,
  pickedTriples,
  pickText,
  samePick,
  tripleSource,
  unnamedTripleProblem,
} from "../cargo/target-triples";
import type { BuildRecordSource } from "../graph/build-records";
import type { TestRunner } from "../graph/settings";
import { cargoMetadataOf } from "../graph/collisions";
import {
  commandDigestFolder,
  commandIdVariable,
  digestFolder,
  runIdVariable,
} from "../graph/lockfile-task";
import { uncachedByDesign } from "../graph/outputs";
import { sharedArtifact, sharedArtifactMessage } from "./shared-artifacts";
import { physicalPath, repositoryFolder } from "../graph/real-path";
import {
  cachedTargets,
  type InferredTargetName,
  inferredTargetNames,
  type TargetCargoMetadata,
  targetCargoMetadataKey,
} from "../graph/targets";
import { wasmTriple } from "../graph/wasm";
import {
  describeFolder,
  MissingToolError,
  type OptionalToolId,
  requireTool,
} from "../tools/optional-tools";
import {
  type CargoStep,
  cargoSteps,
  type CargoTargetOptions,
  type CrateSelection,
  pluginVersionOption,
  type SelectingRunner,
  selectsBySpecification,
} from "./command";
import { hasLibrary, runGroup } from "./group-run";
import { type NapiTask, NapiTaskError, prepareNapiTask, runNapiGroup } from "./napi-build";
import { prepareWasmTask, runWasmGroup, type WasmTask, WasmTaskError } from "./wasm-build";
import { type GroupSelection, type PlannedGroup, planGroups } from "./groups";
import { runnerCommand } from "./runner-script";
import {
  type CargoInvocation,
  cargoEnvironment,
  printCommand,
  taskRunsVerbosely,
} from "./cargo-invocation";
import { checkDigests, DigestCheck, DigestWrite, heldMembers, writeDigests } from "./digests";
import { dotenvProblem } from "./dotenv-check";
import {
  cargoTaskEnvironment,
  readyUrlProducers,
  TaskEnvironmentError,
  type TaskShape,
  withoutUnloadedRootValues,
} from "./task-env";
import { type BuildInputCheck, checkBuildInputs } from "./input-check";
import {
  NxTaskFilesError,
  nxTaskFileParts,
  nxTaskFiles,
  skippedCheckWarning,
} from "./nx-task-files";
import { recordedNxCommand } from "./nx-command";
import { type ExecutorOptions, OptionError, type TaskOptions, taskOptions } from "./task-options";
import {
  invalidTestModeMessage,
  type TestMode,
  testMode,
  testModeNote,
  testModeText,
} from "./test-mode";

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
  "hakari-check": "cargo-hakari",
  "coverage-baseline": "cargo-affected",
};

/** A problem that stops a task before cargo runs; its message is what the task prints. */
export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskError";
  }
}

/**
 * What {@link cargoTaskEnvironment} needs to know of a task run on its own:
 * its configuration, and whether it waits for a continuous task that
 * reports ready by signal, for which Nx sets `NX_READY_URL`
 * ({@link readyUrlProducers}).
 */
export function singleTaskShape(context: ExecutorContext): TaskShape {
  const graph = context.taskGraph;
  const task = Object.values(graph?.tasks ?? {}).find(
    (candidate) =>
      candidate.target.project === context.projectName &&
      candidate.target.target === context.targetName &&
      candidate.target.configuration === context.configurationName,
  );
  const producers =
    task === undefined || graph === undefined || context.projectGraph === undefined
      ? []
      : readyUrlProducers(task.id, graph, context.projectGraph);
  return { configuration: context.configurationName, readyUrlDependency: producers.length > 0 };
}

/**
 * One of the plugin's executors, by the name under which `executors.json`
 * lists it, with the options that its schema declares.
 */
export interface PluginExecutor extends ExecutorOptions {
  /** Whether the executor runs the target with this default name. */
  serves(target: InferredTargetName): boolean;
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
 * Runs one task of an inferred target that Nx runs on its own, as with
 * `--batch=false`: as a group with one task (`TERM-GROUP`), in the root
 * folder of the crate's workspace, with the environment that Nx gives the
 * task and nothing added.
 *
 * A group that selects its crate, a group of one crate among them, runs one
 * cargo command with cargo's standard streams as the task's own, so that Nx
 * shows and stores what cargo prints, and the task succeeds when cargo exits
 * with status 0. A group that selects the whole workspace, as `build`,
 * `check`, `lint` and `test` do under `workspace-build` on the host, runs the
 * steps that the same group runs in a batch, so that its crate compiles with
 * the features of the whole workspace whatever else runs
 * (`REQ-STABLE-FEATURES`), and prints its part of their output once they
 * have ended, as its result in a batch holds it (`DES-BATCH`).
 *
 * A problem found before cargo starts fails the task with a message that
 * names it and runs no cargo. An option that the task ignores gets a warning
 * line at the top of its output, and so does the reason why a task runs its
 * crate alone where the output names it. Before anything else, the task
 * prints the warnings that graph creation found for its project, among them
 * the one for an Nx major newer than the supported ones that
 * `NX_RUST_ALLOW_UNSUPPORTED_NX` lets the plugin run with, which the Nx
 * daemon keeps out of the terminal. The project's keys hold a digest of them,
 * so that a cache hit replays the warnings of the graph that the command
 * uses (`DES-DIAGNOSTICS`, "Warnings where they are seen"), apart from those
 * about Cargo configuration that Nx does not hash, which no key holds. When
 * the executor's context says that Nx runs verbosely, the task prints each
 * cargo command right before cargo starts, after every warning
 * (`DES-INVOCATION`, "Printing the command"); otherwise it prints nothing of
 * it.
 */
// @mara implements DES-INVOCATION
// @mara implements REQ-CARGO-UNCHANGED
// @mara implements REQ-NO-MANIFEST-WRITES
// @mara implements REQ-VERBOSE-COMMAND
// @mara implements REQ-STABLE-FEATURES
export async function runTask(
  executor: PluginExecutor,
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  for (const warning of projectWarnings(context)) {
    console.warn(warning);
  }
  // The task's environment without the variables by which Nx tells the task
  // how it runs and records it, which a batch cannot give its tasks: every
  // check and every cargo command of the task uses it, as in a batch
  // (`DES-BATCH`).
  let prepared: PreparedTask;
  let planned: PlannedGroup<PreparedTask>;
  let invocation: GroupInvocation;
  let env: NodeJS.ProcessEnv;
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
        `${context.projectName}:${context.targetName}: @convesoft/nx-rust cannot build this task's environment, because ${error.message}. The task does not run, so that Nx stores no result for it. Use an Nx version that @convesoft/nx-rust supports.`,
      );
    }
    prepared = prepareTask(executor, options, context, env);
    [planned] = planGroups([[prepared]]);
    const [finished] = groupInvocations([prepared], context.root, planned.selection);
    if (typeof finished === "string") {
      throw new TaskError(finished);
    }
    invocation = finished;
  } catch (error) {
    if (error instanceof TaskError) {
      console.error(error.message);
      return { success: false };
    }
    throw error;
  }
  for (const warning of prepared.warnings) {
    console.warn(warning);
  }
  if (prepared.testMode?.note !== undefined) {
    console.warn(prepared.testMode.note);
  }
  if (planned.selection.kind === "alone" && planned.selection.note !== undefined) {
    console.warn(planned.selection.note);
  }
  const task = `${context.projectName ?? ""}:${context.targetName ?? ""}`;
  const verbose = taskRunsVerbosely(context);
  // `napi-build` runs its compile with variables of its own and its
  // post-processing after it, and `wasm-build` the wasm-bindgen CLI after its
  // compile, whichever way their groups select (`DES-NAPI`, `DES-WASM`). A
  // task that selects affected tests runs steps 1 and 2 before its nextest
  // command (`DES-TEST-RUN`), as in a batch.
  if (
    planned.selection.kind === "workspace" ||
    prepared.napi !== undefined ||
    prepared.wasm !== undefined ||
    prepared.testMode?.selects === true
  ) {
    const [result] = await (
      prepared.napi !== undefined
        ? runNapiGroup
        : prepared.wasm !== undefined
          ? runWasmGroup
          : runGroup
    )([{ prepared, invocation, context }], verbose);
    if (result.output !== "") {
      await new Promise<void>((resolve) =>
        process.stdout.write(`${result.output}\n`, () => resolve()),
      );
    }
    return { success: result.success };
  }
  // Every step of the group, one after another, each only after the one
  // before it succeeded: one for most targets, two for `hakari-check`, and
  // for `test` with nextest the doctests only where the crate has a library.
  for (const step of invocation.steps.filter(
    (entry) => entry.kind !== "doctests" || hasLibrary(invocation.package),
  )) {
    if (!(await runCargo({ ...invocation, args: step.args }, env, verbose ? task : undefined))) {
      if (prepared.target === "hakari-check") {
        console.error(hakariCheckFailure(task, step.args));
      }
      return { success: false };
    }
  }
  const { failures, warnings } = await checksAfterCargo(invocation, context);
  for (const warning of warnings) {
    console.warn(warning);
  }
  for (const failure of failures) {
    console.error(failure);
  }
  return { success: failures.length === 0 };
}

/**
 * The message of a failed `hakari-check`, after cargo-hakari's own output
 * (`DES-UNIFICATION`, "Drift"; `DES-DIAGNOSTICS`): which command failed, and
 * that running `cargo hakari generate` and `cargo hakari manage-deps` and
 * committing the result brings the hack crate up to date.
 */
// @mara implements DES-DIAGNOSTICS
export function hakariCheckFailure(task: string, args: readonly string[]): string {
  return `${task}: \`cargo ${args.join(" ")}\` failed, so the hack crate of cargo-hakari is not current, or cargo-hakari could not read the package graph, as its output above says. No task of the workspace's crates that depends on this check runs, so that Nx stores no result for them. Run \`cargo hakari generate\` and \`cargo hakari manage-deps\` in the workspace root and commit the result.`;
}

/**
 * The checks of a task after its cargo call has succeeded, in one step
 * (`DES-LOCKFILE-HASHING`, "Post-check"): first what the task does with the
 * lockfile's digests, which the lockfile task writes and a cached task
 * computes again, then, on a crate's `build`, the comparison of the files
 * that cargo recorded with the task's inputs (`DES-BUILD-INPUT-CHECK`). Both
 * run, so that a failed task names every problem at once.
 *
 * @returns The failure messages, without which the task succeeds, and the
 *   warning that the input check did not run, for the task's output.
 */
// @mara implements DES-LOCKFILE-HASHING
// @mara implements DES-BUILD-INPUT-CHECK
export async function checksAfterCargo(
  invocation: Pick<TaskInvocation, "digests" | "inputCheck">,
  context: ExecutorContext,
): Promise<{ failures: string[]; warnings: string[] }> {
  const failures: string[] = [];
  const warnings: string[] = [];
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
      warnings.push(skippedCheckWarning(check.task, error));
    }
  }
  return { failures, warnings };
}

/**
 * A task whose checks before cargo have passed, waiting for the cargo
 * command of its group (`TERM-GROUP`): what its command depends on, and
 * what the task does after the command.
 */
export interface PreparedTask {
  /** The task as messages name it, `<project>:<target>`. */
  task: string;
  /** The default name of the task's target, which decides the command. */
  target: InferredTargetName;
  /** The options that the target takes ({@link taskOptions}). */
  options: CargoTargetOptions;
  /** The binary's arguments, for `run`; empty for every other target. */
  binaryArguments: string[];
  /** One warning line per option that the task ignores (`DES-UNKNOWN-OPTIONS`). */
  warnings: string[];
  /** Whether the command runs in locked mode (`DES-INVOCATION`). */
  locked: boolean;
  /** The workspace's root folder, relative to the repository root. */
  workspaceRoot: string;
  /** The absolute path of the workspace root, where cargo starts. */
  cwd: string;
  /** The crate's package name; absent for a workspace project without a crate. */
  crate?: string;
  /** The crate's manifest, relative to the repository root. */
  manifest?: string;
  /** What the task does with the lockfile's digests after cargo ({@link TaskInvocation.digests}). */
  digests?: DigestStep;
  /**
   * On a cached `build` or `doc` whose outputs name the artifact directory:
   * the target's metadata, against which the group's directories are
   * checked before cargo builds (`DES-OUTPUTS`).
   */
  artifactCheck?: TargetCargoMetadata;
  /**
   * On a crate's `build`, `napi-build` and `wasm-build`: what graph creation
   * reported for the records (`DES-BUILD-INPUT-CHECK`).
   */
  records?: BuildRecordSource;
  /** On `napi-build`: what its compile and post-processing need (`DES-NAPI`). */
  napi?: NapiTask;
  /** On `wasm-build`: what its post-processing needs (`DES-WASM`). */
  wasm?: WasmTask;
  /**
   * Whether the target's own options, which the crate's table, a
   * `project.json` or a `targetDefaults` entry give it, set a feature set:
   * features, all features or no default features. Such a task forms a
   * group of one crate whatever else runs ("Groups of one crate" in
   * `DES-BATCH`); a feature set that a configuration or the command line
   * gives every task of a run does not count.
   */
  ownFeatureSet?: boolean;
  /**
   * On `test`: the workspace's test runner, from the target's metadata
   * (`REQ-TEST-RUNNER`); absent means `cargo`.
   */
  testRunner?: TestRunner;
  /**
   * The feature-unification strategy of the task's workspace, as graph
   * creation recorded it in the project's metadata (`DES-UNIFICATION`);
   * `workspace-build` where it recorded none, and where absent.
   */
  featureUnification?: "hakari" | "cargo" | "workspace-build";
  /**
   * Under `hakari`, the triples of `platforms` that graph creation recorded:
   * a task that builds for another triple, or on another host, forms a
   * group of one crate ("Triples that `platforms` does not list").
   */
  hakariPlatforms?: string[];
  /**
   * On `test` in a workspace that uses selection: the test mode, decided
   * from the task's environment by the rule of the target's mode input
   * (`DES-TEST-MODE`), and the line that says at the top of the task's
   * output which suite it runs and why.
   */
  testMode?: {
    mode: TestMode;
    /**
     * Whether the task selects: it is in affected mode with a baseline and
     * does not opt out with `affectedTests = false`.
     */
    selects: boolean;
    note?: string;
  };
  /** Under `hakari`, the hack crate's package name (`DES-NAPI`). */
  hakariPackage?: string;
  /** The task's environment, with which its checks ran and its cargo runs. */
  env: NodeJS.ProcessEnv;
}

/**
 * The checks of a task before cargo runs, and what its command depends on,
 * apart from what a group asks cargo once for all its tasks: the crates'
 * package ID specifications and Cargo's directories ({@link groupInvocations}).
 *
 * @param env The task's environment, with `NX_RUST_LOCKED`, `NX_RUST_RUN_ID`
 *   and the record of the `nx` command ({@link recordedNxCommand}).
 * @throws {TaskError} When the target is no inferred target of this
 *   executor, when its configuration caches a target that the plugin leaves
 *   uncached in this project, when `build` or `doc` gets the profile `dev`,
 *   `test` or `bench`, or is cached while its options name no triple and
 *   the task's environment and Cargo's configuration pick a triple whose
 *   folder the plugin cannot name or other triples than its outputs name,
 *   or is cached while its `targetTriple` option is `host-tuple` or a
 *   target specification file (`DES-OUTPUTS`), when `NX_RUST_LOCKED` is
 *   neither `true` nor `false`, when `args` does not split into words, when
 *   the run gives `pluginVersion` another value than the target's
 *   (`DES-PLUGIN-OPTIONS`), when a task whose target hashes digests does not
 *   depend on its workspace's lockfile task in a run that does not exclude
 *   task dependencies (`DES-LOCKFILE-HASHING`), when the run holds the
 *   `build` of a crate whose `test` replaces its executables without an
 *   order between the two (`DES-TARGETS`), or when the tool that the target
 *   runs besides cargo is not installed where `env` and the workspace root
 *   say (`DES-DIAGNOSTICS`), or when `NX_RUST_TEST_MODE` has another value
 *   than `full` or `affected` for a `test` in a workspace that uses
 *   selection (`DES-TEST-MODE`). The checks of what reaches the task's key, the
 *   cache guard, `pluginVersion` and the lockfile dependency, and the check
 *   of the order of `test` and `build` all run before the check for the tool.
 */
// @mara implements DES-OUTPUTS
// @mara implements DES-PLUGIN-OPTIONS
// @mara implements DES-DIAGNOSTICS
// @mara implements DES-TEST-MODE
export function prepareTask(
  executor: PluginExecutor,
  options: CargoTargetOptions,
  context: ExecutorContext,
  env: NodeJS.ProcessEnv,
): PreparedTask {
  const projectName = context.projectName ?? "";
  const targetName = context.targetName ?? "";
  const task = `${projectName}:${targetName}`;
  const metadata = targetMetadata(context.target?.metadata?.[targetCargoMetadataKey]);
  if (metadata === undefined || !executor.serves(metadata.target)) {
    throw new TaskError(
      `${task}: ${executor.name} runs only the targets that @convesoft/nx-rust infers for a crate or a Cargo workspace, and ${task} is not one of them. To run another cargo command, define a target with a "command" under a name of its own.`,
    );
  }
  // Dotenv files whose expansion would differ between the ways of running
  // the task (`DES-BATCH`, "Dotenv files").
  let dotenv: string | undefined;
  try {
    if (context.projectGraph === undefined) {
      throw new TaskEnvironmentError("Nx gave the task no project graph");
    }
    dotenv = dotenvProblem(
      {
        id: task,
        target: {
          project: projectName,
          target: targetName,
          ...(context.configurationName === undefined
            ? {}
            : { configuration: context.configurationName }),
        },
        projectRoot: context.projectsConfigurations?.projects?.[projectName]?.root,
      },
      context.projectGraph,
      context.root,
      env,
    );
  } catch (error) {
    if (!(error instanceof TaskEnvironmentError)) {
      throw error;
    }
    throw new TaskError(
      `${task}: @convesoft/nx-rust cannot check the dotenv files of this task, because ${error.message}. The task does not run, so that Nx stores no result for it. Use an Nx version that @convesoft/nx-rust supports.`,
    );
  }
  if (dotenv !== undefined) {
    throw new TaskError(`${task}: ${dotenv}`);
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
  // A file of this task that another project's target writes too, where
  // graph creation did not see that project (`DES-OUTPUTS`, "Files of one
  // name"): only a task that Nx caches can store it.
  const shared =
    context.target?.cache === true &&
    (metadata.target === "build" ||
      metadata.target === "doc" ||
      (metadata.target === "test" && metadata.waitsForBuild === true))
      ? sharedArtifact(context.projectsConfigurations?.projects ?? {}, {
          task,
          project: projectName,
          target: metadata.target,
        })
      : undefined;
  if (shared !== undefined) {
    throw new TaskError(
      sharedArtifactMessage(
        { task, project: projectName, target: metadata.target as "build" | "doc" | "test" },
        shared,
      ),
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
    // The outputs take the option's value for the triple's folder, which
    // cargo names otherwise for some values (`DES-OUTPUTS`).
    if (context.target?.cache === true && namesTriple(options)) {
      checkOptionTriple(task, metadata.target, options.targetTriple as string, context, env);
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
  const strategy = cargo.featureUnification ?? "workspace-build";
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
  if (metadata.target === "test") {
    // The crates whose `build` the test waits for; a graph from before the
    // list was recorded names the crate's own `build` alone.
    const project = context.projectsConfigurations?.projects?.[projectName];
    const roots =
      metadata.waitsForBuilds ??
      (metadata.waitsForBuild === true && project !== undefined ? [project.root] : []);
    if (roots.length > 0) {
      checkBuildOrder(task, context, roots);
    }
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
  } else if (metadata.digests !== undefined) {
    const lockfileTask = keyHoldsDigests(context, cargo.workspaceManifest, env);
    if (lockfileTask !== undefined) {
      const members = heldMembers(
        metadata.digests,
        metadata.everyDigest === true,
        lockfileTask.members,
      );
      if (members === undefined) {
        throw new TaskError(
          `${task}: the cache key of this task holds the digests of every member of its Cargo workspace, ${workspaceRoot === "." ? "at the repository root" : `in ${workspaceRoot}`}, but the metadata of the lockfile task ${lockfileTask.id} names no member, so nx-rust cannot check them after cargo's call. The task does not run, so that Nx stores no result for it. Run \`nx reset\` so that Nx creates the project graph again.`,
        );
      }
      // Under `hakari`, a task that shares its command compares every
      // member's digest, although its key holds its own: its result rests
      // on the drift check, which judged the whole lockfile
      // (`DES-LOCKFILE-HASHING`, "Post-check").
      const shared =
        strategy === "hakari"
          ? heldMembers(metadata.digests, true, lockfileTask.members)
          : undefined;
      if (strategy === "hakari" && shared === undefined) {
        throw new TaskError(
          `${task}: this task compares the digests of every member of its Cargo workspace, ${workspaceRoot === "." ? "at the repository root" : `in ${workspaceRoot}`}, after a cargo command that it shares with other crates, but the metadata of the lockfile task ${lockfileTask.id} names no member, so nx-rust cannot check them after cargo's call. The task does not run, so that Nx stores no result for it. Run \`nx reset\` so that Nx creates the project graph again.`,
        );
      }
      if (strategy === "hakari" && metadata.target !== "doc") {
        checkHakariDependency(context, cargo.workspaceManifest);
      }
      digests = {
        kind: "check",
        task,
        lockfile,
        folder,
        commandFolder,
        members,
        ...(shared === undefined ? {} : { sharedMembers: shared }),
        workspace: workspaceRoot,
      };
    }
  }
  // The test mode, by the rule of the mode input that the key holds, from
  // the task's own environment; a task run on its own and one in a batch
  // get the same (`DES-TEST-MODE`).
  let testModeDecision: PreparedTask["testMode"];
  if (metadata.target === "test" && metadata.affectedTests !== true) {
    // Graph creation refuses the option set to true in stored configuration,
    // so a value here comes from the command line or a forwarding task
    // (`DES-PLUGIN-OPTIONS`).
    if (examined.options.affectedTests === true) {
      throw new TaskError(
        `${task}: this run sets "affectedTests" to true, as --affectedTests=true on the command line does, but the Cargo workspace in ${cargo.workspaceManifest} does not use the selection of affected tests, so the option can only turn it off. Remove it, or turn selection on with affectedTests = true under [workspace.metadata.nx] in ${cargo.workspaceManifest}. The task does not run, so that Nx stores no result for it.`,
      );
    }
  }
  if (metadata.target === "test" && metadata.affectedTests === true) {
    const mode = testMode(env, cwd);
    if (mode.kind === "invalid") {
      throw new TaskError(invalidTestModeMessage(task, mode.value));
    }
    const optedOut = examined.options.affectedTests === false;
    const selects = mode.kind === "affected" && !optedOut;
    const neededBy = `the selection of affected tests of the ${targetName} target of ${cargo.packageName ?? projectName}, whose Cargo workspace in ${describeFolder(workspaceRoot)} turns it on (affectedTests), in test mode ${testModeText(mode)}`;
    let missing: string | undefined;
    try {
      requireTool("cargo-affected", neededBy, {
        workspaceRoot: context.root,
        workspaces: [],
        env,
        folder: cwd,
      });
    } catch (error) {
      if (!(error instanceof MissingToolError)) {
        throw error;
      }
      // In affected mode the task cannot select without it; in mode full it
      // runs the full suite, and the missing tool would show only in a run
      // that selects (`DES-DIAGNOSTICS`).
      if (selects) {
        throw new TaskError(`${task}: ${error.message}`);
      }
      missing = `${task}: warning: cargo-affected is not installed, which the selection of affected tests in this workspace needs in test mode affected; this run is in test mode ${testModeText(mode)} and runs the full suite without it. ${error.tool.install}`;
    }
    const note = [testModeNote(task, mode, optedOut), missing]
      .filter((line) => line !== undefined)
      .join("\n");
    testModeDecision = { mode, selects, ...(note === "" ? {} : { note }) };
  }
  // The checks of `napi-build` before cargo (`DES-NAPI`), after those of
  // what reaches the task's key.
  let napi: NapiTask | undefined;
  if (metadata.target === "napi-build" && cargo.packageName !== undefined) {
    try {
      napi = prepareNapiTask(
        task,
        cargo.packageName,
        metadata,
        join(context.root, project?.root ?? ""),
        cwd,
        env,
        context.target?.cache === true,
        context.root,
      );
    } catch (error) {
      throw error instanceof NapiTaskError ? new TaskError(error.message) : error;
    }
  }
  // The checks of `wasm-build` before cargo (`DES-WASM`), after those of
  // what reaches the task's key.
  let wasm: WasmTask | undefined;
  if (metadata.target === "wasm-build" && cargo.packageName !== undefined) {
    try {
      wasm = prepareWasmTask(
        task,
        cargo.packageName,
        metadata,
        join(context.root, project?.root ?? ""),
        cwd,
        env,
        examined.options,
        context.root,
        metadata.digests?.find((member) => member.name === cargo.packageName)?.version,
      );
    } catch (error) {
      throw error instanceof WasmTaskError ? new TaskError(error.message) : error;
    }
  }
  const nextest = metadata.target === "test" && metadata.testRunner === "nextest";
  const tool = nextest ? "cargo-nextest" : targetTools[metadata.target];
  if (tool !== undefined) {
    const neededBy = nextest
      ? `the ${targetName} target of ${cargo.packageName ?? projectName}, whose Cargo workspace in ${describeFolder(workspaceRoot)} uses the nextest runner (testRunner)`
      : `the ${targetName} target of the Cargo workspace in ${describeFolder(workspaceRoot)}`;
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
  return {
    task,
    target: metadata.target,
    options: examined.options,
    binaryArguments: examined.binaryArguments,
    warnings: examined.warnings,
    locked,
    workspaceRoot,
    cwd,
    ...(cargo.packageName === undefined
      ? {}
      : { crate: cargo.packageName, manifest: cargo.manifest }),
    ...(digests === undefined ? {} : { digests }),
    ...((metadata.target === "build" || metadata.target === "doc") &&
    context.target?.cache === true &&
    metadata.artifactDirectory !== undefined
      ? { artifactCheck: metadata }
      : {}),
    ...((metadata.target === "build" ||
      metadata.target === "napi-build" ||
      metadata.target === "wasm-build") &&
    metadata.records !== undefined
      ? { records: metadata.records }
      : {}),
    ...(napi === undefined ? {} : { napi }),
    ...(wasm === undefined ? {} : { wasm }),
    ...(setsFeatureSet(context.target?.options) ? { ownFeatureSet: true } : {}),
    ...(nextest ? { testRunner: "nextest" as const } : {}),
    ...(testModeDecision === undefined ? {} : { testMode: testModeDecision }),
    featureUnification: strategy,
    ...(cargo.hakariPlatforms === undefined ? {} : { hakariPlatforms: cargo.hakariPlatforms }),
    ...(typeof cargo.hakariPackage === "string" ? { hakariPackage: cargo.hakariPackage } : {}),
    env,
  };
}

/**
 * Whether options set a feature set other than the default features:
 * features, all features or no default features (`DES-FEATURE-SETS`).
 */
function setsFeatureSet(options: Record<string, unknown> | undefined): boolean {
  if (options === undefined) {
    return false;
  }
  const { features, allFeatures, noDefaultFeatures } = options;
  return (
    (Array.isArray(features) && features.length > 0) ||
    (typeof features === "string" && features !== "") ||
    allFeatures === true ||
    noDefaultFeatures === true
  );
}

/** The cargo commands of a group, and what each of its tasks does after it. */
export interface GroupInvocation extends CargoInvocation {
  /**
   * The group's cargo commands, one per step of its target, in order
   * ({@link cargoSteps}); `args` is the first one's.
   */
  steps: CargoStep[];
  /**
   * Every member of the workspace, as the group's report of the members
   * gives them, where the group selects the whole workspace: the reading of
   * its output tells crates outside the group by them.
   */
  workspaceMembers?: CargoPackage[];
  /**
   * Every member of the workspace, as the group's report of the members
   * gives them, where a task of the `test` group selects affected tests
   * (`DES-TEST-RUN`, step 2).
   */
  affectedMembers?: CargoPackage[];
  /** The selecting runner's command, for a `test` group that selects the whole workspace. */
  runner?: string[];
  /** The task's crate as the command selects it; absent for a workspace project. */
  crate?: CrateSelection;
  /**
   * The crate as the group's report of the members gives it, with its
   * targets and features; absent where the command selects crates by name.
   */
  package?: CargoPackage;
  /**
   * What the task does with the lockfile's digests after the command
   * (`DES-LOCKFILE-HASHING`, "Post-check"), as its preparation decided:
   * every check after cargo comes from here, for a task run on its own and
   * in a batch alike.
   */
  digests?: DigestStep;
  /** On a crate's `build`: the check of the files that cargo recorded (`DES-BUILD-INPUT-CHECK`). */
  inputCheck?: BuildInputCheck;
  /**
   * On `napi-build`: Cargo's directories, where its compile keeps the type
   * information and writes the library (`DES-NAPI`).
   */
  directories?: CargoDirectories;
}

/**
 * Completes the cargo command of a group of prepared tasks, all of one
 * workspace, kind, environment and command options (`TERM-GROUP`): asks
 * cargo once for the package ID specifications of the group's crates,
 * where its command selects them so (`DES-INVOCATION`), and once for
 * Cargo's directories, where a task of the group is a cached `build` or
 * `doc` or checks a build's inputs (`DES-OUTPUTS`, `DES-BUILD-INPUT-CHECK`),
 * both in the workspace root with the group's environment, and checks each
 * cached `build` and `doc` against the artifact directory its outputs name.
 *
 * The commands select the crates as `selection` says ({@link planGroups}):
 * each with `-p`, or the whole workspace with `--workspace`, for which the
 * group keeps every member that the report gives, and for `test` with the
 * three steps and the selecting runner of `DES-TEST-RUN` ({@link cargoSteps}).
 *
 * @returns For each task, in order, the commands of the whole group with
 *   what the task does after it, or the message with which the task fails
 *   before cargo runs: cargo cannot report the specifications or the
 *   directories, the workspace has no member of the crate's name any more,
 *   or cargo reports another artifact directory than the outputs name.
 *   Every task of a group gets the same `args` where none fails.
 */
// @mara implements DES-INVOCATION
// @mara implements DES-OUTPUTS
// @mara implements DES-BATCH
// @mara implements DES-UNIFICATION
export function groupInvocations(
  tasks: readonly PreparedTask[],
  root: string,
  selection: GroupSelection = { kind: "crates" },
): (GroupInvocation | string)[] {
  const [first] = tasks;
  if (first === undefined) {
    return [];
  }
  const { cwd, env, workspaceRoot, target } = first;
  // One report of Cargo's directories for the group, and then one of the
  // members, where its command selects crates by their specifications: the
  // order in which a task run on its own has always asked.
  const directories: CargoDirectories | DirectoryReportError | undefined = tasks.some(
    (task) =>
      task.artifactCheck !== undefined || task.records !== undefined || task.napi !== undefined,
  )
    ? directoryReport(cwd, env)
    : undefined;
  const specs: SpecReport | undefined =
    selectsBySpecification(target) && tasks.some((task) => task.crate !== undefined)
      ? specReport(cwd, env)
      : undefined;
  const finished = tasks.map(
    (
      task,
    ):
      | { crate?: CrateSelection; package?: CargoPackage; directories?: CargoDirectories }
      | string => {
      try {
        const reached =
          directories instanceof DirectoryReportError
            ? directoryFailure(task.task, directories)
            : directories;
        if (task.napi !== undefined && reached === undefined) {
          throw new TaskError(`${task.task}: cargo reported no directories for this napi-build.`);
        }
        if (task.artifactCheck !== undefined && reached !== undefined) {
          checkArtifactDirectory(task.task, task.artifactCheck, cwd, root, env, reached);
        }
        const pkg =
          task.crate === undefined || !selectsBySpecification(task.target)
            ? undefined
            : packageSpec(task.task, task.crate, workspaceRoot, specs);
        const crate: CrateSelection | undefined =
          task.crate === undefined
            ? undefined
            : { name: task.crate, ...(pkg === undefined ? {} : { spec: pkg.id }) };
        return {
          ...(crate === undefined ? {} : { crate }),
          ...(pkg === undefined ? {} : { package: pkg }),
          ...(reached === undefined ? {} : { directories: reached }),
        };
      } catch (error) {
        if (error instanceof TaskError) {
          return error.message;
        }
        throw error;
      }
    },
  );
  // The command selects the crates of the tasks that passed their checks;
  // a task that failed before cargo takes no part in it.
  const crates = finished.flatMap((entry) =>
    typeof entry === "string" || entry.crate === undefined ? [] : [entry.crate],
  );
  const workspace = selection.kind === "workspace";
  // nextest runs no runner of the plugin's (`DES-TEST-RUN`).
  const runner: SelectingRunner | undefined =
    workspace && target === "test" && first.testRunner !== "nextest"
      ? { host: selection.host ?? "", command: runnerCommand() }
      : undefined;
  if (runner !== undefined && runner.host === "") {
    throw new Error("A test group that selects the whole workspace needs the host's triple.");
  }
  const workspaceMembers = workspace && specs instanceof Map ? [...specs.values()] : undefined;
  // A group that selects affected tests places changed files among every
  // member (`DES-TEST-RUN`, step 2).
  const affectedMembers =
    tasks.some((task) => task.testMode?.selects === true) && specs instanceof Map
      ? [...specs.values()]
      : undefined;
  return tasks.map((task, index) => {
    const entry = finished[index];
    if (typeof entry === "string") {
      return entry;
    }
    const steps = cargoSteps(
      {
        target: task.target,
        ...(crates.length === 0 ? {} : { crates }),
        locked: task.locked,
        binaryArguments: task.binaryArguments,
        workspace,
        ...(task.testRunner === undefined ? {} : { testRunner: task.testRunner }),
        workspaceUnification: task.featureUnification === "cargo",
      },
      task.options,
      runner,
    );
    const args = steps[0].args;
    const inputCheck: BuildInputCheck | undefined =
      task.records !== undefined &&
      task.crate !== undefined &&
      task.manifest !== undefined &&
      entry.directories !== undefined
        ? {
            task: task.task,
            crate: task.crate,
            manifest: task.manifest,
            // The compile of `wasm-build` builds the library alone, with
            // `--lib`, and exports no record of a binary (`DES-WASM`).
            records:
              task.target === "wasm-build" ? { ...task.records, binaries: [] } : task.records,
            directories: entry.directories,
            // `wasm-build` passes the wasm triple with `--target` (`DES-WASM`).
            selection:
              task.target === "wasm-build"
                ? { ...task.options, targetTriple: wasmTriple }
                : task.options,
            env,
            cwd,
          }
        : undefined;
    return {
      args,
      steps,
      cwd,
      ...(workspaceMembers === undefined ? {} : { workspaceMembers }),
      ...(affectedMembers === undefined ? {} : { affectedMembers }),
      ...(runner === undefined ? {} : { runner: [...runner.command] }),
      ...(entry.crate === undefined ? {} : { crate: entry.crate }),
      ...(entry.package === undefined ? {} : { package: entry.package }),
      ...(task.digests === undefined ? {} : { digests: task.digests }),
      ...(inputCheck === undefined ? {} : { inputCheck }),
      ...(task.napi !== undefined && entry.directories !== undefined
        ? { directories: entry.directories }
        : {}),
    };
  });
}

/**
 * What cargo reported for a group's members, by package name, each with its
 * package ID specification as `id`, or why it could not report them.
 */
type SpecReport = Map<string, CargoPackage> | PackageSpecReportError;

// The members in the workspace root with the group's environment, as the
// group's command starts (`DES-INVOCATION`), from one report for the group.
function specReport(cwd: string, env: NodeJS.ProcessEnv): SpecReport {
  try {
    return memberPackages(cwd, env);
  } catch (error) {
    if (error instanceof PackageSpecReportError) {
      return error;
    }
    throw error;
  }
}

// Cargo's directories in the workspace root with the group's environment,
// as physical paths, or why cargo could not report them.
function directoryReport(
  cwd: string,
  env: NodeJS.ProcessEnv,
): CargoDirectories | DirectoryReportError {
  try {
    const reported = reportedDirectories(cwd, env);
    return { artifact: physicalPath(reported.artifact), build: physicalPath(reported.build) };
  } catch (error) {
    if (error instanceof DirectoryReportError) {
      return error;
    }
    throw error;
  }
}

/**
 * Whether the key of a task whose target hashes digests holds them, so that
 * the task checks them after cargo's call (`DES-LOCKFILE-HASHING`,
 * "Post-check"): the lockfile task that it depends on, by its id, with the
 * members that its metadata names, from which a key that holds every
 * member's digest takes them, or `undefined`. A run that excludes task dependencies, which the plugin's
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
): { id: string; members?: PackageVersion[] } | undefined {
  if ((env[runIdVariable] ?? "") !== "") {
    return undefined;
  }
  const graphTask = graphTaskOf(context);
  if (graphTask === undefined) {
    return undefined;
  }
  const projects = context.projectsConfigurations?.projects ?? {};
  // An edge is an object with the task's id; older task graphs held the id itself.
  const edges: unknown[] = context.taskGraph?.dependencies?.[graphTask.id] ?? [];
  for (const edge of edges) {
    const id = typeof edge === "string" ? edge : (edge as { id?: string } | null)?.id;
    const dependency = id === undefined ? undefined : context.taskGraph?.tasks?.[id]?.target;
    const project = dependency === undefined ? undefined : projects[dependency.project];
    const target = project?.targets?.[dependency?.target ?? ""];
    const metadata = targetMetadata(target?.metadata?.[targetCargoMetadataKey]);
    if (
      id !== undefined &&
      metadata?.target === "lockfile" &&
      project !== undefined &&
      cargoMetadataOf(project)?.workspaceManifest === workspaceManifest
    ) {
      return { id, ...(metadata.members === undefined ? {} : { members: metadata.members }) };
    }
  }
  const task = `${context.projectName ?? ""}:${context.targetName ?? ""}`;
  const folder = dirname(workspaceManifest);
  throw new TaskError(
    [
      `${task}: this task does not depend on the lockfile task of its Cargo workspace, ${folder === "." ? "at the repository root" : `in ${folder}`}, so its cache key holds no digest of the crate's locked dependencies, and Nx could restore its result after Cargo.lock has changed. The task does not run, so that Nx stores no result for it.`,
      `Make sure that the workspace's folder is an Nx project with the plugin's lockfile target, and that no configuration replaces the dependsOn of ${task}: run \`nx show target ${task} --json\` and look under \`sourceMap\` for the file and entry. A run with --exclude-task-dependencies runs the task without the lockfile task, and Nx never restores what it stores then.`,
    ].join("\n"),
  );
}

/**
 * Fails a cached crate task of a workspace that uses `hakari` before cargo
 * runs where its task graph holds no dependency on the workspace's
 * `hakari-check`, in a run that does not exclude task dependencies
 * (`DES-UNIFICATION`, "Drift"): its key holds the hack crate's manifest in
 * place of the other members', which stands for them only while the drift
 * check passes, so that nothing would have checked the hack crate. The
 * caller runs it only where {@link keyHoldsDigests} found the lockfile task
 * in such a run.
 *
 * @throws {TaskError} Naming the workspace and how to find what replaced the
 *   task's `dependsOn` (`DES-DIAGNOSTICS`).
 */
// @mara implements DES-UNIFICATION
// @mara implements DES-DIAGNOSTICS
function checkHakariDependency(context: ExecutorContext, workspaceManifest: string): void {
  const graphTask = graphTaskOf(context);
  if (graphTask === undefined) {
    return;
  }
  const projects = context.projectsConfigurations?.projects ?? {};
  const edges: unknown[] = context.taskGraph?.dependencies?.[graphTask.id] ?? [];
  for (const edge of edges) {
    const id = typeof edge === "string" ? edge : (edge as { id?: string } | null)?.id;
    const dependency = id === undefined ? undefined : context.taskGraph?.tasks?.[id]?.target;
    const project = dependency === undefined ? undefined : projects[dependency.project];
    const target = project?.targets?.[dependency?.target ?? ""];
    if (
      targetMetadata(target?.metadata?.[targetCargoMetadataKey])?.target === "hakari-check" &&
      project !== undefined &&
      cargoMetadataOf(project)?.workspaceManifest === workspaceManifest
    ) {
      return;
    }
  }
  const task = `${context.projectName ?? ""}:${context.targetName ?? ""}`;
  const folder = dirname(workspaceManifest);
  throw new TaskError(
    [
      `${task}: this task does not depend on the hakari-check task of its Cargo workspace, ${folder === "." ? "at the repository root" : `in ${folder}`}, which uses the feature strategy hakari. Its cache key holds the hack crate's manifest in place of the other members' manifests, which stands for them only while the hack crate is current, so without the check Nx could restore or store a result that depends on what else runs. The task does not run, so that Nx stores no result for it.`,
      `Make sure that no configuration replaces the dependsOn of ${task}: run \`nx show target ${task} --json\` and look under \`sourceMap\` for the file and entry, and keep the plugin's entries with "...". A run with --exclude-task-dependencies runs the task without hakari-check, and Nx never restores what it stores then.`,
    ].join("\n"),
  );
}

/**
 * Fails a crate's `test` before cargo runs where its cargo commands replace
 * the executables that a crate's `build` declares, and the task graph holds
 * a task of that `build` that Nx neither finishes before the `test` starts
 * nor starts only after the `test` has finished ({@link finishesBefore}),
 * as where a `project.json`, a target table or a `targetDefaults` entry
 * replaces the `dependsOn` that the plugin infers for `test` (`DES-TARGETS`,
 * "Guard"). The crates are those whose `build` the plugin makes the `test`
 * wait for, `roots` ({@link testBuilds} in `targets.ts`): under
 * `workspace-build`, every crate of the workspace with a binary and an
 * integration test or bench, the test's own crate among them where it is
 * one, because a `cargo test` of the whole workspace replaces the
 * executables of each (`ADR-WORKSPACE-TEST-EXECUTABLES`). Nx could then run
 * the two at the same time, store the test's executable under the key of
 * `build`, or let the tests run the executable of `build` and store their
 * result (`DES-OUTPUTS`). A run whose graph holds no such `build`, such as
 * `nx test <crate>` with the dependency removed, or one without `build`
 * under `--exclude-task-dependencies`, has nothing to order and passes. A
 * task invoked outside a task graph that holds it is not checked.
 *
 * @param roots The roots of the crates whose `build` the test waits for.
 * @throws {TaskError} Naming the `build` tasks, the reason and the fix.
 */
// @mara implements DES-TARGETS
// @mara implements DES-DIAGNOSTICS
function checkBuildOrder(task: string, context: ExecutorContext, roots: readonly string[]): void {
  const graphTask = graphTaskOf(context);
  const graph = context.taskGraph;
  if (graphTask === undefined || graph === undefined) {
    return;
  }
  const projects = context.projectsConfigurations?.projects ?? {};
  const waited = new Set(roots);
  const unordered = Object.values(graph.tasks ?? {}).filter(({ id, target }) => {
    const project = projects[target.project];
    return (
      project !== undefined &&
      waited.has(project.root) &&
      targetMetadata(project.targets?.[target.target]?.metadata?.[targetCargoMetadataKey])
        ?.target === "build" &&
      !finishesBefore(graph, id, graphTask.id) &&
      !finishesBefore(graph, graphTask.id, id)
    );
  });
  if (unordered.length === 0) {
    return;
  }
  const builds = unordered
    .map(({ id }) => id)
    .sort()
    .join(" and ");
  const ownOnly = unordered.every(({ target }) => target.project === context.projectName);
  const why = ownOnly
    ? `cargo test replaces the executables that ${builds} declares as its outputs, because the crate has a binary and an integration test or a bench that cargo test builds`
    : `the cargo test of this task, which builds the whole workspace under workspace-build, replaces the executables that ${builds} ${unordered.length === 1 ? "declares as its outputs, because that crate has" : "declare as their outputs, because those crates have"} a binary and an integration test or a bench that cargo test builds`;
  throw new TaskError(
    [
      `${task}: ${why}, and this run holds ${builds} without the dependency of ${task} on ${unordered.length === 1 ? "it" : "them"} that @convesoft/nx-rust infers. Nx could run the two at the same time, store this task's executables under the key of ${builds}, or let the tests run the executables of ${builds} and store their result. The task does not run, so that Nx stores no result for it.`,
      `Make sure that no configuration replaces the dependsOn of ${task}: run \`nx show target ${task} --json\` and look under \`sourceMap\` for the file and entry, and keep the plugin's entries with "...", as in "dependsOn": ["...", "^codegen"]. A dependency on a continuous task orders the two only where that task, or a task it depends on, depends on ${builds} itself.`,
    ].join("\n"),
  );
}

/**
 * Whether Nx finishes and stores the task `earlier` before it starts the task
 * `later`, as its task graph decides (`DES-TARGETS`, "Guard"). Nx starts a
 * task once its ordinary dependencies have completed, which comes after
 * their outputs are stored, and once its continuous dependencies have been
 * started, or have reported ready where the edge waits for that; a continuous
 * task is itself started only once its own ordinary dependencies have
 * completed (`EVD-CARGO-ARTIFACT-WRITERS`). So no task of a path of
 * dependencies starts before the task that it depends on has started, and
 * `earlier` has finished before `later` starts where a path leads from
 * `later` to `earlier`, through ordinary and continuous dependencies alike,
 * and its last edge, the one into `earlier`, is an ordinary dependency. A
 * path that reaches `earlier` only as a continuous dependency, which is how
 * Nx records every edge into a continuous task, guarantees no more than that
 * `earlier` has started.
 */
function finishesBefore(
  graph: {
    dependencies?: Record<string, unknown[]>;
    continuousDependencies?: Record<string, unknown[]>;
  },
  earlier: string,
  later: string,
): boolean {
  // An edge is an object with the task's id; older task graphs held the id itself.
  const ids = (edges: unknown[] | undefined): string[] =>
    (edges ?? []).flatMap((edge) => {
      const id = typeof edge === "string" ? edge : (edge as { id?: string } | null)?.id;
      return id === undefined ? [] : [id];
    });
  const seen = new Set<string>();
  const queue = [later];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const ordinary = ids(graph.dependencies?.[id]);
    if (ordinary.includes(earlier)) {
      return true;
    }
    queue.push(...ordinary, ...ids(graph.continuousDependencies?.[id]));
  }
  return false;
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
 * Runs cargo for a task with the task's environment and the variables of the
 * invocation, which no command of this version has, and with the task's
 * standard streams. Signals that stop the executor reach cargo too.
 *
 * @param taskEnv The task's environment without the variables by which Nx
 *   tells it how it runs and records it ({@link cargoTaskEnvironment}).
 *
 * Unlike graph creation (`runCargoForGraph`), a task sets no
 * `RUSTUP_AUTO_INSTALL`, so rustup behaves as for plain cargo.
 *
 * @param shownFor In a verbose run, the task whose command it is: the
 *   command's lines ({@link printCommand}), built from the same invocation,
 *   go to standard error before cargo starts (`DES-INVOCATION`, "Printing the
 *   command"). Undefined in every other run, which prints nothing of it.
 * @returns Whether cargo exited with status 0.
 */
// @mara implements DES-INVOCATION
export async function runCargo(
  invocation: CargoInvocation,
  taskEnv: NodeJS.ProcessEnv,
  shownFor?: string,
): Promise<boolean> {
  if (shownFor !== undefined) {
    // Written out before cargo starts, whose output goes to the same streams.
    await printCommand(shownFor, invocation);
  }
  return new Promise((resolve) => {
    const child = spawn("cargo", invocation.args, {
      cwd: invocation.cwd,
      env: cargoEnvironment(invocation, taskEnv),
      stdio: "inherit",
    });
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

// Fails a cached `build` or `doc` whose `targetTriple` option is a value
// for which cargo writes to another folder than the outputs name, which
// interpolate the option as the triple's folder (`DES-OUTPUTS`):
// `host-tuple`, for which cargo uses the host's triple, and a target
// specification file. The option arrives with the task, when Nx has decided
// to cache it already.
// @mara implements DES-OUTPUTS
// @mara implements DES-DIAGNOSTICS
function checkOptionTriple(
  task: string,
  target: InferredTargetName,
  triple: string,
  context: ExecutorContext,
  env: NodeJS.ProcessEnv,
): void {
  const reason = optionTripleReason(triple);
  if (reason === undefined) {
    return;
  }
  const cause = `${task}: the targetTriple option of this run of the cached ${target} is ${JSON.stringify(triple)}, and @convesoft/nx-rust cannot name the folder that cargo writes to for this value: ${reason}. The task does not run, so that Nx stores no result for it.`;
  if (triple === "host-tuple") {
    const project = context.projectsConfigurations?.projects?.[context.projectName ?? ""];
    const workspaceManifest =
      project === undefined ? undefined : cargoMetadataOf(project)?.workspaceManifest;
    const host = hostTriple(
      join(context.root, workspaceManifest === undefined ? "." : dirname(workspaceManifest)),
      env,
    );
    throw new TaskError(
      host === undefined
        ? `${cause} Pass the host's triple itself in place of host-tuple, the value that \`rustc -vV\` prints after "host:".`
        : `${cause} Pass the host's triple itself in place of host-tuple: --targetTriple=${host}.`,
    );
  }
  const table =
    target === "doc"
      ? "[workspace.metadata.nx.project.targets.doc] of the workspace's Cargo.toml"
      : "[package.metadata.nx.targets.build] of the crate's Cargo.toml";
  throw new TaskError(
    `${cause} Build with a built-in triple, or run the target uncached: set cache = false in ${table}, or in the target's configuration in a project.json.`,
  );
}

// The package ID specification with which the task's command selects its
// crate: the one that cargo reports for the member of that name when it
// starts in the workspace root with the task's environment, as the command
// does (`DES-INVOCATION`). It holds the absolute path of the crate's folder
// and goes into the command only, into no input, output or option. A group
// asks cargo once for all its crates ({@link specReport}).
// @mara implements DES-INVOCATION
// @mara implements DES-DIAGNOSTICS
function packageSpec(
  task: string,
  packageName: string,
  workspaceRoot: string,
  specs: SpecReport | undefined,
): CargoPackage {
  if (!(specs instanceof Map)) {
    const failure: PackageSpecReportError =
      specs ?? new PackageSpecReportError("no report was asked for", "");
    const stderr = failure.stderr.trim();
    throw new TaskError(
      [
        `${task}: \`cargo metadata\` could not list the members of the Cargo workspace for this task, so @convesoft/nx-rust cannot name the crate ${packageName} to cargo: ${failure.message}.`,
        ...(stderr === "" ? [] : [stderr]),
        "The task does not run, so that Nx stores no result for it. Correct what cargo reports, such as a manifest or a configuration file that it cannot read, and run the task again.",
      ].join("\n"),
    );
  }
  const spec = specs.get(packageName);
  if (spec === undefined) {
    throw new TaskError(
      [
        `${task}: the Cargo workspace in ${describeFolder(workspaceRoot)} has no member named ${packageName} any more, while the project graph still has the crate, so the graph is out of date. The task does not run, so that Nx stores no result for it.`,
        "Run `nx reset`, or stop the daemon with `nx daemon --stop`, and run the task again.",
      ].join("\n"),
    );
  }
  return spec;
}

// Cargo's directories for a task, which cargo reports with the task's
// environment in the folder where it will run, as physical paths: the
// artifact directory that it writes to, and the build directory, whose
// files the check of `DES-BUILD-INPUT-CHECK` leaves out.
// @mara implements DES-BUILD-INPUT-CHECK
function taskDirectories(task: string, cwd: string, env: NodeJS.ProcessEnv): CargoDirectories {
  const report = directoryReport(cwd, env);
  return report instanceof DirectoryReportError ? directoryFailure(task, report) : report;
}

// Fails a task whose cargo could not report Cargo's directories.
function directoryFailure(task: string, error: DirectoryReportError): never {
  const stderr = error.stderr.trim();
  throw new TaskError(
    [
      `${task}: \`cargo metadata\` could not report Cargo's directories for this task, so @convesoft/nx-rust cannot tell where cargo puts its files: ${error.message}.`,
      ...(stderr === "" ? [] : [stderr]),
      "The task does not run, so that Nx stores no result for it. Correct what cargo reports, such as a manifest or a configuration file that it cannot read, and run the task again.",
    ].join("\n"),
  );
}

// Fails a cached `build` or `doc` for which cargo reports, with the task's
// environment, another artifact directory than the one whose folders its
// outputs name, which graph creation recorded: cargo would write elsewhere,
// and Nx would store what lies at the declared paths, an older artifact or
// nothing, under the task's key (`DES-OUTPUTS`). Where the variables that
// move the directory, `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR` and
// `CARGO_HOME`, have the values that graph creation saw, or those values
// give another directory as well, Cargo's configuration has changed since
// graph creation, as a file that Nx does not watch can under the Nx daemon;
// otherwise the task's environment moves it, as a dotenv file of the task
// does. A group asks cargo once for its directories ({@link directoryReport}).
// @mara implements DES-OUTPUTS
// @mara implements DES-DIAGNOSTICS
function checkArtifactDirectory(
  task: string,
  metadata: TargetCargoMetadata,
  cwd: string,
  root: string,
  env: NodeJS.ProcessEnv,
  directories: CargoDirectories,
): void {
  const named = metadata.artifactDirectory as string;
  const now = repositoryFolder(directories.artifact, root);
  if (now.inside && now.path === named) {
    return;
  }
  const end = "The task does not run, so that Nx stores no result for it.";
  const graphVariables = metadata.directoryVariables ?? {};
  const taskVariables = directoryVariables(env);
  const moved = directoryVariableNames.filter(
    (name) => taskVariables[name] !== graphVariables[name],
  );
  const graphEnv: NodeJS.ProcessEnv = { ...env };
  for (const name of directoryVariableNames) {
    if (graphVariables[name] === undefined) {
      delete graphEnv[name];
    } else {
      graphEnv[name] = graphVariables[name];
    }
  }
  const byVariables =
    moved.length === 0
      ? undefined
      : repositoryFolder(taskDirectories(task, cwd, graphEnv).artifact, root);
  if (byVariables === undefined || !byVariables.inside || byVariables.path !== named) {
    throw new TaskError(
      [
        `${task}: Cargo's configuration has changed since Nx created the project graph: cargo now puts the artifacts of this run in ${now.path}${now.inside ? "" : ", outside the repository"}, while the outputs of the cached ${metadata.target} name the artifact directory ${named}.`,
        `Nx does not watch a configuration file outside the repository, such as the Cargo home's, so the graph that the Nx daemon keeps is out of date. ${end} Run \`nx reset\`, or stop the daemon with \`nx daemon --stop\`, and run the task again.`,
      ].join("\n"),
    );
  }
  const shown = (value: string | undefined) =>
    value === undefined ? "unset" : JSON.stringify(value);
  const variables = moved
    .map(
      (name) =>
        `${name} is ${shown(taskVariables[name])} in the task's environment and was ${shown(graphVariables[name])} when Nx created the graph`,
    )
    .join(", and ");
  throw new TaskError(
    [
      `${task}: cargo puts the artifacts of this run of the cached ${metadata.target} in ${now.path}${now.inside ? "" : ", outside the repository"}, but its outputs name the artifact directory ${named}: ${variables}.`,
      `A variable that only a dotenv file of the task sets, such as a .env file in the crate's or the workspace's folder or a root .env.build, .env.doc or .env.<configuration>, is unknown when Nx creates the graph. ${end} Set the variable in the environment of the nx command or in the repository's root .env file, or set the folder as build.target-dir in a .cargo/config.toml of the workspace instead.`,
    ].join("\n"),
  );
}

// The warnings that graph creation recorded for the task's project, whose
// digest the task's key holds, then those that `createDependencies` found
// for the task's target, each once (`DES-DIAGNOSTICS`, "Warnings where they
// are seen"), and those about its workspace's Cargo configuration that Nx
// does not hash, which no key holds, so that a cache hit replays them as the
// run that stored the result printed them.
// @mara implements DES-DIAGNOSTICS
export function projectWarnings(context: ExecutorContext): string[] {
  const project = context.projectsConfigurations?.projects?.[context.projectName ?? ""];
  const cargo = project === undefined ? undefined : cargoMetadataOf(project);
  const warnings: unknown[] = [
    ...(Array.isArray(cargo?.warnings) ? cargo.warnings : []),
    ...(Array.isArray(cargo?.configurationWarnings) ? cargo.configurationWarnings : []),
  ];
  const targetWarnings: unknown[] = Array.isArray(cargo?.targetWarnings)
    ? cargo.targetWarnings
    : [];
  return [
    ...new Set([
      ...warnings.filter((warning): warning is string => typeof warning === "string"),
      ...targetWarnings.flatMap((entry) => {
        const { target, warning } = (entry ?? {}) as { target?: unknown; warning?: unknown };
        return target === context.targetName && typeof warning === "string" ? [warning] : [];
      }),
    ]),
  ];
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
    artifactDirectory,
    directoryVariables: variables,
    members,
    digests,
    everyDigest,
    records,
    waitsForBuild,
    waitsForBuilds,
    napiAddon,
    napiHost,
    napiHeaderFile,
    sharedLibrary,
    testRunner,
    affectedTests,
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
        ...(typeof artifactDirectory === "string" ? { artifactDirectory } : {}),
        ...(typeof variables === "object" &&
        variables !== null &&
        Object.values(variables).every((entry) => typeof entry === "string")
          ? { directoryVariables: variables as Record<string, string> }
          : {}),
        ...(isPackageList(members) ? { members } : {}),
        ...(isPackageList(digests) ? { digests } : {}),
        ...(everyDigest === true ? { everyDigest } : {}),
        ...(isRecordSource(records) ? { records } : {}),
        ...(waitsForBuild === true ? { waitsForBuild } : {}),
        ...(Array.isArray(waitsForBuilds) &&
        waitsForBuilds.every((root) => typeof root === "string")
          ? { waitsForBuilds: waitsForBuilds as string[] }
          : {}),
        ...(typeof napiAddon === "string" ? { napiAddon } : {}),
        ...(typeof napiHost === "string" ? { napiHost } : {}),
        ...(typeof napiHeaderFile === "string" ? { napiHeaderFile } : {}),
        ...(typeof sharedLibrary === "string" ? { sharedLibrary } : {}),
        ...(testRunner === "nextest" ? { testRunner } : {}),
        ...(affectedTests === true ? { affectedTests } : {}),
      }
    : undefined;
}

// Whether a value has the shape of the record source that graph creation
// gives a crate's `build` (`buildRecordSource` in `build-records.ts`).
function isRecordSource(value: unknown): value is BuildRecordSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { library, binaries, features, optionalDependencies, shared } = value as Partial<
    Record<keyof BuildRecordSource, unknown>
  >;
  const isStrings = (list: unknown): list is string[] =>
    Array.isArray(list) && list.every((item) => typeof item === "string");
  return (
    (library === undefined ||
      (typeof library === "object" &&
        library !== null &&
        typeof (library as { name?: unknown }).name === "string" &&
        typeof (library as { procMacro?: unknown }).procMacro === "boolean" &&
        ((library as { crateTypes?: unknown }).crateTypes === undefined ||
          isStrings((library as { crateTypes?: unknown }).crateTypes)))) &&
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
