import type { ExecutorContext } from "@nx/devkit";
import { join } from "node:path";

/** What Nx knows about the files of one task, from the Nx installed in the repository. */
export interface NxTaskFiles {
  /**
   * The files that Nx's hash of the task reads, by their paths relative to
   * the repository root: Nx's own matching of the task's file inputs.
   */
  inputFiles: ReadonlySet<string>;
  /**
   * The files that Nx sees below a folder, relative to the repository root:
   * none that `.gitignore`, `.nxignore` or Nx's fixed exclusions leave out,
   * and none below a symbolic link to a folder.
   *
   * @param folder A path relative to the repository root, `""` for the root.
   */
  filesBelow(folder: string): string[];
}

/**
 * Why the check cannot ask the installed Nx about a task's files: a part
 * that it lacks or that has changed. Its message is one line, the reason
 * alone ({@link skippedCheckWarning}).
 */
export class NxTaskFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NxTaskFilesError";
  }
}

/** The part of Nx's `HashPlanInspector` that the check uses. */
interface HashPlanInspector {
  init(): Promise<void>;
  inspectTaskInputs(
    target: { project: string; target: string; configuration?: string },
    parsedArgs: Record<string, unknown>,
    extraTargetDependencies: Record<string, unknown>,
    excludeTaskDependencies: boolean,
  ): Record<string, { files?: unknown }>;
}

/** The internal parts of the installed Nx that the check uses, loaded. */
export interface NxTaskFileParts {
  /** `HashPlanInspector` of `nx/src/hasher/hash-plan-inspector`. */
  Inspector: new (...args: unknown[]) => HashPlanInspector;
  /** `globWithWorkspaceContextSync` of `nx/src/utils/workspace-context`. */
  glob: (workspaceRoot: string, globs: string[]) => unknown;
}

/**
 * Loads the two parts of the installed Nx through which the check matches a
 * build's files with its inputs, which are not public API
 * (`RISK-UPSTREAM-CHANGES`): `HashPlanInspector`, which expands a task's
 * hash plan into the files it reads with Nx's own matching, and the glob of
 * the workspace context that it reads the files from.
 *
 * @throws {NxTaskFilesError} When the installed Nx lacks one of them, naming it.
 */
// @mara implements DES-BUILD-INPUT-CHECK
export function nxTaskFileParts(workspaceRoot: string): NxTaskFileParts {
  const Inspector = load("nx/src/hasher/hash-plan-inspector", workspaceRoot).HashPlanInspector;
  if (typeof Inspector !== "function") {
    throw new NxTaskFilesError(
      "the installed Nx lacks HashPlanInspector in nx/src/hasher/hash-plan-inspector",
    );
  }
  const glob = load("nx/src/utils/workspace-context", workspaceRoot).globWithWorkspaceContextSync;
  if (typeof glob !== "function") {
    throw new NxTaskFilesError(
      "the installed Nx lacks globWithWorkspaceContextSync in nx/src/utils/workspace-context",
    );
  }
  return { Inspector, glob } as NxTaskFileParts;
}

/**
 * The files that Nx hashes for the task of `context`, and those that it sees
 * in the repository, through the parts that {@link nxTaskFileParts} loaded.
 * Both run in this process, without the daemon.
 *
 * @throws {NxTaskFilesError} When a part gives a result of another shape, or
 *   Nx gave the executor no project graph.
 */
// @mara implements DES-BUILD-INPUT-CHECK
export async function nxTaskFiles(
  { Inspector, glob }: NxTaskFileParts,
  context: ExecutorContext,
): Promise<NxTaskFiles> {
  const project = context.projectName ?? "";
  const target = context.targetName ?? "";
  if (context.projectGraph === undefined) {
    throw new NxTaskFilesError("Nx gave the executor no project graph");
  }
  const inspector = new Inspector(context.projectGraph, context.root, context.nxJsonConfiguration);
  if (typeof inspector.init !== "function" || typeof inspector.inspectTaskInputs !== "function") {
    throw new NxTaskFilesError(
      "HashPlanInspector of the installed Nx lacks init or inspectTaskInputs",
    );
  }
  await inspector.init();
  const configuration = context.configurationName || undefined;
  const inputs = inspector.inspectTaskInputs(
    { project, target, ...(configuration === undefined ? {} : { configuration }) },
    {},
    {},
    true,
  );
  // The task's id as Nx forms it; where Nx resolved the configuration
  // otherwise, the one task of the project's target.
  const id = [project, target, configuration].filter((part) => part !== undefined).join(":");
  const candidates = Object.keys(inputs ?? {}).filter(
    (key) => key === `${project}:${target}` || key.startsWith(`${project}:${target}:`),
  );
  const key = id in (inputs ?? {}) ? id : candidates.length === 1 ? candidates[0] : id;
  const files = inputs?.[key]?.files;
  if (!isPathList(files)) {
    throw new NxTaskFilesError(
      `the inputs that HashPlanInspector of the installed Nx gives for ${id} hold no list of files`,
    );
  }
  return {
    inputFiles: new Set(files),
    filesBelow(folder) {
      const all = glob(context.root, ["**/*"]);
      if (!isPathList(all)) {
        throw new NxTaskFilesError(
          "globWithWorkspaceContextSync of the installed Nx gives no list of file paths",
        );
      }
      return folder === "" ? all : all.filter((file) => file.startsWith(`${folder}/`));
    },
  };
}

/**
 * The one warning line of a task whose check did not run because the
 * installed Nx lacks, or has changed, a part that it needs
 * (`DES-DIAGNOSTICS`). Only an Nx that the plugin does not support can,
 * which `NX_RUST_ALLOW_UNSUPPORTED_NX` lets the plugin run with.
 */
// @mara implements DES-DIAGNOSTICS
export function skippedCheckWarning(task: string, error: NxTaskFilesError): string {
  return `nx-rust: ${task}: the build input check did not run, because ${error.message}, so Nx caches the result without it. Use an Nx version that @convesoft/nx-rust supports, or a version of @convesoft/nx-rust that supports the installed one.`;
}

function load(path: string, workspaceRoot: string): Record<string, unknown> {
  try {
    return require(resolveFromRepository(path, workspaceRoot));
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0];
    throw new NxTaskFilesError(`${path} cannot be loaded from the installed Nx (${reason})`);
  }
}

// Where Nx resolves from the repository, as the version check does; otherwise
// from the plugin.
function resolveFromRepository(path: string, workspaceRoot: string): string {
  try {
    return require.resolve(path, {
      paths: [join(workspaceRoot, ".nx", "installation"), workspaceRoot],
    });
  } catch {
    return require.resolve(path);
  }
}

function isPathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((path) => typeof path === "string");
}
