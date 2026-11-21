import {
  constants,
  copyFileSync,
  linkSync,
  lstatSync,
  renameSync,
  type Stats,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ExecutorContext } from "@nx/devkit";
import { targetCargoMetadataKey } from "../graph/targets";

/**
 * The targets of the batch of `build` whose cargo commands link the
 * executables, `cdylib` and `staticlib` files of crates whose `build` is
 * not among their own tasks (`EVD-CARGO-ARTIFACT-WRITERS`). `cargo doc`
 * links none. `cargo test` and `cargo bench` link executables too, but
 * leave them as plain cargo does after a `build` (`ADR-TEST-AFTER-BUILD`).
 */
const linkingTargets: ReadonlySet<string> = new Set(["build", "napi-build", "wasm-build"]);

/** A file that a group keeps while its commands run ({@link keepFiles}). */
export interface KeptFile {
  /** The file, an output of another task's `build`. */
  path: string;
  /** The task whose output it is, as `project:target`. */
  owner: string;
  /** The second name under which the group keeps it, in the same folder. */
  aside: string;
  /** The file as the group found it. */
  before: FileState;
  /** The second name's file as the group made it. */
  kept: FileState;
}

type FileState = Pick<Stats, "dev" | "ino" | "size" | "mtimeMs">;

function state({ dev, ino, size, mtimeMs }: Stats): FileState {
  return { dev, ino, size, mtimeMs };
}

function same(a: FileState, b: FileState): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/**
 * The files that a group of a batch keeps while its commands run, so that
 * they are as it found them afterwards (`DES-BATCH`, "Files that a batch
 * leaves on disk"): the declared outputs of every `build` task of the
 * command's task graph that is not one of the group's tasks, each with the
 * task it belongs to; for a group that selects its crates, only those of the
 * builds of its own crates' projects, since its commands write no other
 * crate's files (`EVD-CARGO-ARTIFACT-WRITERS`). Only groups of `build`,
 * `napi-build` and `wasm-build` keep any.
 *
 * @param ids The group's tasks.
 * @param target The default name of the group's target.
 * @param wholeWorkspace Whether the group's commands select the whole workspace.
 * @param context The executor context of a task of the group, whose task
 *   graph is the command's.
 * @returns The files, absolute, with the task each belongs to.
 */
// @mara implements DES-BATCH
export function keptOutputs(
  ids: readonly string[],
  target: string,
  wholeWorkspace: boolean,
  context: ExecutorContext,
): { path: string; owner: string }[] {
  if (!linkingTargets.has(target)) {
    return [];
  }
  const own = new Set(ids);
  const projects = new Set(ids.map((id) => context.taskGraph?.tasks[id]?.target.project));
  const files: { path: string; owner: string }[] = [];
  for (const [id, task] of Object.entries(context.taskGraph?.tasks ?? {})) {
    const { project, target: name } = task.target;
    if (own.has(id) || (!wholeWorkspace && !projects.has(project))) {
      continue;
    }
    const metadata = context.projectGraph?.nodes[project]?.data.targets?.[name]?.metadata?.[
      targetCargoMetadataKey
    ] as { target?: unknown } | undefined;
    if (metadata?.target !== "build") {
      continue;
    }
    for (const output of task.outputs ?? []) {
      files.push({ path: resolve(context.root, output), owner: `${project}:${name}` });
    }
  }
  return files;
}

/**
 * Keeps each of `files` that is a regular file under a second name in its
 * folder, a hard link, or a copy where the file system refuses a link, so
 * that {@link putBack} can put it back once the group's commands have run.
 * Cargo replaces a file that it links into the artifact directory by
 * removing it first, and a linker writes a new file, so the kept one stays
 * as it was; {@link putBack} checks that it did.
 *
 * @returns The kept files, or the problem with the first one that could
 *   not be kept, in which case none is kept any more.
 */
export function keepFiles(
  files: readonly { path: string; owner: string }[],
): { kept: KeptFile[] } | { problem: string } {
  const kept: KeptFile[] = [];
  for (const { path, owner } of files) {
    let stats: Stats;
    try {
      stats = lstatSync(path);
    } catch {
      continue;
    }
    if (!stats.isFile()) {
      continue;
    }
    const aside = join(dirname(path), `.${basename(path)}.nx-rust-kept-${process.pid}`);
    try {
      unlinkSync(aside);
    } catch {
      // There is none from an earlier run of this process number.
    }
    try {
      try {
        linkSync(path, aside);
      } catch {
        copyFileSync(path, aside, constants.COPYFILE_FICLONE);
      }
      kept.push({ path, owner, aside, before: state(stats), kept: state(lstatSync(aside)) });
    } catch (error) {
      discard(kept);
      return {
        problem: `could not keep ${path}, which ${owner} stores, under a second name in its folder: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { kept };
}

/**
 * Puts back each file that {@link keepFiles} kept where the group's commands
 * replaced it, and removes the second names.
 *
 * @returns A problem for each file that could not be put back, or whose
 *   kept copy changed while the commands ran.
 */
export function putBack(kept: readonly KeptFile[]): string[] {
  const problems: string[] = [];
  for (const file of kept) {
    try {
      if (!same(state(lstatSync(file.aside)), file.kept)) {
        unlinkSync(file.aside);
        problems.push(
          `found that ${file.path}, which ${file.owner} stores, was written in place while the group's cargo commands ran, so that it could not keep the file as ${file.owner} left it`,
        );
        continue;
      }
      let current: Stats | undefined;
      try {
        current = lstatSync(file.path);
      } catch {
        current = undefined;
      }
      if (current !== undefined && same(state(current), file.before)) {
        unlinkSync(file.aside);
      } else {
        renameSync(file.aside, file.path);
      }
    } catch (error) {
      problems.push(
        `could not put back ${file.path}, which ${file.owner} stores, from ${file.aside}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return problems;
}

// Removes the second names of files kept so far.
function discard(kept: readonly KeptFile[]): void {
  for (const file of kept) {
    try {
      unlinkSync(file.aside);
    } catch {
      // Already gone.
    }
  }
}
