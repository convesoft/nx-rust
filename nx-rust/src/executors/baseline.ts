import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { plainLine } from "./cargo-output";
import { type CargoTargetOptions, compilingFlags, workspaceUnificationFlags } from "./command";
import {
  type BaselineContext,
  contextDifferences,
  contextRecordFile,
  contextVariablePrefixes,
  readContextRecord,
} from "./baseline-context";
import { describeList } from "./cargo-output";

// The coverage baseline target (`DES-BASELINE`, `REQ-BASELINE`): which
// collection it runs, from what cargo-affected's report says, the files it
// removes before collecting, and the lock that keeps two collections of one
// checkout apart. Everything here but the files is a function of its
// arguments, so that the rules are tested without the tools.

/** cargo-affected's database and its SQLite files, relative to the workspace root. */
export const databaseFiles: readonly string[] = [
  "coverage.db",
  "coverage.db-wal",
  "coverage.db-shm",
].map((file) => join("target", "affected", file));

/**
 * The file that marks a running collection of the workspace, relative to its
 * root, holding the process ID of the collection's executor.
 */
export const collectionLockFile = join("target", "affected", "nx-rust-collect.lock");

/** How the commands of the collection are built, besides the target's options. */
export interface CollectionFlags {
  /** Locked mode (`DES-INVOCATION`). */
  locked: boolean;
  /** Whether the workspace uses the `cargo` strategy (`DES-UNIFICATION`). */
  workspaceUnification: boolean;
}

/**
 * The arguments that cargo-affected passes to `cargo nextest run` for the
 * collection (`DES-BASELINE`): `--workspace --no-fail-fast`, then the cargo
 * arguments of the test runs as `test` with the nextest runner gives them,
 * the feature flags, `--cargo-profile` for the `profile` option, the flags of
 * the `cargo` strategy and `--locked` in locked mode. No `--no-tests`:
 * cargo-affected passes its own.
 */
// @mara implements DES-BASELINE
export function collectionNextestArguments(
  options: CargoTargetOptions,
  flags: CollectionFlags,
): string[] {
  return [
    "--workspace",
    "--no-fail-fast",
    ...compilingFlags(
      {
        features: options.features,
        allFeatures: options.allFeatures,
        noDefaultFeatures: options.noDefaultFeatures,
        profile: options.profile,
      },
      "--cargo-profile",
    ),
    ...(flags.workspaceUnification ? [...workspaceUnificationFlags] : []),
    ...(flags.locked ? ["--locked"] : []),
  ];
}

/** The arguments after `cargo` of the collection: `affected collect [--diff] -- <nextest arguments>`. */
export function collectArguments(diff: boolean, nextestArgs: readonly string[]): string[] {
  return ["affected", "collect", ...(diff ? ["--diff"] : []), "--", ...nextestArgs];
}

/**
 * The arguments after `cargo` of the report that decides between a full
 * collection and `--diff`: `affected status --report-json <file> --` and the
 * collection's arguments without `--no-fail-fast`, which `cargo nextest
 * list` does not take.
 */
export function baselineStatusArguments(
  reportFile: string,
  nextestArgs: readonly string[],
): string[] {
  return [
    "affected",
    "status",
    "--report-json",
    reportFile,
    "--",
    ...nextestArgs.filter((arg) => arg !== "--no-fail-fast"),
  ];
}

/** Which collection the target runs, and why, in words for the task's output. */
export type CollectionChoice = { kind: "diff" | "full"; reason: string };

/**
 * The collection that the report of `cargo affected status` asks for
 * (`DES-BASELINE`, `REQ-BASELINE`): `collect --diff` where the report shows
 * usable data, as `hit-exact` or `hit-with-divergence` with a collection
 * that `HEAD` reaches, and no reachable collection lies more than
 * `threshold` commits behind `HEAD`; a full collection otherwise, with the
 * reason: cargo-affected failed or wrote no report of schema 1, the report
 * shows no usable data (the first run, a lost database, a changed lockfile,
 * manifest, compiler, `RUSTFLAGS` or build target, or no collection that
 * `HEAD` reaches), or the oldest collection is further behind. A full
 * collection is always correct, so every doubt gives one.
 */
