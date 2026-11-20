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
import { hackCrateName } from "../graph/unification";
import {
  releasePublishExecutor,
  releasePublishTarget,
  targetCargoMetadataKey,
} from "../graph/targets";
import { recordedNxCommand } from "../executors/nx-command";
import { readTaskDotenv } from "../executors/dotenv-check";
import { nxTaskConfiguration, TaskEnvironmentError } from "../executors/task-env";
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
import { dotenvDifferences, dotenvSettings, settingDifferences } from "./publish-settings";

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
export interface Crate {
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
  /** Whether it is the hack crate that the cargo-hakari configuration of its workspace names (`DES-RELEASE`, "Hack crate"). */
  hack: boolean;
}

/** What a crate's cargo commands run with: a task's label and environment. */
interface Runner {
  /** `<project>:nx-release-publish`. */
  label: string;
  /** The task, as the task graph holds it, with its project's root. */
  task: Task;
  /** The environment of the task's cargo commands ({@link perTaskVariables} left out). */
  env: NodeJS.ProcessEnv;
  /** A key of {@link env}, equal for equal environments. */
  envKey: string;
}

/** A task whose checks before cargo passed so far. */
interface Prepared extends Runner {
  id: string;
  crate: Crate;
  dryRun: boolean;
  /** What the task prints before anything else: its project's warnings and the lines for ignored options. */
  head: string[];
  start: number;
}

/**
 * Where a crate goes: a registry, with the setting that chooses it, or why
 * the executor cannot tell.
 */
type Target =
  | { kind: "registry"; registry: Registry; source: string }
  | { kind: "unknown"; reason: string };

/**
 * Another `nx-release-publish` task of the run, which the executor did not
 * receive, as for a task run on its own (`DES-RELEASE`, "Checks before the
 * first call"). Its environment is that of a task the executor received
 * whose dotenv files give the same Cargo settings; where none does, it runs
 * with the first such task's environment and `foreign` says how they differ.
 */
interface Other extends Prepared {
  foreign?: string;
}

/** A crate of the run whose registry the executor cannot establish, with the message that says why. */
interface Disagreement {
  task: Prepared;
  message: string;
}

