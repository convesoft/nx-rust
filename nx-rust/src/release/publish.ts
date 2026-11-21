import type { ExecutorContext, Task } from "@nx/devkit";
import { dirname, join } from "node:path";
import type { CargoInvocation } from "../executors/cargo-invocation";
import { declaredOptionsOf } from "../executors/declared-options";
import { recordedNxCommand } from "../executors/nx-command";
import { projectWarnings } from "../executors/task-guards";
import { type ExecutorOptions, ignoredOptionLine } from "../executors/task-options";
import { cargoMetadataOf } from "../graph/collisions";
import { realPath } from "../graph/real-path";
import {
  releasePublishExecutor,
  releasePublishTarget,
  targetCargoMetadataKey,
} from "../graph/targets";
import {
  crateKey,
  publishArguments,
  refusedStaleLockfile,
  refusedUncommittedChanges,
  type Registry,
  registryKey,
  registryLabel,
  runCapturedCargo,
  uploadedCrates,
  verifiedCrates,
} from "./publish-cargo";
import {
  type Crate,
  crateLinks,
  crateOf,
  type CrateStore,
  createCrateStore,
  dependencyFolders,
  type DependencyLink,
  folderLabel,
  LinkError,
  type Other,
  type Prepared,
  relativePath,
  reportOf,
  type Runner,
} from "./publish-crates";
import {
  configuredOptions,
  contextOf,
  createDotenvStore,
  type DotenvStore,
  environmentKey,
  otherRunTasks,
  ownRunner,
  withProjectRoot,
} from "./publish-environments";
import {
  indented,
  labelOf,
  lookupFailure,
  notVerifiedMessage,
  npmOptionLine,
  npmOptions,
  publishedElsewhere,
  publishFirstMessage,
  registryOptionMessage,
  unpublishedMessage,
} from "./publish-messages";
import {
  createRegistryStore,
  lookupVersion,
  type RegistryStore,
  targetOf,
} from "./publish-registry";

export { type Crate, type DependencyLink, registryOptionMessage, unpublishedMessage };

/** One task that the publish executor receives, alone or in a batch. */
export interface PublishInput {
  /** The task's id in the task graph. */
  id: string;
  /** The task, as the task graph holds it. */
  task: Task;
  /** The task's options, as Nx combines them for the task. */
  options: Record<string, unknown>;
  /**
   * The task's environment, as the plugin runs cargo with it
   * (`DES-BATCH`), or why it cannot be built, which fails the task.
   */
  env: NodeJS.ProcessEnv | { failure: string };
}

/** The result that the executor reports for one task, as Nx 24 takes it from a batch. */
export interface PublishResult {
  success: boolean;
  status: "success" | "failure";
  /** The task's own output, which Nx prints with it. */
  terminalOutput: string;
  startTime: number;
  endTime: number;
}

/** A result with the task it belongs to, as a batch implementation yields it. */
export interface PublishReport {
  task: string;
  result: PublishResult;
}

/** What the executor needs from the run besides the tasks. */
export interface PublishRun {
  /** The batch's or the task's executor context, whose task graph holds the tasks. */
  context: ExecutorContext;
  /**
   * Called before each cargo command, so that a verbose run prints it
   * (`DES-INVOCATION`, "Printing the command"); absent otherwise.
   */
  announce?: (tasks: string, invocation: CargoInvocation) => Promise<void>;
}

/**
 * The variables that Nx gives each task of its own, and which a cargo call
 * for several tasks therefore cannot carry: a call runs with the environment
 * of its tasks without them, and tasks whose environments differ otherwise
 * share no call.
 */
const perTaskVariables = [
  "NX_TASK_TARGET_PROJECT",
  "NX_TASK_TARGET_TARGET",
  "NX_TASK_TARGET_CONFIGURATION",
  "LERNA_PACKAGE_NAME",
];

/** A crate of the run whose registry the executor cannot establish, with the message that says why. */
interface Disagreement {
  task: Prepared;
  message: string;
}

