import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Folders that {@link repositoryFiles} leaves out: installed packages and Nx's own data. */
const skippedFolders = new Set(["node_modules", ".nx"]);

/**
 * Every file below `root` with its content, by path relative to `root` with
 * `/` separators, leaving out `node_modules` and `.nx`. Compare two results
 * with {@link changedFiles} to see what a command wrote.
 */
export function repositoryFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (folder: string, prefix: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!skippedFolders.has(entry.name)) {
          visit(join(folder, entry.name), path);
        }
      } else {
        files.set(path, readFileSync(join(folder, entry.name), "utf8"));
      }
    }
  };
  visit(root, "");
  return files;
}

/** The paths that were added, removed or changed between two {@link repositoryFiles} results, sorted. */
export function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
}
