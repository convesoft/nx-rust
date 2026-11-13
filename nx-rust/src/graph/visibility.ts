import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Which of `files`, relative to the repository root, are in the files that
 * Nx sees: those that `.gitignore` and `.nxignore` files and Nx's fixed
 * exclusions leave in its workspace context. Nx hashes no other file, and a
 * fileset that names one has no effect (`EVD-NX-24-FILE-INPUTS`).
 *
 * It asks Nx's workspace context, through the daemon where one serves the
 * command, as Nx's own plugins do. Where the installed Nx lacks that part,
 * every file counts as seen.
 */
export async function filesNxSees(
  workspaceRoot: string,
  files: readonly string[],
): Promise<Set<string>> {
  if (files.length === 0) {
    return new Set();
  }
  const glob = workspaceContextGlob(workspaceRoot);
  if (glob === undefined) {
    return new Set(files);
  }
  return new Set(await glob(workspaceRoot, files.map(escapeGlob)));
}

/**
 * Which of `folders`, relative to the repository root, Nx sees: a folder
 * with a `Cargo.toml` where Nx sees that file, and another folder where Nx
 * sees any file below it ({@link filesNxSees}).
 */
export async function foldersNxSees(
  workspaceRoot: string,
  folders: readonly string[],
): Promise<Set<string>> {
  if (folders.length === 0) {
    return new Set();
  }
  const glob = workspaceContextGlob(workspaceRoot);
  if (glob === undefined) {
    return new Set(folders);
  }
  const prefix = (folder: string) => (folder === "." ? "" : `${escapeGlob(folder)}/`);
  const patterns = folders.map((folder) =>
    existsSync(join(workspaceRoot, folder, "Cargo.toml"))
      ? `${prefix(folder)}Cargo.toml`
      : `${prefix(folder)}**/*`,
  );
  const files = await glob(workspaceRoot, patterns);
  return new Set(
    folders.filter((folder) =>
      files.some((file) => folder === "." || file.startsWith(`${folder}/`)),
    ),
  );
}

type Glob = (workspaceRoot: string, globs: string[]) => Promise<string[]>;

// `globWithWorkspaceContext` of the Nx installed in the repository.
function workspaceContextGlob(workspaceRoot: string): Glob | undefined {
  try {
    const context = require(
      require.resolve("nx/src/utils/workspace-context", { paths: [workspaceRoot] }),
    );
    return typeof context?.globWithWorkspaceContext === "function"
      ? context.globWithWorkspaceContext
      : undefined;
  } catch {
    return undefined;
  }
}

// A path as a glob that matches only itself.
function escapeGlob(path: string): string {
  return path.replace(/[*?[\]{}()!@+\\]/g, "\\$&");
}
