import { constants, copyFileSync, linkSync, lstatSync, mkdirSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import type { ExecutorContext } from "@nx/devkit";
import {
  type CargoDirectories,
  DirectoryReportError,
  reportedDirectories,
} from "../cargo/directories";
import { hostTriple } from "../cargo/host-triple";
import type { CargoPackage } from "../cargo/metadata";
import { loadNxNative, type MatchGlobPaths } from "../compatibility/nx-bridge";
import { literalSegment } from "../graph/nx-glob";
import { finalFileNames } from "../graph/outputs";
import { physicalPath } from "../graph/real-path";
import { targetCargoMetadataKey, testReplacesExecutables } from "../graph/targets";
import { callTriples, profileFolder } from "./build-records";
import type { GroupMember } from "./group-run";
import type { GroupSelection } from "./groups";
import {
  createStage,
  moveStagedFiles,
  pathInStage,
  removeStage,
  type Stage,
  StageError,
} from "./stage";

/** A file that a group keeps while its commands run, with the build that stores it. */
export interface KeptCandidate {
  /** The file, absolute, below the artifact directory's physical path. */
  path: string;
  /** The cached `build` task of the command that stores it, as `project:target`. */
  owner: string;
}

/** What a group keeps while its commands run ({@link keepFiles}). */
export interface Keeping {
  /** The stage that holds the kept files; absent where nothing is kept. */
  stage?: Stage;
  files: KeptFile[];
}

/** A file that a group keeps, and the stage's link to it. */
export interface KeptFile extends KeptCandidate {
  /** The hard link, or copy, of the file in the stage. */
  staged: string;
  /** The file as the group found it. */
  before: FileState;
  /** The stage's file as the group made it. */
  kept: FileState;
}

type FileState = Pick<Stats, "dev" | "ino" | "size" | "mtimeMs" | "mode">;

function state({ dev, ino, size, mtimeMs, mode }: Stats): FileState {
  return { dev, ino, size, mtimeMs, mode };
}

function same(a: FileState, b: FileState): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.mode === b.mode
  );
}

/** A cached `build` task of the command, with its outputs relative to the repository. */
interface StoringBuild {
  owner: string;
  outputs: string[];
}

/**
 * The files that a `test` or `bench` group of a batch keeps while its
 * commands run, so that they are as the command's builds left them
 * afterwards (`DES-BATCH`, "Files that a test batch puts back").
 *
 * The candidates are the final files that the group's cargo commands can
 * link again: for each crate that the group can build for its tests, every
 * member of the workspace where the group selects the whole workspace and
 * its own crates where it selects them, those with a binary and an
 * integration test or bench for `test` ({@link testReplacesExecutables}) and
 * those with a binary for `bench`, the names that the outputs of a crate's
 * `build` give its final files ({@link finalFileNames}), in the folder of
 * each triple that the group's command builds for ({@link callTriples}) and
 * of its profile ({@link profileFolder}), below the physical path of the
 * artifact directory that cargo reports for the group.
 *
 * A candidate is kept where a cached `build` task of the command's task
 * graph that is not one of the group's tasks, and for a group that selects
 * its crates belongs to one of their projects, stores it: one of the
 * outputs that Nx resolved for the task names the file or a folder above
 * it, or is a glob that Nx's own glob matching accepts for it, with `!`
 * exclusions. No folder is listed and no file is searched for.
 *
 * @param members The group's tasks with their commands.
 * @param ids The group's task ids.
 * @param match Nx's glob matching, for outputs that are globs; loaded from
 *   the Nx of the repository where not given.
 * @param directoriesOf Cargo's directories for the group, as cargo reports them.
 * @returns The candidates that a build stores, with the group's
 *   directories, or the problem with which the group's tasks fail.
 */
