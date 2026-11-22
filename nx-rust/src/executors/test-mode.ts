import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { commandIdVariable, workspaceSegment } from "../graph/lockfile-task";

/** The environment variable that chooses the test mode of a run (`DES-TEST-MODE`). */
export const testModeVariable = "NX_RUST_TEST_MODE";

/**
 * cargo-affected's database in a workspace root, whatever the target
 * directory is (`EVD-CARGO-AFFECTED-REPORT`).
 */
export const baselineDatabase = join("target", "affected", "coverage.db");

/**
 * Whether Nx detects CI in `env`: the rule of `isCI` in Nx 24.0.6
 * (`nx/src/utils/is-ci`), which `nx` uses for its own defaults. The plugin
 * keeps a copy, because the mode command runs in a process of its own,
 * where loading Nx would cost more than the rest of the command; a test
 * compares the copy with the installed Nx's function.
 */
// @mara implements DES-TEST-MODE
export function nxDetectsCI(env: NodeJS.ProcessEnv): boolean {
  if (env.CI === "false") {
    return false;
  }
  return Boolean(
    env.CI ||
    env.TF_BUILD === "true" ||
    env.GITHUB_ACTIONS === "true" ||
    env.BUILDKITE === "true" ||
    env.CIRCLECI === "true" ||
    env.CIRRUS_CI === "true" ||
    env.TRAVIS === "true" ||
    env["bamboo.buildKey"] ||
    env.bamboo_buildKey ||
    env.CODEBUILD_BUILD_ID ||
    env.GITLAB_CI ||
    env.HEROKU_TEST_RUN_ID ||
    env.BUILD_ID ||
    env.BUILD_NUMBER ||
    env.BUILD_BUILDID ||
    env.TEAMCITY_VERSION ||
    env.JENKINS_URL ||
    env.HUDSON_URL,
  );
}

/** The mode that a run asks for, before the baseline counts (steps 1 and 2 of `DES-TEST-MODE`). */
export type AskedTestMode =
  | { kind: "full"; reason: string }
  | { kind: "affected"; reason: string }
  | { kind: "invalid"; value: string };

/**
 * The mode that `env` asks for: `NX_RUST_TEST_MODE` set to `full` or
 * `affected`, and without it `full` where Nx detects CI and `affected`
 * elsewhere. Any other value, the empty one included, is invalid and fails
 * the task.
 */
// @mara implements DES-TEST-MODE
export function askedTestMode(env: NodeJS.ProcessEnv): AskedTestMode {
  const value = env[testModeVariable];
  if (value === undefined) {
    return nxDetectsCI(env)
      ? { kind: "full", reason: `Nx detects CI and ${testModeVariable} is not set` }
      : { kind: "affected", reason: `${testModeVariable} is not set and Nx detects no CI` };
  }
  if (value === "full" || value === "affected") {
    return { kind: value, reason: `${testModeVariable} is "${value}"` };
  }
  return { kind: "invalid", value };
}

/** The commits of a coverage baseline, or why there is none that can be read. */
export type BaselineCommits = { commits: string[] } | { problem: string };

/**
 * A step that a test runs between the reader's first look at the files and
 * its open of the database ({@link baselineCommits}), so that what another
 * process does in between can be checked without timing luck.
 */
export interface BaselineReadSteps {
  beforeOpen?(): void;
}

/**
 * The commits that cargo-affected's database in `workspaceRoot` holds
 * coverage for, of every fingerprint, sorted and without repeats
 * (`DES-TEST-MODE`, step 3). It reads `target/affected/coverage.db` with
 * Node's SQLite and starts no cargo-affected, whose `status` builds the
 * tests (`EVD-CARGO-AFFECTED-COST`).
 *
 * It never opens the database in a way that can write: only as immutable
 * and read-only, which creates no file, since an ordinary read-only
 * connection to a database in WAL mode creates `-wal` and `-shm` files and
 * leaves them behind (`EVD-TEST-MODE-READING`). An immutable read ignores
 * a `-wal` file and takes no lock, so it counts only where the database is
 * whole and settled: a `-wal` file beside it before the read or after it,
 * as while a collection runs or after one was interrupted, or a database
 * file whose size, modification time or inode differs between the two
 * looks, gives a problem and no commits. So do a missing database, a Node
 * without `node:sqlite`, a database of another schema, as after
 * cargo-affected changed it, one that cannot be read, one without coverage,
 * and a commit that is not lower-case hexadecimal.
 *
 * @param workspaceRoot The workspace's root folder, absolute or relative to
 *   the current folder.
 * @param steps For tests: a step between the first look and the open.
 */
