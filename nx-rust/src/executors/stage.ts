import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import type { ExecutorContext } from "@nx/devkit";
import type { CargoDirectories } from "../cargo/directories";
import { targetCargoMetadataKey } from "../graph/targets";
import type { GroupSelection } from "./groups";
import type { GroupInvocation } from "./task";

/**
 * The folder in the artifact directory that holds the stages of staged
 * commands (`DES-BATCH`, "Staged builds"): on the file system of the files
 * that a stage's files replace, among Cargo's directories, and removed by
 * `cargo clean`.
 */
export const stageFolderName = ".nx-rust-stage";

/** The marker that names the process that owns a stage. */
const ownerFileName = ".nx-rust-owner";

/** A stage's folder name: the owning process's id and its counter. */
const stageNamePattern = /^(\d+)-(\d+)$/;

/** Where a staged command links its final artifacts, and the directories it moves them to. */
export interface Stage {
  /** The stage, `<artifact directory>/.nx-rust-stage/<process id>-<counter>`. */
  path: string;
  /** Cargo's directories for the command, as cargo reports them for its workspace root and environment. */
  directories: CargoDirectories;
}

/** A process as a stage's marker records it, to tell a reused process id from its owner. */
export interface StageOwner {
  pid: number;
  /** When the process started, as the system reports it; `undefined` where the system tells nothing. */
  start: string | undefined;
}

/** A stage could not be made. */
export class StageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageError";
  }
}

/**
 * The flags that make a cargo command build into `stage` (`DES-INVOCATION`):
 * `--target-dir` with the stage, and `build.build-dir` with the build
 * directory that cargo would use anyway, so that it builds and reuses
 * exactly what it would without the stage (`EVD-STAGED-BUILDS`).
 */
// @mara implements DES-INVOCATION
export function stageFlags(stage: Stage): string[] {
  return [
    "--target-dir",
    stage.path,
    "--config",
    `build.build-dir=${tomlString(stage.directories.build)}`,
  ];
}

/** `value` as a TOML basic string, which `--config` reads. */
export function tomlString(value: string): string {
  let text = '"';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === '"' || character === "\\") {
      text += `\\${character}`;
    } else if (code < 0x20 || code === 0x7f) {
      text += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      text += character;
    }
  }
  return `${text}"`;
}

let counter = 0;

/**
 * Makes a new, empty stage in the artifact directory of `directories` for
 * this process (`DES-BATCH`, "Staged builds"), after removing the stages
 * that processes which no longer run left there ({@link removeStaleStages}).
 * A folder of this process's id that this process did not make is the
 * leftover of an earlier process with the same id, and is removed too.
 *
 * @throws {StageError} Where the folder cannot be made or marked.
 */
// @mara implements DES-BATCH
export function createStage(
  directories: CargoDirectories,
  owner: StageOwner = currentOwner(),
  liveness: (pid: number) => StageOwner | "dead" = processState,
): Stage {
  const parent = join(directories.artifact, stageFolderName);
  removeStaleStages(directories.artifact, owner, liveness);
  try {
    mkdirSync(parent, { recursive: true });
  } catch (error) {
    throw new StageError(`could not make ${parent}: ${messageOf(error)}`);
  }
  for (;;) {
    const path = join(parent, `${owner.pid}-${counter++}`);
    if (!makeFolder(path, owner)) {
      continue;
    }
    try {
      writeFileSync(join(path, ownerFileName), `${JSON.stringify(owner)}\n`);
    } catch (error) {
      rmSync(path, { recursive: true, force: true });
      throw new StageError(`could not mark the stage ${path}: ${messageOf(error)}`);
    }
    return { path, directories };
  }
}

/**
 * Removes a stage and everything in it, where `stage.path` is a stage of
 * its artifact directory: a folder named `<process id>-<counter>` in its
 * `.nx-rust-stage` folder, and nothing else.
 *
 * @returns The problem where the folder could not be removed.
 */
export function removeStage(stage: Stage): string | undefined {
  if (!isStagePath(stage.path, stage.directories.artifact)) {
    return `@convesoft/nx-rust did not remove ${stage.path}, which is no stage of ${stage.directories.artifact}`;
  }
  try {
    rmSync(stage.path, { recursive: true, force: true });
    return undefined;
  } catch (error) {
    return `@convesoft/nx-rust could not remove the stage ${stage.path}: ${messageOf(error)}`;
  }
}

/**
 * Removes the stages in `artifactDirectory` that processes which no longer
 * run left there, such as an interrupted command's. A stage belongs to a
 * running process where the process of its id runs and, where both are
 * known, started when the stage's marker says, so that a process that got
 * a dead owner's id does not keep the dead owner's stage. A stage whose
 * marker is missing or unreadable belongs to the process of its id while
 * that runs, which covers the moment between making the folder and
 * marking it. Stages of this process are left alone.
 */
