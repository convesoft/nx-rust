import type { ExecutorContext } from "@nx/devkit";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { hostTriple } from "../cargo/host-triple";
import type { CargoPackage } from "../cargo/metadata";
import { pickedTriples, pickText } from "../cargo/target-triples";
import { loadNxNative, type MatchGlobPaths } from "../compatibility/nx-bridge";
import { cargoMetadataOf } from "../graph/collisions";
import { targetCargoMetadataKey } from "../graph/targets";
import {
  type AffectedReport,
  affectedStatusArguments,
  collectionsProblem,
  type CrateSelection,
  diffRelativeVariables,
  gitChangedFiles,
  gitIgnored,
  readAffectedReport,
  selectionFiltersets,
  usableCollections,
  type WideningMember,
  widenSelection,
} from "./affected";
import { type InputPlacement, inputPlacement } from "./affected-inputs";
import {
  type BaselineContext,
  cargoContext,
  contextDifferences,
  contextRuntimeCommands,
  contextVariables,
  environmentContext,
  readContextRecord,
  runtimeContext,
} from "./baseline-context";
import { type CargoInvocation, cargoEnvironment, printCommand } from "./cargo-invocation";
import { describeList } from "./cargo-output";
import { NxTaskFilesError } from "./nx-task-files";
import type { PreparedTask } from "./task";
import { hashedModeProblem, recordSubset, type TestMode, testModeText } from "./test-mode";

/** A task of an affected group, as steps 1 and 2 need it. */
export interface AffectedMember {
  prepared: PreparedTask;
  /** The task's executor context, with the project graph and Nx's configuration. */
  context: ExecutorContext;
}

/** What steps 1 and 2 of `DES-TEST-RUN` decided for a group. */
export type AffectedOutcome =
  /** The group runs its full suite, for the reason given. */
  | { kind: "full"; reason: string }
  /**
   * The group runs its selection: the `-E` arguments, none where no test is
   * selected, and what each crate runs.
   */
  | { kind: "selection"; filtersets: string[]; crates: Map<string, CrateSelection> };

/**
 * Steps 1 and 2 of `DES-TEST-RUN` for a nextest group in affected mode
 * (`REQ-AFFECTED-TESTS`, `REQ-SELECTION-SAFETY`): checks that the task's key
 * holds the test mode that the executor reads (`DES-TEST-MODE`), compares
 * the baseline's context record with the group's
 * (`ADR-AFFECTED-BASELINE-CONTEXT`), asks cargo-affected for the selection
 * with git's `diff.relative`, checks the changed files against git's, and
 * widens the selection by the tasks' inputs. Every doubt gives the full suite
 * with the reason. Before it returns a selection, it records in the
 * command's record that the workspace runs a subset in this mode.
 *
 * @param runArgs The arguments of the group's `cargo nextest run`.
 */