// @mara implements DES-TEST-MODE
export function baselineCommits(
  workspaceRoot: string,
  steps: BaselineReadSteps = {},
): BaselineCommits {
  const database = join(workspaceRoot, baselineDatabase);
  const wal = `${database}-wal`;
  const unsettled = `the coverage baseline in ${baselineDatabase} has a -wal file beside it, as while a collection runs or after one was interrupted`;
  const before = fileState(database);
  if (before === undefined) {
    return { problem: `there is no coverage baseline: ${baselineDatabase} does not exist` };
  }
  if (existsSync(wal)) {
    return { problem: unsettled };
  }
  let sqlite: typeof import("node:sqlite");
  try {
    sqlite = require("node:sqlite") as typeof import("node:sqlite");
  } catch {
    return {
      problem: `this Node.js has no node:sqlite, with which @convesoft/nx-rust reads the coverage baseline in ${baselineDatabase}`,
    };
  }
  steps.beforeOpen?.();
  let values: unknown[];
  try {
    const location = pathToFileURL(database);
    location.searchParams.set("immutable", "1");
    const connection = new sqlite.DatabaseSync(location, { readOnly: true });
    try {
      values = connection
        .prepare("SELECT DISTINCT collect_sha FROM test_regions")
        .all()
        .map((row) => (row as Record<string, unknown>).collect_sha);
    } finally {
      connection.close();
    }
  } catch (error) {
    return {
      problem: `the coverage baseline in ${baselineDatabase} could not be read (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (existsSync(wal)) {
    return { problem: unsettled };
  }
  if (fileState(database) !== before) {
    return { problem: `the coverage baseline in ${baselineDatabase} changed while it was read` };
  }
  const commits = [...new Set(values)];
  if (commits.length === 0) {
    return { problem: `the coverage baseline in ${baselineDatabase} holds no coverage` };
  }
  if (!commits.every((commit) => typeof commit === "string" && /^[0-9a-f]+$/.test(commit))) {
    return {
      problem: `the coverage baseline in ${baselineDatabase} names a commit that is no hexadecimal object name`,
    };
  }
  return { commits: (commits as string[]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) };
}

/** The size, modification time and inode of a file, or `undefined` where it is missing. */
function fileState(path: string): string | undefined {
  try {
    const stat = statSync(path);
    return stat.isFile() ? `${stat.size}:${stat.mtimeMs}:${stat.ino}` : undefined;
  } catch {
    return undefined;
  }
}

/** The test mode of a run (`TERM-TEST-MODE`), with why it is that mode. */
export type TestMode =
  | { kind: "full"; reason: string }
  | { kind: "affected"; commits: string[]; reason: string }
  | { kind: "invalid"; value: string };

/**
 * The test mode of a run in the workspace at `workspaceRoot`, by the rule
 * that the mode command and the test executor share (`DES-TEST-MODE`): the
 * mode that `env` asks for, where `affected` stays `affected` only with a
 * baseline whose commits can be read, and becomes `full` otherwise, with
 * the reason.
 */
// @mara implements DES-TEST-MODE
export function testMode(env: NodeJS.ProcessEnv, workspaceRoot: string): TestMode {
  return testModeAt(env, workspaceRoot);
}

function testModeAt(
  env: NodeJS.ProcessEnv,
  workspaceRoot: string,
  steps: BaselineReadSteps = {},
): TestMode {
  const asked = askedTestMode(env);
  if (asked.kind !== "affected") {
    return asked;
  }
  const baseline = baselineCommits(workspaceRoot, steps);
  return "commits" in baseline
    ? { kind: "affected", commits: baseline.commits, reason: asked.reason }
    : { kind: "full", reason: `${asked.reason}, but ${baseline.problem}` };
}

/**
 * What the mode command prints for `mode`, and with it what the key of a
 * `test` task holds: `full`, `affected:<commits>` with the baseline's
 * commits joined by `,`, or for an invalid `NX_RUST_TEST_MODE` a line that
 * names the value, so that a failure that Nx stores with
 * `NX_CACHE_FAILURES=true` is never restored for a valid mode.
 */
// @mara implements DES-TEST-MODE
export function testModeText(mode: TestMode): string {
  switch (mode.kind) {
    case "full":
      return "full";
    case "affected":
      return `affected:${mode.commits.join(",")}`;
    case "invalid":
      return `invalid ${testModeVariable}=${JSON.stringify(mode.value)}`;
  }
}

/**
 * The message of a task that fails before cargo runs because
 * `NX_RUST_TEST_MODE` has another value than `full` or `affected`.
 */
export function invalidTestModeMessage(task: string, value: string): string {
  return `${task}: ${testModeVariable} is ${JSON.stringify(value)}, but it can only be "full", which runs the whole suite, or "affected", which runs the tests that a change can affect. Set it to one of the two, or unset it: a run then selects on a developer's machine and runs the whole suite where Nx detects CI. The task does not run, so that Nx stores no result for it.`;
}

/**
 * The line at the top of a `test` task's output in a workspace that uses
 * selection, which says which suite the task runs and why (`DES-TEST-MODE`,
 * `REQ-AFFECTED-TESTS`).
 *
 * @param optedOut Whether the task's `affectedTests` option is `false`, as a
 *   crate's table or `--affectedTests=false` sets it.
 * @param testTarget The test target that the task's `test` option names,
 *   which it runs in either mode as in mode `full`, also where its
 *   `affectedTests` is `false` (`DES-TEST-RUN`, "One test target").
 */
export function testModeNote(
  task: string,
  mode: TestMode,
  optedOut: boolean,
  testTarget?: string,
): string | undefined {
  if (mode.kind === "invalid") {
    return undefined;
  }
  const text = testModeText(mode);
  if (testTarget !== undefined) {
    return `${task}: runs the test target ${JSON.stringify(testTarget)} that its option test names, as in test mode full, and selects no affected tests; the test mode is ${text}.`;
  }
  if (optedOut) {
    return `${task}: runs the full suite, because its option affectedTests is false; the test mode is ${text}.`;
  }
  if (mode.kind === "full") {
    return `${task}: runs the full suite in test mode full, because ${mode.reason}.`;
  }
  return `${task}: test mode ${text}, because ${mode.reason}.`;
}

/**
 * The folder under the repository root in which the mode command and the
 * test executor keep their record of one `nx` command (`DES-TEST-MODE`,
 * "Between hashing and the run"), one folder per command and workspace.
 * Nx leaves `.nx/workspace-data` out of its file map, and the plugin's
 * `postTasksExecution` hook removes a command's folders when it ends.
 */
export const testModeRecordRoot = ".nx/workspace-data/nx-rust/test-mode";

/** The record's file of the modes that the mode command printed, one line each. */
const printedFile = "printed";

/** The record's file of the modes in which a task of the command ran a subset, one line each. */
const subsetFile = "subsets";

/**
 * The id that the plugin's `preTasksExecution` hook gives the `nx` command
 * whose task has the environment `env`, with only the characters that a
 * folder name keeps; `undefined` without one.
 */
export function commandIdOf(env: NodeJS.ProcessEnv): string | undefined {
  const id = (env[commandIdVariable] ?? "").replace(/[^A-Za-z0-9-]/g, "");
  return id === "" ? undefined : id;
}

/**
 * The folder of the record of the command `commandId` for the workspace at
 * `workspaceRoot` ({@link testModeRecordRoot}).
 *
 * @param workspaceRoot The workspace's root folder, relative to the repository root.
 */
export function testModeRecordFolder(
  repositoryRoot: string,
  workspaceRoot: string,
  commandId: string,
): string {
  return join(
    repositoryRoot,
    testModeRecordRoot,
    commandId,
    workspaceSegment(workspaceRoot === "" ? "." : workspaceRoot),
  );
}

// The lines of a record's file; none where it does not exist.
function recordLines(file: string): string[] | undefined {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line !== "");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : undefined;
  }
}

