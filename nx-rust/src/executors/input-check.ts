import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { configuredDepInfoBasedir } from "../cargo/dep-info-basedir";
import type { BuildRecordSource } from "../graph/build-records";
import { physicalPath } from "../graph/real-path";
import { type BuildSelection, nameRecords, type NamedRecord, parseRecord } from "./build-records";
import type { NxTaskFiles } from "./nx-task-files";

/** What the check of a `build` task needs besides the files that Nx knows. */
export interface BuildInputCheck {
  /** The task, as `<project>:<target>`. */
  task: string;
  /** The crate's package name. */
  crate: string;
  /** The crate's manifest, relative to the repository root. */
  manifest: string;
  /** What graph creation reported for the crate's records. */
  records: BuildRecordSource;
  /** The task's feature, profile and triple options. */
  selection: BuildSelection;
  /** The task's environment, for `CARGO_BUILD_TARGET` and Cargo's configuration. */
  env: Readonly<Record<string, string | undefined>>;
  /** The absolute path of the folder where cargo ran, the workspace root. */
  cwd: string;
}

/** A file in the repository that a record names, resolved. */
interface ReadFile {
  /** Its real path relative to the repository's real path. */
  file: string;
  /** The symbolic link, relative to the repository root, through which cargo recorded it. */
  link?: string;
  /** The folder that cargo recorded as one path and that holds the file, relative to the repository root. */
  folder?: string;
}

/**
 * Checks a `build` task after a cargo call that built its crate without
 * error, fresh or not (`DES-BUILD-INPUT-CHECK`): reads the records that the
 * call exported for the crate's library and binaries, as {@link nameRecords}
 * names them, resolves every path they hold to the file it names, leaves out
 * those outside the repository and in Cargo's build or artifact directory,
 * enumerates a recorded folder as Nx sees it, and compares each file with
 * Nx's matching of the task's file inputs.
 *
 * @param nx What Nx knows about the task's files, asked only where a record
 *   names a file in the repository.
 * @returns The task's failure message where a file is not covered, naming
 *   the crate, each such file and the `fileInputs` line that would cover
 *   them; `undefined` where every file is covered.
 */
// @mara implements DES-BUILD-INPUT-CHECK
// @mara implements REQ-BUILD-INPUT-CHECK
export async function checkBuildInputs(
  check: BuildInputCheck,
  repositoryRoot: string,
  nx: () => Promise<NxTaskFiles>,
): Promise<string | undefined> {
  const root = realPathOf(repositoryRoot) ?? resolve(repositoryRoot);
  const absolute = (path: string) => physicalPath(isAbsolute(path) ? path : join(root, path));
  const artifactDirectory = absolute(check.records.artifactDirectory);
  const cargoDirectories = [artifactDirectory, absolute(check.records.buildDirectory)];
  const records = nameRecords(
    check.records,
    check.crate,
    check.selection,
    check.env,
    artifactDirectory,
  );
  const found = new Map<string, ReadFile>();
  const folders: string[] = [];
  let configuredBasedir: string | undefined | null = null;
  for (const record of records) {
    for (const { path, basedir } of recordedPaths(record, () => {
      if (configuredBasedir === null) {
        configuredBasedir = configuredDepInfoBasedir(check.cwd, check.env);
      }
      return configuredBasedir;
    })) {
      const spelled = isAbsolute(path)
        ? path
        : basedir === undefined
          ? undefined
          : join(basedir, path);
      const resolved =
        spelled === undefined ? undefined : resolveRead(spelled, root, cargoDirectories);
      if (resolved === undefined) {
        continue;
      }
      if (resolved.isFolder) {
        folders.push(resolved.file);
      } else if (!found.has(resolved.file)) {
        found.set(resolved.file, {
          file: resolved.file,
          ...(resolved.link === undefined ? {} : { link: resolved.link }),
        });
      }
    }
  }
  if (found.size === 0 && folders.length === 0) {
    return undefined;
  }
  const files = await nx();
  for (const folder of new Set(folders)) {
    for (const file of files.filesBelow(folder)) {
      const resolved = resolveListed(file, repositoryRoot, root, cargoDirectories);
      if (resolved !== undefined && !found.has(resolved.file)) {
        found.set(resolved.file, {
          file: resolved.file,
          ...(resolved.link === undefined ? {} : { link: resolved.link }),
          folder,
        });
      }
    }
  }
  const uncovered = [...found.values()]
    .filter(({ file }) => !files.inputFiles.has(file))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return uncovered.length === 0 ? undefined : failureMessage(check, uncovered, root);
}