// @mara implements DES-BASELINE
// @mara implements REQ-BASELINE
export function collectionChoice(
  exit: { code: number | null; signal?: string | null; failure?: string },
  text: string | undefined,
  stderr: string,
  threshold: number,
): CollectionChoice {
  const full = (reason: string): CollectionChoice => ({ kind: "full", reason });
  if (exit.failure !== undefined) {
    return full(`cargo affected status could not run (${exit.failure})`);
  }
  if (exit.code !== 0) {
    const tail = stderr
      .trim()
      .split("\n")
      .slice(-3)
      .map((line) => plainLine(line).trim())
      .join(" ");
    return full(
      `cargo affected status ${exit.signal ? `was stopped by ${exit.signal}` : `exited with status ${exit.code}`}${tail === "" ? "" : ` (${tail})`}`,
    );
  }
  if (text === undefined) {
    return full("cargo affected status wrote no report");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return full("cargo-affected's report is no JSON");
  }
  const root = record(data);
  if (root?.schema_version !== 1) {
    return full(
      `cargo-affected's report has the schema_version ${JSON.stringify(root?.schema_version ?? null)}, and this version of @convesoft/nx-rust reads only 1`,
    );
  }
  const cache = record(root.cache);
  const status = cache?.status;
  if (status !== "hit-exact" && status !== "hit-with-divergence") {
    const labels =
      status === "miss-fingerprint"
        ? record(Array.isArray(cache?.stored_fingerprints) ? cache.stored_fingerprints[0] : null)
            ?.differing_labels
        : undefined;
    const differing =
      Array.isArray(labels) && labels.length > 0 && labels.every((l) => typeof l === "string")
        ? `, which differs from the stored one in ${(labels as string[]).join(", ")}`
        : "";
    return full(
      `the report shows no usable data: its cache status is ${typeof status === "string" ? status : JSON.stringify(status ?? null)}${differing}`,
    );
  }
  const shas = Array.isArray(cache?.collect_shas) ? cache.collect_shas : [];
  let behind: number | undefined;
  for (const entry of shas) {
    const sha = record(entry);
    if (sha?.relation === "equal") {
      behind = Math.max(behind ?? 0, 0);
    } else if (sha?.relation === "reachable") {
      const ahead = sha.commits_ahead;
      if (typeof ahead !== "number" || !Number.isInteger(ahead) || ahead < 0) {
        return full("cargo-affected's report names a collection without the commits since it");
      }
      behind = Math.max(behind ?? 0, ahead);
    }
  }
  if (behind === undefined) {
    return full("the report shows no usable data: HEAD reaches no collection of the baseline");
  }
  if (behind > threshold) {
    return full(
      `the oldest collection of the baseline is ${behind} ${behind === 1 ? "commit" : "commits"} behind HEAD, more than fullCollectThreshold (${threshold})`,
    );
  }
  return {
    kind: "diff",
    reason:
      behind === 0
        ? "the baseline holds usable data of HEAD"
        : `the baseline holds usable data, whose oldest collection is ${behind} ${behind === 1 ? "commit" : "commits"} behind HEAD, within fullCollectThreshold (${threshold})`,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Why the coverage that the database holds cannot be kept for this
 * collection, so that only a full collection into an empty database will
 * do, or `undefined` where `collect --diff` may run (`DES-BASELINE`,
 * `ADR-AFFECTED-BASELINE-CONTEXT`): `--diff` re-collects only what changed
 * and keeps every other test's rows, which then stand for the context that
 * the new record names. It may run only where the record that is there
 * before the collection can be read, is of the current version and equals
 * `collected` in every field: the cargo options, the triple, every
 * environment input and every runtime input, compared with the function
 * that the test runs use, and in both directions, so that an input that the
 * earlier collection had and this one has not counts as well. A missing
 * record, as on the first run or after a collection that failed or was
 * stopped, an unreadable one, one of another version and one that differs
 * each give the reason, in words for the task's output.
 */
// @mara implements DES-BASELINE
export function previousRecordProblem(
  workspaceRoot: string,
  collected: BaselineContext,
): string | undefined {
  const file = join(workspaceRoot, contextRecordFile);
  let present = true;
  try {
    readFileSync(file);
  } catch (error) {
    present = (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
  if (!present) {
    return "the baseline has no record of the context of its last collection, as on the first run or after a collection that failed or was stopped, so the coverage it holds cannot be kept";
  }
  const previous = readContextRecord(workspaceRoot);
  if ("problem" in previous) {
    return `${previous.problem.replace(/; collect the baseline again$/, "")}, so the coverage it holds cannot be kept`;
  }
  const differences = contextDifferences(previous.context, collected);
  const dropped = [
    // A variable of the prefixes counts in contextDifferences already.
    ...Object.keys(previous.context.env)
      .filter(
        (name) =>
          !(name in collected.env) &&
          !contextVariablePrefixes.some((prefix) => name.startsWith(prefix)),
      )
      .map((name) => `the variable ${name}`),
    ...Object.keys(previous.context.runtime)
      .filter((command) => !(command in collected.runtime))
      .map((command) => `the runtime input \`${command}\``),
  ].sort();
  const parts = [
    ...(differences.length === 0
      ? []
      : [`${describeList(differences)} ${differences.length === 1 ? "differs" : "differ"}`]),
    ...(dropped.length === 0
      ? []
      : [
          `the last collection had ${describeList(dropped)} among its inputs, which this one has not`,
        ]),
  ];
  return parts.length === 0
    ? undefined
    : `the last collection ran in another context, so the coverage it holds cannot be kept: ${parts.join(", and ")}`;
}

/**
 * Removes, in the workspace root `workspaceRoot`, what a collection replaces
 * before it starts ("Order of writing" in `DES-BASELINE`): the context
 * record always, and for a full collection cargo-affected's database with
 * its `-wal` and `-shm` files, so that it starts from an empty database.
 * Nothing else: no folder of Cargo's and no other file of cargo-affected's.
 */
// @mara implements DES-BASELINE
export function removeBeforeCollection(workspaceRoot: string, full: boolean): void {
  rmSync(join(workspaceRoot, contextRecordFile), { force: true });
  if (full) {
    for (const file of databaseFiles) {
      rmSync(join(workspaceRoot, file), { force: true });
    }
  }
}

/** The lock of a running collection, which {@link CollectionLock.release} gives back. */
export interface CollectionLock {
  release(): void;
}

/** Why the lock was not taken: a running process holds it, or the plugin cannot tell. */
export type LockRefusal = { holder: number } | { problem: string };

/** The file that marks a takeover of a stale lock, beside {@link collectionLockFile}. */
export const takeoverMarkerFile = `${collectionLockFile}.takeover`;

/** Points in {@link takeCollectionLock} where a test can let another contender act. */
export interface LockSeams {
  /** After the lock was found stale, before the takeover. */
  afterStaleRead?: () => void;
}

/**
 * Takes the lock of the workspace's collection, {@link collectionLockFile}.
 * The file appears whole and only if it did not exist: it is written under a
 * name of this process's own and then hard-linked to the lock's name, which
 * fails where the lock exists. Where a running process holds the lock, the
 * collection does not start and the holder is returned: two collections of
 * one checkout could leave the record of one beside the coverage of the
 * other.
 *
 * A lock whose process no longer runs, as after a collection that was
 * killed, is taken over only under the takeover marker,
 * {@link takeoverMarkerFile}, which one contender at a time creates the same
 * way: under it, the contender reads the lock again and removes it only
 * where it still holds the dead process's ID, then creates its own as above.
 * So a contender that read the same stale lock as another, which has taken
 * it over meanwhile, finds the other's ID and is refused, and two
 * contenders never both hold the lock. Where a stale lock and the marker
 * are there, the plugin cannot tell whether a takeover runs or one was
 * killed halfway, and refuses with a problem that names both files. A
 * marker beside no lock, as a taker killed between removing the stale lock
 * and creating its own leaves it, stops nothing: the lock is created as
 * usual and the marker stays. That is safe, because a taker still alive in
 * that window then fails to create the lock and is refused.
 */
// @mara implements DES-BASELINE
export function takeCollectionLock(
  workspaceRoot: string,
  pid = process.pid,
  seams: LockSeams = {},
): CollectionLock | LockRefusal {
  const file = join(workspaceRoot, collectionLockFile);
  const marker = join(workspaceRoot, takeoverMarkerFile);
  mkdirSync(dirname(file), { recursive: true });
  const lock: CollectionLock = {
    release() {
      if (readQuietly(file) === String(pid)) {
        rmSync(file, { force: true });
      }
    },
  };
  if (createWhole(file, pid)) {
    return lock;
  }
  const seen = readQuietly(file);
  const holder = seen === undefined ? undefined : Number.parseInt(seen, 10);
  if (holder !== undefined && Number.isInteger(holder) && holder > 0 && runs(holder)) {
    return { holder };
  }
  seams.afterStaleRead?.();
  if (!createWhole(marker, pid)) {
    return {
      problem: `another collection is taking over the lock ${collectionLockFile} of a collection that ended, or one was stopped while it did and left ${takeoverMarkerFile}. Run the target again; if it keeps failing and no collection runs in this checkout, remove both files`,
    };
  }
  try {
    const now = readQuietly(file);
    if (now !== seen) {
      const other = now === undefined ? undefined : Number.parseInt(now, 10);
      return other !== undefined && Number.isInteger(other) && other > 0
        ? { holder: other }
        : {
            problem: `the lock ${collectionLockFile} changed while this collection took it over. Run the target again`,
          };
    }
    rmSync(file, { force: true });
    if (createWhole(file, pid)) {
      return lock;
    }
    const other = Number.parseInt(readQuietly(file) ?? "", 10);
    return Number.isInteger(other) && other > 0
      ? { holder: other }
      : {
          problem: `another collection took the lock ${collectionLockFile} first. Run the target again`,
        };
  } finally {
    if (readQuietly(marker) === String(pid)) {
      rmSync(marker, { force: true });
    }
  }
}

// Creates `file` holding `pid`, whole, only where it does not exist: written
// under a name of this process's own, then hard-linked, which fails with
// EEXIST where `file` exists.
function createWhole(file: string, pid: number): boolean {
  const own = `${file}.${pid}.${process.hrtime.bigint()}`;
  writeFileSync(own, `${pid}\n`);
  try {
    linkSync(own, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    return false;
  } finally {
    rmSync(own, { force: true });
  }
}

// The trimmed text of a file, or `undefined` where it cannot be read.
function readQuietly(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return undefined;
  }
}

// Whether a process with this ID runs on this machine.
function runs(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