// @mara implements DES-TEST-RUN
// @mara implements DES-TEST-MODE
// @mara implements REQ-AFFECTED-TESTS
// @mara implements REQ-SELECTION-SAFETY
export async function affectedSelection(
  members: readonly AffectedMember[],
  workspaceMembers: readonly CargoPackage[],
  runArgs: readonly string[],
  verbose: boolean,
): Promise<AffectedOutcome> {
  const [first] = members;
  const mode = first?.prepared.testMode?.mode;
  if (first === undefined || mode?.kind !== "affected") {
    return { kind: "full", reason: "the group is not in affected mode" };
  }
  const { cwd, env, workspaceRoot } = first.prepared;
  const root = first.context.root;
  const text = testModeText(mode);
  const hashed = hashedModeProblem(env, root, workspaceRoot, text);
  if (hashed !== undefined) {
    return { kind: "full", reason: hashed };
  }
  // The name of the test target, which the plugin's options can change
  // (`targetNames`); every task of the group runs it.
  const testTarget = first.context.targetName ?? "test";
  const graph = first.context.projectGraph;
  if (graph === undefined) {
    return { kind: "full", reason: "Nx gave the executor no project graph" };
  }
  // The projects of the group's crates and of every member with a binary.
  const projects = projectsOfMembers(first.context, workspaceMembers, first.prepared.workspaceRoot);
  const groupProjects = members.map((member) => member.context.projectName ?? "");
  const binaryProjects = workspaceMembers
    .filter((pkg) => pkg.targets.some((target) => target.kind.includes("bin")))
    .flatMap((pkg) => {
      const project = projects.get(pkg.name);
      return project === undefined ? [] : [project];
    });
  let placement: InputPlacement;
  try {
    placement = await inputPlacement(
      root,
      graph,
      first.context.nxJsonConfiguration,
      [...new Set([...groupProjects, ...binaryProjects])],
      testTarget,
    );
  } catch (error) {
    if (error instanceof NxTaskFilesError) {
      return {
        kind: "full",
        reason: `@convesoft/nx-rust cannot read the test inputs from the installed Nx (${error.message})`,
      };
    }
    throw error;
  }
  const context = contextProblem(first.prepared, members, placement, mode, root);
  if ("problem" in context) {
    return { kind: "full", reason: context.problem };
  }
  const status = await runStatus(first.prepared, runArgs, verbose, members);
  if ("problem" in status) {
    return { kind: "full", reason: status.problem };
  }
  const { report } = status;
  const moved = collectionsProblem(report, mode.commits);
  if (moved !== undefined) {
    return { kind: "full", reason: moved };
  }
  // The record again: a collection of the same commit in another context,
  // which ran whole between the first read and the report, changes neither
  // the commits nor the report's collections, only the record
  // (`DES-BASELINE`, "Collection and the test runs").
  const again = readContextRecord(first.prepared.cwd);
  if (!("context" in again) || !isDeepStrictEqual(again.context, context.record)) {
    return {
      kind: "full",
      reason:
        "the record of the baseline's context changed while the task ran, as a collection that ran meanwhile changes it",
    };
  }
  const changed = gitChangedFiles(cwd, root, usableCollections(report), env);
  if ("problem" in changed) {
    return { kind: "full", reason: `git cannot name the changed files: ${changed.problem}` };
  }
  const inputFiles = new Set<string>();
  for (const project of groupProjects) {
    for (const file of placement.inputs.get(project)?.files ?? []) {
      inputFiles.add(file);
    }
  }
  // Each input by its path from the top of the git repository; one outside
  // it is one whose changes git cannot see.
  const fromTop = [...inputFiles].map((file) =>
    relative(changed.top, join(root, file)).split(sep).join("/"),
  );
  const outside = [...inputFiles].filter((_, index) => fromTop[index].startsWith("../"));
  if (outside.length > 0) {
    return {
      kind: "full",
      reason: `${describeList(outside.slice(0, 3))}, an input of the group's tests, lies outside the git repository in ${changed.top}, so git cannot say whether it changed`,
    };
  }
  const ignored = gitIgnored(changed.top, fromTop, env);
  if ("problem" in ignored) {
    return { kind: "full", reason: `git cannot say which inputs it ignores: ${ignored.problem}` };
  }
  if (ignored.length > 0) {
    return {
      kind: "full",
      reason: `git ignores ${describeList(ignored.slice(0, 3))}, an input of the group's tests, so it cannot say whether that changed`,
    };
  }
  const missing = unreportedFiles(report, changed.files, workspaceRoot);
  if (missing.length > 0) {
    return {
      kind: "full",
      reason: `git names the changed ${missing.length === 1 ? "file" : "files"} ${describeList(missing.slice(0, 3))}, which cargo-affected's report does not list`,
    };
  }
  const folder = workspaceRoot === "." ? "" : workspaceRoot.split(sep).join("/");
  const toProject = new Map([...projects].map(([name, project]) => [project, name]));
  const declaredPatterns = declaredFilesets(first.context, workspaceMembers, projects, testTarget);
  const widened = widenSelection(report, changed.files, {
    workspaceFolder: folder,
    members: workspaceMembers.map((pkg) => wideningMember(pkg, root)),
    crates: members.map((member) => ({
      name: member.prepared.crate ?? "",
      optedOut: member.prepared.options.affectedTests === false,
    })),
    owners(path) {
      const owners = placement.owners(path);
      return owners?.flatMap((project) => {
        const name = toProject.get(project);
        return name === undefined ? [] : [name];
      });
    },
    holdsFileBelow(crate, below) {
      const project = projects.get(crate);
      const files = project === undefined ? undefined : placement.inputs.get(project)?.files;
      // Every crate's test holds every member's manifest (`DES-INPUTS`),
      // which reaches no program; any other file below the folder counts.
      return [...(files ?? [])].some(
        (file) => file.startsWith(`${below}/`) && file !== `${below}/Cargo.toml`,
      );
    },
    declared: (path) => declaredPatterns(path),
  });
  if (widened.kind === "full") {
    return widened;
  }
  if (!recordSubset(env, root, workspaceRoot, text)) {
    return {
      kind: "full",
      reason:
        "the command's record of the test mode cannot be written, so a later hash of this command could not see that a subset ran",
    };
  }
  return {
    kind: "selection",
    filtersets: selectionFiltersets(widened.crates),
    crates: widened.crates,
  };
}

