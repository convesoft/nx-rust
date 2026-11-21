import type { Tree } from "@nx/devkit";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { parse } from "smol-toml";
import { shellWord } from "../executors/cargo-invocation";
import { ReleaseError } from "./manifests";
import { errorMessage, isAbsence, treePath } from "./places";
import {
  type ReleaseCrate,
  type ReleaseRepository,
  type ReleaseWorkspace,
  repositoryPath,
} from "./repository";
import { sentenceList } from "./version-checks";

/** A package that a lockfile locks. */
interface LockedPackage {
  name?: unknown;
  version?: unknown;
  source?: unknown;
}

/** A lockfile as the run read it before it changed anything. */
export type LockfileState =
  | { kind: "absent" }
  | { kind: "unreadable"; reason: string }
  | { kind: "read"; packages: LockedPackage[] };

/** The lockfile state that a version run records for `afterAllProjectsVersioned`. */
export interface LockfileRun {
  /**
   * The lockfiles that `afterAllProjectsVersioned` brings up to date, relative
   * to the repository root, with their workspaces.
   */
  lockfiles: Map<string, ReleaseWorkspace>;
  /**
   * The files that the run writes through Nx's tree, by their
   * {@link treePath}: where they lie once symbolic links are followed.
   */
  written: Set<string>;
  /** The lockfiles that the run has read, by their absolute path, as they were before it. */
  lockfileStates: Map<string, LockfileState>;
}

/**
 * Brings the `Cargo.lock` of each Cargo workspace that `run` changed up to
 * date (`DES-RELEASE`, "Lockfile"), for `afterAllProjectsVersioned`.
 */