/** How a task ended, before it is reported. */
type Outcome =
  | { kind: "failed"; lines: string[] }
  | { kind: "succeeded"; lines: string[] }
  /** Left out of cargo in a dry run, because another call would publish a dependency (`DES-RELEASE`, "Dry run"). */
  | { kind: "not-verified"; lines: string[] };

/**
 * Publishes the crates of `inputs` (`DES-RELEASE`): for each task, the
 * checks of the options and the crate's target registry; then one
 * `cargo publish --locked` per Cargo workspace, target registry, environment
 * and dry run, each after the calls whose crates its crates depend on, each
 * preceded by the checks before each call (**Existing versions**,
 * _Dependencies published elsewhere_ and _Dependencies published first_);
 * and one result per task from cargo's output.
 *
 * It yields a result for every task it receives, also for one that it does
 * not hand to cargo, and throws for none (`EVD-NX-24-BATCHES`): a failure of
 * its own machinery fails every task that has no result yet.
 */
// @mara implements DES-RELEASE
// @mara implements REQ-RELEASE
export async function* publishTasks(
  inputs: readonly PublishInput[],
  run: PublishRun,
): AsyncGenerator<PublishReport> {
  const reported = new Set<string>();
  const report = (
    id: string,
    start: number,
    success: boolean,
    lines: readonly string[],
  ): PublishReport => {
    reported.add(id);
    const output = lines.join("\n");
    return {
      task: id,
      result: {
        success,
        status: success ? "success" : "failure",
        terminalOutput: output === "" || output.endsWith("\n") ? output : `${output}\n`,
        startTime: start,
        endTime: Date.now(),
      },
    };
  };
  try {
    const publisher = new Publisher(run);
    const prepared: Prepared[] = [];
    for (const input of inputs) {
      const start = Date.now();
      const outcome = publisher.prepare(input, start);
      if ("failed" in outcome) {
        yield report(input.id, start, false, outcome.failed);
      } else {
        prepared.push(outcome);
      }
    }
    for await (const [task, success, lines] of publisher.publish(prepared)) {
      yield report(task.id, task.start, success, [...task.head, ...lines]);
    }
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    for (const input of inputs.filter(({ id }) => !reported.has(id))) {
      yield report(input.id, Date.now(), false, [
        `${labelOf(input.task)}: @convesoft/nx-rust could not publish this crate, and nothing was uploaded for it. This is a defect of the plugin; please report it with this output.`,
        message,
      ]);
    }
  }
}

/** What one run of the executor knows: the repository's crates, the reports and the registries it found. */
class Publisher {
  private readonly root: string;
  private readonly executor: ExecutorOptions;
  private readonly crates: CrateStore;
  private readonly dotenv: DotenvStore;
  private readonly registry: RegistryStore;
  /** The prepared tasks that the executor received, by the real path of their crate's folder. */
  private byFolder = new Map<string, Prepared>();
  /** The other tasks of the run, by the real path of their crate's folder (`otherRunTasks`). */
  private othersByFolder = new Map<string, Other>();

  constructor(private readonly run: PublishRun) {
    this.root = run.context.root;
    this.executor = {
      name: releasePublishExecutor,
      shortName: "release-publish",
      declared: declaredOptionsOf(releasePublishExecutor),
    };
    this.crates = createCrateStore(run.context);
    this.dotenv = createDotenvStore(run.context);
    this.registry = createRegistryStore(run.context.root, run.announce);
  }

