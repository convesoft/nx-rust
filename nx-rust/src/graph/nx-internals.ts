import type { TargetConfiguration } from "@nx/devkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadDevkitInternals,
  loadRetrieveWorkspaceFiles,
  NxBridgeError,
} from "../compatibility/nx-bridge";

/** The parts of Nx's internal modules that graph creation uses. */
export interface NxGraphInternals {
  /**
   * Nx's rule for laying one configuration of a target over another, as it
   * lays a `project.json` over a plugin's target (`EVD-NX-24-OPTION-SEMANTICS`).
   * With `deferSpreadsWithoutBase` false, a `"..."` without a base value
   * stands for nothing.
   */
  mergeTargetConfigurations(
    target: TargetConfiguration,
    baseTarget: TargetConfiguration | undefined,
    projectConfigSourceMap: undefined,
    sourceInformation: undefined,
    targetIdentifier: undefined,
    deferSpreadsWithoutBase: boolean,
  ): TargetConfiguration;
  /**
   * The files of `files` that an entry with `include` and `exclude`
   * receives: Nx's last step in choosing an entry's files.
   */
  findMatchingConfigFiles(
    files: readonly string[],
    include: readonly string[] | undefined,
    exclude: readonly string[] | undefined,
  ): string[];
  /**
   * The files that Nx chooses for an entry before {@link findMatchingConfigFiles}:
   * those of Nx's workspace context that the entry's `createNodes` pattern
   * matches, where Nx globs a narrow `include` natively first
   * (`EVD-NX-24-ENTRY-CONTEXT`). Nx's own `globPluginFiles`, called through
   * `retrieveProjectConfigurationPaths` of
   * `nx/src/project-graph/utils/retrieve-workspace-files` with the entry
   * alone, relative to the repository root. That module is loaded on the
   * first call.
   */
  pluginFiles(
    workspaceRoot: string,
    pattern: string,
    include: readonly string[] | undefined,
    exclude: readonly string[] | undefined,
  ): Promise<string[]>;
}

const pluginFilesPath = "nx/src/project-graph/utils/retrieve-workspace-files";
const pluginFilesPart = "retrieveProjectConfigurationPaths";

const loaded = new Map<string, NxGraphInternals>();

/**
 * The internal parts of the Nx installed in the repository that graph
 * creation uses, from the same module that Nx itself loaded. They are no
 * public API and can change between majors (`RISK-UPSTREAM-CHANGES`), so
 * each part is checked to be a function, and each result to have the shape
 * that the plugin reads, as `init`'s graph check does: a changed part fails
 * graph creation with a message that names it, instead of giving a wrong
 * graph.
 *
 * @throws {Error} When the module cannot be loaded or lacks a part, naming
 *   it; the returned functions throw such an error for a result of another shape.
 */
export function nxGraphInternals(workspaceRoot: string): NxGraphInternals {
  const cached = loaded.get(workspaceRoot);
  if (cached !== undefined) {
    return cached;
  }
  let nx: ReturnType<
    typeof loadDevkitInternals<"mergeTargetConfigurations" | "findMatchingConfigFiles">
  >;
  try {
    nx = loadDevkitInternals(workspaceRoot, [
      "mergeTargetConfigurations",
      "findMatchingConfigFiles",
    ]);
  } catch (error) {
    if (error instanceof NxBridgeError) {
      throw unsupported(error.message);
    }
    throw error;
  }
  const internals: NxGraphInternals = {
    mergeTargetConfigurations: (...args) =>
      checked(
        nx.mergeTargetConfigurations(...args),
        "mergeTargetConfigurations",
        "no target configuration",
        isTable,
      ),
    findMatchingConfigFiles: (...args) =>
      checked(
        nx.findMatchingConfigFiles(...args),
        "findMatchingConfigFiles",
        "no list of file paths",
        isPathList,
      ),
    pluginFiles: async (root, pattern, include, exclude) => {
      let retrieve: ReturnType<
        typeof loadRetrieveWorkspaceFiles<"retrieveProjectConfigurationPaths">
      >["retrieveProjectConfigurationPaths"];
      try {
        retrieve = loadRetrieveWorkspaceFiles(workspaceRoot, [
          pluginFilesPart,
        ]).retrieveProjectConfigurationPaths;
      } catch (error) {
        if (error instanceof NxBridgeError) {
          throw unsupported(error.message);
        }
        throw error;
      }
      // The parts of a loaded plugin entry that Nx's globPluginFiles reads.
      const entry = { createNodes: [pattern], include, exclude };
      return checked(
        (await retrieve(root, [entry])) as string[],
        pluginFilesPart,
        "no list of file paths",
        isPathList,
        pluginFilesPath,
      );
    },
  };
  loaded.set(workspaceRoot, internals);
  return internals;
}

/**
 * Whether Nx leaves a directory out of the files it reads, by the rules that
 * Nx itself gives for its file walker (`createGitIgnoreChecker` of
 * `nx/src/devkit-internals`, the same in every Nx 24 release): its fixed
 * folders, such as `node_modules` and `.nx/cache`, and the `.gitignore` and
 * `.nxignore` files from the repository root down to the directory, read
 * from disk now. Ask a new function after an ignore file changes.
 *
 * Unlike {@link nxGraphInternals}, it fails nothing: where the installed Nx
 * lacks that part, it returns `undefined`, and a caller that only warns can
 * say nothing instead.
 *
 * @returns A function of a directory's path relative to the repository
 *   root, with `/` separators, that is `false` only where Nx answers that it
 *   reads the directory; `undefined` where the installed Nx cannot tell.
 */
export function nxIgnoreRules(workspaceRoot: string): ((directory: string) => boolean) | undefined {
  let create: ReturnType<
    typeof loadDevkitInternals<"createGitIgnoreChecker">
  >["createGitIgnoreChecker"];
  try {
    create = loadDevkitInternals(workspaceRoot, ["createGitIgnoreChecker"]).createGitIgnoreChecker;
  } catch {
    return undefined;
  }
  // The only part of a generator's file tree that the checker reads.
  const tree = {
    read(path: string): string | null {
      try {
        return readFileSync(join(workspaceRoot, path), "utf8");
      } catch {
        return null;
      }
    },
  };
  const checker = create(tree) as { isIgnoredDirectory?: unknown } | null | undefined;
  const isIgnoredDirectory = checker?.isIgnoredDirectory;
  if (typeof isIgnoredDirectory !== "function") {
    return undefined;
  }
  return (directory) => isIgnoredDirectory.call(checker, directory) !== false;
}

// The result, or an error that names the part and what its result lacks.
function checked<T>(
  result: T,
  part: string,
  lacking: string,
  isExpected: (value: unknown) => boolean,
  path = "nx/src/devkit-internals",
): T {
  if (!isExpected(result)) {
    throw unsupported(`the result of ${part} from ${path} is ${lacking}`);
  }
  return result;
}

function isTable(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathList(value: unknown): boolean {
  return Array.isArray(value) && value.every((path) => typeof path === "string");
}

function unsupported(detail: string): Error {
  return new Error(
    [
      `nx-rust cannot create the project graph with the installed Nx: ${detail}.`,
      "It reads the settings of the nx metadata tables in Cargo.toml and of its entries in nx.json through parts of Nx that are not public API, and the installed Nx does not have them in the form it expects.",
      "Use an Nx version that @convesoft/nx-rust supports, or a version of @convesoft/nx-rust that supports the installed Nx.",
    ].join("\n"),
  );
}
