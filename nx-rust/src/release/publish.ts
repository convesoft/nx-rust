import type { ExecutorContext, Task } from "@nx/devkit";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CargoDependency, CargoMetadata, CargoPackage } from "../cargo/metadata";
import { PackageSpecReportError, workspaceReport } from "../cargo/package-specs";
import type { CargoInvocation } from "../executors/cargo-invocation";
import { declaredOptionsOf } from "../executors/declared-options";
import { projectWarnings } from "../executors/task";
import { type ExecutorOptions, ignoredOptionLine } from "../executors/task-options";
import { cargoMetadataOf } from "../graph/collisions";
import { realPath } from "../graph/real-path";
import {
  releasePublishExecutor,
  releasePublishTarget,
  targetCargoMetadataKey,
} from "../graph/targets";
import { recordedNxCommand } from "../executors/nx-command";
import { dependencyEntries, parseManifest } from "./manifests";
import {
  crateKey,
  isCratesIoIndex,
  lookupArguments,
  lookUp,
  type Lookup,
  probeRegistry,
  publishArguments,
  refusedPublishList,
  refusedReplacedCratesIo,
  refusedStaleLockfile,
  refusedUncommittedChanges,
  type Registry,
  registryFromProbe,
  registryKey,
  registryLabel,
  registryNamed,
  runCapturedCargo,
  shownLabel,
  uploadedCrates,
  verifiedCrates,
} from "./publish-cargo";

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

/** The options of `@convesoft/nx-rust:release-publish` that Nx's npm publishing has and cargo has not. */
const npmOptions: Readonly<Record<string, string>> = {
  tag: "distribution tags",
  access: "access levels",
  otp: "one-time passwords",
};

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

/** A crate of the repository, as the report of its Cargo workspace gives it. */
interface Crate {
  /** The real package name. */
  name: string;
  version: string;
  /** The absolute path of its manifest. */
  manifest: string;
  /** The real path of its folder. */
  folder: string;
  /** The real path of its workspace's root folder. */
  workspaceRoot: string;
  /** Its `publish` list; `null` without one, `[]` for `publish = false`. */
  publish: string[] | null;
  dependencies: CargoDependency[];
  /** Its Nx project, where it has one. */
  project?: string;
  /** Whether its project has the target `nx-release-publish`. */
  hasPublishTarget: boolean;
}

/** A task whose checks before cargo passed so far. */
interface Prepared {
  id: string;
  /** `<project>:nx-release-publish`. */
  label: string;
  crate: Crate;
  /** The environment of the task's cargo commands ({@link perTaskVariables} left out). */
  env: NodeJS.ProcessEnv;
  /** A key of {@link env}, equal for equal environments. */
  envKey: string;
  dryRun: boolean;
  /** What the task prints before anything else: its project's warnings and the lines for ignored options. */
  head: string[];
  start: number;
}

/** Where a crate goes: a registry, or why the executor cannot tell. */
type Target = { kind: "registry"; registry: Registry } | { kind: "unknown"; reason: string };

/** A dependency of a crate on another crate of the repository, with what its entry says. */
interface DependencyLink {
  dependency: Crate;
  /** Where the dependency's entry points: crates.io, or the registry it names with its index URL. */
  points: { kind: "crates-io" } | { kind: "named"; name: string; index: string };
  /** The manifest that holds the entry, relative to the repository root: the root manifest for an inherited one. */
  entryManifest: string;
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
  /** The projects of the graph by the real path of their crate's folder. */
  private readonly projects = new Map<
    string,
    { project: string; workspaceRoot: string; hasPublishTarget: boolean }
  >();
  private readonly reports = new Map<string, CargoMetadata | { failure: string }>();
  private readonly targets = new Map<string, Promise<Target>>();
  private readonly probes = new Map<string, Promise<Target>>();
  private readonly linksOf = new Map<Prepared, Promise<DependencyLink[]>>();
  /** Lookups that found their version, which a later call cannot take back. */
  private readonly found = new Set<string>();

