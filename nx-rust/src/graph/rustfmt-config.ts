import { realpathSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { CargoWorkspace, describeWorkspaces } from "./discovery";

/** The names of rustfmt's configuration file, in the order in which rustfmt looks for them in a folder. */
const fileNames = [".rustfmt.toml", "rustfmt.toml"];

/**
 * The rustfmt configuration file that rustfmt takes for a file of the
 * repository where no folder from the file's up to the repository root
 * holds one, or `undefined` where it takes none (`DES-DIAGNOSTICS`,
 * "Rustfmt configuration outside the repository"). rustfmt looks in each
 * folder above the file's, up to the file system's root, then in the home
 * folder and then in `rustfmt` in the user's configuration folder, and in
 * each for `.rustfmt.toml` before `rustfmt.toml`, and takes the first file
 * it finds (`EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`). This repeats only the
 * folders above the repository's real path and the two per-user folders,
 * with the home folder from `HOME`, or the user's entry where it is unset or
 * empty, and the configuration folder from an absolute `XDG_CONFIG_HOME`,
 * else `.config` in the home folder, and on macOS `Library/Application
 * Support` there.
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
  let folder = realPathOf(repositoryRoot);
  while (dirname(folder) !== folder) {
    folder = dirname(folder);
    const found = fileIn(folder);
    if (found !== undefined) {
      return found;
    }
  }
  const home = env.HOME !== undefined && env.HOME !== "" ? env.HOME : userHome();
  if (home === undefined) {
    return undefined;
  }
  const xdg = env.XDG_CONFIG_HOME;
  const configuration =
    platform === "darwin"
      ? join(home, "Library", "Application Support")
      : xdg !== undefined && isAbsolute(xdg)
        ? xdg
        : join(home, ".config");
  return fileIn(home) ?? fileIn(join(configuration, "rustfmt"));
}

/**
 * The warning about a rustfmt configuration file outside the repository
 * that applies to crates of the workspaces, because no folder from a
 * crate's up to the repository root holds `rustfmt.toml` or
 * `.rustfmt.toml` ({@link outsideRustfmtConfiguration}), one for all the
 * workspaces that it concerns, or none. It joins the
 * {@link CargoWorkspace.formattingWarnings} of each crate that it concerns,
 * whose `fmt-check` and `fmt` tasks print it at their start; like the
 * warning about Cargo configuration that Nx does not hash, no key holds it,
 * so that a machine's rustfmt configuration gives no keys of their own
 * (`RISK-HOST-ENVIRONMENT`, `DES-DIAGNOSTICS`).
 *
 * The folders that the check looks at are those of the crates' manifests,
 * not those of their source files, below which a folder can hold a
 * configuration file that rustfmt takes for the files below it.
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
  const covered = new Map<string, boolean>();
  const isCovered = (folder: string): boolean => {
    const known = covered.get(folder);
    if (known !== undefined) {
      return known;
    }
    const inside = relative(repositoryRoot, folder);
    const result =
      inside === ".." || inside.startsWith("../") || isAbsolute(inside)
        ? true
        : fileIn(folder) !== undefined || (inside !== "" && isCovered(dirname(folder)));
    covered.set(folder, result);
    return result;
  };
  const concerned = workspaces
    .map((workspace) => ({
      workspace,
      crates: workspace.members
        .map((pkg) => pkg.manifest_path)
        .filter((manifest) => !isCovered(dirname(manifest))),
    }))
    .filter(({ crates }) => crates.length > 0);
  if (concerned.length === 0) {
    return [];
  }
  const subject = describeWorkspaces(concerned.map(({ workspace }) => workspace.root));
  const guide = 'see "Rustfmt configuration outside the repository" in the nx-rust caching guide';
  const message = [
    `nx-rust: rustfmt takes its configuration from ${file} for the crates of ${subject} that no rustfmt.toml or .rustfmt.toml in the repository covers, but the file lies outside the repository, so Nx does not hash it, and a fmt-check result cached before a change to it can be restored afterwards.`,
    `Add a rustfmt.toml to the repository root to have every machine format alike and Nx hash it, or run \`nx reset\` after each change to the file; --skip-nx-cache covers only the command it is given to (${guide}).`,
  ].join("\n");
  for (const { workspace, crates } of concerned) {
    for (const manifest of crates) {
      workspace.formattingWarnings.set(manifest, message);
    }
  }
  return [message];
}

// The configuration file that rustfmt takes in the folder, the first of its
// names that is a file, following symbolic links, or undefined.
function fileIn(folder: string): string | undefined {
  for (const name of fileNames) {
    const path = join(folder, name);
    try {
      if (statSync(path).isFile()) {
        return path;
      }
    } catch {
      // Missing or unreadable: rustfmt goes on to the next name.
    }
  }
  return undefined;
}

function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function userHome(): string | undefined {
  try {
    return userInfo().homedir || undefined;
  } catch {
    return undefined;
  }
}
