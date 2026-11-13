import type { TargetConfiguration } from "@nx/devkit";
import { join } from "node:path";

/** The parts of Nx's `nx/src/devkit-internals` that graph creation uses. */
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
  /** The files of `files` that an entry with `include` and `exclude` receives. */
  findMatchingConfigFiles(
    files: readonly string[],
    include: readonly string[] | undefined,
    exclude: readonly string[] | undefined,
  ): string[];
  /** The files of Nx's workspace context that match `globs`, relative to the root. */
  globWithWorkspaceContext(workspaceRoot: string, globs: string[]): Promise<string[]>;
}

const parts = [
  "mergeTargetConfigurations",
  "findMatchingConfigFiles",
  "globWithWorkspaceContext",
] as const;

const loaded = new Map<string, NxGraphInternals>();

/**
 * The internal parts of the Nx installed in the repository that graph
 * creation uses, from the same module that Nx itself loaded. They are no
 * public API and can change between majors (`RISK-UPSTREAM-CHANGES`), so
 * each part is checked to be a function.
 *
 * @throws {Error} When the module cannot be loaded or lacks a part, naming it.
 */
export function nxGraphInternals(workspaceRoot: string): NxGraphInternals {
  const cached = loaded.get(workspaceRoot);
  if (cached !== undefined) {
    return cached;
  }
  const path = "nx/src/devkit-internals";
  let module: Record<string, unknown>;
  try {
    module = require(resolveFromRepository(path, workspaceRoot));
  } catch (error) {
    throw unsupported(`${path} could not be loaded (${reason(error)})`);
  }
  for (const part of parts) {
    if (typeof module?.[part] !== "function") {
      throw unsupported(`${part} from ${path} is not a function`);
    }
  }
  const internals = module as unknown as NxGraphInternals;
  loaded.set(workspaceRoot, internals);
  return internals;
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

function unsupported(detail: string): Error {
  return new Error(
    [
      `nx-rust cannot create the project graph with the installed Nx: ${detail}.`,
      "It reads the settings of the nx metadata tables in Cargo.toml and of its entries in nx.json through parts of Nx that are not public API, and the installed Nx does not have them in the form it expects.",
      "Use an Nx version that @convesoft/nx-rust supports, or a version of @convesoft/nx-rust that supports the installed Nx.",
    ].join("\n"),
  );
}

function reason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0];
}
