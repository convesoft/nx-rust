import { statSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { CargoWorkspace, describeWorkspaces } from "./discovery";
import { realPath } from "./real-path";

/** The names of rustfmt's configuration file, in the order in which rustfmt looks for them in a folder. */
const fileNames = [".rustfmt.toml", "rustfmt.toml"];

/**
 * What rustfmt finds in one folder: the path of the file that it takes
 * there, `"none"` where it goes on to the next folder, or `"stop"` where an
 * error, such as a folder that cannot be searched, makes it fail.
 */
type Lookup = string | "none" | "stop";

/**
 * The rustfmt configuration file that rustfmt takes for a file of the
 * repository where no folder from the file's up to the repository root
 * holds one, or `undefined` where it takes none or fails
 * (`DES-DIAGNOSTICS`, "Rustfmt configuration outside the repository").
 * rustfmt looks in each folder above the file's, up to the file system's
 * root, then in the home folder and then in `rustfmt` in the user's
 * configuration folder, and in each for `.rustfmt.toml` before
 * `rustfmt.toml`, and takes the first file it finds; an error other than a
 * missing file or folder stops it (`EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`).
 * This repeats only the folders above the repository's real path and the
 * two per-user folders: the home folder from `HOME`, or the user's entry
 * where it is unset or empty, and the configuration folder from an absolute
 * `XDG_CONFIG_HOME`, else `.config` in the home folder, and on macOS
 * `Library/Application Support` there.
 *
 * @param repositoryRoot The absolute path of the repository root.
 * @param env The environment of graph creation, whose `HOME` and
 *   `XDG_CONFIG_HOME` rustfmt reads too unless a task's own dotenv files
 *   change them.
 */
export function outsideRustfmtConfiguration(
  repositoryRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const folders: string[] = [];
  for (let folder = realPath(repositoryRoot); dirname(folder) !== folder;) {
    folder = dirname(folder);
    folders.push(folder);
  }
  const home = env.HOME !== undefined && env.HOME !== "" ? env.HOME : userHome();
  const xdg = env.XDG_CONFIG_HOME;
  const configuration =
    platform === "darwin"
      ? home === undefined
        ? undefined
        : join(home, "Library", "Application Support")
      : xdg !== undefined && isAbsolute(xdg)
        ? xdg
        : home === undefined
          ? undefined
          : join(home, ".config");
  for (const folder of [
    ...folders,
    ...(home === undefined ? [] : [home]),
    ...(configuration === undefined ? [] : [join(configuration, "rustfmt")]),
  ]) {
    const found = lookIn(folder);
    if (found === "stop") {
      return undefined;
    }
    if (found !== "none") {
      return found;
    }
  }
  return undefined;
}

/**
 * The warning about a rustfmt configuration file that rustfmt takes for
 * crates of the workspaces from outside the repository, or from a per-user
 * folder inside it, because no folder from a source file of the crate up to
 * the repository root holds `rustfmt.toml` or `.rustfmt.toml`
 * ({@link outsideRustfmtConfiguration}), one for all the workspaces that it
 * concerns, or none. The folders are those of the source files of the
 * crate's targets, `src_path` in the report, where rustfmt starts looking
 * for each of them. A file inside the repository concerns only the crates
 * whose folder does not hold it, since a crate's key holds the files of its
 * folder. The warning joins the {@link CargoWorkspace.formattingWarnings} of
 * each crate that it concerns, whose `fmt-check` and `fmt` tasks print it at
 * their start; like the warning about Cargo configuration that Nx does not
 * hash, no key holds it, so that a machine's rustfmt configuration gives no
 * keys of their own (`RISK-HOST-ENVIRONMENT`, `DES-DIAGNOSTICS`).
 *
 * @param repositoryRoot The absolute path of the repository root.
 */
// @mara implements DES-DIAGNOSTICS
export function rustfmtConfigurationWarnings(
  workspaces: CargoWorkspace[],
  repositoryRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const file = outsideRustfmtConfiguration(repositoryRoot, env);
  if (file === undefined) {
    return [];
  }
  const root = realPath(repositoryRoot);
  const insidePath = (path: string): string | undefined => {
    const inside = relative(root, realPath(path));
    return inside === ".." || inside.startsWith("../") || isAbsolute(inside) ? undefined : inside;
  };
  const shown = insidePath(file);
  const real = realPath(file);
  const covered = new Map<string, boolean>();
  // Whether rustfmt takes a file of the repository, or fails, before it
  // leaves the repository, starting in `folder`, a real path inside it.
  const isCovered = (folder: string): boolean => {
    const known = covered.get(folder);
    if (known !== undefined) {
      return known;
    }
    const found = lookIn(folder);
    const result = found !== "none" || (folder !== root && isCovered(dirname(folder)));
    covered.set(folder, result);
    return result;
  };
  const concerned = workspaces
    .map((workspace) => ({
      workspace,
      crates: workspace.members
        .filter(
          (pkg) => shown === undefined || !isWithin(realPath(dirname(pkg.manifest_path)), real),
        )
        .filter((pkg) =>
          pkg.targets.some((target) => {
            const folder = realPath(dirname(target.src_path ?? pkg.manifest_path));
            return insidePath(folder) !== undefined && !isCovered(folder);
          }),
        )
        .map((pkg) => pkg.manifest_path),
    }))
    .filter(({ crates }) => crates.length > 0);
  if (concerned.length === 0) {
    return [];
  }
  const subject = describeWorkspaces(concerned.map(({ workspace }) => workspace.root));
  const guide = 'see "Rustfmt configuration outside the repository" in the nx-rust caching guide';
  const message = [
    shown === undefined
      ? `nx-rust: rustfmt takes its configuration from ${file} for the crates of ${subject} that no rustfmt.toml or .rustfmt.toml in the repository covers, but the file lies outside the repository, so Nx does not hash it, and a fmt-check result cached before a change to it can be restored afterwards.`
      : `nx-rust: rustfmt takes its configuration from ${shown}, a per-user file that HOME or XDG_CONFIG_HOME places in the repository, for the crates of ${subject} that no other rustfmt.toml or .rustfmt.toml covers, but the file lies outside the folders of those crates, so their keys do not hold it, and a fmt-check result cached before a change to it can be restored afterwards.`,
    `Add a rustfmt.toml to the repository root to have every machine format alike and Nx hash it, or run \`nx reset\` after each change to the file; --skip-nx-cache covers only the command it is given to (${guide}).`,
  ].join("\n");
  for (const { workspace, crates } of concerned) {
    for (const manifest of crates) {
      workspace.formattingWarnings.set(manifest, message);
    }
  }
  return [message];
}

// What rustfmt finds in the folder: the first of its names that is a file,
// following symbolic links; "none" where neither is, as for a missing name
// or folder; and "stop" for another error, on which rustfmt fails.
function lookIn(folder: string): Lookup {
  for (const name of fileNames) {
    const path = join(folder, name);
    try {
      if (statSync(path).isFile()) {
        return path;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return "stop";
      }
    }
  }
  return "none";
}

// Whether `path` lies in `folder` or below it, both real paths.
function isWithin(folder: string, path: string): boolean {
  const inside = relative(folder, path);
  return inside !== "" && inside !== ".." && !inside.startsWith("../") && !isAbsolute(inside);
}

function userHome(): string | undefined {
  try {
    return userInfo().homedir || undefined;
  } catch {
    return undefined;
  }
}
