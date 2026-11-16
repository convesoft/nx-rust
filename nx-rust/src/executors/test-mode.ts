import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
  const asked = askedTestMode(env);
  if (asked.kind !== "affected") {
    return asked;
  }
  const baseline = baselineCommits(workspaceRoot);
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
 */
export function testModeNote(task: string, mode: TestMode, optedOut: boolean): string | undefined {
  if (mode.kind === "invalid") {
    return undefined;
  }
  const text = testModeText(mode);
  if (optedOut) {
    return `${task}: runs the full suite, because its option affectedTests is false; the test mode is ${text}.`;
  }
  if (mode.kind === "full") {
    return `${task}: runs the full suite in test mode full, because ${mode.reason}.`;
  }
  return `${task}: test mode ${text}, because ${mode.reason}. This version of @convesoft/nx-rust does not select affected tests yet, so the full suite runs.`;
}
