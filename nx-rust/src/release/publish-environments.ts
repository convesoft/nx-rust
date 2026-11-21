import type { ExecutorContext, Task } from "@nx/devkit";
import { dirname, join } from "node:path";
import { readTaskDotenv } from "../executors/dotenv-check";
import { nxTaskConfiguration, TaskEnvironmentError } from "../executors/task-env";
import { cargoMetadataOf } from "../graph/collisions";
import { realPath } from "../graph/real-path";
import { releasePublishTarget } from "../graph/targets";
import {
  type Crate,
  crateOf,
  type CrateStore,
  type Other,
  type Prepared,
  reportOf,
  type Runner,
} from "./publish-crates";
import { configuredLabel, labelOf, sentenceAnd } from "./publish-messages";
import { dotenvDifferences, dotenvSettings } from "./publish-settings";

/** Cached dotenv layers per task for one publish run. */
export interface DotenvStore {
  readonly context: ExecutorContext;
  readonly root: string;
  /** The dotenv files of each task, by its id, or why they cannot be read. */
  readonly dotenvs: Map<string, Record<string, string> | { failure: string }>;
}

export function createDotenvStore(context: ExecutorContext): DotenvStore {
  return {
    context,
    root: context.root,
    dotenvs: new Map(),
  };
}

/**
 * The other `nx-release-publish` tasks of the run's task graph, those of
 * crates whose tasks the executor did not receive, as when Nx runs each
 * task on its own (`DES-RELEASE`, "Checks before the first call"). Each
 * gets the environment of a received task whose dotenv files give the
 * same Cargo settings (**A dependency's environment**), or, where none
 * does, the first one's, and says why it is foreign.
 */