// @mara implements DES-BATCH
export function filesToKeep(
  members: readonly GroupMember[],
  ids: readonly string[],
  selection: GroupSelection,
  context: ExecutorContext,
  match?: MatchGlobPaths,
  directoriesOf: (cwd: string, env: NodeJS.ProcessEnv) => CargoDirectories = reportedDirectories,
): { files: KeptCandidate[]; directories?: CargoDirectories } | { problem: string } {
  const [first] = members;
  const target = first?.prepared.target;
  if (first === undefined || (target !== "test" && target !== "bench")) {
    return { files: [] };
  }
  const wholeWorkspace = selection.kind === "workspace";
  const projects = new Set(ids.map((id) => context.taskGraph?.tasks[id]?.target.project));
  const builds = storingBuilds(new Set(ids), wholeWorkspace ? undefined : projects, context);
  const crates = (
    wholeWorkspace
      ? (first.invocation.workspaceMembers ?? [])
      : members.flatMap((member) =>
          member.invocation.package === undefined ? [] : [member.invocation.package],
        )
  ).filter(target === "test" ? testReplacesExecutables : hasBinary);
  if (builds.length === 0 || crates.length === 0) {
    return { files: [] };
  }
  let matcher = match;
  if (matcher === undefined && builds.some((build) => !build.outputs.every(isLiteral))) {
    try {
      matcher = loadNxNative(context.root).matchGlobPaths;
    } catch (error) {
      const owners = builds.filter((build) => !build.outputs.every(isLiteral));
      return {
        problem: `could not read the outputs ${owners.map((build) => `${build.outputs.join(", ")} of ${build.owner}`).join(" and ")} as Nx reads them, to tell which files those builds store, because Nx's glob matching could not be loaded: ${messageOf(error)}`,
      };
    }
  }
  let directories: CargoDirectories;
  try {
    const reported = directoriesOf(first.invocation.cwd, first.prepared.env);
    directories = {
      artifact: physicalPath(reported.artifact),
      build: physicalPath(reported.build),
    };
  } catch (error) {
    if (!(error instanceof DirectoryReportError)) {
      throw error;
    }
    return {
      problem: `could not get Cargo's directories for the group, to tell which files of the command's builds its cargo commands link again: ${error.message}`,
    };
  }
  const { options, env, cwd } = first.prepared;
  let picked = callTriples(options, env, cwd);
  // Cargo builds for the host's triple where the option or the configuration
  // says `host-tuple`, into that triple's folder, which a cached build that
  // names the triple stores.
  if (
    (picked.kind === "triples" && picked.triples.includes("host-tuple")) ||
    (picked.kind === "unnamed" && picked.value === "host-tuple")
  ) {
    const host =
      selection.kind === "workspace" && selection.host !== undefined && selection.host !== ""
        ? selection.host
        : hostTriple(cwd, env);
    if (host !== undefined) {
      picked = callTriples(options, env, cwd, host);
    }
  }
  // Any other triple whose folder the plugin cannot name, such as a target
  // specification file, gives no candidate (`DES-OUTPUTS`).
  const triples = picked.kind === "none" ? [""] : picked.kind === "triples" ? picked.triples : [];
  const profile = profileFolder(options.profile ?? (target === "bench" ? "bench" : undefined));
  const root = physicalPath(context.root);
  const files: KeptCandidate[] = [];
  const seen = new Set<string>();
  for (const crate of crates) {
    for (const triple of triples) {
      for (const name of finalFileNames(crate)) {
        const path = join(directories.artifact, triple, profile, name);
        const inside = relative(root, path);
        if (seen.has(path) || inside.startsWith("..") || isAbsolute(inside)) {
          continue;
        }
        seen.add(path);
        const owner = builds.find((build) =>
          stores(build.outputs, inside.split(sep).join("/"), matcher),
        );
        if (owner !== undefined) {
          files.push({ path, owner: owner.owner });
        }
      }
    }
  }
  return { files, directories };
}

/**
 * Keeps each of `files` that is a regular file in a new stage of the
 * artifact directory, a hard link at the same path relative to it, or a
 * copy where the file system refuses a link, so that {@link putBack} can put
 * it back once the group's commands have run. A missing file, or one that
 * is no regular file, such as a symbolic link, is not kept. Cargo replaces
 * a file that it links into the artifact directory by removing it first,
 * and a linker writes a new file, so the kept one stays as it was;
 * {@link putBack} checks that it did. No stage is made where nothing is kept.
 *
 * @returns What is kept, or the problem with the first file that could not
 *   be looked at or kept, in which case nothing is kept any more.
 */
