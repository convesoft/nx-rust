import type { TargetDependencyConfig } from "@nx/devkit";
import { posix } from "node:path";

/**
 * The folder under the repository root that holds the lockfile tasks'
 * digests, one folder per workspace (`DES-LOCKFILE-HASHING`, "Where the
 * digests live"). Nx hashes a dependency's output only inside the
 * repository, and leaves `.nx/workspace-data` out of its file map
 * (`EVD-NX-24-LOCKFILE-TASK`).
 */
export const digestRoot = ".nx/workspace-data/nx-rust/lockfile";

/** The variable that marks a run that excludes task dependencies (`DES-LOCKFILE-HASHING`, "Excluded dependencies"). */
export const runIdVariable = "NX_RUST_RUN_ID";

/**
 * The variable that gives each `nx` command an id of its own, under which
 * its lockfile tasks keep a private copy of the digests they write
 * (`DES-LOCKFILE-HASHING`, "Post-check"). No target names it as an input,
 * so it never reaches a cache key.
 */
export const commandIdVariable = "NX_RUST_COMMAND_ID";

/** The folder in a workspace's digest folder that holds the private copies of each command. */
export const commandsFolderName = "commands";

/**
 * The folder of a workspace's digests, relative to the repository root: one
 * path segment under {@link digestRoot} per workspace, so that the folders
 * of nested workspaces, such as one at the repository root and one below it,
 * never contain each other. The segment is the workspace's root folder with
 * every byte other than a letter, a digit, `.`, `_` and `-` written as `%`
 * and two hexadecimal digits, `/` included, and `%2E` for the repository root
 * itself. Glob patterns over it thus hold no character that a glob reads
 * specially.
 *
 * @param workspaceRoot The workspace's root folder relative to the repository root, `.` for the root itself.
 */
export function digestFolder(workspaceRoot: string): string {
  const segment =
    workspaceRoot === "."
      ? "%2E"
      : [...Buffer.from(workspaceRoot, "utf8")]
          .map((byte) =>
            /[A-Za-z0-9._-]/.test(String.fromCharCode(byte))
              ? String.fromCharCode(byte)
              : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
          )
          .join("");
  return posix.join(digestRoot, segment);
}

/**
 * The file that holds a member's digest in its workspace's folder, named
 * after its package name, which is unique among a workspace's members.
 */
export function digestFile(workspaceRoot: string, packageName: string): string {
  return posix.join(digestFolder(workspaceRoot), digestFileName(packageName));
}

/** The name of the file of a member's digest in its workspace's folder. */
export function digestFileName(packageName: string): string {
  return `${packageName}.digest`;
}

/**
 * The folder of the copies of a workspace's digests that the lockfile task
 * of one `nx` command writes for that command alone, relative to the
 * repository root. No glob of a digest input reaches into it: `*.digest`
 * stops at a folder.
 *
 * @param commandId The command's {@link commandIdVariable}.
 */
export function commandDigestFolder(workspaceRoot: string, commandId: string): string {
  return posix.join(digestFolder(workspaceRoot), commandsFolderName, commandId);
}

/**
 * The `dependsOn` entry on the lockfile task of a workspace: the target of
 * that name of the project whose root is the workspace's root folder. Nx
 * matches `directory:` patterns against project roots when it builds the
 * task graph, so the entry holds when a `package.json` or `project.json`
 * gives the workspace project another name (`DES-PROJECT-GRAPH`). A root
 * that Nx's glob matching would read specially is escaped.
 *
 * @param workspaceRoot The workspace's root folder relative to the repository root, `.` for the root itself.
 * @param target The lockfile task's name, as `targetNames` gives it.
 */
export function lockfileDependency(workspaceRoot: string, target: string): TargetDependencyConfig {
  return {
    projects: [`directory:${workspaceRoot.replace(/[\\*?[\](){}!+@]/g, "\\$&")}`],
    target,
  };
}
