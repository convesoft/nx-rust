import { lstatSync, readlinkSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { CargoWorkspace, describeWorkspaces } from "./discovery";
import type { InputDefinition } from "./inputs";
import { physicalPath } from "./real-path";
import type { FileInput } from "./settings";

/** What a project's `fileInputs` give: the filesets for its key, or why graph creation stops. */
export interface DeclaredFiles {
  /** One fileset per pattern, with `includeIgnored`, in the order of the patterns. */
  filesets: InputDefinition[];
  /** The problems of `DES-DIAGNOSTICS` that the patterns have; graph creation stops on any. */
  problems: string[];
}

/** The characters that make a path segment a glob for Nx, and a backslash that may escape one. */
const globCharacters = /[*?[\]{}()\\]/;

/**
 * A `..` segment in a glob, also one that an alternative of braces gives,
 * such as `{a,..}/x`.
 */
const parentAfterGlob = /(^|[/{,])\.\.($|[/},])/;

/**
 * Turns the `fileInputs` patterns of a crate's tables into the filesets of
 * `DES-INPUTS` ("Declared files"): each pattern resolved against the folder
 * of the manifest that holds it, as `{workspaceRoot}/<path>` with
 * `includeIgnored`, so that Nx hashes a declared file that Git ignores.
 *
 * Nx fails the hash of every task whose `includeIgnored` fileset has a `.`
 * or `..` segment, so the pattern's fixed part, its segments before the
 * first one with a glob character, is resolved here as the system resolves
 * it, the symbolic links in it included. Nx keeps the hash of a link to a
 * file until the link itself changes, and matches changed files by their
 * own paths (`EVD-NX-24-FILE-INPUTS`). The pattern therefore gives a
 * fileset for each link that its fixed part passes, at the path where the
 * link itself lies, so that a change to the link is seen, and one for the
 * real path with the rest of the pattern, so that a change to what the
 * links lead to is seen. A link that only the glob part reaches stays as it
 * is.
 *
 * Each of these is a problem that names the manifest and the pattern
 * (`REQ-FILE-INPUTS-HASHABLE`): a `..` after a glob character, which could
 * lead anywhere and fails Nx's hash; a real path outside the repository, or
 * a link outside it that the fixed part passes; and a real path in the
 * build or artifact directory of the crate's workspace. Nx hashes no file
 * that a fileset names by a path that leaves the repository, and
 * `nx affected` sees no change to a file outside it, so the message for
 * such a pattern points to `runtimeInputs`.
 *
 * @param fileInputs The patterns of both tables, each with its manifest relative to the repository root.
 * @param workspace The crate's workspace, whose Cargo directories no pattern may point into.
 * @param repositoryRoot The absolute path of the repository root.
 */
// @mara implements DES-INPUTS
// @mara implements REQ-BUILD-SCRIPT-INPUTS
// @mara implements REQ-FILE-INPUTS-HASHABLE
// @mara implements DES-DIAGNOSTICS
export function declaredFiles(
  fileInputs: readonly FileInput[],
  workspace: Pick<CargoWorkspace, "root" | "report">,
  repositoryRoot: string,
): DeclaredFiles {
  const filesets = new Map<string, InputDefinition>();
  const problems: string[] = [];
  const realRoot = physicalPath(repositoryRoot);
  const directories = cargoDirectories(workspace);
  const declare = (path: string) => {
    const fileset = path === "" ? "{workspaceRoot}/**/*" : `{workspaceRoot}/${path}`;
    filesets.set(fileset, { fileset, includeIgnored: true });
  };
  for (const input of fileInputs) {
    const { start, fixed, glob } = splitPattern(input, repositoryRoot);
    if (parentAfterGlob.test(glob)) {
      problems.push(parentAfterGlobProblem(input));
      continue;
    }
    const { real, links } = resolveFixed(start, fixed);
    const path = within(realRoot, real);
    if (path === undefined) {
      const resolved = [real, glob].filter((part) => part !== "").join("/");
      problems.push(outsideProblem(input, `resolves to ${resolved}`));
      continue;
    }
    const outsideLink = links.find((link) => within(realRoot, link) === undefined);
    if (outsideLink !== undefined) {
      problems.push(outsideProblem(input, `runs through the symbolic link ${outsideLink}`));
      continue;
    }
    const directory = directories.find(
      (directory) => within(directory.realPath, real) !== undefined,
    );
    if (directory !== undefined) {
      problems.push(cargoDirectoryProblem(input, directory, workspace, repositoryRoot));
      continue;
    }
    for (const link of links) {
      declare(within(realRoot, link) ?? "");
    }
    declare([path, glob].filter((part) => part !== "").join("/"));
  }
  return { filesets: [...filesets.values()], problems };
}

/**
 * The pattern against its manifest's folder: where it starts, as a real
 * path, the segments before the first one with a glob character, as
 * written, and the rest of the pattern, without `.` segments and empty
 * ones. A relative pattern starts at its manifest's folder. An absolute one
 * starts at the repository root where it begins with the root's path, so
 * that the links in the spelling of the root itself, such as `/tmp` on
 * macOS, are not counted as links that the pattern passes; elsewhere at the
 * file system's root.
 */
function splitPattern(
  input: FileInput,
  repositoryRoot: string,
): { start: string; fixed: string[]; glob: string } {
  let pattern = input.pattern;
  let start = physicalPath(join(repositoryRoot, posix.dirname(input.manifest)));
  if (posix.isAbsolute(pattern)) {
    const root = repositoryRoot.endsWith(sep) ? repositoryRoot : `${repositoryRoot}${sep}`;
    start = pattern.startsWith(root) ? physicalPath(repositoryRoot) : sep;
    pattern = pattern.startsWith(root) ? pattern.slice(root.length) : pattern;
  }
  const fixed: string[] = [];
  const glob: string[] = [];
  for (const segment of pattern.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    (glob.length > 0 || globCharacters.test(segment) ? glob : fixed).push(segment);
  }
  return { start, fixed, glob: glob.join("/") };
}

/** Linux's MAXSYMLINKS. */
const maximumLinks = 40;

/**
 * The real path that `segments` reach from the real folder `start`, as the
 * system resolves it: a `..` leaves the folder that a link before it leads
 * to, a link whose target does not exist yet is followed too, and segments
 * that do not exist are added as written. With it, the absolute path of
 * every link passed on the way, its folder resolved and itself not, in the
 * order they are passed, also those that a link's target passes.
 */
function resolveFixed(
  start: string,
  segments: readonly string[],
): { real: string; links: string[] } {
  const links: string[] = [];
  const visit = (folder: string, parts: readonly string[]): string => {
    let current = folder;
    for (const part of parts) {
      if (part === "" || part === ".") {
        continue;
      }
      if (part === "..") {
        current = dirname(current);
        continue;
      }
      const next = join(current, part);
      const target = links.length < maximumLinks ? linkTarget(next) : undefined;
      if (target === undefined) {
        current = next;
        continue;
      }
      links.push(next);
      current = visit(isAbsolute(target) ? sep : current, target.split(sep));
    }
    return current;
  };
  return { real: visit(start, segments), links };
}

/** What the symbolic link at `path` points to, or `undefined` where no link lies there. */
function linkTarget(path: string): string | undefined {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined;
  } catch {
    // Missing, or below a file.
    return undefined;
  }
}