/** The project of each member, by package name, among the projects of the run's configuration. */
function projectsOfMembers(
  context: ExecutorContext,
  members: readonly CargoPackage[],
  workspaceRoot: string,
): Map<string, string> {
  const names = new Set(members.map((pkg) => pkg.name));
  const projects = new Map<string, string>();
  for (const [name, project] of Object.entries(context.projectsConfigurations?.projects ?? {})) {
    const cargo = cargoMetadataOf(project);
    if (
      cargo?.packageName !== undefined &&
      names.has(cargo.packageName) &&
      dirname(cargo.workspaceManifest) === workspaceRoot
    ) {
      projects.set(cargo.packageName, name);
    }
  }
  return projects;
}

// A member as step 2 needs it, with paths relative to the repository root.
function wideningMember(pkg: CargoPackage, root: string): WideningMember {
  const folder = relative(root, dirname(pkg.manifest_path)).split(sep).join("/");
  const names = new Set<string>();
  const buildScript = pkg.targets
    .filter((target) => target.kind.includes("custom-build"))
    .flatMap((target) => {
      const source = (target as { src_path?: unknown }).src_path;
      if (typeof source !== "string") {
        return [];
      }
      const file = relative(root, source).split(sep).join("/");
      const holder = file.slice(0, file.lastIndexOf("/"));
      return holder === folder ? [file] : [file, holder];
    });
  for (const dependency of pkg.dependencies ?? []) {
    if (typeof dependency.path === "string") {
      names.add(dependency.name);
    }
  }
  return {
    name: pkg.name,
    folder,
    procMacro: pkg.targets.some((target) => target.kind.includes("proc-macro")),
    buildScript,
    hasBinary: pkg.targets.some((target) => target.kind.includes("bin")),
    dependsOn: [...names],
  };
}

/**
 * Whether a path matches a `fileInputs` pattern of a crate of the workspace,
 * from the filesets that graph creation recorded in each crate's `test`
 * metadata (`declaredFiles`), with Nx's native matcher.
 */
function declaredFilesets(
  context: ExecutorContext,
  members: readonly CargoPackage[],
  projects: ReadonlyMap<string, string>,
  testTarget: string,
): (path: string) => boolean {
  const patterns = new Set<string>();
  for (const pkg of members) {
    const project = projects.get(pkg.name);
    const metadata =
      project === undefined
        ? undefined
        : (context.projectsConfigurations?.projects?.[project]?.targets?.[testTarget]?.metadata?.[
            targetCargoMetadataKey
          ] as { declaredFiles?: unknown } | undefined);
    for (const pattern of Array.isArray(metadata?.declaredFiles) ? metadata.declaredFiles : []) {
      if (typeof pattern === "string") {
        patterns.add(pattern.replace(/^\{workspaceRoot\}\/?/, ""));
      }
    }
  }
  if (patterns.size === 0) {
    return () => false;
  }
  const match = nativeMatch(context.root);
  return (path) => (match === undefined ? true : match([...patterns], [path])[0] === true);
}

function nativeMatch(root: string): MatchGlobPaths | undefined {
  try {
    return loadNxNative(root).matchGlobPaths;
  } catch {
    return undefined;
  }
}

/**
 * Why the baseline's context does not fit the group's
 * (`ADR-AFFECTED-BASELINE-CONTEXT`): no record, or the options and variables
 * that differ; the record where it fits.
 */