  /**
   * The checks of one task that need no registry: its target, its options
   * and its crate (`DES-RELEASE`, "Options"). A task whose options hold
   * `registry` fails here, before cargo runs, whatever the value.
   */
  prepare(input: PublishInput, start: number): Prepared | { failed: string[] } {
    const { task } = input;
    const label = labelOf(task);
    const project = this.run.context.projectsConfigurations?.projects?.[task.target.project];
    const taskContext = contextOf(task, this.run.context);
    const head = project === undefined ? [] : projectWarnings(taskContext);
    const fail = (...lines: string[]) => ({ failed: [...head, ...lines] });
    const metadata = taskContext.target?.metadata?.[targetCargoMetadataKey] as
      | { target?: unknown }
      | undefined;
    const cargo = project === undefined ? undefined : cargoMetadataOf(project);
    if (metadata?.target !== releasePublishTarget || cargo?.packageName === undefined) {
      return fail(
        `${label}: ${releasePublishExecutor} runs only the target ${releasePublishTarget} that @convesoft/nx-rust infers for a crate, and ${label} is not one of them. Nothing was published. Remove the target, or let the plugin infer it.`,
      );
    }
    if ("failure" in input.env) {
      return fail(input.env.failure);
    }
    const options = input.options;
    if (Object.prototype.hasOwnProperty.call(options, "registry")) {
      return fail(registryOptionMessage(label, options.registry, task));
    }
    const lines: string[] = [];
    for (const [name, value] of Object.entries(options)) {
      if (name.startsWith("__") || this.executor.declared.has(name)) {
        continue;
      }
      lines.push(
        name in npmOptions
          ? npmOptionLine(label, name, value, task)
          : ignoredOptionLine(
              {
                task: label,
                target: releasePublishTarget,
                executor: this.executor,
                options,
                configured: configuredOptions(taskContext),
                graphTask: task,
                record: recordedNxCommand(input.env),
              },
              name,
              value,
              "unknown",
            ),
      );
    }
    const env = { ...input.env };
    for (const name of perTaskVariables) {
      delete env[name];
    }
    const envKey = environmentKey(env);
    const manifest = join(this.root, cargo.manifest);
    const workspaceRoot = realPath(join(this.root, dirname(cargo.workspaceManifest)));
    const report = reportOf(this.crates, workspaceRoot, env, envKey);
    if ("failure" in report) {
      return fail(...lines, `${label}: ${report.failure}`);
    }
    const pkg = report.packages.find(
      (candidate) => realPath(dirname(candidate.manifest_path)) === realPath(dirname(manifest)),
    );
    if (pkg === undefined) {
      return fail(
        ...lines,
        `${label}: the report of the Cargo workspace in ${folderLabel(this.root, workspaceRoot)} has no crate with the manifest ${cargo.manifest}, so nothing was published. Run the command again; if the crate moved, Nx's project graph is out of date.`,
      );
    }
    const crate = crateOf(this.crates, pkg, workspaceRoot, report);
    return {
      id: input.id,
      label,
      task: withProjectRoot(task, project?.root),
      crate,
      env,
      envKey,
      dryRun: options.dryRun === true || env.NX_DRY_RUN === "true",
      head: [...head, ...lines],
      start,
    };
  }

