import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { CargoWorkspace, describeWorkspaces } from "./discovery";
import type { InputDefinition } from "./inputs";
import { realPath } from "./real-path";
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
 * first one with a glob character, is resolved here, and the symbolic links
 * in it as well: Nx keeps the hash of a link to a file until the link
 * itself changes, and matches changed files by their real paths, so a
 * fileset that names a link would miss a change to what it points to
 * (`EVD-NX-24-FILE-INPUTS`). A link that only the glob part reaches stays
 * as it is.
 *
 * Each of these is a problem that names the manifest and the pattern
 * (`REQ-FILE-INPUTS-HASHABLE`): a `..` after a glob character, which could
 * lead anywhere and fails Nx's hash; a fixed part that resolves outside the
 * repository, also through a symbolic link; and one that resolves into the
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
  workspace: CargoWorkspace,
  repositoryRoot: string,
): DeclaredFiles {
  const filesets: InputDefinition[] = [];
  const problems: string[] = [];
  const realRoot = realPath(repositoryRoot);
  const directories = cargoDirectories(workspace);
  for (const input of fileInputs) {
    const { fixed, glob } = resolvePattern(input, repositoryRoot);
    if (parentAfterGlob.test(glob)) {
      problems.push(parentAfterGlobProblem(input));
      continue;
    }
    const real = realPathOfPrefix(fixed);
    const path = within(realRoot, real);
    if (path === undefined) {
      problems.push(outsideProblem(input, [real, glob].filter((part) => part !== "").join("/")));
      continue;
    }
    const directory = directories.find(
      (directory) =>
        within(directory.path, fixed) !== undefined ||
        within(directory.realPath, real) !== undefined,
    );
    if (directory !== undefined) {
      problems.push(cargoDirectoryProblem(input, directory, workspace, repositoryRoot));
      continue;
    }
    const rest = [path, glob].filter((part) => part !== "").join("/");
    filesets.push({
      fileset: rest === "" ? "{workspaceRoot}/**/*" : `{workspaceRoot}/${rest}`,
      includeIgnored: true,
    });
  }
  return { filesets, problems };
}

/**
 * The pattern resolved against its manifest's folder: the absolute path of
 * its segments before the first one with a glob character, without `.` and
 * `..` segments, and the rest of the pattern as written, without `.`
 * segments and empty ones.
 */
function resolvePattern(input: FileInput, repositoryRoot: string): { fixed: string; glob: string } {
  const start = posix.isAbsolute(input.pattern)
    ? "/"
    : join(repositoryRoot, posix.dirname(input.manifest));
  let fixed = start;
  const glob: string[] = [];
  for (const segment of input.pattern.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (glob.length > 0 || globCharacters.test(segment)) {
      glob.push(segment);
    } else {
      fixed = segment === ".." ? dirname(fixed) : join(fixed, segment);
    }
  }
  return { fixed, glob: glob.join("/") };
}

/**
 * The path with the symbolic links of its longest existing prefix
 * resolved, the rest appended as it is. A link whose target does not exist
 * yet is followed too, so that a pattern through it resolves where the
 * files will be.
 */
function realPathOfPrefix(path: string, links = 0): string {
  let existing = path;
  const rest: string[] = [];
  while (!isPresent(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  try {
    return join(realpathSync(existing), ...rest);
  } catch {
    // A link to a path that does not exist; 40 links, as Linux allows.
    if (links < 40 && isPresent(existing) && lstatSync(existing).isSymbolicLink()) {
      const target = resolve(dirname(existing), readlinkSync(existing));
      return realPathOfPrefix(join(target, ...rest), links + 1);
    }
    return path;
  }
}

/** Whether the path names a file, a folder or a link, whether or not the link's target exists. */
function isPresent(path: string): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    // Such as a path below a file.
    return false;
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
  /** Its real path. */
  realPath: string;
}

/**
 * The workspace's build and artifact directories, once each. Cargo creates
 * them on its first build, so each real path resolves only the part that
 * exists.
 */
function cargoDirectories(workspace: CargoWorkspace): CargoDirectory[] {
  const { build_directory: build, target_directory: artifact } = workspace.report;
  const directory = (role: string, path: string): CargoDirectory => ({
    role,
    path: resolve(path),
    realPath: realPathOfPrefix(resolve(path)),
  });
  if (build === undefined || resolve(build) === resolve(artifact)) {
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

function outsideProblem(input: FileInput, resolved: string): string {
  return [
    `${input.manifest}: the fileInputs pattern ${JSON.stringify(input.pattern)} resolves to ${resolved}, outside the repository, whose files Nx does not track.`,
    "To key the crate's tasks on such files, add a command to runtimeInputs that prints them or a hash of them; nx affected does not see a change to its output.",
  ].join(" ");
}

function cargoDirectoryProblem(
  input: FileInput,
  directory: CargoDirectory,
  workspace: CargoWorkspace,
  repositoryRoot: string,
): string {
  const shown = within(repositoryRoot, directory.path) || directory.path;
  return [
    `${input.manifest}: the fileInputs pattern ${JSON.stringify(input.pattern)} resolves into ${shown}, Cargo's ${directory.role} of ${describeWorkspaces([workspace.root])}.`,
    "Cargo writes the files there; declare the files that they are made from instead.",
  ].join(" ");
}
