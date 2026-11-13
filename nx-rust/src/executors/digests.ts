import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  type Lockfile,
  LockfileError,
  memberDigest,
  type PackageVersion,
  parseLockfile,
} from "../cargo/lockfile";
import { commandsFolderName, digestFileName } from "../graph/lockfile-task";

/** What a task whose key holds digests checks after its cargo call. */
export interface DigestCheck {
  /** The task as `nx show target` takes it, `<project>:<target>`. */
  task: string;
  /** The absolute path of the workspace's `Cargo.lock`. */
  lockfile: string;
  /** The absolute path of the workspace's digest folder, which Nx hashes. */
  folder: string;
  /**
   * The absolute path of the folder of the private copies that the lockfile
   * task of the task's own `nx` command wrote; `undefined` where the
   * command has no id, so that no copy can exist.
   */
  commandFolder: string | undefined;
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
  /**
   * The absolute path of the folder of the private copies for the task's
   * own `nx` command; `undefined` where the command has no id.
   */
  commandFolder: string | undefined;
  /** The members whose digests it writes. */
  members: PackageVersion[];
}

/** How old a private copy may get before a lockfile task removes it, in milliseconds. */
export const commandCopyLifetime = 24 * 60 * 60 * 1000;

/**
 * The step of the lockfile task after `cargo update --workspace`: one file
 * per member in the workspace's digest folder, named after its package
 * name and holding its digest of the `Cargo.lock` that cargo left
 * (`DES-LOCKFILE-HASHING`), which is what Nx hashes into the keys of the
 * tasks that depend on the task; and the same files in a folder private to
 * the task's `nx` command, which no other command writes, for the check
 * after cargo's call ({@link checkDigests}). Other files in the digest
 * folder, such as those of removed members, are deleted, so that the folder
 * holds exactly the task's output, and so are the private folders of other
 * commands that are older than a day, which a stopped command left. Each
 * file is replaced in one step, so that a reader never sees part of one.
 *
 * @param task The task, `<project>:<target>`, for the message.
 * @param now The current time, in milliseconds.
 * @returns The message to fail the task with, or `undefined` once the
 *   digests are written.
 */
// @mara implements DES-LOCKFILE-HASHING
export function writeDigests(
  task: string,
  step: DigestWrite,
  now = Date.now(),
): string | undefined {
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
  removeOldCommandFolders(join(step.folder, commandsFolderName), now);
  for (const folder of [step.commandFolder, step.folder]) {
    if (folder === undefined) {
      continue;
    }
    mkdirSync(folder, { recursive: true });
    for (const [file, digest] of digests) {
      const temporary = join(folder, `.${file}.${process.pid}.tmp`);
      writeFileSync(temporary, `${digest}\n`);
      renameSync(temporary, join(folder, file));
    }
  }
  for (const file of readdirSync(step.folder)) {
    if (!digests.has(file) && file !== commandsFolderName) {
      rmSync(join(step.folder, file), { recursive: true, force: true });
    }
  }
  return undefined;
}

/**
 * The check of `DES-LOCKFILE-HASHING`, "Post-check", after the cargo call of
 * a task whose key holds digests. For each member, three values must be
 * equal: the digest that the lockfile task of the task's own `nx` command
 * wrote to its private copy, the shared digest file, which Nx hashed into
 * the key, as it is now, and the digest computed again from `Cargo.lock`
 * now. A difference means that a manifest or `Cargo.lock` changed while the
 * run went on, also through another `nx` command, whose lockfile task
 * rewrites the shared file, so that cargo may have built with locked
 * dependencies that the task's key does not describe. The task then fails,
 * so that Nx stores nothing for it. A missing private copy fails it as
 * well: the shared file alone cannot show what the key holds.
 *
 * @returns The message to fail the task with, or `undefined` when every digest matches.
 */
// @mara implements DES-LOCKFILE-HASHING
// @mara implements DES-DIAGNOSTICS
export function checkDigests(check: DigestCheck): string | undefined {
  const where = check.workspace === "." ? "at the repository root" : `in ${check.workspace}`;
  const failure = (reason: string) =>
    [
      `${check.task}: ${reason}`,
      `Cargo.lock of the Cargo workspace ${where}, or its digest, changed while the run went on, such as through an edit of a Cargo.toml or through another nx command that ran at the same time, so that cargo may have built with locked dependencies that the task's cache key does not describe. The task fails, so that Nx stores no result for it; run it again.`,
    ].join("\n");
  if (check.commandFolder === undefined) {
    return failure(
      "this nx command has no id from the plugin's preTasksExecution hook, so nx-rust cannot tell which digests its lockfile task wrote.",
    );
  }
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
    const own = readDigest(join(check.commandFolder, fileName(member)));
    if (own === undefined) {
      return failure(
        `the digest of the locked dependencies of ${member.name} that this command's lockfile task wrote is missing from ${check.commandFolder}.`,
      );
    }
    const shared = readDigest(join(check.folder, fileName(member)));
    if (shared !== own || current !== own) {
      return failure(
        `the locked dependencies of ${member.name} had the digest ${own} when this command's lockfile task ran; now Cargo.lock gives ${current}, and the digest file that Nx hashed holds ${shared ?? "nothing"}.`,
      );
    }
  }
  return undefined;
}

function fileName(member: PackageVersion): string {
  return digestFileName(member.name);
}

// The digest in a file, or `undefined` where it cannot be read.
function readDigest(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return undefined;
  }
}

// Removes the private folders of commands that were last written more than
// a day ago.
function removeOldCommandFolders(commands: string, now: number): void {
  let names: string[];
  try {
    names = readdirSync(commands);
  } catch {
    return;
  }
  for (const name of names) {
    const folder = join(commands, name);
    try {
      if (now - statSync(folder).mtimeMs > commandCopyLifetime) {
        rmSync(folder, { recursive: true, force: true });
      }
    } catch {
      // Removed by another command meanwhile.
    }
  }
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