/** A value that no other evaluation prints, so that no stored result is ever restored under it. */
export function neverRestored(): string {
  return `unrestorable ${randomBytes(16).toString("hex")}`;
}

/**
 * What the mode command prints for a task with the environment `env` in
 * the workspace at `workspaceRoot` (`DES-TEST-MODE`, "Between hashing and the
 * run"): the text of its test mode ({@link testModeText}), with two
 * exceptions that keep a subset's result from being stored under a key that
 * it does not satisfy. Where a task of the same `nx` command has run, or is
 * about to run, a subset in another mode than this text, it prints a value
 * that is never restored ({@link neverRestored}): Nx hashes some tasks again
 * after they ran, and the key of such a task must not say `full` or name
 * another baseline. And where it cannot add what it prints to the command's
 * record, it prints such a value as well, since the executor could then not
 * see it.
 *
 * Without a command id from the plugin's hook, as where Nx hashes outside a
 * run, it prints the text and records nothing.
 *
 * @param workspaceRoot The workspace's root folder, relative to `repositoryRoot`.
 */
// @mara implements DES-TEST-MODE
export function printedTestMode(
  env: NodeJS.ProcessEnv,
  repositoryRoot: string,
  workspaceRoot: string,
  steps: BaselineReadSteps = {},
): string {
  const text = testModeText(testModeAt(env, join(repositoryRoot, workspaceRoot), steps));
  const id = commandIdOf(env);
  if (id === undefined) {
    return text;
  }
  const folder = testModeRecordFolder(repositoryRoot, workspaceRoot, id);
  const subsets = recordLines(join(folder, subsetFile));
  const printed =
    subsets === undefined || subsets.some((subset) => subset !== text) ? neverRestored() : text;
  try {
    mkdirSync(folder, { recursive: true });
    appendFileSync(join(folder, printedFile), `${askedTestMode(env).kind}\t${printed}\n`);
  } catch {
    return neverRestored();
  }
  return printed;
}