function contextProblem(
  prepared: PreparedTask,
  members: readonly AffectedMember[],
  placement: InputPlacement,
  mode: Extract<TestMode, { kind: "affected" }>,
  repositoryRoot: string,
): { problem: string } | { record: BaselineContext } {
  const record = readContextRecord(prepared.cwd);
  if ("problem" in record) {
    return record;
  }
  const names = new Set<string>();
  const commands = new Set<string>();
  for (const member of members) {
    const inputs = placement.inputs.get(member.context.projectName ?? "");
    for (const name of inputs?.environment ?? []) {
      names.add(name);
    }
    for (const command of inputs?.runtime ?? []) {
      commands.add(command);
    }
  }
  // The runtime inputs again, as Nx ran them when it hashed: what git cannot
  // show has to equal the collection's (`ADR-AFFECTED-BASELINE-CONTEXT`).
  const runtime = runtimeContext(contextRuntimeCommands(commands), repositoryRoot, prepared.env);
  if ("problem" in runtime) {
    return { problem: runtime.problem };
  }
  const current: BaselineContext = {
    version: 2,
    cargo: cargoContext(prepared.options),
    triple: contextTriple(prepared.cwd, prepared.env),
    env: environmentContext(contextVariables(names, prepared.env), prepared.env),
    runtime: runtime.runtime,
  };
  const differences = contextDifferences(record.context, current);
  return differences.length === 0
    ? { record: record.context }
    : {
        problem: `the baseline ${mode.commits.join(",")} was collected in another context: ${describeList(differences)} ${differences.length === 1 ? "differs" : "differ"}`,
      };
}

/**
 * The target triple that cargo builds for in the workspace root with `env`,
 * as a context record names it: `host <triple>` where neither Cargo's
 * configuration nor `CARGO_BUILD_TARGET` picks one, else the pick as
 * {@link pickText} gives it.
 */
export function contextTriple(workspaceRoot: string, env: NodeJS.ProcessEnv): string {
  const picked = pickedTriples(workspaceRoot, env);
  return picked.kind === "none"
    ? `host ${hostTriple(workspaceRoot, env) ?? "unknown"}`
    : pickText(picked);
}

/**
 * Runs `cargo affected status` for the group (`DES-TEST-RUN`, step 1) in the
 * workspace root, with the group's environment and git's `diff.relative`, and
 * reads its report from a folder of its own under the system's temporary
 * folder, which is removed afterwards.
 */
async function runStatus(
  prepared: PreparedTask,
  runArgs: readonly string[],
  verbose: boolean,
  members: readonly AffectedMember[],
): Promise<{ report: AffectedReport } | { problem: string }> {
  const folder = mkdtempSync(join(tmpdir(), "nx-rust-affected-"));
  const file = join(folder, "report.json");
  const invocation: CargoInvocation = {
    args: affectedStatusArguments(runArgs, file),
    cwd: prepared.cwd,
    env: diffRelativeVariables(prepared.env),
  };
  try {
    if (verbose) {
      await printCommand(members.map((member) => member.prepared.task).join(", "), invocation);
    }
    const run = await new Promise<{
      code: number | null;
      signal: string | null;
      failure?: string;
      stderr: string;
    }>((resolve) => {
      const child = spawn("cargo", invocation.args, {
        cwd: invocation.cwd,
        env: cargoEnvironment(invocation, prepared.env),
        stdio: ["ignore", "ignore", "pipe"],
      });
      const stderr: Buffer[] = [];
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
      const forward = (signal: NodeJS.Signals) => child.kill(signal);
      for (const signal of signals) {
        process.on(signal, forward);
      }
      const finish = (result: { code: number | null; signal: string | null; failure?: string }) => {
        for (const signal of signals) {
          process.off(signal, forward);
        }
        resolve({ ...result, stderr: Buffer.concat(stderr).toString("utf8") });
      };
      child.on("error", (error) => finish({ code: null, signal: null, failure: error.message }));
      child.on("close", (code, signal) => finish({ code, signal }));
    });
    let text: string | undefined;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      text = undefined;
    }
    return readAffectedReport(run, text, run.stderr);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * The changed files inside the workspace folder that cargo-affected's report
 * does not list, by their paths relative to the workspace root, apart from
 * `.profraw` files, which cargo-affected leaves out (`DES-TEST-RUN`, step 1):
 * a mismatch of paths fails safe.
 */
export function unreportedFiles(
  report: AffectedReport,
  changed: readonly string[],
  workspaceRoot: string,
): string[] {
  const folder =
    workspaceRoot === "." || workspaceRoot === "" ? "" : `${workspaceRoot.split(sep).join("/")}/`;
  const listed = new Set(report.changedFiles.map((file) => file.path));
  return changed
    .filter((path) => folder === "" || path.startsWith(folder))
    .map((path) => path.slice(folder.length))
    .filter((path) => !path.endsWith(".profraw") && !listed.has(path));
}