/** A dependency of a crate on another crate of the repository, with what its entry says. */
export interface DependencyLink {
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
  /** The hack crate's name by the real path of its workspace root, `undefined` for none. */
  private readonly hackCrates = new Map<string, string | undefined>();
  /** Lookups that found their version, which a later call cannot take back. */
  private readonly found = new Set<string>();
  /** The prepared tasks that the executor received, by the real path of their crate's folder. */
  private byFolder = new Map<string, Prepared>();
  /** The other tasks of the run, by the real path of their crate's folder ({@link others}). */
  private othersByFolder = new Map<string, Other>();
  /** The dotenv files of each task, by its id, or why they cannot be read. */
  private readonly dotenvs = new Map<string, Record<string, string> | { failure: string }>();

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
    const crate = this.crateOf(pkg, workspaceRoot, report);
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
      const target = await this.targetOf(task.crate, task);
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
    const disagreements = await this.disagreements(targeted, this.others(tasks));
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
    for (const call of orderCalls([...calls.values()], (task) =>
      this.dependencyFolders(task.crate),
    )) {
      for await (const end of this.publishCall(call.registry, call.tasks, outcomes, byFolder)) {
        yield end;
      }
    }
  }

  /**
   * The other `nx-release-publish` tasks of the run's task graph, those of
   * crates whose tasks the executor did not receive, as when Nx runs each
   * task on its own (`DES-RELEASE`, "Checks before the first call"). Each
   * gets the environment of a received task whose dotenv files give the
   * same Cargo settings (**A dependency's environment**), or, where none
   * does, the first one's, and says why it is foreign.
   */
  private others(tasks: readonly Prepared[]): Other[] {
    const [first] = tasks;
    const received = new Set(tasks.map((task) => task.id));
    const others: Other[] = [];
    if (first === undefined) {
      return others;
    }
    for (const graphTask of Object.values(this.run.context.taskGraph?.tasks ?? {})) {
      if (graphTask.target.target !== releasePublishTarget || received.has(graphTask.id)) {
        continue;
      }
      const project = this.run.context.projectsConfigurations?.projects?.[graphTask.target.project];
      const cargo = project === undefined ? undefined : cargoMetadataOf(project);
      if (cargo?.packageName === undefined) {
        continue;
      }
      const task = withProjectRoot(graphTask, project?.root);
      let runner: Prepared = first;
      let foreign: string | undefined;
      const same = tasks.find(
        (candidate) => this.sameDotenvSettings(candidate.task, task) === true,
      );
      if (same !== undefined) {
        runner = same;
      } else {
        foreign = this.dotenvComparison(first.task, task);
      }
      const workspaceRoot = realPath(join(this.root, dirname(cargo.workspaceManifest)));
      const report = this.reportOf(workspaceRoot, runner.env, runner.envKey);
      const folder = realPath(join(this.root, dirname(cargo.manifest)));
      const pkg =
        "failure" in report
          ? undefined
          : report.packages.find(
              (candidate) => realPath(dirname(candidate.manifest_path)) === folder,
            );
      if ("failure" in report || pkg === undefined) {
        continue;
      }
      const other: Other = {
        id: graphTask.id,
        label: labelOf(graphTask),
        task,
        crate: this.crateOf(pkg, workspaceRoot, report),
        env: runner.env,
        envKey: runner.envKey,
        dryRun: runner.dryRun,
        head: [],
        start: Date.now(),
        ...(foreign === undefined ? {} : { foreign }),
      };
      others.push(other);
      this.othersByFolder.set(other.crate.folder, other);
    }
    return others;
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
        links = await this.links(task);
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
        unpublishedMessage(task, link, this.relativePath(link.dependency.manifest)) !== undefined
      ) {
        // Failed by the check _Unpublished dependencies_ before the crate's call.
        continue;
      }
      const established = await this.dependencyTarget(task, link.dependency);
      if ("failure" in established) {
        return established.failure;
      }
      const elsewhere = this.publishedElsewhere(task, link, established, established.own);
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
   * of {@link others}, whose environment is not established, counts as
   * reaching cargo.
   */
  private async reachesCargo(task: Prepared): Promise<boolean> {
    if ((task as Other).foreign !== undefined) {
      return true;
    }
    const target = await this.targetOf(task.crate, task);
    return (
      target.kind === "registry" &&
      (await this.lookup(task.crate, target.registry, task)).kind === "missing"
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
    const own = this.ownRunner(dependency, task);
    if ("failure" in own) {
      return { failure: own.failure };
    }
    const target = await this.targetOf(dependency, own);
    if (target.kind === "unknown") {
      return {
        failure: `${task.label}: ${task.crate.name} depends on ${dependency.name}, whose target registry @convesoft/nx-rust cannot tell, so it publishes neither: ${target.reason}`,
      };
    }
    return { target: target.registry, source: target.source, own };
  }

  /**
   * What the cargo commands for `dependency` run with, the environment of
   * its own task (`DES-RELEASE`, "A dependency's environment"): the task
   * that the executor received for it, or another task of the run for it;
   * otherwise `task`, where the dependency has no `nx-release-publish`
   * task, or where the dotenv files that Nx loads for the dependency's task
   * give the same Cargo settings as those of `task`. Otherwise the message
   * of `task` that says why its environment cannot be established.
   */
  private ownRunner(dependency: Crate, task: Prepared): Runner | { failure: string } {
    const own = this.byFolder.get(dependency.folder) ?? this.othersByFolder.get(dependency.folder);
    if (own !== undefined && (own as Other).foreign === undefined) {
      return own;
    }
    const project =
      dependency.project === undefined
        ? undefined
        : this.run.context.projectsConfigurations?.projects?.[dependency.project];
    if (dependency.project === undefined || !dependency.hasPublishTarget || project === undefined) {
      return task;
    }
    let dependencyTask: Task;
    if (own !== undefined) {
      // In the run's task graph, as Nx built it, with its configuration.
      dependencyTask = own.task;
    } else {
      const outside = this.taskOutsideRun(dependency, dependency.project, project, task);
      if ("failure" in outside) {
        return outside;
      }
      dependencyTask = outside.task;
    }
    if (this.sameDotenvSettings(task.task, dependencyTask) === true) {
      return task;
    }
    return {
      failure: `${task.label}: ${task.crate.name} depends on ${dependency.name}, which ${labelOf(dependencyTask)} publishes, and @convesoft/nx-rust cannot rebuild the environment of that task, because ${own === undefined ? "the run does not hand it to this" : "Nx runs it on its own, apart from this"} task, while ${this.dotenvComparison(task.task, dependencyTask)}. So it cannot establish where ${dependency.name} goes, and nothing was uploaded for ${task.crate.name}. Publish both in one nx release publish with batches, as it runs by default, or give the crates of one release the same Cargo settings, such as in the environment of the command or in .cargo/config.toml.`,
    };
  }

  /**
   * The `nx-release-publish` task of `dependency`'s project, which is not in
   * the run's task graph, with the configuration that Nx would give it in a
   * command like this one (`DES-RELEASE`, "A dependency's environment"):
   * the configuration of `task` where `task`'s target did not take it as its
   * own default and the dependency's target declares it, otherwise the
   * dependency's `defaultConfiguration`, by Nx's own rule. Because another
   * command may have published the dependency with any configuration, the
   * task counts only where every configuration that its target declares,
   * and none, give the same Cargo settings; otherwise the message of `task`
   * that names the configurations that differ.
   */
  private taskOutsideRun(
    dependency: Crate,
    projectName: string,
    project: {
      root: string;
      targets?: Record<string, { configurations?: Record<string, unknown> }>;
    },
    task: Prepared,
  ): { task: Task } | { failure: string } {
    const variant = (configuration: string | undefined): Task =>
      withProjectRoot(
        {
          id: `${projectName}:${releasePublishTarget}${configuration === undefined ? "" : `:${configuration}`}`,
          target: {
            project: projectName,
            target: releasePublishTarget,
            ...(configuration === undefined ? {} : { configuration }),
          },
          overrides: {},
          outputs: [],
          cache: false,
          parallelism: true,
        },
        project.root,
      );
    const graph = this.run.context.projectGraph;
    const fail = (reason: string) => ({
      failure: `${task.label}: ${task.crate.name} depends on ${dependency.name}, which ${projectName}:${releasePublishTarget} publishes outside this run, and ${reason}. So @convesoft/nx-rust cannot establish where ${dependency.name} goes, and nothing was uploaded for ${task.crate.name}.`,
    });
    if (graph === undefined) {
      return fail("Nx gave the task no project graph to tell that task's configuration");
    }
    const dependentTarget =
      this.run.context.projectsConfigurations?.projects?.[task.task.target.project]?.targets?.[
        releasePublishTarget
      ];
    const own = task.task.target.configuration;
    // A configuration that the dependent's target took as its own default
    // may not have been passed by the command.
    const passed =
      own !== undefined && own !== dependentTarget?.defaultConfiguration ? own : undefined;
    let configuration: string | undefined;
    try {
      configuration = nxTaskConfiguration(
        this.root,
        graph,
        projectName,
        releasePublishTarget,
        passed,
      );
    } catch (error) {
      if (!(error instanceof TaskEnvironmentError)) {
        throw error;
      }
      return fail(`it cannot tell that task's configuration (${error.message})`);
    }
    const resolved = variant(configuration);
    const declared = Object.keys(project.targets?.[releasePublishTarget]?.configurations ?? {});
    const differing = [undefined, ...declared]
      .filter((other) => other !== configuration)
      .map(variant)
      .filter((other) => this.sameDotenvSettings(resolved, other) !== true);
    if (differing.length > 0) {
      return {
        failure: [
          `${task.label}: ${task.crate.name} depends on ${dependency.name}, which ${projectName}:${releasePublishTarget} publishes outside this run, and the configurations of that target give different Cargo settings, so @convesoft/nx-rust cannot tell with which of them ${dependency.name} was published, cannot establish where it went, and nothing was uploaded for ${task.crate.name}:`,
          ...differing.map((other) => `  ${this.dotenvComparison(resolved, other)}.`),
          `  Give every configuration of ${projectName}:${releasePublishTarget} the same Cargo settings, such as in the environment of the command or in .cargo/config.toml rather than in a dotenv file of one configuration, or publish ${dependency.name} and ${task.crate.name} in one nx release publish with batches.`,
        ].join("\n"),
      };
    }
    return { task: resolved };
  }

  /**
   * Whether the dotenv files that Nx loads for two tasks give the same Cargo
   * settings ({@link dotenvSettings}); `undefined` where they cannot be read.
   */
  private sameDotenvSettings(a: Task, b: Task): boolean | undefined {
    const first = this.dotenvOf(a);
    const second = this.dotenvOf(b);
    if ("failure" in first || "failure" in second) {
      return undefined;
    }
    return dotenvDifferences(dotenvSettings(first), dotenvSettings(second)).length === 0;
  }

  /** How the Cargo settings of the dotenv files of two tasks differ, as a clause. */
  private dotenvComparison(a: Task, b: Task): string {
    const first = this.dotenvOf(a);
    const second = this.dotenvOf(b);
    if ("failure" in first || "failure" in second) {
      return `@convesoft/nx-rust cannot read their dotenv files to compare their Cargo settings (${"failure" in first ? first.failure : (second as { failure: string }).failure})`;
    }
    const names = dotenvDifferences(dotenvSettings(first), dotenvSettings(second));
    return `the dotenv files that Nx loads for ${configuredLabel(a)} and ${configuredLabel(b)} give different values to ${sentenceAnd(names)}${this.dotenvFiles(a, b, names)}`;
  }

  /** Where the dotenv files of two tasks define `names`, as a parenthesis. */
  private dotenvFiles(a: Task, b: Task, names: readonly string[]): string {
    const files = [a, b].flatMap((task) => {
      const origin = this.dotenvOrigins(task);
      return names.flatMap((name) => {
        const file = origin.get(name);
        return file === undefined ? [] : [file];
      });
    });
    const unique = [...new Set(files)];
    return unique.length === 0 ? "" : ` (${unique.join(", ")})`;
  }

  /** The values that the dotenv files of `task` define, before expansion, or why they cannot be read. */
  private dotenvOf(task: Task): Record<string, string> | { failure: string } {
    let dotenv = this.dotenvs.get(task.id);
    if (dotenv === undefined) {
      const graph = this.run.context.projectGraph;
      if (graph === undefined) {
        dotenv = { failure: "Nx gave the task no project graph" };
      } else {
        try {
          dotenv = readTaskDotenv(task, graph, this.root).raw;
        } catch (error) {
          if (!(error instanceof TaskEnvironmentError)) {
            throw error;
          }
          dotenv = { failure: error.message };
        }
      }
      this.dotenvs.set(task.id, dotenv);
    }
    return dotenv;
  }

  /** The value that the dotenv files of `task` give `name`, before expansion. */
  private dotenvValue(task: Task, name: string): string | undefined {
    const dotenv = this.dotenvOf(task);
    return "failure" in dotenv ? undefined : dotenv[name];
  }

  /** The file that gives each variable of the dotenv files of `task`, relative to the repository root. */
  private dotenvOrigins(task: Task): Map<string, string> {
    const graph = this.run.context.projectGraph;
    if (graph === undefined) {
      return new Map();
    }
    try {
      return readTaskDotenv(task, graph, this.root).origin;
    } catch (error) {
      if (!(error instanceof TaskEnvironmentError)) {
        throw error;
      }
      return new Map();
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
    for (const link of links) {
      const unpublished = unpublishedMessage(
        task,
        link,
        this.relativePath(link.dependency.manifest),
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
      const elsewhere = this.publishedElsewhere(task, link, established, established.own);
      if (elsewhere !== undefined) {
        return { kind: "failed", lines: [elsewhere] };
      }
      if (inCall.has(dependency.folder)) {
        continue;
      }
      const lookup = await this.lookup(dependency, target.registry, established.own, task.label);
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
    established: { target: Registry; source: string },
    own: Runner,
  ): string | undefined {
    const { dependency, points } = link;
    const { target } = established;
    const sameWorkspace = dependency.workspaceRoot === task.crate.workspaceRoot;
    // Cargo's settings, apart from the choice of the target registry, in
    // which the two environments differ.
    const differing = settingDifferences(task.env, own.env, ["CARGO_REGISTRY_DEFAULT"]);
    if (points.kind === "crates-io" && target.kind === "crates-io") {
      return undefined;
    }
    let reason: string;
    if (points.kind === "named" && target.kind === "named") {
      if (sameWorkspace && points.name === target.name && differing.length === 0) {
        return undefined;
      }
      const variable = indexVariable(target.name);
      const index = own.env[variable];
      if (index !== undefined && sameIndex(index, points.index)) {
        return undefined;
      }
      const where = own.envKey === task.envKey ? "" : `in the environment of ${own.label}, `;
      reason = !sameWorkspace
        ? `the two crates lie in different Cargo workspaces, whose configuration files can give one name different indexes, and ${where}${variable} ${index === undefined ? "is not set" : `gives ${index}`} where the entry's index is ${points.index}`
        : points.name === target.name
          ? `${task.label} and ${own.label} run with different Cargo settings, ${sentenceAnd(differing)}, with which one name can stand for different indexes, and ${where}${variable} ${index === undefined ? "is not set" : `gives ${index}`} where the entry's index is ${points.index}`
          : `the entry names \`${points.name}\`, not \`${target.name}\`, and ${where}${variable} does not give \`${target.name}\` the index that \`${points.name}\` has (${points.index})`;
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
    if (own.envKey !== task.envKey) {
      remedies.push(
        "give the crates of one release the same Cargo settings, such as in the environment of the command or in .cargo/config.toml, rather than in a dotenv file of one crate",
      );
    }
    return [
      `${task.label}: ${task.crate.name} depends on ${dependency.name} through the entry in ${link.entryManifest}, which points to ${pointsLabel}, while ${dependency.name} is published to ${registryLabel(target)}, ${established.source}, and @convesoft/nx-rust cannot establish that these are one registry: ${reason}. Nothing was uploaded for ${task.crate.name}: cargo would publish it with a dependency on the crate of that name in ${pointsLabel}.`,
      `  To publish it, ${sentence(remedies)}.`,
    ].join("\n");
  }

  /**
   * The target registry of `crate` for commands with `task`'s environment
   * (`DES-RELEASE`, "Target registry"): the name in `CARGO_REGISTRY_DEFAULT`,
   * without a probe, where it holds one; otherwise what the probe shows, as
   * the crate's `publish` list allows it.
   */
  private targetOf(crate: Crate, task: Runner): Promise<Target> {
    const key = [crate.folder, task.envKey].join("\u0000");
    let target = this.targets.get(key);
    if (target === undefined) {
      target = this.findTarget(crate, task);
      this.targets.set(key, target);
    }
    return target;
  }

  private async findTarget(crate: Crate, task: Runner): Promise<Target> {
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
      const file = this.dotenvOrigins(task.task).get("CARGO_REGISTRY_DEFAULT");
      const fromFile =
        file !== undefined && this.dotenvValue(task.task, "CARGO_REGISTRY_DEFAULT") === named;
      return {
        kind: "registry",
        registry: registryNamed(named),
        source: `which CARGO_REGISTRY_DEFAULT chooses in the environment of ${task.label}${fromFile ? `, set by ${file}` : ""}`,
      };
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

  private async probe(crate: Crate, task: Runner): Promise<Target> {
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
      return {
        kind: "registry",
        registry,
        source:
          list !== null && list.length === 1
            ? `which the publish list of ${crate.name} in ${this.relativePath(crate.manifest)} chooses`
            : `which cargo chooses for it in the folder ${this.relativePath(cwd)}, by registry.default in its Cargo configuration${list === null ? "" : ` from the publish list of ${crate.name}`}`,
      };
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
  private async lookup(
    crate: Crate,
    registry: Registry,
    task: Runner,
    label = task.label,
  ): Promise<Lookup> {
    const key = lookupKey(crate, registry, task.envKey);
    if (this.found.has(key)) {
      return { kind: "found" };
    }
    await this.run.announce?.(label, {
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
   * requirement on crates of the repository, those with `publish = false`
   * included, with where each entry points (`DES-RELEASE`, "Where a
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
        return this.crateOf(pkg, realPath(report.workspace_root), report);
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
    return this.crateOf(pkg, realPath(report.workspace_root), report);
  }

  /** The crate `pkg` of the workspace whose root and report these are. */
  private crateOf(pkg: CargoPackage, workspaceRoot: string, report: CargoMetadata): Crate {
    const folder = realPath(dirname(pkg.manifest_path));
    const project = this.projects.get(folder);
    if (!this.hackCrates.has(workspaceRoot)) {
      const members = new Set(report.workspace_members);
      this.hackCrates.set(
        workspaceRoot,
        hackCrateName(
          report.workspace_root,
          report.packages.filter((member) => members.has(member.id)).map((member) => member.name),
        ),
      );
    }
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
      hack: this.hackCrates.get(workspaceRoot) === pkg.name,
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

/** `task` with its project's root, which Nx's dotenv files of a task need. */
function withProjectRoot(task: Task, root: string | undefined): Task {
  return task.projectRoot === undefined && root !== undefined
    ? { ...task, projectRoot: root }
    : task;
}

/** Each line of a message indented by two spaces. */
function indented(message: string): string {
  return message
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/** "a, b and c". */
function sentenceAnd(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `<project>:<target>`, with `:<configuration>` where the task has one. */
function configuredLabel(task: Task): string {
  const { configuration } = task.target;
  return configuration === undefined ? labelOf(task) : `${labelOf(task)}:${configuration}`;
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
  const head = `${task.label}: ${task.crate.name} needs ${dependency.name} ${dependency.version}, which is not in ${registryLabel(registry)} yet${failed === undefined ? "" : `, because ${failed.label} failed in this run`}, so @convesoft/nx-rust does not publish ${task.crate.name}, and nothing was uploaded for it: cargo would publish it against an older version of ${dependency.name} that its requirement accepts.`;
  if (dependency.hack) {
    return `${head} ${dependency.name} is the hack crate of cargo-hakari, which @convesoft/nx-rust never publishes: publish its stub ${dependency.name} ${dependency.version} to ${registryLabel(registry)} once yourself, as ${hakariPublishing} describes, and run nx release publish again.`;
  }
  return `${head} Publish ${dependency.name} first: in the same nx release publish, which publishes a dependency's Cargo workspace and release group first, or by running ${dependency.project === undefined ? `the publishing of ${dependency.name}` : `${dependency.project}:${releasePublishTarget}`} before this task.`;
}

/** cargo-hakari's guide to publishing crates that depend on the hack crate. */
const hakariPublishing = "https://docs.rs/cargo-hakari/latest/cargo_hakari/publishing";

/**
 * The check _Unpublished dependencies_ (`DES-RELEASE`): a dependency that is
 * not published to the registry that its entry points to, through
 * `publish = false` or a `publish` list that does not hold that registry by
 * the entry's own name, `crates-io` for crates.io, fails the crate, because
 * cargo packages the dependency for that registry whatever its `publish`
 * says (`EVD-CARGO-PUBLISH`). Where the entry points to a registry whose
 * name the executor did not find, a `publish` list cannot be compared with
 * it, and the crate fails as well. For a hack crate, the message adds
 * cargo-hakari's two ways (**Hack crate**).
 *
 * @param manifest The dependency's manifest, relative to the repository root.
 * @returns The failure message, or `undefined` where the check passes.
 */
// @mara implements DES-RELEASE
export function unpublishedMessage(
  task: { label: string; crate: { name: string } },
  link: DependencyLink,
  manifest: string,
): string | undefined {
  const { dependency, points } = link;
  const list = dependency.publish;
  if (list === null) {
    return undefined;
  }
  const crate = task.crate.name;
  if (points.kind === "named" && points.name === "") {
    return [
      `${task.label}: ${crate} depends on ${dependency.name} through the entry in ${link.entryManifest}, which points to the registry with the index ${points.index}, and @convesoft/nx-rust finds no \`registry\` key in that entry, so it cannot establish whether the publish list of ${dependency.name} in ${manifest}, ${JSON.stringify(list)}, holds that registry. Nothing was uploaded for ${crate}.`,
      `  To publish it, name the registry in that entry with \`registry = "<name>"\`, by a name that the publish list of ${dependency.name} holds.`,
    ].join("\n");
  }
  const name = points.kind === "crates-io" ? "crates-io" : points.name;
  if (list.includes(name)) {
    return undefined;
  }
  const pointsLabel = points.kind === "crates-io" ? "crates.io" : `the registry \`${points.name}\``;
  const why =
    list.length === 0
      ? `${manifest} sets \`publish = false\``
      : `its publish list in ${manifest}, ${JSON.stringify(list)}, does not hold \`${name}\``;
  const remedies = [
    list.length === 0
      ? `publish ${dependency.name} to ${pointsLabel} as well, by removing \`publish = false\` from its manifest`
      : `publish ${dependency.name} to ${pointsLabel} as well, by adding "${name}" to its publish list`,
    ...(list.length === 0
      ? []
      : [
          `name in that entry, with its \`registry\` key, a registry that the publish list of ${dependency.name} holds, ${sentenceOr(list.map((entry) => `\`${entry}\``))}`,
        ]),
    `make ${dependency.name} no normal or build dependency of ${crate}`,
  ];
  return [
    `${task.label}: ${crate} depends on ${dependency.name} through the entry in ${link.entryManifest}, which points to ${pointsLabel}, and ${dependency.name} is not published there: ${why}. Nothing was uploaded for ${crate}: cargo would package it for ${pointsLabel} with a dependency on ${dependency.name}, which fails to resolve there or resolves to an unrelated crate of that name.`,
    `  To publish it, ${sentenceWith(remedies, "or")}.`,
    ...(dependency.hack
      ? [
          `  ${dependency.name} is the hack crate of cargo-hakari, which @convesoft/nx-rust never publishes. cargo-hakari offers two ways: publish a stub of the hack crate once under a name of your own and without \`publish = false\`, after which ${crate} publishes normally; or publish ${crate} with \`cargo hakari publish -p ${crate}\` outside Nx, which takes the dependency out for the upload. See ${hakariPublishing}.`,
        ]
      : []),
  ].join("\n");
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

/** "a; b; and c" as the end of a sentence. */
function sentence(items: readonly string[]): string {
  return sentenceWith(items, "and");
}

/** "a; b; <word> c" as the end of a sentence. */
function sentenceWith(items: readonly string[], word: "and" | "or"): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join("; ")}; ${word} ${items[items.length - 1]}`;
}

/** "a, b or c". */
function sentenceOr(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