/**
 * The paths that a record holds, each with the folder that a relative one
 * is relative to (`DES-BUILD-INPUT-CHECK`, points 3 and 4). Cargo writes a
 * path relative to `build.dep-info-basedir` where that folder holds it, and
 * absolute otherwise, the artifact of the rule included. The artifact lies
 * beside the record, so where the record spells it relatively, the folder
 * is the record's own folder without the artifact's relative path. Where it
 * spells the artifact absolutely, the artifact lies outside that folder, and
 * the folder comes from Cargo's configuration. A missing record names nothing.
 */
function recordedPaths(
  record: NamedRecord,
  configured: () => string | undefined,
): { path: string; basedir: string | undefined }[] {
  let text: string;
  try {
    text = readFileSync(record.path, "utf8");
  } catch {
    return [];
  }
  return parseRecord(text).flatMap(({ target, paths }) => {
    let basedir: string | undefined;
    if (paths.some((path) => !isAbsolute(path))) {
      basedir = isAbsolute(target)
        ? configured()
        : basedirFromArtifact(dirname(record.path), target);
      basedir ??= configured();
    }
    return paths.map((path) => ({ path, basedir }));
  });
}

// The folder that a relative artifact path is relative to, given the folder
// that holds the artifact; `undefined` where the spelling does not fit.
function basedirFromArtifact(folder: string, artifact: string): string | undefined {
  const relativePath = normalize(artifact);
  const full = join(folder, basename(relativePath));
  const suffix = `${sep}${relativePath}`;
  if (!full.endsWith(suffix)) {
    return undefined;
  }
  return full.slice(0, full.length - suffix.length) || sep;
}

/**
 * A recorded path resolved to what it names (point 4): symbolic links
 * followed, `..` taken as the system takes it, and on macOS the case of the
 * names on disk. `undefined` for a path that names nothing, lies outside the
 * repository, or lies in Cargo's build or artifact directory.
 */
function resolveRead(
  spelled: string,
  root: string,
  cargoDirectories: readonly string[],
): { file: string; link?: string; isFolder: boolean } | undefined {
  const real = realPathOf(spelled);
  if (real === undefined) {
    return undefined;
  }
  const file = within(root, real);
  if (
    file === undefined ||
    cargoDirectories.some((directory) => within(directory, real) !== undefined)
  ) {
    return undefined;
  }
  let isFolder: boolean;
  try {
    isFolder = statSync(real).isDirectory();
  } catch {
    return undefined;
  }
  // The link through which cargo recorded the file: the recorded spelling,
  // its `..` taken as text, where that is a symbolic link in the repository.
  const lexical = within(root, resolve(spelled));
  const link =
    !isFolder && lexical !== undefined && lexical !== file && isLink(join(root, lexical))
      ? lexical
      : undefined;
  return { file, ...(link === undefined ? {} : { link }), isFolder };
}

/**
 * A file that Nx lists below a recorded folder (point 5), resolved as
 * {@link resolveRead} does; a symbolic link to a folder is not followed.
 */