  /**
   * Publishes the prepared tasks, call by call, and yields each task's end
   * as soon as it is known: the task, whether it succeeded, and its lines
   * after its head.
   */
  async *publish(tasks: readonly Prepared[]): AsyncGenerator<[Prepared, boolean, string[]]> {
    const outcomes = new Map<Prepared, Outcome>();
    const byFolder = new Map(tasks.map((task) => [task.crate.folder, task]));
    this.byFolder = byFolder;
    // The target registry of each task's crate.
    const calls = new Map<string, { registry: Registry; tasks: Prepared[] }>();
    const targeted: Prepared[] = [];
    for (const task of tasks) {
      const target = await targetOf(this.registry, this.dotenv, task.crate, task);
      if (target.kind === "unknown") {
        outcomes.set(task, { kind: "failed", lines: [`${task.label}: ${target.reason}`] });
        yield [task, false, [`${task.label}: ${target.reason}`]];
        continue;
      }
      targeted.push(task);
      const key = [
        task.crate.workspaceRoot,
        task.envKey,
        registryKey(target.registry),
        String(task.dryRun),
      ].join("\u0000");
      const call = calls.get(key) ?? { registry: target.registry, tasks: [] };
      call.tasks.push(task);
      calls.set(key, call);
    }
    // Checks before the first call: where the registry of any dependency of
    // a crate of the run cannot be established, nothing is uploaded.
    const disagreements = await this.disagreements(
      targeted,
      otherRunTasks(this.dotenv, this.crates, tasks, this.othersByFolder),
    );
    if (disagreements.length > 0) {
      for (const task of targeted) {
        const own = disagreements.filter((disagreement) => disagreement.task === task);
        const lines =
          own.length > 0
            ? [
                ...own.map((disagreement) => disagreement.message),
                "  Because an upload cannot be undone, @convesoft/nx-rust uploads nothing of this run until this is corrected.",
              ]
            : [
                `${task.label}: @convesoft/nx-rust uploads nothing of this run, because the registry of a dependency of a crate that the run publishes cannot be established as the registry that the dependency goes to, and an upload cannot be undone. Nothing was uploaded for ${task.crate.name}. Correct what follows and run nx release publish again:`,
                ...disagreements.map((disagreement) => indented(disagreement.message)),
              ];
        outcomes.set(task, { kind: "failed", lines });
        yield [task, false, lines];
      }
      return;
    }
    for (const call of orderCalls([...calls.values()], (task) => dependencyFolders(task.crate))) {
      for await (const end of this.publishCall(call.registry, call.tasks, outcomes, byFolder)) {
        yield end;
      }
    }
  }

  /**
   * The checks before the first call (`DES-RELEASE`): for each crate of the
   * run, those that the executor received with a target registry and the
   * others of the task graph, the registry of each normal or build
   * dependency with a version requirement on a crate of the repository,
   * other than one that fails _Unpublished dependencies_, has to be
   * established as the registry that the dependency goes to, in the
   * dependency's own environment. A crate whose version its target registry
   * has already is left out of the check, as it is left out of cargo.
   *
   * @returns Each crate whose check fails, with the message that says why.
   */
  private async disagreements(
    targeted: readonly Prepared[],
    others: readonly Other[],
  ): Promise<Disagreement[]> {
    const found: Disagreement[] = [];
    for (const task of [...targeted, ...others]) {
      let links: DependencyLink[];
      try {
        links = await crateLinks(this.crates, task);
      } catch (error) {
        if (!(error instanceof LinkError)) {
          throw error;
        }
        // Reported by the checks before the crate's call.
        continue;
      }
      const message = await this.disagreement(task, links);
      if (message !== undefined && (await this.reachesCargo(task))) {
        found.push({ task, message });
      }
    }
    return found;
  }

  /** The message of {@link disagreements} for one crate, or `undefined` where its dependencies' registries are established. */
  private async disagreement(
    task: Prepared,
    links: readonly DependencyLink[],
  ): Promise<string | undefined> {
    const foreign = (task as Other).foreign;
    if (foreign !== undefined && links.length > 0) {
      return `${task.label}: ${task.crate.name} depends on ${links.map((link) => link.dependency.name).join(", ")}, and Nx runs ${task.label} on its own, so @convesoft/nx-rust cannot rebuild its environment, while ${foreign}. So it cannot establish where the dependencies of ${task.crate.name} go, and nothing was uploaded. Run nx release publish with batches, as it runs by default, or give the crates of one release the same Cargo settings, such as in the environment of the command or in .cargo/config.toml.`;
    }
    for (const link of links) {
      if (
        unpublishedMessage(task, link, relativePath(this.root, link.dependency.manifest)) !==
        undefined
      ) {
        // Failed by the check _Unpublished dependencies_ before the crate's call.
        continue;
      }
      const established = await this.dependencyTarget(task, link.dependency);
      if ("failure" in established) {
        return established.failure;
      }
      const elsewhere = publishedElsewhere(task, link, established, established.own);
      if (elsewhere !== undefined) {
        return elsewhere;
      }
    }
    return undefined;
  }