export function otherRunTasks(
  dotenvStore: DotenvStore,
  crateStore: CrateStore,
  tasks: readonly Prepared[],
  othersByFolder: Map<string, Other>,
): Other[] {
  const [first] = tasks;
  const received = new Set(tasks.map((task) => task.id));
  const others: Other[] = [];
  if (first === undefined) {
    return others;
  }
  for (const graphTask of Object.values(dotenvStore.context.taskGraph?.tasks ?? {})) {
    if (graphTask.target.target !== releasePublishTarget || received.has(graphTask.id)) {
      continue;
    }
    const project =
      dotenvStore.context.projectsConfigurations?.projects?.[graphTask.target.project];
    const cargo = project === undefined ? undefined : cargoMetadataOf(project);
    if (cargo?.packageName === undefined) {
      continue;
    }
    const task = withProjectRoot(graphTask, project?.root);
    let runner: Prepared = first;
    let foreign: string | undefined;
    const same = tasks.find(
      (candidate) => sameDotenvSettings(dotenvStore, candidate.task, task) === true,
    );
    if (same !== undefined) {
      runner = same;
    } else {
      foreign = dotenvComparison(dotenvStore, first.task, task);
    }
    const workspaceRoot = realPath(join(dotenvStore.root, dirname(cargo.workspaceManifest)));
    const report = reportOf(crateStore, workspaceRoot, runner.env, runner.envKey);
    const folder = realPath(join(dotenvStore.root, dirname(cargo.manifest)));
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
      crate: crateOf(crateStore, pkg, workspaceRoot, report),
      env: runner.env,
      envKey: runner.envKey,
      dryRun: runner.dryRun,
      head: [],
      start: Date.now(),
      ...(foreign === undefined ? {} : { foreign }),
    };
    others.push(other);
    othersByFolder.set(other.crate.folder, other);
  }
  return others;
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
export function ownRunner(
  dotenvStore: DotenvStore,
  byFolder: ReadonlyMap<string, Prepared>,
  othersByFolder: ReadonlyMap<string, Other>,
  dependency: Crate,
  task: Prepared,
): Runner | { failure: string } {
  const own = byFolder.get(dependency.folder) ?? othersByFolder.get(dependency.folder);
  if (own !== undefined && (own as Other).foreign === undefined) {
    return own;
  }
  const project =
    dependency.project === undefined
      ? undefined
      : dotenvStore.context.projectsConfigurations?.projects?.[dependency.project];
  if (dependency.project === undefined || !dependency.hasPublishTarget || project === undefined) {
    return task;
  }
  let dependencyTask: Task;
  if (own !== undefined) {
    // In the run's task graph, as Nx built it, with its configuration.
    dependencyTask = own.task;
  } else {
    const outside = taskOutsideRun(dotenvStore, dependency, dependency.project, project, task);
    if ("failure" in outside) {
      return outside;
    }
    dependencyTask = outside.task;
  }
  if (sameDotenvSettings(dotenvStore, task.task, dependencyTask) === true) {
    return task;
  }
  return {
    failure: `${task.label}: ${task.crate.name} depends on ${dependency.name}, which ${labelOf(dependencyTask)} publishes, and @convesoft/nx-rust cannot rebuild the environment of that task, because ${own === undefined ? "the run does not hand it to this" : "Nx runs it on its own, apart from this"} task, while ${dotenvComparison(dotenvStore, task.task, dependencyTask)}. So it cannot establish where ${dependency.name} goes, and nothing was uploaded for ${task.crate.name}. Publish both in one nx release publish with batches, as it runs by default, or give the crates of one release the same Cargo settings, such as in the environment of the command or in .cargo/config.toml.`,
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
function taskOutsideRun(
  dotenvStore: DotenvStore,
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
  const graph = dotenvStore.context.projectGraph;
  const fail = (reason: string) => ({
    failure: `${task.label}: ${task.crate.name} depends on ${dependency.name}, which ${projectName}:${releasePublishTarget} publishes outside this run, and ${reason}. So @convesoft/nx-rust cannot establish where ${dependency.name} goes, and nothing was uploaded for ${task.crate.name}.`,
  });
  if (graph === undefined) {
    return fail("Nx gave the task no project graph to tell that task's configuration");
  }
  const dependentTarget =
    dotenvStore.context.projectsConfigurations?.projects?.[task.task.target.project]?.targets?.[
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
      dotenvStore.root,
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
    .filter((other) => sameDotenvSettings(dotenvStore, resolved, other) !== true);
  if (differing.length > 0) {
    return {
      failure: [
        `${task.label}: ${task.crate.name} depends on ${dependency.name}, which ${projectName}:${releasePublishTarget} publishes outside this run, and the configurations of that target give different Cargo settings, so @convesoft/nx-rust cannot tell with which of them ${dependency.name} was published, cannot establish where it went, and nothing was uploaded for ${task.crate.name}:`,
        ...differing.map((other) => `  ${dotenvComparison(dotenvStore, resolved, other)}.`),
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
function sameDotenvSettings(store: DotenvStore, a: Task, b: Task): boolean | undefined {
  const first = dotenvOf(store, a);
  const second = dotenvOf(store, b);
  if ("failure" in first || "failure" in second) {
    return undefined;
  }
  return dotenvDifferences(dotenvSettings(first), dotenvSettings(second)).length === 0;
}

/** How the Cargo settings of the dotenv files of two tasks differ, as a clause. */
function dotenvComparison(store: DotenvStore, a: Task, b: Task): string {
  const first = dotenvOf(store, a);
  const second = dotenvOf(store, b);
  if ("failure" in first || "failure" in second) {
    return `@convesoft/nx-rust cannot read their dotenv files to compare their Cargo settings (${"failure" in first ? first.failure : (second as { failure: string }).failure})`;
  }
  const names = dotenvDifferences(dotenvSettings(first), dotenvSettings(second));
  return `the dotenv files that Nx loads for ${configuredLabel(a)} and ${configuredLabel(b)} give different values to ${sentenceAnd(names)}${dotenvFiles(store, a, b, names)}`;
}

/** Where the dotenv files of two tasks define `names`, as a parenthesis. */
function dotenvFiles(store: DotenvStore, a: Task, b: Task, names: readonly string[]): string {
  const files = [a, b].flatMap((task) => {
    const origin = dotenvOrigins(store, task);
    return names.flatMap((name) => {
      const file = origin.get(name);
      return file === undefined ? [] : [file];
    });
  });
  const unique = [...new Set(files)];
  return unique.length === 0 ? "" : ` (${unique.join(", ")})`;
}

/** The values that the dotenv files of `task` define, before expansion, or why they cannot be read. */
function dotenvOf(store: DotenvStore, task: Task): Record<string, string> | { failure: string } {
  let dotenv = store.dotenvs.get(task.id);
  if (dotenv === undefined) {
    const graph = store.context.projectGraph;
    if (graph === undefined) {
      dotenv = { failure: "Nx gave the task no project graph" };
    } else {
      try {
        dotenv = readTaskDotenv(task, graph, store.root).raw;
      } catch (error) {
        if (!(error instanceof TaskEnvironmentError)) {
          throw error;
        }
        dotenv = { failure: error.message };
      }
    }
    store.dotenvs.set(task.id, dotenv);
  }
  return dotenv;
}

/** The value that the dotenv files of `task` give `name`, before expansion. */
export function dotenvValue(store: DotenvStore, task: Task, name: string): string | undefined {
  const dotenv = dotenvOf(store, task);
  return "failure" in dotenv ? undefined : dotenv[name];
}

/** The file that gives each variable of the dotenv files of `task`, relative to the repository root. */
export function dotenvOrigins(store: DotenvStore, task: Task): Map<string, string> {
  const graph = store.context.projectGraph;
  if (graph === undefined) {
    return new Map();
  }
  try {
    return readTaskDotenv(task, graph, store.root).origin;
  } catch (error) {
    if (!(error instanceof TaskEnvironmentError)) {
      throw error;
    }
    return new Map();
  }
}

/** A key of an environment's variables that have a value, in a fixed order. */
export function environmentKey(env: NodeJS.ProcessEnv): string {
  return JSON.stringify(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/** `task` with its project's root, which Nx's dotenv files of a task need. */
export function withProjectRoot(task: Task, root: string | undefined): Task {
  return task.projectRoot === undefined && root !== undefined
    ? { ...task, projectRoot: root }
    : task;
}

/**
 * The executor context of one task, as Nx gives it to the task run on its
 * own: the run's context with the task's project, target and configuration.
 */
export function contextOf(task: Task, context: ExecutorContext): ExecutorContext {
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
export function configuredOptions(context: ExecutorContext): Record<string, unknown> {
  const configuration = context.configurationName;
  return {
    ...context.target?.options,
    ...(configuration ? context.target?.configurations?.[configuration] : undefined),
  };
}