function resolveListed(
  listed: string,
  repositoryRoot: string,
  root: string,
  cargoDirectories: readonly string[],
): { file: string; link?: string } | undefined {
  const path = join(repositoryRoot, listed);
  const real = realPathOf(path);
  if (real === undefined) {
    return undefined;
  }
  const file = within(root, real);
  if (
    file === undefined ||
    cargoDirectories.some((directory) => within(directory, real) !== undefined)
  ) {
    return undefined;
  }
  try {
    if (!statSync(real).isFile()) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return file === listed ? { file } : { file, link: listed };
}

// The message of a failed check (point 7).
// @mara implements DES-DIAGNOSTICS
function failureMessage(
  check: BuildInputCheck,
  uncovered: readonly ReadFile[],
  root: string,
): string {
  const crateFolder =
    realPathOf(join(root, dirname(check.manifest))) ?? join(root, dirname(check.manifest));
  const fromCrate = (file: string) => {
    const path = relative(crateFolder, join(root, file)).split(sep).join(posix.sep);
    return path === "" ? "." : path;
  };
  const lines = uncovered.map(({ file, link, folder }) => {
    const notes = [
      ...(link === undefined ? [] : [`through the symbolic link ${link}`]),
      ...(folder === undefined
        ? []
        : [
            `in the folder ${folder === "" ? "at the repository root" : folder}, which cargo records as a whole`,
          ]),
    ];
    return `- ${file}${notes.length === 0 ? "" : `, ${notes.join(", ")}`}`;
  });
  const patterns = [...new Set(uncovered.map(({ file }) => escapeGlob(fromCrate(file))))];
  const folders = [
    ...new Set(uncovered.flatMap(({ folder }) => (folder === undefined ? [] : [folder]))),
  ];
  return [
    `${check.task}: cargo build read files in the repository that none of the task's inputs covers, so Nx would store its result under a cache key that misses them. The task fails, so that Nx stores no result for it.`,
    `The crate ${check.crate} read:`,
    ...lines,
    `Declare them under fileInputs in the [package.metadata.nx] table of ${check.manifest}, beside the patterns that it lists already:`,
    `fileInputs = [${patterns.map((pattern) => JSON.stringify(pattern)).join(", ")}]`,
    ...folders.map(
      (folder) =>
        `A pattern for the folder ${folder === "" ? "at the repository root" : folder}, ${JSON.stringify(folderPattern(fromCrate(folder)))}, also covers the files that are added to it later.`,
    ),
  ].join("\n");
}

// `**` below a folder relative to the crate's folder.
function folderPattern(folder: string): string {
  const escaped = escapeGlob(folder);
  return escaped === "." ? "**" : `${escaped}/**`;
}

// A path with the characters that make a pattern a glob escaped by a backslash.
function escapeGlob(path: string): string {
  return path.replace(/[*?[\]{}()\\]/g, (character) => `\\${character}`);
}

// The path relative to `root` with `/` separators, `""` for the root itself;
// `undefined` outside it.
function within(root: string, path: string): string | undefined {
  const inside = relative(root, path);
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return undefined;
  }
  return inside.split(sep).join(posix.sep);
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// The real path as the system resolves it, `..` after a link included, and
// on macOS with the case of the names on disk; `undefined` where nothing is
// there.
function realPathOf(path: string): string | undefined {
  let real: string;
  try {
    real = realpathSync.native(path);
  } catch {
    return undefined;
  }
  return process.platform === "darwin" ? caseOnDisk(real) : real;
}

/**
 * The path with each name in the case that the folder holding it lists, for
 * a file system that ignores case (`DES-BUILD-INPUT-CHECK`, point 4). A name
 * that the folder lists as it is stays.
 */
function caseOnDisk(path: string): string {
  const names = path.split(sep).filter((name) => name !== "");
  let current: string = sep;
  for (const name of names) {
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      return path;
    }
    const exact = entries.includes(name);
    const stored = exact
      ? name
      : (entries.find((entry) => entry.toLowerCase() === name.toLowerCase()) ?? name);
    current = join(current, stored);
  }
  return current;
}
