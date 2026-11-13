import type { NxJsonConfiguration, PluginConfiguration, ProjectConfiguration } from "@nx/devkit";
import plugin = require("../../index");
import type { CargoWorkspace } from "../../graph/discovery";
import { registrationOf } from "../../graph/registration";
import { checkTargetDefaults, ReadTargetDefaults } from "../../graph/target-defaults";

/** The name under which `nx.json` lists the plugin. */
export const pluginName = "@convesoft/nx-rust";

/** What graph creation found with the plugin's entries in `nx.json`. */
export interface GraphCheck {
  /**
   * The `Cargo.toml` files that Nx sees in the repository, relative to its
   * root, before the entries' `include` and `exclude` apply.
   */
  manifests: string[];
  /** The Cargo workspaces the entries found, each once, in the order they were found. */
  workspaces: CargoWorkspace[];
  /** The warnings about `targetDefaults` entries that graph creation prints (`DES-TARGET-DEFAULT-GUARD`). */
  targetDefaultWarnings: string[];
}

/** Graph creation would fail with the plugin's entries in `nx.json`. */
export class GraphCheckError extends Error {
  constructor(
    /** The errors that Nx reports for graph creation, each as Nx words it. */
    readonly errors: string[],
  ) {
    super(errors.join("\n\n"));
    this.name = "GraphCheckError";
  }
}

/** The Nx versions that this version of the plugin supports (`REQ-COMPATIBILITY`). */
export const supportedNx = "Nx 24";

/**
 * The installed Nx lacks the internal parts of Nx through which the check
 * runs graph creation, or they work differently from what the check expects.
 */
export class UnsupportedNxError extends Error {
  constructor(
    /** The version of the installed Nx, if it could be read. */
    readonly nxVersion: string | undefined,
    /** What is missing or different. */
    readonly detail: string,
  ) {
    const nx = nxVersion === undefined ? "the installed Nx" : `the installed Nx ${nxVersion}`;
    super(
      [
        `nx-rust cannot check this repository with ${nx}: ${detail}.`,
        `This version of ${pluginName} supports ${supportedNx}. It runs the checks of graph creation through parts of Nx that are not public API, and ${nx} does not have them in the form it expects.`,
        `Use a supported Nx version, or a version of ${pluginName} that supports ${nx}.`,
      ].join("\n"),
    );
    this.name = "UnsupportedNxError";
  }
}

/** Whether a `plugins` entry of `nx.json` is one of this plugin. */
export function isPluginEntry(entry: PluginConfiguration): boolean {
  return (typeof entry === "string" ? entry : entry.plugin) === pluginName;
}

/**
 * Creates the plugin's part of the project graph as Nx would with `nxJson`,
 * without writing anything, and returns what it found.
 *
 * Each entry of the plugin in `nxJson.plugins` runs the plugin's own
 * `createNodes` through Nx's project-configuration step, which hands it the
 * `Cargo.toml` files of Nx's workspace context that the entry's `include` and
 * `exclude` let through, as graph creation does. Every check that graph
 * creation makes in `createNodes` therefore runs here too, and the warnings
 * it prints are printed again. The check of `targetDefaults` that graph
 * creation makes in `createDependencies` runs on the projects that this
 * step merges. `@nx/devkit`'s `addPlugin` runs a plugin the same way before
 * it registers one. Nx's project-configuration step is not
 * part of its public API: the end-to-end suite checks it on each supported Nx
 * major (`REQ-COMPATIBILITY`).
 *
 * @param nxJson `nx.json` as it would be, with the plugin's entries.
 * @param workspaceRoot The absolute path of the repository root.
 * @throws {GraphCheckError} When graph creation would fail.
 * @throws {UnsupportedNxError} When the installed Nx lacks those internal
 *   parts, or they return something the check cannot read.
 */