export function removeStaleStages(
  artifactDirectory: string,
  owner: StageOwner = currentOwner(),
  liveness: (pid: number) => StageOwner | "dead" = processState,
): void {
  const parent = join(artifactDirectory, stageFolderName);
  let names: string[];
  try {
    names = readdirSync(parent);
  } catch {
    return;
  }
  for (const name of names) {
    const match = stageNamePattern.exec(name);
    if (match === null) {
      continue;
    }
    const path = join(parent, name);
    const pid = Number(match[1]);
    const marked = readOwner(path);
    if (pid === owner.pid && (marked === undefined || sameOwner(marked, owner))) {
      continue;
    }
    const state = liveness(pid);
    const stale =
      state === "dead" ||
      (marked !== undefined &&
        marked.start !== undefined &&
        state.start !== undefined &&
        marked.start !== state.start);
    if (stale) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

/** A file of a staged command to move into the artifact directory. */
export interface StagedFile {
  /** The file in the stage. */
  from: string;
  /** The same path relative to the artifact directory. */
  to: string;
  /** The package whose target it is, as cargo's messages name it. */
  packageId: string;
}

/**
 * The final artifacts of the packages `packageIds` that a staged `build`
 * command linked into `stage` (`DES-BATCH`, "Staged builds"; `DES-OUTPUTS`):
 * from cargo's `compiler-artifact` messages in `output`, the files of each
 * `bin`, `cdylib` and `staticlib` target that lie in the stage, the
 * split-debuginfo files among them, and never an `rlib`, `rmeta` or the
 * file of a `dylib` or proc macro; and the dependency record that cargo
 * wrote beside a file of any target of the packages, where there is one,
 * which the build input check reads, also a library's that is only an
 * `rlib` (`DES-BUILD-INPUT-CHECK`). A file that a message names outside the
 * stage, such as a library's `rmeta` in the build directory, is not the
 * command's to move.
 */
// @mara implements DES-BATCH
export function stagedFinalFiles(
  output: string,
  stage: Stage,
  packageIds: ReadonlySet<string>,
): StagedFile[] {
  const files = new Map<string, StagedFile>();
  const add = (from: string, packageId: string): void => {
    const inside = withinFolder(stage.path, from);
    if (inside !== undefined && !files.has(from)) {
      files.set(from, { from, to: join(stage.directories.artifact, inside), packageId });
    }
  };
  for (const line of output.split("\n")) {
    if (!line.startsWith("{")) {
      continue;
    }
    let message: {
      reason?: unknown;
      package_id?: unknown;
      target?: { kind?: unknown };
      filenames?: unknown;
    };
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      message.reason !== "compiler-artifact" ||
      typeof message.package_id !== "string" ||
      !packageIds.has(message.package_id) ||
      !Array.isArray(message.target?.kind) ||
      !Array.isArray(message.filenames)
    ) {
      continue;
    }
    const kinds: unknown[] = message.target.kind;
    for (const file of message.filenames) {
      if (typeof file !== "string") {
        continue;
      }
      if (finalArtifact(kinds, file)) {
        add(file, message.package_id);
      }
      const record = recordBeside(file);
      if (withinFolder(stage.path, file) !== undefined && existsSync(record)) {
        add(record, message.package_id);
      }
    }
  }
  return [...files.values()];
}

/**
 * Moves each staged file to its place in the artifact directory, by rename,
 * which replaces a file there in one step, or, where the two lie on
 * different file systems, by a copy beside the place that is then renamed
 * onto it. Nothing outside the stage is taken and nothing outside the
 * artifact directory is written.
 *
 * @returns A problem for each file that could not be moved, by the package
 *   whose target it is.
 */
// @mara implements DES-BATCH
export function moveStagedFiles(stage: Stage, files: readonly StagedFile[]): Map<string, string[]> {
  const problems = new Map<string, string[]>();
  const fail = (file: StagedFile, problem: string): void => {
    problems.set(file.packageId, [...(problems.get(file.packageId) ?? []), problem]);
  };
  for (const file of files) {
    const inside = withinFolder(stage.path, file.from);
    if (
      inside === undefined ||
      file.to !== join(stage.directories.artifact, inside) ||
      withinFolder(join(stage.directories.artifact, stageFolderName), file.to) !== undefined
    ) {
      fail(file, `${file.from} is no file of the stage ${stage.path}`);
      continue;
    }
    try {
      mkdirSync(dirname(file.to), { recursive: true });
      try {
        renameSync(file.from, file.to);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
          throw error;
        }
        const copy = join(dirname(file.to), `.${basename(file.to)}.nx-rust-${process.pid}`);
        try {
          copyFileSync(file.from, copy);
          renameSync(copy, file.to);
        } catch (copyError) {
          rmSync(copy, { force: true });
          throw copyError;
        }
      }
    } catch (error) {
      fail(file, `could not move ${file.from} to ${file.to}: ${messageOf(error)}`);
    }
  }
  return problems;
}