  constructor(private readonly run: PublishRun) {
    this.root = run.context.root;
    this.executor = {
      name: releasePublishExecutor,
      shortName: "release-publish",
      declared: declaredOptionsOf(releasePublishExecutor),
    };
    for (const [name, project] of Object.entries(
      run.context.projectsConfigurations?.projects ?? {},
    )) {
      const cargo = cargoMetadataOf(project);
      if (cargo?.packageName === undefined) {
        continue;
      }
      this.projects.set(realPath(join(this.root, dirname(cargo.manifest))), {
        project: name,
        workspaceRoot: realPath(join(this.root, dirname(cargo.workspaceManifest))),
        hasPublishTarget: project.targets?.[releasePublishTarget] !== undefined,
      });
    }
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
    const report = this.reportOf(workspaceRoot, env, envKey);
    if ("failure" in report) {
      return fail(...lines, `${label}: ${report.failure}`);
    }
    const pkg = report.packages.find(
      (candidate) => realPath(dirname(candidate.manifest_path)) === realPath(dirname(manifest)),
    );
    if (pkg === undefined) {
      return fail(
        ...lines,
        `${label}: the report of the Cargo workspace in ${this.folderLabel(workspaceRoot)} has no crate with the manifest ${cargo.manifest}, so nothing was published. Run the command again; if the crate moved, Nx's project graph is out of date.`,
      );
    }
    const crate = this.crateOf(pkg, workspaceRoot);
    return {
      id: input.id,
      label,
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
    // The target registry of each task's crate.
    const calls = new Map<string, { registry: Registry; tasks: Prepared[] }>();
    for (const task of tasks) {
      const target = await this.targetOf(task.crate, task);
      if (target.kind === "unknown") {
        outcomes.set(task, { kind: "failed", lines: [`${task.label}: ${target.reason}`] });
        yield [task, false, [`${task.label}: ${target.reason}`]];
        continue;
      }
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
    for (const call of orderCalls([...calls.values()], (task) =>
      this.dependencyFolders(task.crate),
    )) {
      for await (const end of this.publishCall(call.registry, call.tasks, outcomes, byFolder)) {
        yield end;
      }
    }
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
        for (const link of await this.links(task)) {
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
            `${task.label}: Cargo.lock of the Cargo workspace in ${this.folderLabel(cwd)} does not match its manifests, and @convesoft/nx-rust passes --locked, so that publishing changes no tracked file. Run \`nx release version\`, which brings Cargo.lock up to date, commit the lockfile, and run nx release publish again.`,
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
   * registry has its version already (**Existing versions**), then for each
   * normal or build dependency with a version requirement on a crate of the
   * repository, _Dependencies published elsewhere_ and _Dependencies
   * published first_. The check _Unpublished dependencies_ is not part of
   * this version: a dependency with `publish = false` is left to cargo.
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
    const existing = await this.lookup(crate, registry, task);
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
          lookupFailure(task, crate, registry, existing, this.folderLabel(crate.workspaceRoot)),
        ],
      };
    }
    let links: DependencyLink[];
    try {
      links = await this.links(task);
    } catch (error) {
      if (!(error instanceof LinkError)) {
        throw error;
      }
      return { kind: "failed", lines: [`${task.label}: ${error.message}`] };
    }
    let notVerified: Outcome | undefined;
    for (const link of links) {
      const { dependency } = link;
      const target = await this.targetOf(dependency, task);
      if (target.kind === "unknown") {
        return {
          kind: "failed",
          lines: [
            `${task.label}: ${crate.name} depends on ${dependency.name}, whose target registry @convesoft/nx-rust cannot tell, so it publishes neither: ${target.reason}`,
          ],
        };
      }
      const elsewhere = this.publishedElsewhere(task, link, target.registry);
      if (elsewhere !== undefined) {
        return { kind: "failed", lines: [elsewhere] };
      }
      if (inCall.has(dependency.folder)) {
        continue;
      }
      const lookup = await this.lookup(dependency, target.registry, task);
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
              this.folderLabel(dependency.workspaceRoot),
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

  /**
   * The check _Dependencies published elsewhere_: the registry that the
   * dependency's entry points to has to be established as the dependency's
   * own target registry, which only three cases do (`DES-RELEASE`, "Where a
   * dependency points").
   *
   * @returns The failure message, or `undefined` where the check passes.
   */
  private publishedElsewhere(
    task: Prepared,
    link: DependencyLink,
    target: Registry,
  ): string | undefined {
    const { dependency, points } = link;
    const sameWorkspace = dependency.workspaceRoot === task.crate.workspaceRoot;
    if (points.kind === "crates-io" && target.kind === "crates-io") {
      return undefined;
    }
    let reason: string;
    if (points.kind === "named" && target.kind === "named") {
      if (sameWorkspace && points.name === target.name) {
        return undefined;
      }
      const variable = indexVariable(target.name);
      const index = task.env[variable];
      if (index !== undefined && sameIndex(index, points.index)) {
        return undefined;
      }
      reason = sameWorkspace
        ? `the entry names \`${points.name}\`, not \`${target.name}\`, and ${variable} does not give \`${target.name}\` the index that \`${points.name}\` has (${points.index})`
        : `the two crates lie in different Cargo workspaces, whose configuration files can give one name different indexes, and ${variable} ${index === undefined ? "is not set" : `gives ${index}`} where the entry's index is ${points.index}`;
    } else if (points.kind === "crates-io") {
      reason =
        "the entry has no `registry` key, so the published crate would depend on crates.io's crate of that name, also where the Cargo configuration replaces crates.io";
    } else {
      reason = `the entry names \`${points.name}\``;
    }
    const pointsLabel =
      points.kind === "crates-io" ? "crates.io" : `the registry \`${points.name}\``;
    const remedies =
      target.kind === "crates-io"
        ? ["remove the `registry` key from that entry, so that it points to crates.io"]
        : [
            `add \`registry = "${target.name}"\` to that entry, or correct it to name \`${target.name}\``,
            "configure each registry's index under one name",
            ...(sameWorkspace
              ? []
              : [
                  `because ${dependency.name} lies in another Cargo workspace, give the registry's index in the environment as ${indexVariable(target.name)}, so that it is the same for every workspace, or keep both crates in one Cargo workspace`,
                ]),
          ];
    return [
      `${task.label}: ${task.crate.name} depends on ${dependency.name} through the entry in ${link.entryManifest}, which points to ${pointsLabel}, while ${dependency.name} is published to ${registryLabel(target)}, and @convesoft/nx-rust cannot establish that these are one registry: ${reason}. Nothing was uploaded for ${task.crate.name}: cargo would publish it with a dependency on the crate of that name in ${pointsLabel}.`,
      `  To publish it, ${sentence(remedies)}.`,
    ].join("\n");
  }

  /**
   * The target registry of `crate` for commands with `task`'s environment
   * (`DES-RELEASE`, "Target registry"): the name in `CARGO_REGISTRY_DEFAULT`,
   * without a probe, where it holds one; otherwise what the probe shows, as
   * the crate's `publish` list allows it.
   */
  private targetOf(crate: Crate, task: Prepared): Promise<Target> {
    const key = [crate.folder, task.envKey].join("\u0000");
    let target = this.targets.get(key);
    if (target === undefined) {
      target = this.findTarget(crate, task);
      this.targets.set(key, target);
    }
    return target;
  }

  private async findTarget(crate: Crate, task: Prepared): Promise<Target> {
    const list = crate.publish;
    const listText = list === null ? "" : JSON.stringify(list);
    const named = task.env.CARGO_REGISTRY_DEFAULT;
    if (named !== undefined && named !== "") {
      if (list !== null && !list.includes(named)) {
        return {
          kind: "unknown",
          reason: `CARGO_REGISTRY_DEFAULT names the registry \`${named}\`, which the publish list of ${crate.name} in ${this.relativePath(crate.manifest)}, ${listText}, leaves out, so cargo would refuse to publish it, and in a call with other crates the whole call. Nothing was uploaded for ${crate.name}. Add "${named}" to the list, or publish ${crate.name} in a run with CARGO_REGISTRY_DEFAULT set to an entry of the list, or without it.`,
        };
      }
      return { kind: "registry", registry: registryNamed(named) };
    }
    // One probe per workspace, environment and publish value.
    const probeKey = [crate.workspaceRoot, task.envKey, listText].join("\u0000");
    let probe = this.probes.get(probeKey);
    if (probe === undefined) {
      probe = this.probe(crate, task);
      this.probes.set(probeKey, probe);
    }
    const result = await probe;
    return result.kind === "unknown"
      ? { kind: "unknown", reason: result.reason.split("{crate}").join(crate.name) }
      : result;
  }

  private async probe(crate: Crate, task: Prepared): Promise<Target> {
    const cwd = crate.workspaceRoot;
    const list = crate.publish;
    const announce = this.run.announce;
    if (announce !== undefined) {
      await announce(task.label, {
        args: ["publish", "--dry-run", "--no-verify", "--locked", "-p", crate.name],
        cwd,
      });
    }
    const result = await probeRegistry(crate.name, cwd, task.env);
    if (result.kind === "failed" || refusedPublishList(result.output)) {
      return {
        kind: "unknown",
        reason: [
          `cargo could not tell which registry it would publish {crate} to, so @convesoft/nx-rust does not publish it, and nothing was uploaded for it. \`cargo publish --dry-run --no-verify --locked -p ${crate.name}\`, run in ${this.folderLabel(cwd)}, printed:`,
          result.output.trimEnd(),
          refusedReplacedCratesIo(result.output)
            ? replacedCratesIoAdvice("{crate}")
            : `Choose the registry as for plain cargo publish: set \`publish = ["<name>"]\` in the crate's Cargo.toml, \`registry.default\` in .cargo/config.toml, or CARGO_REGISTRY_DEFAULT=<name> for one run.`,
        ].join("\n"),
      };
    }
    const shown = result.shown;
    const registry = registryFromProbe(list, shown);
    if (registry !== undefined) {
      return { kind: "registry", registry };
    }
    if (list !== null && list.length > 1) {
      return {
        kind: "unknown",
        reason: `the publish list of {crate} in ${this.relativePath(crate.manifest)}, ${JSON.stringify(list)}, holds several registries, and cargo showed ${shownLabel(shown)} for the registry it would publish to, which no entry of the list names, so @convesoft/nx-rust cannot tell which registry that is and publishes nothing for {crate}. Configure each registry under one name, the same in every Cargo workspace and without a source replacement, and choose the entry with registry.default in .cargo/config.toml or with CARGO_REGISTRY_DEFAULT.`,
      };
    }
    return {
      kind: "unknown",
      reason: `cargo showed ${shownLabel(shown)} for the registry it would publish {crate} to, which names no registry, so @convesoft/nx-rust publishes nothing for {crate}. Configure the registry under one name, without a source replacement, and publish online.`,
    };
  }

  /**
   * Looks `crate`'s version up in `registry`, started in the root of the
   * crate's Cargo workspace with `task`'s environment (`DES-RELEASE`,
   * "Lookups"). A version once found is not asked again.
   */
  private async lookup(crate: Crate, registry: Registry, task: Prepared): Promise<Lookup> {
    const key = lookupKey(crate, registry, task.envKey);
    if (this.found.has(key)) {
      return { kind: "found" };
    }
    await this.run.announce?.(task.label, {
      args: lookupArguments(crate.name, crate.version, registry),
      cwd: crate.workspaceRoot,
    });
    const result = await lookUp(crate.name, crate.version, registry, crate.workspaceRoot, task.env);
    if (result.kind === "found") {
      this.found.add(key);
    }
    return result;
  }

  /**
   * The normal and build dependencies of `task`'s crate with a version
   * requirement on crates of the repository other than those with
   * `publish = false`, with where each entry points (`DES-RELEASE`, "Where a
   * dependency points").
   *
   * @throws {LinkError} When the crate's manifest or a dependency's report
   *   cannot be read, or a dependency has no entry in the manifest.
   */
  private links(task: Prepared): Promise<DependencyLink[]> {
    let links = this.linksOf.get(task);
    if (links === undefined) {
      links = this.readLinks(task);
      this.linksOf.set(task, links);
    }
    return links;
  }

  private async readLinks(task: Prepared): Promise<DependencyLink[]> {
    const { crate } = task;
    const links: DependencyLink[] = [];
    let entries: ManifestEntry[] | undefined;
    for (const dependency of crate.dependencies) {
      if (
        (dependency.kind !== null && dependency.kind !== "build") ||
        dependency.path === undefined
      ) {
        continue;
      }
      const folder = realPath(dependency.path);
      if (!this.insideRepository(folder)) {
        continue;
      }
      entries ??= this.manifestEntries(crate);
      const entry = matchingEntry(entries, dependency, folder);
      if (entry === undefined) {
        throw new LinkError(
          `cargo reports a dependency of ${crate.name} on ${dependency.name} in ${dependency.path}, but @convesoft/nx-rust finds no entry for it in ${this.relativePath(crate.manifest)} or in the [workspace.dependencies] of its workspace, so it cannot tell which registry the entry names, and nothing was uploaded for ${crate.name}. Check that the manifests are saved and valid, and run nx release publish again.`,
        );
      }
      if (entry.requirement === undefined) {
        // Left to cargo, which refuses a normal or build path dependency
        // without a version requirement before it uploads anything.
        continue;
      }
      const target = this.crateAt(folder, crate, task);
      if ("failure" in target) {
        throw new LinkError(target.failure);
      }
      if (Array.isArray(target.publish) && target.publish.length === 0) {
        continue;
      }
      links.push({
        dependency: target,
        points: isCratesIoIndex(dependency.registry)
          ? { kind: "crates-io" }
          : { kind: "named", name: entry.registry ?? "", index: dependency.registry as string },
        entryManifest: this.relativePath(entry.manifest),
      });
    }
    return links;
  }

  /** The folders of the crates that `crate` depends on through a normal or build path dependency. */
  private dependencyFolders(crate: Crate): string[] {
    return crate.dependencies
      .filter(
        (dependency) =>
          (dependency.kind === null || dependency.kind === "build") &&
          dependency.path !== undefined &&
          dependency.req !== "*",
      )
      .map((dependency) => realPath(dependency.path as string));
  }

  /** The entries of the dependency tables of `crate`'s manifest, with what they inherit. */
  private manifestEntries(crate: Crate): ManifestEntry[] {
    const rootManifest = join(crate.workspaceRoot, "Cargo.toml");
    const read = (file: string) => {
      try {
        return parseManifest(readFileSync(file, "utf8"), this.relativePath(file));
      } catch (error) {
        throw new LinkError(
          `@convesoft/nx-rust cannot read ${this.relativePath(file)} to tell which registry the dependencies of ${crate.name} name (${error instanceof Error ? error.message : String(error)}), and nothing was uploaded for it. Correct the file and run nx release publish again.`,
        );
      }
    };
    const inherited = new Map(
      dependencyEntries(read(rootManifest))
        .filter((entry) => entry.kind === "workspace")
        .map((entry) => [entry.key, entry]),
    );
    return dependencyEntries(read(crate.manifest))
      .filter((entry) => entry.kind === "normal" || entry.kind === "build")
      .map((entry) => {
        const [source, manifest] =
          entry.entry.workspace === true
            ? [inherited.get(entry.key), rootManifest]
            : [entry, crate.manifest];
        const { path, version, registry } = source?.entry ?? {};
        return {
          kind: entry.kind as "normal" | "build",
          key: entry.key,
          manifest,
          folder: typeof path === "string" ? realPath(resolve(dirname(manifest), path)) : undefined,
          requirement: typeof version === "string" ? version : undefined,
          registry: typeof registry === "string" ? registry : undefined,
        };
      });
  }

  /**
   * The crate of the repository in `folder`, from the report of its Cargo
   * workspace with `task`'s environment: the workspace of its Nx project, the
   * workspace of `dependent` where it is a member, or the workspace that
   * cargo finds from the folder.
   */
  private crateAt(folder: string, dependent: Crate, task: Prepared): Crate | { failure: string } {
    const candidates = [this.projects.get(folder)?.workspaceRoot, dependent.workspaceRoot].filter(
      (root): root is string => root !== undefined,
    );
    for (const root of candidates) {
      const report = this.reportOf(root, task.env, task.envKey);
      if ("failure" in report) {
        return report;
      }
      const pkg = report.packages.find(
        (candidate) => realPath(dirname(candidate.manifest_path)) === folder,
      );
      if (pkg !== undefined) {
        return this.crateOf(pkg, realPath(report.workspace_root));
      }
    }
    const report = this.reportOf(folder, task.env, task.envKey);
    if ("failure" in report) {
      return report;
    }
    const pkg = report.packages.find(
      (candidate) => realPath(dirname(candidate.manifest_path)) === folder,
    );
    if (pkg === undefined) {
      return {
        failure: `@convesoft/nx-rust finds no crate in ${this.relativePath(folder)}, on which ${dependent.name} depends, in the report of its Cargo workspace, so it cannot check that crate's version in the registry, and nothing was uploaded for ${dependent.name}.`,
      };
    }
    return this.crateOf(pkg, realPath(report.workspace_root));
  }

  private crateOf(pkg: CargoPackage, workspaceRoot: string): Crate {
    const folder = realPath(dirname(pkg.manifest_path));
    const project = this.projects.get(folder);
    return {
      name: pkg.name,
      version: pkg.version,
      manifest: pkg.manifest_path,
      folder,
      workspaceRoot,
      publish: Array.isArray(pkg.publish) ? pkg.publish : null,
      dependencies: pkg.dependencies ?? [],
      ...(project === undefined ? {} : { project: project.project }),
      hasPublishTarget: project?.hasPublishTarget ?? false,
    };
  }

  /**
   * The `cargo metadata --no-deps` report of the Cargo workspace that cargo
   * finds from `folder`, asked once per folder and environment, with that
   * environment (`DES-RELEASE`, "Where a dependency points").
   */
  private reportOf(
    folder: string,
    env: NodeJS.ProcessEnv,
    envKey: string,
  ): CargoMetadata | { failure: string } {
    const key = [folder, envKey].join("\u0000");
    let report = this.reports.get(key);
    if (report === undefined) {
      try {
        report = workspaceReport(folder, env);
      } catch (error) {
        if (!(error instanceof PackageSpecReportError)) {
          throw error;
        }
        const output = error.stderr.trim();
        report = {
          failure: [
            `cargo metadata failed in ${this.folderLabel(folder)}, so @convesoft/nx-rust cannot read the crates and dependencies there, and nothing was uploaded: ${error.message}.`,
            ...(output === "" ? [] : [output]),
            "Correct what cargo reports, such as a `registry` key that names a registry no Cargo configuration names, and run nx release publish again.",
          ].join("\n"),
        };
      }
      this.reports.set(key, report);
    }
    return report;
  }

  private insideRepository(path: string): boolean {
    const relativePath = relative(realPath(this.root), path);
    return (
      relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !relativePath.startsWith("/")
    );
  }

  private relativePath(path: string): string {
    const relativePath = relative(realPath(this.root), realPath(path));
    return relativePath === "" ? "." : relativePath.split(sep).join("/");
  }

  private folderLabel(folder: string): string {
    return `the folder ${this.relativePath(folder)}`;
  }
}

/** An entry of a crate's normal or build dependency tables, with what it inherits. */
interface ManifestEntry {
  kind: "normal" | "build";
  key: string;
  /** The absolute path of the manifest that holds what the entry says: the root manifest for an inherited one. */
  manifest: string;
  folder?: string;
  requirement?: string;
  registry?: string;
}

/** Why the dependencies of a crate cannot be read; its message is the reason. */
class LinkError extends Error {}

/**
 * The entry of the manifest for a dependency of the report, matched by kind,
 * key and folder, not by platform, which the report writes normalised, as
 * the version actions match it (`DES-RELEASE`, "Dependents"). Among several
 * that match, as in several target tables, one with a version requirement
 * and a `registry` key comes first.
 */
function matchingEntry(
  entries: readonly ManifestEntry[],
  dependency: CargoDependency,
  folder: string,
): ManifestEntry | undefined {
  const kind = dependency.kind === "build" ? "build" : "normal";
  const key = dependency.rename ?? dependency.name;
  const matching = entries.filter(
    (entry) => entry.kind === kind && entry.key === key && entry.folder === folder,
  );
  return (
    matching.find((entry) => entry.requirement !== undefined && entry.registry !== undefined) ??
    matching.find((entry) => entry.requirement !== undefined) ??
    matching[0]
  );
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

function lookupKey(crate: Crate, registry: Registry, envKey: string): string {
  return [crate.folder, crate.version, registryKey(registry), envKey].join("\u0000");
}

/** A key of an environment's variables that have a value, in a fixed order. */
function environmentKey(env: NodeJS.ProcessEnv): string {
  return JSON.stringify(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/** `CARGO_REGISTRIES_<NAME>_INDEX` for a registry's name, as cargo spells it. */
function indexVariable(name: string): string {
  return `CARGO_REGISTRIES_${name.toUpperCase().replace(/-/g, "_")}_INDEX`;
}

/** Whether two index URLs are the same, apart from a final `/`. */
function sameIndex(a: string, b: string): boolean {
  return a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

function labelOf(task: Task): string {
  return `${task.target.project}:${task.target.target}`;
}

/**
 * The executor context of one task, as Nx gives it to the task run on its
 * own: the run's context with the task's project, target and configuration.
 */
function contextOf(task: Task, context: ExecutorContext): ExecutorContext {
  const { project, target, configuration } = task.target;
  return {
    ...context,
    projectName: project,
    targetName: target,
    ...(configuration === undefined ? {} : { configurationName: configuration }),
    target: context.projectsConfigurations?.projects?.[project]?.targets?.[target],
  };
}

/** The target's options with those of the active configuration laid over them, as Nx merges them. */
function configuredOptions(context: ExecutorContext): Record<string, unknown> {
  const configuration = context.configurationName;
  return {
    ...context.target?.options,
    ...(configuration ? context.target?.configurations?.[configuration] : undefined),
  };
}

/** Whether Nx put `name` with `value` among the overrides of the task, which it does only for options of the command. */
function passedToCommand(task: Task, name: string, value: unknown): boolean {
  const overrides: Record<string, unknown> | undefined = task.overrides;
  return (
    overrides !== undefined &&
    Object.prototype.hasOwnProperty.call(overrides, name) &&
    isDeepStrictEqual(overrides[name], value)
  );
}

function valueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * The message of a task whose options hold `registry` (`DES-RELEASE`,
 * "Options"; `ADR-PUBLISH-REGISTRY-OPTION`): where the value came from, as
 * the overrides of the task graph tell it, Cargo's own ways to choose a
 * registry, and how npm packages alone get one.
 */
// @mara implements DES-RELEASE
export function registryOptionMessage(label: string, value: unknown, task: Task): string {
  const source = passedToCommand(task, "registry", value)
    ? `${label}: the option \`registry\` (${valueText(value)}) was passed to \`nx release publish\`, and nx-rust does not map it to a Cargo registry. Nothing was published.`
    : [
        `${label}: the option \`registry\` (${valueText(value)}) comes from the workspace's configuration, and nx-rust does not map it to a Cargo registry. Nothing was published.`,
        `  Run \`nx show target ${label} --json\` and look under \`sourceMap\` for the file and entry. An entry of \`targetDefaults\` keyed by \`${releasePublishTarget}\` and written for npm reaches crates as well, unless it has a \`filter\` or nx.json has the empty entry keyed by "${releasePublishExecutor}" that \`nx add @convesoft/nx-rust\` adds; an entry keyed by "@nx/js:release-publish" reaches npm packages only.`,
      ].join("\n");
  return [
    source,
    `  Cargo chooses the registry itself: set \`publish = ["<name>"]\` in the crate's Cargo.toml or \`registry.default\` in .cargo/config.toml, or run \`CARGO_REGISTRY_DEFAULT=<name> nx release publish\` for one run. Dependencies on crates of this repository then need \`registry = "<name>"\` in their entries.`,
    "  To give npm packages alone a registry, publish them in a run of their own (`nx release publish --groups <group> --registry <url>`) or set it in .npmrc.",
  ].join("\n");
}

/** The line of a task that ignores one of npm's options `tag`, `access` and `otp` (`DES-RELEASE`, "Options"). */
function npmOptionLine(label: string, name: string, value: unknown, task: Task): string {
  const source = passedToCommand(task, name, value)
    ? "passed to `nx release publish`"
    : `which comes from the workspace's configuration (run \`nx show target ${label} --json\` and look under \`sourceMap\`)`;
  return `${label}: ignoring option \`${name}\` (${valueText(value)}), ${source}: it is npm's, and cargo publish has no ${npmOptions[name]}. Nothing changes for crates; to give it to npm packages alone, publish them in a run of their own.`;
}

function notVerifiedMessage(task: Prepared, dependency: Crate, dependencyTask: string): string {
  return `${task.label}: ${task.crate.name} ${task.crate.version} was not verified, because it needs ${dependency.name} ${dependency.version}, which ${dependencyTask} would publish in another cargo call, and a dry run of one cargo call cannot verify a crate against a version that another call would publish. Nothing was uploaded. The real nx release publish checks before the upload that ${dependency.name} ${dependency.version} is in the registry.`;
}

function publishFirstMessage(
  task: Prepared,
  dependency: Crate,
  registry: Registry,
  failed: Prepared | undefined,
): string {
  return `${task.label}: ${task.crate.name} needs ${dependency.name} ${dependency.version}, which is not in ${registryLabel(registry)} yet${failed === undefined ? "" : `, because ${failed.label} failed in this run`}, so @convesoft/nx-rust does not publish ${task.crate.name}, and nothing was uploaded for it: cargo would publish it against an older version of ${dependency.name} that its requirement accepts. Publish ${dependency.name} first: in the same nx release publish, which publishes a dependency's Cargo workspace and release group first, or by running ${dependency.project === undefined ? `the publishing of ${dependency.name}` : `${dependency.project}:${releasePublishTarget}`} before this task.`;
}

/** The guidance for a crate that would publish to crates.io where the Cargo configuration replaces crates.io (`ADR-PUBLISH-REPLACED-CRATES-IO`). */
function replacedCratesIoAdvice(crate: string): string {
  return `The Cargo configuration replaces crates.io, such as with a mirror, so @convesoft/nx-rust cannot establish that its checks ask crates.io, where cargo would upload ${crate}. Publish ${crate} to crates.io from a job whose Cargo configuration does not replace crates.io, or publish it to another registry with \`publish = ["<name>"]\`, registry.default or CARGO_REGISTRY_DEFAULT.`;
}

/** The message of a lookup that did not establish its source or failed (`DES-RELEASE`, "Lookups"). */
function lookupFailure(
  task: Prepared,
  crate: Crate,
  registry: Registry,
  lookup: Lookup,
  folder: string,
): string {
  if (lookup.kind === "failed") {
    return [
      `${task.label}: \`${lookup.command}\`, run in ${folder}, failed, so @convesoft/nx-rust cannot tell whether ${crate.name} ${crate.version} is in ${registryLabel(registry)}, and nothing was uploaded for ${task.crate.name}. Make sure that the registry can be reached and run nx release publish again. cargo printed:`,
      lookup.output.trimEnd(),
    ].join("\n");
  }
  if (lookup.kind !== "unestablished") {
    return `${task.label}: the lookup of ${crate.name} ${crate.version} in ${registryLabel(registry)} gave no answer.`;
  }
  const head = `${task.label}: \`${lookup.command}\`, run in ${folder}, showed ${lookup.shown} in place of ${registryLabel(registry)}, so @convesoft/nx-rust cannot tell which registry it asked about ${crate.name} ${crate.version}, and nothing was uploaded for ${task.crate.name}.`;
  if (registry.kind === "crates-io" && lookup.shown !== "no line that starts with Updating") {
    return [head, `  ${replacedCratesIoAdvice(crate.name)}`].join("\n");
  }
  return [
    head,
    `  Configure each registry under one name, the same in every Cargo workspace, without a source replacement for the registry you publish to, and publish online: offline, as with CARGO_NET_OFFLINE=true or net.offline, cargo does not show which registry it asked, and it refuses to publish anyway.`,
  ].join("\n");
}

/** "a, b and c" as the end of a sentence. */
function sentence(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join("; ")}; and ${items[items.length - 1]}`;
}