  /**
   * Whether the lookup of `task`'s crate in its target registry leaves it
   * for cargo (**Existing versions**): not where the registry has its version
   * already, which leaves it out, or where the lookup fails, which fails it
   * before its call, as the checks before each call report. A foreign task
   * of `otherRunTasks`, whose environment is not established, counts as
   * reaching cargo.
   */
  private async reachesCargo(task: Prepared): Promise<boolean> {
    if ((task as Other).foreign !== undefined) {
      return true;
    }
    const target = await targetOf(this.registry, this.dotenv, task.crate, task);
    return (
      target.kind === "registry" &&
      (await lookupVersion(this.registry, task.crate, target.registry, task)).kind === "missing"
    );
  }

  /**
   * The target registry of `dependency`, a dependency of `task`'s crate, in
   * the dependency's own environment ({@link ownRunner}), with that
   * environment, or the message of `task` that says why it cannot be told.
   */
  private async dependencyTarget(
    task: Prepared,
    dependency: Crate,
  ): Promise<{ target: Registry; source: string; own: Runner } | { failure: string }> {
    const own = ownRunner(this.dotenv, this.byFolder, this.othersByFolder, dependency, task);
    if ("failure" in own) {
      return { failure: own.failure };
    }
    const target = await targetOf(this.registry, this.dotenv, dependency, own);
    if (target.kind === "unknown") {
      return {
        failure: `${task.label}: ${task.crate.name} depends on ${dependency.name}, whose target registry @convesoft/nx-rust cannot tell, so it publishes neither: ${target.reason}`,
      };
    }
    return { target: target.registry, source: target.source, own };
  }

