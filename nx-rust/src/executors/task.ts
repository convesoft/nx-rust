import type { ExecutorContext } from "@nx/devkit";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { BuildRecordSource } from "../graph/build-records";
import { cargoMetadataOf } from "../graph/collisions";
import { commandDigestFolder, commandIdVariable, digestFolder } from "../graph/lockfile-task";
import { uncachedByDesign } from "../graph/outputs";
import type { TestRunner } from "../graph/settings";
import {
  cachedTargets,
  type InferredTargetName,
  type TargetCargoMetadata,
  targetCargoMetadataKey,
} from "../graph/targets";
import {
  describeFolder,
  MissingToolError,
  type OptionalToolId,
  requireTool,
} from "../tools/optional-tools";
import { taskRunsVerbosely } from "./cargo-invocation";
import { type CargoTargetOptions, pluginVersionOption } from "./command";
import { heldMembers } from "./digests";
import { dotenvProblem } from "./dotenv-check";
import { type GroupInvocation, groupInvocations } from "./group-invocations";
import { hasLibrary } from "./group-run";
import { type PlannedGroup, planGroups } from "./groups";
import { type NapiTask, NapiTaskError, prepareNapiTask } from "./napi-build";
import { recordedNxCommand } from "./nx-command";
import { resetNxWorkspaceContext } from "./nx-task-files";
import { failedInputWarnings } from "./runtime-input-check";
import { sharedArtifact, sharedArtifactMessage } from "./shared-artifacts";
import { sharedBuildFolders } from "./stage";
import { runTargetGroup } from "./staged-run";
import { cargoTaskEnvironment, TaskEnvironmentError, withoutUnloadedRootValues } from "./task-env";
import { checksAfterCargo, hakariCheckFailure, runCargo } from "./task-execution";
import {
  checkBuildOrder,
  checkHakariDependency,
  checkOptionTriple,
  checkPickedTriples,
  configuredOptions,
  type DigestStep,
  graphTaskOf,
  keyHoldsDigests,
  lockedMode,
  namesTriple,
  type PluginExecutor,
  projectWarnings,
  singleTaskShape,
  targetMetadata,
  TaskError,
} from "./task-guards";
import { OptionError, type TaskOptions, taskOptions } from "./task-options";
import {
  invalidTestModeMessage,
  type TestMode,
  testMode,
  testModeNote,
  testModeText,
} from "./test-mode";
import { prepareWasmTask, type WasmTask, WasmTaskError } from "./wasm-build";

export {
  checksAfterCargo,
  type GroupInvocation,
  groupInvocations,
  type PluginExecutor,
  projectWarnings,
  TaskError,
};

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
    // Two builds of one crate into one folder in one command, which no stage
    // keeps apart, fail before cargo runs, as in a batch (`DES-BATCH`, "Files
    // that a batch stores").
    const graphTask = prepared.target === "build" ? graphTaskOf(context) : undefined;
    const refused =
      graphTask === undefined
        ? undefined
        : sharedBuildFolders([graphTask.id], context).get(graphTask.id);
    if (refused !== undefined) {
      throw new TaskError(refused);
    }
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
    // A whole-workspace `build` and the compile of `napi-build` and
    // `wasm-build` build in a stage of their own, as in a batch (`DES-BATCH`,
    // "Staged builds").
    const [result] = await runTargetGroup(
      [{ prepared, invocation, context }],
      planned.selection,
      verbose,
    );
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
  // As after a group's cargo calls (runGroup): the check lists the files as
  // cargo left them, whatever in this process read Nx's workspace context
  // before (`DES-BUILD-INPUT-CHECK`, point 5). Nothing does in Nx 24.0.6,
  // which leaves the reset nothing to clear.
  if (invocation.inputCheck !== undefined) {
    resetNxWorkspaceContext(context.root);
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
  /** What the task does with the lockfile's digests after cargo (`TaskInvocation.digests`). */
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
      workspaceRoot: context.root,
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
    // Last, once every check that fails the task has passed.
    warnings: [
      ...examined.warnings,
      ...failedInputWarnings(task, context.target?.inputs, context.root, env),
    ],
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
