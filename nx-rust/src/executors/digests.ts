import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Lockfile,
  LockfileError,
  memberDigest,
  type PackageVersion,
  parseLockfile,
} from "../cargo/lockfile";
import { digestFileName } from "../graph/lockfile-task";

/** What a task whose key holds digests checks after its cargo call. */
export interface DigestCheck {
  /** The task as `nx show target` takes it, `<project>:<target>`. */
  task: string;
  /** The absolute path of the workspace's `Cargo.lock`. */
  lockfile: string;
  /** The absolute path of the workspace's digest folder. */
  folder: string;
  /** The members whose digests the task's key holds. */
  members: PackageVersion[];
  /** The workspace's root folder, relative to the repository root. */
  workspace: string;
}

/** What the lockfile task writes ({@link writeDigests}). */
export interface DigestWrite {
  /** The absolute path of the workspace's `Cargo.lock`. */
  lockfile: string;
  /** The absolute path of the workspace's digest folder. */
  folder: string;
  /** The members whose digests it writes. */
  members: PackageVersion[];
}

/**
 * The step of the lockfile task after `cargo update --workspace`: one file
 * per member in the workspace's digest folder, named after its package
 * name and holding its digest of the `Cargo.lock` that cargo left
 * (`DES-LOCKFILE-HASHING`). Other files in the folder, such as those of
 * removed members, are deleted, so that the folder is exactly the task's
 * output. Each file is replaced in one step, so that a reader never sees
 * part of one.
 *
 * @param task The task, `<project>:<target>`, for the message.
 * @returns The message to fail the task with, or `undefined` once the
 *   digests are written.
 */
// @mara implements DES-LOCKFILE-HASHING
export function writeDigests(task: string, step: DigestWrite): string | undefined {
  let digests: Map<string, string>;
  try {
    const lockfile = readLockfile(step.lockfile);
    digests = new Map(
      step.members.map((member) => [fileName(member), memberDigest(lockfile, member)]),
    );
  } catch (error) {
    if (error instanceof LockfileError) {
      return `${task}: nx-rust cannot read the digests of the workspace's members from ${step.lockfile}, which cargo update left: ${error.message}.`;
    }
    throw error;
  }
  mkdirSync(step.folder, { recursive: true });
  for (const [file, digest] of digests) {
    const temporary = join(step.folder, `.${file}.${process.pid}.tmp`);
    writeFileSync(temporary, `${digest}\n`);
    renameSync(temporary, join(step.folder, file));
  }
  for (const file of readdirSync(step.folder)) {
    if (!digests.has(file)) {
      rmSync(join(step.folder, file), { recursive: true, force: true });
    }
  }
  return undefined;
}

/**
 * The check of `DES-LOCKFILE-HASHING`, "Post-check", after the cargo call of
 * a task whose key holds digests: each member's digest computed again from
 * `Cargo.lock` must equal the digest file from which Nx computed the key.
 * They differ when a manifest or `Cargo.lock` changed while the run went
 * on, so that cargo used a lockfile that the key does not describe; the
 * task then fails, so that Nx stores nothing for it.
 *
 * @returns The message to fail the task with, or `undefined` when every digest matches.
 */
// @mara implements DES-LOCKFILE-HASHING
// @mara implements DES-DIAGNOSTICS
export function checkDigests(check: DigestCheck): string | undefined {
  const where =
    check.workspace === "." ? "at the repository root" : `in ${check.workspace}`;
  const failure = (reason: string) =>
    [
      `${check.task}: ${reason}`,
      `This happens when a Cargo.toml or Cargo.lock of the Cargo workspace ${where} changes while the run goes on, so that cargo builds with locked dependencies that the task's cache key does not describe. The task fails, so that Nx stores no result for it; run it again.`,
    ].join("\n");
  let lockfile: Lockfile;
  try {
    lockfile = readLockfile(check.lockfile);
  } catch (error) {
    if (error instanceof LockfileError) {
      return failure(`nx-rust cannot read ${check.lockfile} after cargo's call: ${error.message}.`);
    }
    throw error;
  }
  for (const member of check.members) {
    const file = join(check.folder, fileName(member));
    let recorded: string | undefined;
    try {
      recorded = readFileSync(file, "utf8").trim();
    } catch {
      recorded = undefined;
    }
    let current: string;
    try {
      current = memberDigest(lockfile, member);
    } catch (error) {
      if (error instanceof LockfileError) {
        return failure(
          `after cargo's call, ${check.lockfile} no longer gives the locked dependencies of ${member.name}: ${error.message}.`,
        );
      }
      throw error;
    }
    if (recorded === undefined) {
      return failure(
        `the digest of the locked dependencies of ${member.name}, ${file}, which the task's cache key reads, is missing.`,
      );
    }
    if (recorded !== current) {
      return failure(
        `Cargo.lock changed while the task ran: the locked dependencies of ${member.name} now have the digest ${current}, and the task's cache key holds ${recorded}.`,
      );
    }
  }
  return undefined;
}

function fileName(member: PackageVersion): string {
  return digestFileName(member.name);
}

function readLockfile(path: string): Lockfile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new LockfileError(`it cannot be read (${(error as Error).message})`);
  }
  return parseLockfile(text);
}