/** `path` relative to `folder` where it lies in it, `""` for the folder itself; else `undefined`. */
function within(folder: string, path: string): string | undefined {
  const inside = relative(folder, path);
  return inside === ".." || inside.startsWith("../") || isAbsolute(inside) ? undefined : inside;
}

/** One of Cargo's directories of the workspace. */
interface CargoDirectory {
  /** What the directory is to Cargo: `build directory`, `artifact directory` or both. */
  role: string;
  /** Its absolute path, as cargo reports it. */
  path: string;
  /** The folder that the system reaches through it ({@link physicalPath}). */
  realPath: string;
}

/** The workspace's build and artifact directories, once each, also before Cargo creates them. */
function cargoDirectories(workspace: Pick<CargoWorkspace, "report">): CargoDirectory[] {
  const { build_directory: build, target_directory: artifact } = workspace.report;
  const directory = (role: string, path: string): CargoDirectory => ({
    role,
    path: resolve(path),
    realPath: physicalPath(path),
  });
  if (build === undefined || physicalPath(build) === physicalPath(artifact)) {
    const role = build === undefined ? "artifact directory" : "build and artifact directory";
    return [directory(role, artifact)];
  }
  return [directory("build directory", build), directory("artifact directory", artifact)];
}

function parentAfterGlobProblem(input: FileInput): string {
  return [
    `${input.manifest}: the fileInputs pattern ${JSON.stringify(input.pattern)} has a ".." segment after a glob character, so that nx-rust cannot tell which folder it reaches, and Nx cannot hash it.`,
    'Put every ".." before the first glob character, such as "*", "?" or "{".',
  ].join(" ");
}

/** @param where Where the pattern leaves the repository, such as `resolves to /x`. */
function outsideProblem(input: FileInput, where: string): string {
  return [
    `${input.manifest}: the fileInputs pattern ${JSON.stringify(input.pattern)} ${where}, outside the repository, whose files Nx does not track.`,
    "To key the crate's tasks on such files, add a command to runtimeInputs that prints them or a hash of them; nx affected does not see a change to its output.",
  ].join(" ");
}

function cargoDirectoryProblem(
  input: FileInput,
  directory: CargoDirectory,
  workspace: Pick<CargoWorkspace, "root">,
  repositoryRoot: string,
): string {
  const shown = within(repositoryRoot, directory.path) || directory.path;
  return [
    `${input.manifest}: the fileInputs pattern ${JSON.stringify(input.pattern)} resolves into ${shown}, Cargo's ${directory.role} of ${describeWorkspaces([workspace.root])}.`,
    "Cargo writes the files there; declare the files that they are made from instead.",
  ].join(" ");
}
