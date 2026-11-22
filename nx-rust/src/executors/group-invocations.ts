import {
  type CargoDirectories,
  DirectoryReportError,
  directoryVariableNames,
  directoryVariables,
  reportedDirectories,
} from "../cargo/directories";
import type { CargoPackage } from "../cargo/metadata";
import { memberPackages, PackageSpecReportError } from "../cargo/package-specs";
import { physicalPath, repositoryFolder } from "../graph/real-path";
import type { TargetCargoMetadata } from "../graph/targets";
import { wasmTriple } from "../graph/wasm";
import { describeFolder } from "../tools/optional-tools";
import type { CargoInvocation } from "./cargo-invocation";
import {
  type CargoStep,
  cargoSteps,
  type CrateSelection,
  type SelectingRunner,
  selectsBySpecification,
} from "./command";
import type { GroupSelection } from "./groups";
import type { BuildInputCheck } from "./input-check";
import { runnerCommand } from "./runner-script";
import type { PreparedTask } from "./task";
import { type DigestStep, TaskError } from "./task-guards";

/** The cargo commands of a group, and what each of its tasks does after it. */
export interface GroupInvocation extends CargoInvocation {
  /**
   * The group's cargo commands, one per step of its target, in order
   * ({@link cargoSteps}); `args` is the first one's.
   */
  steps: CargoStep[];
  /**
   * Of a staged command, `args` without the stage's two flags (`DES-BATCH`,
   * "Staged builds"): what names the command's configuration, as for the
   * type folder and `cargo tree` of `napi-build` (`DES-NAPI`).
   */
  unstagedArgs?: string[];
  /**
   * Every member of the workspace, as the group's report of the members
   * gives them, where the group selects the whole workspace: the reading of
   * its output tells crates outside the group by them.
   */
  workspaceMembers?: CargoPackage[];
  /**
   * Every member of the workspace, as the group's report of the members
   * gives them, where the command selects crates by their specifications:
   * where Cargo denies warnings, the reading of a command with JSON messages
   * follows the crates' path dependencies through them (`DES-BATCH`,
   * "Denied warnings").
   */
  members?: CargoPackage[];
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
 * The commands select the crates as `selection` says (`planGroups`):
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
  const members = specs instanceof Map ? [...specs.values()] : undefined;
  const workspaceMembers = workspace ? members : undefined;
  // A group that selects affected tests places changed files among every
  // member (`DES-TEST-RUN`, step 2).
  const affectedMembers = tasks.some((task) => task.testMode?.selects === true)
    ? members
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
      ...(members === undefined ? {} : { members }),
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