  /** The checks before one call, the call, and the result of each of its tasks. */
  private async *publishCall(
    registry: Registry,
    tasks: readonly Prepared[],
    outcomes: Map<Prepared, Outcome>,
    byFolder: ReadonlyMap<string, Prepared>,
  ): AsyncGenerator<[Prepared, boolean, string[]]> {
    const [first] = tasks;
    const { env, dryRun } = first;
    const cwd = first.crate.workspaceRoot;
    const inCall = new Map(tasks.map((task) => [task.crate.folder, task]));
    const settle = (task: Prepared, outcome: Outcome) => {
      outcomes.set(task, outcome);
      inCall.delete(task.crate.folder);
    };
    for (const task of tasks) {
      const outcome = await this.checkTask(task, registry, inCall, outcomes, byFolder);
      if (outcome !== undefined) {
        settle(task, outcome);
      }
    }
    // A crate of the call that depends on a crate left out of it, other than
    // one whose version the registry has, is left out as well.
    for (let changed = true; changed;) {
      changed = false;
      // A Map visits each entry once, also while entries are deleted.
      for (const task of inCall.values()) {
        for (const link of await crateLinks(this.crates, task)) {
          const left = tasks.find(
            (other) =>
              other.crate.folder === link.dependency.folder && !inCall.has(other.crate.folder),
          );
          const outcome = left === undefined ? undefined : outcomes.get(left);
          if (left === undefined || outcome === undefined || outcome.kind === "succeeded") {
            continue;
          }
          settle(
            task,
            outcome.kind === "not-verified"
              ? { kind: "not-verified", lines: [notVerifiedMessage(task, left.crate, left.label)] }
              : {
                  kind: "failed",
                  lines: [
                    `${task.label}: ${task.crate.name} depends on ${left.crate.name}, which is left out of this cargo call because ${left.label} failed, so ${task.crate.name} is left out as well and nothing was uploaded for it. Correct what the output of ${left.label} reports and run nx release publish again.`,
                  ],
                },
          );
          changed = true;
          break;
        }
      }
    }
    for (const task of tasks) {
      const outcome = outcomes.get(task);
      if (outcome !== undefined) {
        yield [task, outcome.kind !== "failed", outcome.lines];
      }
    }
    const remaining = tasks.filter((task) => inCall.has(task.crate.folder));
    if (remaining.length === 0) {
      return;
    }
    const invocation: CargoInvocation = {
      args: publishArguments(
        remaining.map((task) => task.crate.name),
        registry,
        dryRun,
      ),
      cwd,
    };
    await this.run.announce?.(remaining.map((task) => task.label).join(", "), invocation);
    const result = await runCapturedCargo(invocation, env);
    // Each task's result from what cargo's output shows for its own crate:
    // uploaded in a real call, verified in a dry run. What the output does
    // not show counts as failed (`DES-RELEASE`, "Batch").
    const uploaded = uploadedCrates(result.output);
    const verified = verifiedCrates(result.output);
    const done = dryRun ? verified : uploaded;
    const doneText = dryRun ? "verified" : "uploaded";
    const output = result.output.trimEnd();
    for (const task of remaining) {
      const crate = `${task.crate.name} ${task.crate.version}`;
      const success = done.has(crateKey(task.crate.name, task.crate.version));
      const lines = output === "" ? [] : [output];
      if (success && result.status !== 0) {
        lines.push(
          `${task.label}: cargo ${doneText} ${crate} before the call failed for another of its crates, whose task says why.`,
        );
      }
      if (!success) {
        if (refusedStaleLockfile(result.output)) {
          lines.push(
            `${task.label}: Cargo.lock of the Cargo workspace in ${folderLabel(this.root, cwd)} does not match its manifests, and @convesoft/nx-rust passes --locked, so that publishing changes no tracked file. Run \`nx release version\`, which brings Cargo.lock up to date, commit the lockfile, and run nx release publish again.`,
          );
        }
        if (refusedUncommittedChanges(result.output)) {
          lines.push(
            `${task.label}: cargo publishes committed files only, and @convesoft/nx-rust never passes --allow-dirty. Commit the new versions first: nx release commits them by default, while nx release version on its own only stages them unless its git settings ask for a commit. Then run nx release publish again.`,
          );
        }
        if (result.status === 0) {
          lines.push(
            `${task.label}: cargo publish succeeded, but its output does not show that ${crate} was ${doneText}, so @convesoft/nx-rust cannot tell whether it was and reports the task failed. Check ${registryLabel(registry)}, and run nx release publish again; a version that the registry has by then is left out.`,
          );
        } else if (
          !refusedStaleLockfile(result.output) &&
          !refusedUncommittedChanges(result.output)
        ) {
          const before = [...done].join(", ");
          lines.push(
            `${task.label}: cargo publish failed${before === "" ? "" : ` after it ${doneText} ${before}`}, and its output does not show that ${crate} was ${doneText}. Correct what cargo reports above and run nx release publish again; versions that the registry has by then are left out.`,
          );
        }
      }
      outcomes.set(task, success ? { kind: "succeeded", lines } : { kind: "failed", lines });
      yield [task, success, lines];
    }
  }

