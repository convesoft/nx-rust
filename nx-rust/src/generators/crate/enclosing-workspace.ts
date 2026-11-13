import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { parse } from "smol-toml";

/** The Cargo workspace that a new crate's folder lies in. */
export interface EnclosingWorkspace {
  /** The absolute path of the workspace's root manifest. */
  manifest: string;
  /** The entries of `[workspace] exclude`, as written. */
  exclude: string[];
}

/**
 * The workspace that will enclose a crate created in `folder`, found as
 * cargo finds it: the nearest `Cargo.toml` above the folder that has a
 * `[workspace]` table. `undefined` when there is none, so that the crate is
 * a standalone crate. A manifest that is not valid TOML is passed over.
 *
 * @param folder The absolute path of the crate's folder.
 */
// @mara implements DES-GENERATORS
export function enclosingWorkspace(folder: string): EnclosingWorkspace | undefined {
  for (let above = dirname(folder); ; above = dirname(above)) {
    const manifest = join(above, "Cargo.toml");
    const workspace = existsSync(manifest) ? readWorkspaceTable(manifest) : undefined;
    if (workspace !== undefined) {
      const exclude = Array.isArray(workspace.exclude)
        ? workspace.exclude.filter((entry): entry is string => typeof entry === "string")
        : [];
      return { manifest, exclude };
    }
    if (dirname(above) === above) {
      return undefined;
    }
  }
}

/**
 * The entry of the workspace's `exclude` that leaves `folder` out of the
 * workspace, or `undefined`. Cargo reads an entry as a path relative to the
 * workspace root, not as a glob, and leaves out every folder at or below
 * it.
 *
 * @param folder The absolute path of the crate's folder.
 */
export function excludingEntry(workspace: EnclosingWorkspace, folder: string): string | undefined {
  const root = dirname(workspace.manifest);
  return workspace.exclude.find((entry) => {
    const path = relative(join(root, entry), folder);
    return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
  });
}

function readWorkspaceTable(manifest: string): Record<string, unknown> | undefined {
  try {
    const workspace = parse(readFileSync(manifest, "utf8")).workspace;
    return typeof workspace === "object" && workspace !== null && !Array.isArray(workspace)
      ? (workspace as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