export function updateVersionedLockfiles(
  run: LockfileRun | undefined,
  cwd: string,
  options: { dryRun?: boolean },
): { changedFiles: string[]; deletedFiles: string[] } {
  if (options.dryRun || run === undefined || run.lockfiles.size === 0) {
    return { changedFiles: [], deletedFiles: [] };
  }
  const changed: string[] = [];
  const failures: {
    workspace: ReleaseWorkspace;
    reason: string;
    output: string;
    cargoFailed: boolean;
  }[] = [];
  for (const [lockfile, workspace] of [...run.lockfiles].sort(([a], [b]) => a.localeCompare(b))) {
    const file = join(cwd, lockfile);
    const before = readLockfile(file);
    if (before.kind === "absent") {
      continue;
    }
    if (before.kind === "unreadable") {
      failures.push({
        workspace,
        reason: `nx release version cannot read ${lockfile}: ${before.reason}`,
        output: "",
        cargoFailed: false,
      });
      continue;
    }
    const update = spawnSync("cargo", ["update", "--workspace"], {
      cwd: dirname(file),
      env: process.env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (update.error !== undefined || update.status !== 0) {
      const code = (update.error as NodeJS.ErrnoException | undefined)?.code;
      failures.push({
        workspace,
        reason:
          code === "ENOENT"
            ? "cargo was not found on PATH"
            : update.error !== undefined
              ? update.error.message
              : update.signal
                ? `cargo was stopped by ${update.signal}`
                : `cargo exited with status ${update.status}`,
        output: (update.stderr ?? "").trim(),
        cargoFailed: true,
      });
      continue;
    }
    const after = readLockfile(file);
    if (after.kind !== "read") {
      failures.push({
        workspace,
        reason: `nx release version cannot read ${lockfile} after cargo update --workspace: ${after.kind === "absent" ? "it does not exist" : after.reason}`,
        output: "",
        cargoFailed: false,
      });
      continue;
    }
    if (after.text !== before.text) {
      const path = treePath(cwd, lockfile);
      changed.push(path);
      console.log(
        path === lockfile
          ? `Updated ${lockfile} with cargo update --workspace`
          : `Updated ${path}, to which ${lockfile} leads, with cargo update --workspace`,
      );
    }
  }
  const staged = changed.filter((path) => !gitIgnores(cwd, path));
  if (failures.length > 0) {
    throw new ReleaseError(recoveryMessage(cwd, run, failures, changed, staged));
  }
  return { changedFiles: staged, deletedFiles: [] };
}

/**
 * The message for a lockfile step that failed: each failure, and the
 * commands, quoted for a POSIX shell, that take back what Nx and cargo
 * wrote or bring the lockfiles up to date by hand.
 */
function recoveryMessage(
  cwd: string,
  run: LockfileRun,
  failures: readonly {
    workspace: ReleaseWorkspace;
    reason: string;
    output: string;
    cargoFailed: boolean;
  }[],
  changed: readonly string[],
  staged: readonly string[],
): string {
  const one = failures.length === 1;
  const workspaces = `${one ? "the Cargo workspace" : "the Cargo workspaces"} ${sentenceList(failures.map(({ workspace }) => workspace.rootManifest))}`;
  const written = [...new Set([...run.written, ...staged])].sort();
  const untracked = untrackedFiles(cwd, written);
  const restorable = written.filter((file) => !untracked.includes(file));
  const folders = failures.map(({ workspace }) => posix.dirname(workspace.rootManifest));
  const byHand =
    untracked.length === 0
      ? ""
      : `take back ${sentenceList(untracked)}, which git does not track, by hand`;
  return [
    failures.every(({ cargoFailed }) => cargoFailed)
      ? `cargo update --workspace failed in ${workspaces}, so nx release version cannot bring ${one ? "its" : "their"} Cargo.lock up to date:`
      : `nx release version cannot bring the Cargo.lock of ${workspaces} up to date:`,
    ...failures.flatMap(({ workspace, reason, output }) => [
      `- ${workspace.rootManifest}: ${reason}`,
      ...(output === "" ? [] : output.split("\n").map((line) => `    ${line}`)),
    ]),
    `Nx has written the new versions${changed.length > 0 ? ` and cargo has updated ${sentenceList(changed)}` : ""}, and made no commit or tag.`,
    ...(restorable.length === 0
      ? [`To go back, ${byHand}, and run nx release version again once cargo works.`]
      : [
          `To go back, run this in the root of the Nx workspace,${byHand === "" ? "" : ` ${byHand},`} and run nx release version again once cargo works:`,
          // git reads a path in `*`, `?`, `[` or `\` as a pattern otherwise.
          `    git ${restorable.some((file) => /[*?[\\]/.test(file)) ? "--literal-pathspecs " : ""}checkout -- ${restorable.map(shellWord).join(" ")}`,
        ]),
    `To go on instead, correct what cargo reports, run ${folders.length === 1 ? "this" : "these"} in the root of the Nx workspace, and commit and tag the release yourself:`,
    // cd would read a folder that starts with `-` as an option.
    ...folders.map(
      (folder) =>
        `    (cd ${shellWord(folder.startsWith("-") ? `./${folder}` : folder)} && cargo update --workspace)`,
    ),
  ].join("\n");
}

/** The lockfile of a workspace, relative to the repository root with `/`. */
function lockfileOf(workspace: ReleaseWorkspace): string {
  return posix.join(posix.dirname(workspace.rootManifest), "Cargo.lock");
}

/**
 * The lockfiles, by their path relative to the repository root, that the new
 * version of `crate` makes stale, with their workspaces: those of the
 * workspaces whose root manifest, member manifests or Cargo configuration
 * files are among `files`, and those that lock the crate as a path package
 * at its old version, as the lockfile of a workspace does whose member
 * depends on the crate by path without a version requirement, whose
 * manifests stay as they are (`EVD-CARGO-LOCKFILE-UPDATE`). A workspace
 * without a `Cargo.lock` has none. A lockfile that cannot be read or parsed
 * is among `unreadable`, with the reason, because then nx-rust can tell
 * neither whether it is stale nor bring it up to date; only a lockfile that
 * does not exist is absent.
 */
export function staleLockfiles(
  tree: Tree,
  repository: ReleaseRepository,
  run: LockfileRun,
  crate: ReleaseCrate,
  files: readonly string[],
): { lockfiles: Map<string, ReleaseWorkspace>; unreadable: string[] } {
  const lockfiles = new Map<string, ReleaseWorkspace>();
  const unreadable: string[] = [];
  for (const workspace of repository.workspaces) {
    const lockfile = lockfileOf(workspace);
    const file = join(tree.root, lockfile);
    let state = run.lockfileStates.get(file);
    if (state === undefined) {
      state = lockfileState(file);
      run.lockfileStates.set(file, state);
    }
    if (state.kind === "unreadable") {
      unreadable.push(`- ${lockfile}: ${state.reason}`);
    } else if (
      state.kind === "read" &&
      (changesWorkspace(repository, workspace, files) ||
        // A lockfile names no path, and another path crate of that name and
        // version only costs an update that changes nothing.
        state.packages.some(
          (pkg) =>
            pkg.name === crate.name && pkg.version === crate.version && pkg.source === undefined,
        ))
    ) {
      lockfiles.set(lockfile, workspace);
    }
  }
  return { lockfiles, unreadable };
}

// Whether `files` holds the workspace's root manifest, a member's manifest
// or one of its Cargo configuration files.
function changesWorkspace(
  repository: ReleaseRepository,
  workspace: ReleaseWorkspace,
  files: readonly string[],
): boolean {
  return files.some(
    (file) =>
      file === workspace.rootManifest ||
      workspace.crates.some((member) => member.manifest === file) ||
      workspace.configFiles.some(
        (configFile) => repositoryPath(repository.root, configFile) === file,
      ),
  );
}

// The packages that the lockfile at `file` locks.
function lockfileState(file: string): LockfileState {
  const read = readLockfile(file);
  if (read.kind !== "read") {
    return read;
  }
  try {
    const lock = parse(read.text) as { package?: unknown };
    return {
      kind: "read",
      packages: Array.isArray(lock.package) ? (lock.package as LockedPackage[]) : [],
    };
  } catch (error) {
    return { kind: "unreadable", reason: `no valid TOML: ${errorMessage(error).split("\n")[0]}` };
  }
}

// The text of the lockfile at `file`; absent only where it does not exist.
function readLockfile(
  file: string,
): { kind: "absent" } | { kind: "unreadable"; reason: string } | { kind: "read"; text: string } {
  try {
    return { kind: "read", text: readFileSync(file, "utf8") };
  } catch (error) {
    return isAbsence(error)
      ? { kind: "absent" }
      : { kind: "unreadable", reason: errorMessage(error) };
  }
}

// Whether git ignores a path of the repository; outside a git repository nothing is.
function gitIgnores(cwd: string, path: string): boolean {
  return (
    spawnSync("git", ["check-ignore", "--quiet", "--", path], { cwd, stdio: "ignore" }).status === 0
  );
}

// The files among `files` that git does not track, which `git checkout`
// cannot take back and refuses to take back anything beside; none where git
// cannot tell, as outside a git repository.
function untrackedFiles(cwd: string, files: readonly string[]): string[] {
  if (files.length === 0) {
    return [];
  }
  const listed = spawnSync("git", ["--literal-pathspecs", "ls-files", "-z", "--", ...files], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (listed.status !== 0) {
    return [];
  }
  const tracked = new Set(listed.stdout.split("\0"));
  return files.filter((file) => !tracked.has(file));
}