  /**
   * The checks of one crate before its call (`DES-RELEASE`): whether the
   * registry has its version already (**Existing versions**), then for the
   * normal and build dependencies with a version requirement on crates of
   * the repository, _Unpublished dependencies_ for each of them, and then
   * _Dependencies published elsewhere_ and _Dependencies published first_
   * for each.
   *
   * @returns The task's outcome where a check settles it; `undefined` where
   *   it goes to cargo.
   */
  private async checkTask(
    task: Prepared,
    registry: Registry,
    inCall: ReadonlyMap<string, Prepared>,
    outcomes: ReadonlyMap<Prepared, Outcome>,
    byFolder: ReadonlyMap<string, Prepared>,
  ): Promise<Outcome | undefined> {
    const { crate } = task;
    const existing = await lookupVersion(this.registry, crate, registry, task);
    if (existing.kind === "found") {
      return {
        kind: "succeeded",
        lines: [
          `${task.label}: ${crate.name} ${crate.version} is in ${registryLabel(registry)} already, so it is left out of cargo publish.`,
        ],
      };
    }
    if (existing.kind !== "missing") {
      return {
        kind: "failed",
        lines: [
          lookupFailure(
            task,
            crate,
            registry,
            existing,
            folderLabel(this.root, crate.workspaceRoot),
          ),
        ],
      };
    }
    let links: DependencyLink[];
    try {
      links = await crateLinks(this.crates, task);
    } catch (error) {
      if (!(error instanceof LinkError)) {
        throw error;
      }
      return { kind: "failed", lines: [`${task.label}: ${error.message}`] };
    }
    for (const link of links) {
      const unpublished = unpublishedMessage(
        task,
        link,
        relativePath(this.root, link.dependency.manifest),
      );
      if (unpublished !== undefined) {
        return { kind: "failed", lines: [unpublished] };
      }
    }
    let notVerified: Outcome | undefined;
    for (const link of links) {
      const { dependency } = link;
      // Established before the first call, in the dependency's own
      // environment, which its lookups use as well.
      const established = await this.dependencyTarget(task, dependency);
      if ("failure" in established) {
        return { kind: "failed", lines: [established.failure] };
      }
      const target = { registry: established.target };
      const elsewhere = publishedElsewhere(task, link, established, established.own);
      if (elsewhere !== undefined) {
        return { kind: "failed", lines: [elsewhere] };
      }
      if (inCall.has(dependency.folder)) {
        continue;
      }
      const lookup = await lookupVersion(
        this.registry,
        dependency,
        target.registry,
        established.own,
        task.label,
      );
      if (lookup.kind === "found") {
        continue;
      }
      if (lookup.kind !== "missing") {
        return {
          kind: "failed",
          lines: [
            lookupFailure(
              task,
              dependency,
              target.registry,
              lookup,
              folderLabel(this.root, dependency.workspaceRoot),
            ),
          ],
        };
      }
      const dependencyTask = byFolder.get(dependency.folder);
      const failed =
        dependencyTask !== undefined && outcomes.get(dependencyTask)?.kind === "failed";
      if (
        task.dryRun &&
        dependency.hasPublishTarget &&
        dependency.project !== undefined &&
        !failed
      ) {
        notVerified ??= {
          kind: "not-verified",
          lines: [
            notVerifiedMessage(task, dependency, `${dependency.project}:${releasePublishTarget}`),
          ],
        };
        continue;
      }
      return {
        kind: "failed",
        lines: [
          publishFirstMessage(
            task,
            dependency,
            target.registry,
            failed ? dependencyTask : undefined,
          ),
        ],
      };
    }
    return notVerified;
  }
}

/**
 * The calls in an order in which each comes after the calls whose crates its
 * crates depend on, where no cycle prevents it; the calls of a cycle keep
 * their order, and the checks or cargo fail the one that cannot resolve
 * (`DES-RELEASE`, "Batch").
 */
function orderCalls<T extends { tasks: Prepared[] }>(
  calls: readonly T[],
  dependencies: (task: Prepared) => string[],
): T[] {
  const callOf = new Map<string, T>();
  for (const call of calls) {
    for (const task of call.tasks) {
      callOf.set(task.crate.folder, call);
    }
  }
  const after = new Map<T, Set<T>>(
    calls.map((call) => [
      call,
      new Set(
        call.tasks
          .flatMap((task) => dependencies(task))
          .map((folder) => callOf.get(folder))
          .filter((other): other is T => other !== undefined && other !== call),
      ),
    ]),
  );
  const ordered: T[] = [];
  const remaining = [...calls];
  while (remaining.length > 0) {
    const index = remaining.findIndex((call) =>
      [...(after.get(call) ?? [])].every((other) => ordered.includes(other)),
    );
    ordered.push(...remaining.splice(index === -1 ? 0 : index, 1));
  }
  return ordered;
}