// @mara implements DES-GENERATORS
export async function checkGraphCreation(
  nxJson: NxJsonConfiguration,
  workspaceRoot: string,
): Promise<GraphCheck> {
  const nx = nxInternals(workspaceRoot);
  // Nx copies the plugin module once per entry, so that each entry gets a
  // registration of its own (index.ts); the copies here do the same.
  const entries = (nxJson.plugins ?? []).flatMap((entry, index) =>
    isPluginEntry(entry) ? [{ entry, index, copy: { ...plugin, name: pluginName } }] : [],
  );
  const loaded = entries.map(({ entry, index, copy }) => new nx.LoadedNxPlugin(copy, entry, index));
  const graphCreation = globalThis as { NX_GRAPH_CREATION?: boolean };
  const wasCreating = graphCreation.NX_GRAPH_CREATION;
  graphCreation.NX_GRAPH_CREATION = true;
  let result: unknown;
  try {
    result = await nx.retrieveProjectConfigurations(
      { specifiedPlugins: loaded, defaultPlugins: [] },
      workspaceRoot,
      nxJson,
    );
  } catch (error) {
    if (nx.isProjectConfigurationsError(error)) {
      throw new GraphCheckError(errorMessages(error));
    }
    throw error;
  } finally {
    if (wasCreating === undefined) {
      delete graphCreation.NX_GRAPH_CREATION;
    } else {
      graphCreation.NX_GRAPH_CREATION = wasCreating;
    }
  }
  const manifests = (result as { matchingProjectFiles?: unknown } | null)?.matchingProjectFiles;
  if (!Array.isArray(manifests) || !manifests.every((file) => typeof file === "string")) {
    throw new UnsupportedNxError(
      nxVersion(workspaceRoot),
      "the result of retrieveProjectConfigurations from nx/src/devkit-internals has no matchingProjectFiles list of file paths",
    );
  }
  const projects = (result as { projects?: unknown }).projects;
  if (typeof projects !== "object" || projects === null) {
    throw new UnsupportedNxError(
      nxVersion(workspaceRoot),
      "the result of retrieveProjectConfigurations from nx/src/devkit-internals has no projects",
    );
  }
  const workspaces = new Map<string, CargoWorkspace>();
  const targetDefaultWarnings: string[] = [];
  const targetDefaultErrors: string[] = [];
  for (const { copy } of entries) {
    const graph = registrationOf(copy).graphForDependencies(workspaceRoot);
    for (const workspace of graph?.discovery.workspaces ?? []) {
      if (!workspaces.has(workspace.root)) {
        workspaces.set(workspace.root, workspace);
      }
    }
    if (graph !== undefined) {
      const report = checkTargetDefaults(
        graph,
        Object.values(projects as Record<string, ProjectConfiguration>),
        nxJson,
        copy.name,
        () => targetDefaultsResolver(nx, workspaceRoot),
      );
      targetDefaultWarnings.push(...report.warnings);
      if (report.error !== undefined) {
        targetDefaultErrors.push(report.error);
      }
    }
  }
  if (targetDefaultErrors.length > 0) {
    throw new GraphCheckError(targetDefaultErrors);
  }
  return {
    manifests: [...new Set(manifests as string[])].sort(),
    workspaces: [...workspaces.values()],
    targetDefaultWarnings,
  };
}

/**
 * Nx's resolver for target defaults, which the check of `targetDefaults`
 * needs only where `nx.json` has an entry that changes an inferred target.
 *
 * @throws {UnsupportedNxError} When the installed Nx lacks it.
 */
function targetDefaultsResolver(nx: NxInternals, workspaceRoot: string): ReadTargetDefaults {
  if (typeof nx.readTargetDefaultsForTarget !== "function") {
    throw new UnsupportedNxError(
      nxVersion(workspaceRoot),
      "readTargetDefaultsForTarget from nx/src/devkit-internals is not a function",
    );
  }
  return nx.readTargetDefaultsForTarget;
}

/** The internal parts of Nx that the check uses, as far as it uses them. */
interface NxInternals {
  /** Checked where it is used ({@link targetDefaultsResolver}). */
  readTargetDefaultsForTarget?: ReadTargetDefaults;
  LoadedNxPlugin: new (
    plugin: object,
    entry: PluginConfiguration,
    index: number,
  ) => { createNodes?: unknown };
  retrieveProjectConfigurations(
    plugins: { specifiedPlugins: unknown[]; defaultPlugins: unknown[] },
    workspaceRoot: string,
    nxJson: NxJsonConfiguration,
  ): Promise<unknown>;
  isProjectConfigurationsError(error: unknown): error is { errors?: unknown; message?: unknown };
}

/**
 * Nx's internals from the Nx installed in the repository, which is the Nx
 * that runs the generator, after checking that each part the check uses is
 * there and is what the check calls: a constructor or a function.
 *
 * @throws {UnsupportedNxError} When a part is missing or of another kind.
 */
function nxInternals(workspaceRoot: string): NxInternals {
  let internals: Record<string, unknown>;
  try {
    internals = require(require.resolve("nx/src/devkit-internals", { paths: [workspaceRoot] }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UnsupportedNxError(
      nxVersion(workspaceRoot),
      `nx/src/devkit-internals could not be loaded (${reason})`,
    );
  }
  const constructor = internals?.LoadedNxPlugin;
  if (typeof constructor !== "function" || typeof constructor.prototype !== "object") {
    throw new UnsupportedNxError(
      nxVersion(workspaceRoot),
      "LoadedNxPlugin from nx/src/devkit-internals is not a constructor",
    );
  }
  for (const name of ["retrieveProjectConfigurations", "isProjectConfigurationsError"]) {
    if (typeof internals[name] !== "function") {
      throw new UnsupportedNxError(
        nxVersion(workspaceRoot),
        `${name} from nx/src/devkit-internals is not a function`,
      );
    }
  }
  return internals as unknown as NxInternals;
}

// The messages of the errors that Nx collected for graph creation, or the
// message of the error itself where it holds no list of them.
function errorMessages(error: { errors?: unknown; message?: unknown }): string[] {
  const messages = Array.isArray(error.errors)
    ? error.errors.map((e: { message?: unknown } | null) => e?.message)
    : [];
  return messages.length > 0 && messages.every((message) => typeof message === "string")
    ? messages
    : [String(error.message ?? error)];
}

// The version of the Nx installed in the repository, if it can be read.
function nxVersion(workspaceRoot: string): string | undefined {
  try {
    const version: unknown = require(
      require.resolve("nx/package.json", { paths: [workspaceRoot] }),
    ).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}
