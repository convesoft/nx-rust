import { HARNESS_TIMEOUT } from "./environment";
import { FileChanges, FixtureName } from "./fixtures";
import { FixtureWorkspace, TaskHash } from "./workspace";

/** What must happen to a task's cache key between two states. */
export type Verdict = "must differ" | "must not differ";

/** A state of a fixture workspace: its files and what Nx sees besides them. */
export interface WorkspaceState {
  /** Changes on top of the fixture, by path relative to the repository root. */
  files?: FileChanges;
  /** Environment variables to set; `undefined` removes one. */
  env?: Record<string, string | undefined>;
  /** Options as `nx run project:target --name=value` passes them. */
  overrides?: Record<string, unknown>;
  /**
   * What to do once the files are in place, such as running cargo or
   * publishing to a registry, with the state's environment.
   */
  prepare?: (workspace: FixtureWorkspace, env: Record<string, string | undefined>) => unknown;
}

/** One row of the cache-key matrix: two states of a fixture and a verdict per task. */
export interface CacheKeyRow {
  /** What changes between the states. It names the test. */
  change: string;
  fixture: FixtureName;
  /** What both states share, on top of the fixture. */
  base?: WorkspaceState;
  /** The first state, on top of the base. Without it, the base itself. */
  before?: WorkspaceState;
  /** The second state, on top of the base. */
  after: WorkspaceState;
  /** The verdict for each task, by task id such as `api:test`. */
  keys: Record<string, Verdict>;
  /**
   * Whether every lockfile task runs, through `nx run-many -t lockfile`,
   * before the tasks are hashed in each state, as it runs before them in a
   * real run. Without it, no digest exists, and a digest input hashes
   * nothing in either state.
   */
  lockfileTask?: boolean;
}

/** The hashes of one task in both states of a row. */
export interface CacheKeyOutcome {
  task: string;
  verdict: Verdict;
  before: TaskHash;
  after: TaskHash;
  /** Whether the hashes behave as the verdict says. */
  holds: boolean;
}

/**
 * Hashes the row's tasks in both states with Nx's own task hasher and
 * compares the hashes with the verdicts. Both states are built in the same
 * folder, from a fresh copy of the fixture each.
 */
export async function compareCacheKeys(row: CacheKeyRow): Promise<CacheKeyOutcome[]> {
  const tasks = Object.keys(row.keys);
  const state = (part: WorkspaceState | undefined) => ({
    env: { ...row.base?.env, ...part?.env },
    overrides: { ...row.base?.overrides, ...part?.overrides },
  });
  const workspace = FixtureWorkspace.create(row.fixture, row.base?.files, row.before?.files);
  const prepared = async (part: WorkspaceState | undefined) => {
    const { env } = state(part);
    await row.base?.prepare?.(workspace, env);
    await part?.prepare?.(workspace, env);
    if (row.lockfileTask) {
      await runLockfileTasks(workspace, env);
    }
    return workspace.hashTasks(tasks, state(part));
  };
  try {
    const before = await prepared(row.before);
    workspace.reset(row.base?.files, row.after.files);
    const after = await prepared(row.after);
    return tasks.map((task) => {
      const verdict = row.keys[task];
      const differ = before[task].value !== after[task].value;
      return {
        task,
        verdict,
        before: before[task],
        after: after[task],
        holds: differ === (verdict === "must differ"),
      };
    });
  } finally {
    workspace.remove();
  }
}

/**
 * Runs every lockfile task of the workspace, as a run of the tasks that
 * depend on them would first.
 *
 * @throws {Error} When Nx fails, with its output.
 */
export async function runLockfileTasks(
  workspace: FixtureWorkspace,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const { status, output } = await workspace.nx(
    ["run-many", "-t", "lockfile", "--output-style=static"],
    env,
  );
  if (status !== 0) {
    throw new Error(`The lockfile tasks failed in ${workspace.root}:\n${output}`);
  }
}

/**
 * Checks a row and fails with every task whose key does not behave as its
 * verdict says, naming the inputs whose hashes changed.
 */
export async function expectCacheKeys(row: CacheKeyRow): Promise<void> {
  const failures = (await compareCacheKeys(row)).filter((outcome) => !outcome.holds);
  if (failures.length > 0) {
    throw new Error(failures.map((outcome) => explain(row, outcome)).join("\n\n"));
  }
}

/** Defines one test per row, named after the row's change. */
export function describeCacheKeyMatrix(title: string, rows: CacheKeyRow[]): void {
  describe(title, () => {
    it.each(rows)("$change", (row) => expectCacheKeys(row), HARNESS_TIMEOUT);
  });
}

function explain(row: CacheKeyRow, outcome: CacheKeyOutcome): string {
  if (outcome.verdict === "must differ") {
    return `The key of ${outcome.task} must differ after ${row.change}, but both states hash to ${outcome.before.value}.`;
  }
  const changed = changedInputs(outcome.before.details, outcome.after.details);
  return [
    `The key of ${outcome.task} must not differ after ${row.change}, but it changed from ${outcome.before.value} to ${outcome.after.value}.`,
    `Inputs whose hash changed: ${changed.length > 0 ? changed.join(", ") : "none reported"}`,
  ].join("\n");
}

// The paths of the leaves that differ between two hash details objects.
function changedInputs(before: unknown, after: unknown, path = ""): string[] {
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) =>
      changedInputs(before[key], after[key], path === "" ? key : `${path} > ${key}`),
    );
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [path];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
