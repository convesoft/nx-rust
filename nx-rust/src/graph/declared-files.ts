import type { CreateDependenciesContext } from "@nx/devkit";
import { lstatSync, readlinkSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { CargoDiscovery, CargoWorkspace, describeWorkspaces } from "./discovery";
import type { InputDefinition } from "./inputs";
import { physicalPath } from "./real-path";
import type { FileInput } from "./settings";

/** What a project's `fileInputs` give: the filesets for its key, or why graph creation stops. */
export interface DeclaredFiles {
  /**
   * The filesets for the patterns, with `includeIgnored`, in the order of
   * the patterns: for each, those of the links it passes, the one for its
   * real path and those for the folders of the plugin's projects below
   * where it starts.
   */
  filesets: InputDefinition[];
  /** The problems of `DES-DIAGNOSTICS` that the patterns have; graph creation stops on any. */
  problems: string[];
  /** The patterns that gave filesets, as resolved, for {@link failOnUncoveredProjectFolders}. */
  patterns: DeclaredPattern[];
}

/**
 * A `fileInputs` pattern as graph creation resolved it, kept for the check
 * that `createDependencies` makes with the projects of every plugin
 * ({@link failOnUncoveredProjectFolders}).
 */
export interface DeclaredPattern {
  /** The pattern as written, with its manifest. */
  input: FileInput;
  /** The real name of the crate whose key the pattern goes into. */
  crate: string;
  /** The real path of the folder of the manifest, relative to the repository root. */
  manifestFolder: string;
  /**
   * The real path of the pattern's fixed part, relative to the repository
   * root, `""` for the root itself: the folder that Nx reads it from.
   */
  folder: string;
  /** The rest of the pattern, `""` where the fixed part is all of it. */
  glob: string;
  /** Every fileset that the crate's patterns give, this one's among them. */
  crateFilesets: readonly string[];
}

/** Who a crate's patterns are for, and which projects the plugin creates. */
export interface DeclaredScope {
  /** The real name of the crate whose key the patterns go into. */
  crate: string;
  /**
   * The folders of the projects that this entry of the plugin creates,
   * relative to the repository root ({@link pluginProjectRoots}).
   */
  projectRoots: readonly string[];
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
 * Nx matches an `includeIgnored` fileset only against the files of the
 * deepest project whose folder holds the folder it is read from, the
 * pattern's fixed part, and not against those of a project in a folder below
 * it; one that no project's folder holds, other than the repository root's,
 * against every file (`EVD-NX-24-FILESET-SCOPE`). For each folder of a
 * project of `scope` below the fixed part, other than the repository root,
 * the pattern therefore also gives a fileset that starts in that folder and
 * names the files below it that the pattern names ({@link patternsBelow}),
 * so that Nx counts them for the project that holds them. Projects of other
 * plugins and entries are checked in `createDependencies`
 * ({@link failOnUncoveredProjectFolders}).
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
 * @param scope The crate and the folders of the projects of the plugin's entry.
 */
// @mara implements DES-INPUTS
// @mara implements REQ-BUILD-SCRIPT-INPUTS
// @mara implements REQ-FILE-INPUTS-HASHABLE
// @mara implements DES-DIAGNOSTICS
export function declaredFiles(
  fileInputs: readonly FileInput[],
  workspace: Pick<CargoWorkspace, "root" | "report">,
  repositoryRoot: string,
  scope: DeclaredScope,
): DeclaredFiles {
  const filesets = new Map<string, InputDefinition>();
  const problems: string[] = [];
  const patterns: DeclaredPattern[] = [];
  const crateFilesets: string[] = [];
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
    const folder = toPosix(path);
    for (const root of folder === "" ? [] : scope.projectRoots) {
      if (isBelow(folder, root)) {
        for (const pattern of patternsBelow(glob, root.slice(folder.length + 1).split("/"))) {
          declare(folderFileset(root, pattern).slice("{workspaceRoot}/".length));
        }
      }
    }
    const manifestFolder = physicalPath(join(repositoryRoot, posix.dirname(input.manifest)));
    patterns.push({
      input,
      crate: scope.crate,
      manifestFolder: toPosix(relative(realRoot, manifestFolder)),
      folder,
      glob,
      crateFilesets,
    });
  }
  crateFilesets.push(...filesets.keys());
  return { filesets: [...filesets.values()], problems, patterns };
}

/** The fileset for the files below the project folder `root` that `pattern` names. */
function folderFileset(root: string, pattern: string): string {
  return `{workspaceRoot}/${escapeGlob(root)}/${pattern}`;
}

/**
 * The folders of the projects that the plugin's entry creates for the
 * workspaces of `discovery`, relative to the repository root, without the
 * root itself: each member's folder, and the folder of each root manifest
 * that Nx hands to the plugin (`inferProjects` in `projects.ts`).
 */
export function pluginProjectRoots(
  discovery: Pick<CargoDiscovery, "workspaceRoot" | "workspaces">,
): string[] {
  const roots = new Set(
    discovery.workspaces.flatMap((workspace) => [
      ...workspace.members.map((pkg) =>
        toPosix(relative(discovery.workspaceRoot, dirname(pkg.manifest_path))),
      ),
      ...(workspace.rootManifestHanded ? [toPosix(workspace.root)] : []),
    ]),
  );
  roots.delete("");
  roots.delete(".");
  return [...roots].sort();
}

/**
 * Fails when a `fileInputs` pattern names files in the folder of a project
 * that none of its crate's filesets covers, once Nx has merged the projects
 * of every plugin and entry.
 *
 * Nx matches an `includeIgnored` fileset only against the files of the
 * deepest project whose folder holds the folder that the fileset is read
 * from, and leaves out the projects in folders below it
 * (`EVD-NX-24-FILESET-SCOPE`). `declaredFiles` adds a fileset for each folder
 * of the entry's own projects there, but projects that other plugins or
 * entries create are known only here. For each project in a folder below
 * the fixed part of a pattern that a project's folder holds, the files that
 * the pattern names there count only where the crate's filesets hold the
 * fileset that `declaredFiles` would give that folder, or one for the whole
 * folder, as a pattern that the repository adds does. Otherwise the message
 * gives that fileset as a pattern relative to the manifest.
 *
 * @param patterns The patterns of the entry's projects and of the crates
 *   whose folders their inputs name ({@link DeclaredFiles.patterns}).
 * @param projects The merged projects that `createDependencies` receives.
 * @throws {Error} Naming the manifest, the pattern, its crates and the
 *   project for each folder, with the patterns that would cover it.
 */
// @mara implements DES-INPUTS
// @mara implements REQ-FILE-INPUTS-HASHABLE
// @mara implements DES-DIAGNOSTICS
export function failOnUncoveredProjectFolders(
  patterns: readonly DeclaredPattern[],
  projects: CreateDependenciesContext["projects"],
): void {
  const names = new Map<string, string>();
  for (const [name, project] of Object.entries(projects)) {
    const root = toPosix(posix.normalize(project.root ?? "")).replace(/\/$/, "");
    if (root !== "" && root !== "." && !names.has(root)) {
      names.set(root, name);
    }
  }
  const roots = [...names.keys()].sort();
  // The crates of each message, which a workspace's table gives to every member.
  const problems = new Map<string, Set<string>>();
  for (const pattern of patterns) {
    const owner = pattern.folder === "" ? undefined : deepestHolder(roots, pattern.folder);
    if (owner === undefined) {
      continue;
    }
    for (const root of roots) {
      if (!isBelow(pattern.folder, root)) {
        continue;
      }
      // What `declaredFiles` gives a project folder of its own entry, or a
      // pattern for the whole folder.
      const covered = (glob: string) =>
        [glob, "**", "**/*"].some((whole) =>
          pattern.crateFilesets.includes(folderFileset(root, whole)),
        );
      const below = patternsBelow(
        pattern.glob,
        root.slice(pattern.folder.length + 1).split("/"),
      ).filter((glob) => !covered(glob));
      if (below.length === 0) {
        continue;
      }
      const lines = below.map((glob) => {
        const path = posix.relative(pattern.manifestFolder, root) || ".";
        return `${escapeGlob(path)}/${glob}`;
      });
      const message = [
        `${pattern.input.manifest}: the fileInputs pattern ${JSON.stringify(pattern.input.pattern)} of {crates} names files in ${root}, the folder of the project "${names.get(root)}", which Nx would leave out of the cache keys.`,
        `The pattern starts in ${pattern.folder}, inside the folder of the project "${names.get(owner)}", and Nx matches such a pattern only against that project's own files, not against those of a project in a folder below it.`,
        `nx-rust adds a pattern for the folder of each project that it creates, but "${names.get(root)}" comes from another plugin or entry.`,
        `Add ${list(lines.map((line) => JSON.stringify(line)))} beside it in the fileInputs of ${pattern.input.manifest}, or narrow the pattern so that it does not reach ${root}.`,
      ].join(" ");
      problems.set(message, (problems.get(message) ?? new Set<string>()).add(pattern.crate));
    }
  }
  if (problems.size > 0) {
    throw new Error(
      [...problems]
        .map(([message, crates]) => {
          const sorted = [...crates].sort();
          return message.replace(
            "{crates}",
            `${sorted.length === 1 ? "the crate" : "the crates"} ${list(sorted)}`,
          );
        })
        .join("\n"),
    );
  }
}

/**
 * The patterns, relative to a folder below the one that a pattern starts in,
 * for the files below that folder that the rest of the pattern names: `**`
 * where the pattern names everything below it, as a pattern without a glob
 * that names a folder does, and none where it names nothing there.
 *
 * Each alternative of braces is followed on its own. A segment with a
 * group, such as `@(a|b)` or a brace left over, is taken to match every
 * name, which can only give more files than the pattern names.
 *
 * @param glob The rest of the pattern after the folder it starts in, `""` for none.
 * @param names The names of the folders from that folder down to the folder below it.
 */
export function patternsBelow(glob: string, names: readonly string[]): string[] {
  if (glob === "") {
    return ["**"];
  }
  const alternatives = braceAlternatives(glob);
  if (alternatives === undefined) {
    return ["**"];
  }
  const found = new Set<string>();
  for (const alternative of alternatives) {
    const segments = alternative.split("/").filter((segment) => segment !== "" && segment !== ".");
    // The positions in `segments` that the names read so far can lead to,
    // with each `**` also standing for no folder at all.
    const close = (states: Set<number>): Set<number> => {
      // A state added here is visited as well, which only adds what it adds already.
      for (const state of states) {
        for (let next = state; segments[next] === "**"; next++) {
          states.add(next + 1);
        }
      }
      return states;
    };
    let states = close(new Set([0]));
    for (const name of names) {
      const next = new Set<number>();
      for (const state of states) {
        if (state >= segments.length) {
          continue;
        }
        if (segments[state] === "**") {
          next.add(state);
        } else if (segmentMayMatch(segments[state], name)) {
          next.add(state + 1);
        }
      }
      states = close(next);
    }
    // A pattern that ends at the folder itself names no file below it.
    for (const state of states) {
      if (state < segments.length) {
        found.add(segments.slice(state).join("/"));
      }
    }
  }
  if (found.has("**") || found.has("**/*")) {
    return ["**"];
  }
  return [...found].filter((pattern) => !found.has(`**/${pattern}`)).sort();
}

/** The most alternatives that a pattern's braces are expanded to before it counts as `**`. */
const maximumAlternatives = 256;

/**
 * The pattern with each group of braces replaced by its alternatives, once
 * for each combination; `undefined` beyond {@link maximumAlternatives}. A
 * brace without its partner stays as it is.
 */
function braceAlternatives(pattern: string): string[] | undefined {
  let open = -1;
  for (let index = 0; index < pattern.length; index++) {
    if (pattern[index] === "\\") {
      index++;
    } else if (pattern[index] === "{") {
      open = index;
      break;
    }
  }
  if (open === -1) {
    return [pattern];
  }
  const commas: number[] = [];
  let depth = 0;
  let close = -1;
  for (let index = open + 1; index < pattern.length && close === -1; index++) {
    const character = pattern[index];
    if (character === "\\") {
      index++;
    } else if (character === "{") {
      depth++;
    } else if (character === "}") {
      if (depth === 0) {
        close = index;
      } else {
        depth--;
      }
    } else if (character === "," && depth === 0) {
      commas.push(index);
    }
  }
  if (close === -1) {
    return [pattern];
  }
  const bounds = [open, ...commas, close];
  const results: string[] = [];
  for (let index = 0; index < bounds.length - 1; index++) {
    const alternative = pattern.slice(bounds[index] + 1, bounds[index + 1]);
    const expanded = braceAlternatives(
      `${pattern.slice(0, open)}${alternative}${pattern.slice(close + 1)}`,
    );
    if (expanded === undefined || results.length + expanded.length > maximumAlternatives) {
      return undefined;
    }
    results.push(...expanded);
  }
  return results;
}

/**
 * Whether the segment of a pattern can match the folder name `name`: `*`
 * and `?` stand for any characters but `/`, a `[...]` class for one of its
 * characters, and a backslash makes the next character literal. A segment
 * with a group or a brace is taken to match.
 */
function segmentMayMatch(segment: string, name: string): boolean {
  if (/[(){}]/.test(segment)) {
    return true;
  }
  let source = "";
  for (let index = 0; index < segment.length; index++) {
    const character = segment[index];
    if (character === "\\" && index + 1 < segment.length) {
      source += escapeRegExp(segment[++index]);
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else if (character === "[") {
      const end = classEnd(segment, index);
      if (end === undefined) {
        source += "\\[";
      } else {
        const body = segment.slice(index + 1, end);
        const negated = body.startsWith("!") || body.startsWith("^");
        const members = (negated ? body.slice(1) : body).replace(/[\]\\^[]/g, (c) => `\\${c}`);
        source += `[${negated ? "^" : ""}${members}]`;
        index = end;
      }
    } else {
      source += escapeRegExp(character);
    }
  }
  try {
    return new RegExp(`^${source}$`).test(name);
  } catch {
    return true;
  }
}

/** The index of the `]` that closes the class opened at `open`, if any. */
function classEnd(segment: string, open: number): number | undefined {
  let index = open + 1;
  if (segment[index] === "!" || segment[index] === "^") {
    index++;
  }
  if (segment[index] === "]") {
    index++;
  }
  for (; index < segment.length; index++) {
    if (segment[index] === "\\") {
      index++;
    } else if (segment[index] === "]") {
      return index;
    }
  }
  return undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, (character) => `\\${character}`);
}

/** A path with the characters that make a pattern a glob escaped by a backslash. */
function escapeGlob(path: string): string {
  return path.replace(/[*?[\]{}()\\]/g, (character) => `\\${character}`);
}

/** Whether `path` lies strictly below `folder`, both relative to the repository root. */
function isBelow(folder: string, path: string): boolean {
  return path.startsWith(`${folder}/`);
}

/** The deepest of `roots` that is `folder` or holds it. */
function deepestHolder(roots: readonly string[], folder: string): string | undefined {
  let holder: string | undefined;
  for (const root of roots) {
    if ((folder === root || isBelow(root, folder)) && root.length > (holder?.length ?? -1)) {
      holder = root;
    }
  }
  return holder;
}

function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}

// `a`, `a and b`, `a, b and c`
function list(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
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
