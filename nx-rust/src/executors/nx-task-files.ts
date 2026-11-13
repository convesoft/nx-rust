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

/** A problem with the internal parts of Nx that the check reads; its message is what the task prints. */
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

/**
 * The files that Nx hashes for the task of `context`, and those that it sees
 * in the repository, through two parts of the installed Nx that are not
 * public API (`RISK-UPSTREAM-CHANGES`): `HashPlanInspector`, which expands
 * the task's hash plan into the files it reads with Nx's own matching, and
 * the workspace context that it reads the files from. Both run in this
 * process, without the daemon.
 *
 * @throws {NxTaskFilesError} When the installed Nx lacks one of the parts, or
 *   a part gives a result of another shape, naming it.
 */
// @mara implements DES-BUILD-INPUT-CHECK
export async function nxTaskFiles(context: ExecutorContext): Promise<NxTaskFiles> {
  const project = context.projectName ?? "";
  const target = context.targetName ?? "";
  const inspectorModule = load("nx/src/hasher/hash-plan-inspector", context.root);
  const contextModule = load("nx/src/utils/workspace-context", context.root);
  const Inspector = inspectorModule.HashPlanInspector;
  const glob = contextModule.globWithWorkspaceContextSync;
  if (typeof Inspector !== "function") {
    throw unsupported("HashPlanInspector from nx/src/hasher/hash-plan-inspector is not a class");
  }
  if (typeof glob !== "function") {
    throw unsupported(
      "globWithWorkspaceContextSync from nx/src/utils/workspace-context is not a function",
    );
  }
  if (context.projectGraph === undefined) {
    throw new NxTaskFilesError(
      `${project}:${target}: Nx gave the executor no project graph, from which @convesoft/nx-rust learns which files the task's inputs cover. Run the task through nx run or nx run-many.`,
    );
  }
  const inspector = new (Inspector as new (...args: unknown[]) => HashPlanInspector)(
    context.projectGraph,
    context.root,
    context.nxJsonConfiguration,
  );
  if (typeof inspector.init !== "function" || typeof inspector.inspectTaskInputs !== "function") {
    throw unsupported("HashPlanInspector lacks init or inspectTaskInputs");
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
    throw unsupported(`the inputs that HashPlanInspector gives for ${id} hold no list of files`);
  }
  return {
    inputFiles: new Set(files),
    filesBelow(folder) {
      const all = glob(context.root, ["**/*"]);
      if (!isPathList(all)) {
        throw unsupported("the result of globWithWorkspaceContextSync is no list of file paths");
      }
      return folder === "" ? all : all.filter((file) => file.startsWith(`${folder}/`));
    },
  };
}

function load(path: string, workspaceRoot: string): Record<string, unknown> {
  try {
    return require(resolveFromRepository(path, workspaceRoot));
  } catch (error) {
    throw unsupported(
      `${path} could not be loaded (${(error instanceof Error ? error.message : String(error)).split("\n")[0]})`,
    );
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

function unsupported(detail: string): NxTaskFilesError {
  return new NxTaskFilesError(
    [
      `nx-rust cannot check which files the build read with the installed Nx: ${detail}.`,
      "It compares the files that Cargo records for the build with the task's inputs through parts of Nx that are not public API, and the installed Nx does not have them in the form it expects. The task fails, so that Nx stores no result for it.",
      "Use an Nx version that @convesoft/nx-rust supports, or a version of @convesoft/nx-rust that supports the installed Nx.",
    ].join("\n"),
  );
}