/**
 * Why a task in affected mode must not run a subset, because the test mode
 * that Nx hashed for it may differ from the one its executor reads
 * (`DES-TEST-MODE`, "Between hashing and the run"; `RISK-SUBSET-AS-FULL`), or
 * `undefined` where it may. Nx hands an executor neither the task's hash
 * details nor the output of its runtime inputs, so the executor reads what
 * the mode command recorded for the command: every value that it printed in
 * this command for a task of the workspace, whatever mode the task asked
 * for, has to be `text`, the executor's own reading, and at least one has
 * to be there. The task's own evaluation is among them, since Nx hashes a
 * task after the command's `preTasksExecution` hook and before the task
 * runs, and nothing in the record tells it from another task's.
 *
 * @param workspaceRoot The workspace's root folder, relative to `repositoryRoot`.
 * @param text The test mode as the executor reads it, `affected:<commits>`.
 */
// @mara implements DES-TEST-MODE
export function hashedModeProblem(
  env: NodeJS.ProcessEnv,
  repositoryRoot: string,
  workspaceRoot: string,
  text: string,
): string | undefined {
  const id = commandIdOf(env);
  if (id === undefined) {
    return `this run has no command id from the preTasksExecution hook of @convesoft/nx-rust, so the plugin cannot see which test mode Nx put into the task's cache key`;
  }
  const lines = recordLines(
    join(testModeRecordFolder(repositoryRoot, workspaceRoot, id), printedFile),
  );
  if (lines === undefined) {
    return `the record of the test modes that Nx hashed for this nx command cannot be read`;
  }
  // Every evaluation counts, whatever mode its task asked for: Nx runs the
  // command with an environment that names no task, so the record cannot
  // tell this task's evaluation from another's (`EVD-TEST-MODE-GUARD`).
  const hashed = [...new Set(lines.map((line) => line.split("\t")[1] ?? ""))];
  if (hashed.length === 0) {
    return `the mode command recorded no test mode for this nx command, so the plugin cannot see which one Nx put into the task's cache key`;
  }
  const other = hashed.filter((value) => value !== text);
  if (other.length > 0) {
    return `the tasks of this workspace in this nx command were hashed in different test modes: Nx hashed one with ${describeHashed(other)}, while the baseline now gives ${text} to this task, as where the tasks' environments ask for different modes or a collection created or changed the baseline after hashing, and a subset must not be stored under a key that may say otherwise`;
  }
  return undefined;
}

function describeHashed(values: readonly string[]): string {
  return values
    .map((value) => (value.startsWith("unrestorable ") ? "that is never restored" : value))
    .join(" and ");
}

/**
 * Adds `text` to the command's record of the modes in which its tasks run a
 * subset, before the subset runs, so that the mode command prints a value
 * that is never restored wherever Nx hashes a task of the workspace again
 * in this command with another mode ({@link printedTestMode}).
 *
 * @returns Whether the record holds it; where not, the task must run its full suite.
 */
// @mara implements DES-TEST-MODE
export function recordSubset(
  env: NodeJS.ProcessEnv,
  repositoryRoot: string,
  workspaceRoot: string,
  text: string,
): boolean {
  const id = commandIdOf(env);
  if (id === undefined) {
    return false;
  }
  const folder = testModeRecordFolder(repositoryRoot, workspaceRoot, id);
  try {
    mkdirSync(folder, { recursive: true });
    appendFileSync(join(folder, subsetFile), `${text}\n`);
    return true;
  } catch {
    return false;
  }
}