/** This process, as a stage's marker records it. */
export function currentOwner(): StageOwner {
  return { pid: process.pid, start: processStart(process.pid) };
}

/**
 * Whether the process `pid` runs, and when it started: `"dead"` where the
 * system has no such process; where it has one that another user owns, it
 * runs.
 */
export function processState(pid: number): StageOwner | "dead" {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return "dead";
    }
  }
  return { pid, start: processStart(pid) };
}

/**
 * When the process `pid` started, as the system tells it, so that two
 * readings of one process agree and a process that got another's id
 * differs: on Linux, field 22 of `/proc/<pid>/stat`, in clock ticks since
 * boot; elsewhere, `ps -o lstart=`. `undefined` where neither tells it.
 */
export function processStart(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The command name, field 2, is in parentheses and may hold spaces.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = fields[19];
    if (ticks !== undefined && /^\d+$/.test(ticks)) {
      return `ticks:${ticks}`;
    }
  } catch {
    // No /proc, as on macOS.
  }
  const run = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const started = run.status === 0 ? run.stdout.trim() : "";
  return started === "" ? undefined : `lstart:${started}`;
}

/** Whether `path` is a stage of `artifactDirectory`. */
export function isStagePath(path: string, artifactDirectory: string): boolean {
  return (
    dirname(path) === join(artifactDirectory, stageFolderName) &&
    stageNamePattern.test(basename(path))
  );
}

// Whether `file` of a target of `kinds` is a final artifact that `build`
// declares (`DES-OUTPUTS`): an executable, or the file of a `cdylib` or
// `staticlib`, with its split-debuginfo file; not an `rlib` or `rmeta`, nor
// the library of a `dylib` or proc macro that shares a name with a `cdylib`'s.
function finalArtifact(kinds: readonly unknown[], file: string): boolean {
  if (/\.(rlib|rmeta)$/.test(file)) {
    return false;
  }
  if (kinds.includes("bin")) {
    return true;
  }
  if (/\.(a|lib)(\.dwp)?$/.test(file)) {
    return kinds.includes("staticlib");
  }
  return kinds.includes("cdylib");
}

// The dependency record that cargo writes beside a file that it links into
// the artifact directory: `<name>.d` for `<name>`, `<name>.wasm`,
// `lib<name>.so`, `.dylib`, `.a` or `.rlib`, and their split-debuginfo files.
function recordBeside(file: string): string {
  const name = basename(file)
    .replace(/\.dwp$/, "")
    .replace(/\.(so|dylib|a|lib|dll|wasm|exe|rlib|rmeta)$/, "");
  return join(dirname(file), `${name}.d`);
}

// `path` relative to `folder`, where it lies inside it.
function withinFolder(folder: string, path: string): string | undefined {
  if (!isAbsolute(path)) {
    return undefined;
  }
  const inside = relative(folder, path);
  return inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)
    ? undefined
    : inside;
}

// Makes the stage folder `path`; `false` where this process made it
// before, so that the caller takes the next name. A folder of this process's
// id that this process did not make is an earlier process's leftover, which
// is removed first.
function makeFolder(path: string, owner: StageOwner): boolean {
  try {
    mkdirSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new StageError(`could not make the stage ${path}: ${messageOf(error)}`);
    }
  }
  if (sameOwner(readOwner(path), owner)) {
    return false;
  }
  rmSync(path, { recursive: true, force: true });
  try {
    mkdirSync(path);
    return true;
  } catch (error) {
    throw new StageError(`could not make the stage ${path}: ${messageOf(error)}`);
  }
}

function readOwner(path: string): StageOwner | undefined {
  try {
    const owner = JSON.parse(
      readFileSync(join(path, ownerFileName), "utf8"),
    ) as Partial<StageOwner>;
    return typeof owner.pid === "number"
      ? { pid: owner.pid, start: typeof owner.start === "string" ? owner.start : undefined }
      : undefined;
  } catch {
    return undefined;
  }
}

