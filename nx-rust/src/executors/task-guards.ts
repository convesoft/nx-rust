import type { ExecutorContext, Task } from "@nx/devkit";
import { dirname, join } from "node:path";
import { hostTriple } from "../cargo/host-triple";
import type { PackageVersion } from "../cargo/lockfile";
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
import { cargoMetadataOf } from "../graph/collisions";
import { runIdVariable } from "../graph/lockfile-task";
import {
  type InferredTargetName,
  inferredTargetNames,
  type TargetCargoMetadata,
  targetCargoMetadataKey,
} from "../graph/targets";
import type { CargoTargetOptions } from "./command";
import type { DigestCheck, DigestWrite } from "./digests";
import { readyUrlProducers, type TaskShape } from "./task-env";
import type { ExecutorOptions } from "./task-options";

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

/** What a task does with digests after its cargo call (`TaskInvocation.digests`). */
export type DigestStep = ({ kind: "write" } & DigestWrite) | ({ kind: "check" } & DigestCheck);

/**
 * What `cargoTaskEnvironment` needs to know of a task run on its own:
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
export function keyHoldsDigests(
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
export function checkHakariDependency(context: ExecutorContext, workspaceManifest: string): void {
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
 * wait for, `roots` (`testBuilds` in `targets.ts`): under
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
export function checkBuildOrder(
  task: string,
  context: ExecutorContext,
  roots: readonly string[],
): void {
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
export function configuredOptions(context: ExecutorContext): Record<string, unknown> {
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

// Whether a task's options name a triple, which `--target` then gives cargo
// in place of what the configuration and the environment pick.
export function namesTriple(options: CargoTargetOptions): boolean {
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
export function checkPickedTriples(
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
export function checkOptionTriple(
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
export function targetMetadata(value: unknown): TargetCargoMetadata | undefined {
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
