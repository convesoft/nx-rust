import { readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

/**
 * The path with every symbolic link resolved, so that two spellings of one
 * folder compare equal; the absolute path as given when it does not exist.
 */
export function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * The folder that the system reaches through `path`, also before it
 * exists: every symbolic link is followed, a `..` segment leaves the folder
 * that a link before it leads to, and the folders that do not exist yet are
 * added, as written, to the real path of the deepest one that does. A link
 * that leads to a missing folder is followed as well. Links beyond the 40
 * that Linux follows in one path stay as written.
 */
export function physicalPath(path: string): string {
  return reachedPath(isAbsolute(path) ? path : resolve(path), { links: 0 });
}

// Linux's MAXSYMLINKS.
const maximumLinks = 40;

function reachedPath(path: string, followed: { links: number }): string {
  try {
    return realpathSync(path);
  } catch {
    // Missing, or reached through a link that leads to a missing folder.
  }
  const parent = dirname(path);
  if (parent === path) {
    return path;
  }
  const folder = reachedPath(parent, followed);
  // A real folder's `..` is its parent, so joining as text is right here.
  const reached = join(folder, basename(path));
  if (followed.links >= maximumLinks) {
    return reached;
  }
  let target: string;
  try {
    target = readlinkSync(reached);
  } catch {
    return reached;
  }
  followed.links += 1;
  // Not `resolve`, which would take a `..` in the link as text.
  const relativeTo = folder.endsWith(sep) ? folder : `${folder}${sep}`;
  return reachedPath(isAbsolute(target) ? target : `${relativeTo}${target}`, followed);
}