// @mara implements DES-BATCH
export function keepFiles(
  files: readonly KeptCandidate[],
  directories: CargoDirectories | undefined,
): { keeping: Keeping } | { problem: string } {
  const found: { file: KeptCandidate; stats: Stats }[] = [];
  for (const file of files) {
    let stats: Stats;
    try {
      stats = lstatSync(file.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      return {
        problem: `could not look at ${file.path}, which ${file.owner} stores: ${messageOf(error)}`,
      };
    }
    if (stats.isFile()) {
      found.push({ file, stats });
    }
  }
  if (found.length === 0 || directories === undefined) {
    return { keeping: { files: [] } };
  }
  let stage: Stage;
  try {
    stage = createStage(directories);
  } catch (error) {
    if (!(error instanceof StageError)) {
      throw error;
    }
    return {
      problem: `could not make a stage to keep the files of the command's builds in: ${error.message}`,
    };
  }
  const kept: KeptFile[] = [];
  for (const { file, stats } of found) {
    const staged = pathInStage(stage, file.path);
    try {
      if (staged === undefined) {
        throw new Error("it lies outside the artifact directory");
      }
      mkdirSync(dirname(staged), { recursive: true });
      try {
        linkSync(file.path, staged);
      } catch {
        copyFileSync(file.path, staged, constants.COPYFILE_FICLONE);
      }
      kept.push({ ...file, staged, before: state(stats), kept: state(lstatSync(staged)) });
    } catch (error) {
      removeStage(stage);
      return {
        problem: `could not keep ${file.path}, which ${file.owner} stores, in the stage ${stage.path}: ${messageOf(error)}`,
      };
    }
  }
  return { keeping: { stage, files: kept } };
}

/**
 * Puts back each file that {@link keepFiles} kept where the group's commands
 * replaced or removed it, by the stage's move, and removes the stage.
 *
 * @returns A problem for each file that could not be put back, or whose
 *   kept copy changed while the commands ran, and a warning where the stage
 *   could not be removed.
 */
// @mara implements DES-BATCH
export function putBack(keeping: Keeping): { problems: string[]; warning?: string } {
  const { stage } = keeping;
  if (stage === undefined) {
    return { problems: [] };
  }
  const problems: string[] = [];
  for (const file of keeping.files) {
    try {
      if (!same(state(lstatSync(file.staged)), file.kept)) {
        problems.push(
          `found that ${file.path}, which ${file.owner} stores, was written in place or had its permissions changed while the group's cargo commands ran, so that it could not keep the file as ${file.owner} left it`,
        );
        continue;
      }
      let current: Stats | undefined;
      try {
        current = lstatSync(file.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
        current = undefined;
      }
      if (current !== undefined && same(state(current), file.before)) {
        continue;
      }
      const moved = moveStagedFiles(stage, [
        { from: file.staged, to: file.path, packageId: file.owner },
      ]);
      for (const failures of moved.values()) {
        problems.push(
          ...failures.map(
            (failure) => `could not put back ${file.path}, which ${file.owner} stores: ${failure}`,
          ),
        );
      }
    } catch (error) {
      problems.push(
        `could not put back ${file.path}, which ${file.owner} stores, from ${file.staged}: ${messageOf(error)}`,
      );
    }
  }
  const warning = removeStage(stage);
  return warning === undefined ? { problems } : { problems, warning };
}

// The cached `build` tasks of the command's task graph that are not tasks of
// the group, and, where `projects` is given, belong to one of them, each with
// its outputs as Nx resolved them, relative to the repository: an absolute
// output inside the repository made relative, one outside it left out, since
// Nx cannot store it.
function storingBuilds(
  own: ReadonlySet<string>,
  projects: ReadonlySet<string | undefined> | undefined,
  context: ExecutorContext,
): StoringBuild[] {
  const roots = [...new Set([context.root, physicalPath(context.root)])];
  const builds: StoringBuild[] = [];
  for (const [id, task] of Object.entries(context.taskGraph?.tasks ?? {})) {
    const { project, target } = task.target;
    if (own.has(id) || task.cache !== true || (projects !== undefined && !projects.has(project))) {
      continue;
    }
    const metadata = context.projectGraph?.nodes[project]?.data.targets?.[target]?.metadata?.[
      targetCargoMetadataKey
    ] as { target?: unknown } | undefined;
    if (metadata?.target !== "build") {
      continue;
    }
    const outputs = (task.outputs ?? []).flatMap((output) => {
      const negated = output.startsWith("!");
      const path = negated ? output.slice(1) : output;
      const inside = repositoryPath(path, roots);
      return inside === undefined ? [] : [`${negated ? "!" : ""}${inside}`];
    });
    if (outputs.some((output) => !output.startsWith("!"))) {
      builds.push({ owner: `${project}:${target}`, outputs });
    }
  }
  return builds;
}

// An output relative to the repository, with `/` between its segments and
// without a trailing one, `.` for the repository root itself; `undefined`
// for an absolute one outside it.
function repositoryPath(output: string, roots: readonly string[]): string | undefined {
  if (!isAbsolute(output)) {
    return normalize(output).split(sep).join("/").replace(/\/+$/, "") || ".";
  }
  for (const root of roots) {
    const inside = relative(root, output);
    if (!inside.startsWith("..") && !isAbsolute(inside)) {
      return inside.split(sep).join("/") || ".";
    }
  }
  return undefined;
}

// Whether a build whose outputs are `outputs` stores the file `path`, both
// relative to the repository: as Nx stores a task's outputs, a file that an
// output names, a file below a folder that one names, and for globs and
// exclusions what Nx's own glob matching accepts, each output also followed
// by `/**`, so that a folder that a glob matches stands for its files. An
// output that is the repository root, `.`, is a folder above every file.
function stores(
  outputs: readonly string[],
  path: string,
  match: MatchGlobPaths | undefined,
): boolean {
  if (outputs.every(isLiteral)) {
    return outputs.some(
      (output) => output === "." || output === path || path.startsWith(`${output}/`),
    );
  }
  if (match === undefined) {
    return false;
  }
  const globs = outputs.map((output) => (output === "." ? "**" : output === "!." ? "!**" : output));
  return match([...globs, ...globs.map((glob) => `${glob}/**`)], [path])[0] === true;
}

// Whether an output names a path rather than a glob: no exclusion and no
// pattern segment, as Nx reads its segments; an escape counts as a pattern.
function isLiteral(output: string): boolean {
  return (
    !output.startsWith("!") &&
    output
      .split("/")
      .every(
        (segment) =>
          segment === "" ||
          segment === "." ||
          segment === ".." ||
          literalSegment(segment) === segment,
      )
  );
}

function hasBinary(pkg: CargoPackage): boolean {
  return pkg.targets.some((target) => target.kind.includes("bin"));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
