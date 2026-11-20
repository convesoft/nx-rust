import type { ExecutorContext } from "@nx/devkit";
import {
  loadHashPlanInspector,
  loadWorkspaceContext,
  NxBridgeError,
  type NxHashPlanInspector,
} from "../compatibility/nx-bridge";

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
   * and none below a symbolic link to a folder. The repository is listed on
   * the first call alone, so an instance serves one check and is made after
   * the cargo call whose build it judges.
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

/** Converts a bridge failure into an {@link NxTaskFilesError} with its diagnostic wording. */
export function toTaskFilesError(error: NxBridgeError): NxTaskFilesError {
  const { failure } = error;
  return new NxTaskFilesError(
    failure.kind === "load"
      ? `${failure.module} cannot be loaded from the installed Nx (${failure.reason})`
      : `the installed Nx lacks ${failure.exportName} in ${failure.module}`,
  );
}

/** The internal parts of the installed Nx that the check uses, loaded. */
export interface NxTaskFileParts {
  /** `HashPlanInspector` of `nx/src/hasher/hash-plan-inspector`. */
  Inspector: new (...args: unknown[]) => NxHashPlanInspector;
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
  try {
    const { HashPlanInspector: Inspector } = loadHashPlanInspector(workspaceRoot);
    const { globWithWorkspaceContextSync: glob } = loadWorkspaceContext(workspaceRoot, [
      "globWithWorkspaceContextSync",
    ]);
    return { Inspector, glob };
  } catch (error) {
    if (error instanceof NxBridgeError) {
      throw toTaskFilesError(error);
    }
    throw error;
  }
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
  // The repository's files as Nx sees them, listed once on first use and
  // kept for the instance's lifetime. The check makes an instance after the
  // task's cargo call and drops it when that task's comparison ends, with no
  // write of files in between (`DES-BUILD-INPUT-CHECK`), so the list cannot
  // be older than the build it judges for want of being listed again.
  let repositoryFiles: string[] | undefined;
  return {
    inputFiles: new Set(files),
    filesBelow(folder) {
      if (repositoryFiles === undefined) {
        const all = glob(context.root, ["**/*"]);
        if (!isPathList(all)) {
          throw new NxTaskFilesError(
            "globWithWorkspaceContextSync of the installed Nx gives no list of file paths",
          );
        }
        repositoryFiles = all;
      }
      return folder === ""
        ? [...repositoryFiles]
        : repositoryFiles.filter((file) => file.startsWith(`${folder}/`));
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

function isPathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((path) => typeof path === "string");
}
