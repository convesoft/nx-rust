import { type Dirent, existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * The folders that hold the crates which cargo finds below the folder of a
 * `paths` entry, walked as cargo walks it (`EVD-CARGO-REDIRECTIONS`), by
 * their real paths, in the order of the walk: the folder first, each folder
 * before what lies in it, and the entries of a folder sorted by name.
 *
 * As cargo does, the walk goes to any depth, follows a symbolic link given
 * as `folder` but none below it, and takes every folder that holds a
 * `Cargo.toml`, going on below it: under a crate and under a nested
 * workspace alike. Below `folder` itself it skips the folders whose names
 * start with `.` and those that hold `.git`, and at every level a folder
 * named `target` beside a `Cargo.toml`. A folder it cannot read is skipped,
 * as cargo skips it. It skips nothing else, so it also enters
 * `node_modules` and Cargo's artifact and build directories, where cargo
 * finds crates as well.
 *
 * It also takes a folder whose manifest is a virtual one or one that cargo
 * cannot parse, and every crate of a name that two crates share, where cargo
 * takes one: each such folder only adds a crate that cargo may use
 * (`DES-METADATA-REPORT`). The path dependencies that cargo also takes from
 * each crate it finds are not walked here (`pathsCandidates` in
 * `discovery.ts`).
 *
 * @param folder The folder of the entry, an absolute path.
 * @returns No folder where `folder` does not exist.
 */
// @mara implements DES-METADATA-REPORT
export function cratesBelowPathsFolder(folder: string): string[] {
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
