import { realpathSync } from "node:fs";
import { resolve } from "node:path";

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