function sameOwner(a: StageOwner | undefined, b: StageOwner): boolean {
  return a !== undefined && a.pid === b.pid && a.start === b.start;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a group's cargo command builds in a stage (`DES-BATCH`, "Staged
 * builds"): a `build` that selects the whole workspace, which would link
 * every member's final artifacts, and every compile of `napi-build` and
 * `wasm-build`, which moves none. A `build` that selects its crates with
 * `-p` writes only theirs, and `test`, `bench`, `check`, `lint` and `doc`
 * are never staged: `cargo test` would fix the stage's path into
 * `CARGO_BIN_EXE_<name>` (`EVD-STAGED-BUILDS`).
 */
// @mara implements DES-BATCH
export function stagesCommand(target: string | undefined, selection: GroupSelection): boolean {
  return (
    (target === "build" && selection.kind === "workspace") ||
    target === "napi-build" ||
    target === "wasm-build"
  );
}

/**
 * The group's command with the flags of `stage` after the target's own
 * arguments of every step, and, where `recordsInStage`, as for a
 * `napi-build` or `wasm-build` compile, which moves nothing out of the
 * stage, the build input check reading the records there.
 */
export function withStage(
  invocation: GroupInvocation,
  stage: Stage,
  recordsInStage = false,
): GroupInvocation {
  const flags = stageFlags(stage);
  const add = (args: readonly string[]): string[] => {
    const separator = args.indexOf("--");
    return separator === -1
      ? [...args, ...flags]
      : [...args.slice(0, separator), ...flags, ...args.slice(separator)];
  };
  return {
    ...invocation,
    unstagedArgs: invocation.unstagedArgs ?? invocation.args,
    args: add(invocation.args),
    steps: invocation.steps.map((step) => ({ ...step, args: add(step.args) })),
    ...(invocation.inputCheck === undefined || !recordsInStage
      ? {}
      : { inputCheck: { ...invocation.inputCheck, recordsFolder: stage.path } }),
  };
}

/**
 * The `build` tasks of `ids` that share a folder of the artifact directory
 * with another `build` task of the same project in the command, each with
 * its message (`DES-BATCH`, "Files that a batch stores"). The folder is
 * judged by what Nx itself resolved: the outputs of the tasks in the
 * command's task graph, for the task and its peers alike, which name the
 * artifact directory, the triple folder and the profile folder
 * (`DES-OUTPUTS`). Two tasks collide where an output of one is an output of
 * the other or lies inside it, so that each would store what the other's
 * cargo command wrote, which no stage keeps apart. A task whose outputs name
 * nothing, such as an uncached `build`, is not judged: Nx stores nothing for
 * it. The maintainer decided on 20 November 2026 that such tasks fail with
 * guidance instead of sharing a command.
 */
// @mara implements DES-BATCH
// @mara implements DES-DIAGNOSTICS
export function sharedBuildFolders(
  ids: readonly string[],
  context: ExecutorContext,
): Map<string, string> {
  const graph = context.taskGraph?.tasks ?? {};
  const builds = Object.entries(graph).filter(([, task]) => {
    const { project, target } = task.target;
    const metadata = context.projectGraph?.nodes[project]?.data.targets?.[target]?.metadata?.[
      targetCargoMetadataKey
    ] as { target?: unknown } | undefined;
    return metadata?.target === "build";
  });
  const refused = new Map<string, string>();
  for (const id of ids) {
    const task = graph[id];
    if (task === undefined) {
      continue;
    }
    const own = (task.outputs ?? []).map((output) => normalize(output));
    const folders = new Set<string>();
    const others: string[] = [];
    for (const [otherId, other] of builds) {
      if (otherId === id || other.target.project !== task.target.project) {
        continue;
      }
      const shared = sharedOutput(
        own,
        (other.outputs ?? []).map((output) => normalize(output)),
      );
      if (shared !== undefined) {
        others.push(otherId);
        folders.add(shared);
      }
    }
    if (others.length > 0) {
      const named = [...folders].join(" and ");
      refused.set(
        id,
        `${id}: ${others.join(" and ")} of this command ${others.length === 1 ? "builds" : "build"} the same crate into the same folder of its artifact directory, ${named}, so that each would store the files that the other's cargo command wrote. The task does not run, so that Nx stores no result for it. Run these tasks in separate nx commands.`,
      );
    }
  }
  return refused;
}

// The folder of an output that two lists share, an output of one being one
// of the other or lying inside it, as the outputs name it relative to the
// repository; `undefined` where they share none.
function sharedOutput(a: readonly string[], b: readonly string[]): string | undefined {
  for (const x of a) {
    for (const y of b) {
      if (x === y) {
        return dirname(x);
      }
      if (x.startsWith(`${y}/`)) {
        return y;
      }
      if (y.startsWith(`${x}/`)) {
        return x;
      }
    }
  }
  return undefined;
}
