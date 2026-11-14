import { type Dirent, existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * The folders that hold the crates which cargo takes from the folder of a
 * `paths` entry, found as cargo finds them (`EVD-CARGO-REDIRECTIONS`), by
 * their real paths, in the order of the walk: the folder first, each folder
 * before what lies in it, and the entries of a folder sorted by name.
 *
 * As cargo does, the walk goes to any depth, follows a symbolic link given
 * as `folder` but none below it, and takes every folder that holds a
 * `Cargo.toml`, going on below it: under a crate and under a nested
 * workspace alike. Below `folder` itself it skips the folders whose names
 * start with `.` and those that hold `.git`, and at every level a folder
 * named `target` beside a `Cargo.toml`. A folder it cannot read is skipped,
 * as cargo skips it.
 *
 * Beyond cargo, it never enters below `folder` what holds Cargo's outputs
 * or JS packages rather than crates of the repository: `node_modules`, a
 * folder whose `CACHEDIR.TAG` says that cargo created it, as cargo does in
 * every artifact and build directory ({@link isCargoDirectory}), and the
 * folders in `skipped`. It also takes a folder
 * whose manifest is a virtual one or one that cargo cannot parse, and every
 * crate of a name that two crates share, where cargo takes one: each such
 * folder only adds a crate that cargo may use (`DES-METADATA-REPORT`).
 *
 * @param folder The folder of the entry, an absolute path.
 * @param skipped Real paths of folders not to enter, such as the artifact
 *   and build directories of the workspaces that discovery found.
 * @returns No folder where `folder` does not exist.
 */
// @mara implements DES-METADATA-REPORT
export function cratesBelowPathsFolder(folder: string, skipped: ReadonlySet<string>): string[] {
  let start: string;
  try {
    start = realpathSync(folder);
  } catch {
    return [];
  }
  const crates: string[] = [];
  const visit = (current: string) => {
    const name = basename(current);
    if (current !== start && (name.startsWith(".") || existsSync(join(current, ".git")))) {
      return;
    }
    if (name === "target" && existsSync(join(dirname(current), "Cargo.toml"))) {
      return;
    }
    if (
      current !== start &&
      (name === "node_modules" || skipped.has(current) || isCargoDirectory(current))
    ) {
      return;
    }
    if (existsSync(join(current, "Cargo.toml"))) {
      crates.push(current);
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      visit(join(current, entry.name));
    }
  };
  visit(start);
  return crates;
}

/**
 * Whether cargo created the folder as an artifact or build directory: its
 * `CACHEDIR.TAG` holds the line that Cargo 1.91 and later write there
 * (`EVD-CARGO-REDIRECTIONS`). A tag of another tool does not count.
 */
function isCargoDirectory(folder: string): boolean {
  try {
    return readFileSync(join(folder, "CACHEDIR.TAG"), "utf8").includes(
      "cache directory tag created by cargo",
    );
  } catch {
    return false;
  }
}
