import type { CreateNodes, NxJsonConfiguration } from "@nx/devkit";
import { checkNxForGraph } from "../compatibility/nx-version";
import { cacheContext } from "./caching";
import { computationReports } from "./computation-reports";
import { discoverWorkspaces } from "./discovery";
import { checkEntries, manifestPattern } from "./entries";
import type { TargetWarning } from "./collisions";
import { CargoGraph, inferProjects, projectNodes, withWarningsInputs } from "./projects";
import { readPluginOptions, readSettings } from "./settings";
import { targetDefaultCauses } from "./target-defaults-causes";
import type { PlacedWarning } from "./target-defaults-report";
import { workspaceStrategies } from "./unification";

/** What the `createNodes` call that started last found. */
interface Outcome {
  /** Orders the calls by their start. */
  sequence: number;
  workspaceRoot: string;
  /** Absent when the call failed, which has already failed graph creation. */
  graph?: CargoGraph;
  /**
   * The warnings that `createDependencies` found for targets of the
   * projects, for `createMetadata` ({@link Registration.recordTargetWarnings}).
   */
  targetWarnings?: readonly PlacedWarning[];
}

/**
 * One entry of the plugin in `nx.json`, with what its `createNodes` hook
 * found for its `createDependencies` and `createMetadata` hooks.
 *
 * Nx loads the plugin module once per process and copies its properties for
 * each entry, reading `createNodes` anew for each copy. Each read creates a
 * registration with a `createNodes` of its own ({@link Registration.createNodes}).
 * Nx calls the function of the copy's `createNodes` tuple as an element of
 * that tuple, so that its `this` is the tuple and not the copy, and
 * `createDependencies` and `createMetadata` as methods of the entry's copy, so {@link registrationOf}
 * finds the registration through the copy's `createNodes`. Nothing else that
 * Nx passes to the hooks tells the entries apart: their context is the same
 * for all, and the options of an entry without options are `undefined`
 * (EVD-NX-24-PLUGIN-ENTRIES). An entry's later hooks therefore see only what
 * its own `createNodes` discovered, whether Nx runs the entries in one
 * process or each in a worker of its own.
 *
 * Where a call shows that this does not hold, the hook fails rather than
 * answer with another entry's projects ({@link entryRegistration}).
 */
// @mara implements DES-DISCOVERY
// @mara implements DES-METADATA-REPORT
// @mara implements DES-PROJECT-GRAPH
// @mara implements DES-TARGET-DEFAULT-GUARD
export class Registration {
  /** The `createNodes` hook of this entry. */
  readonly createNodes: CreateNodes;
  private started = 0;
  private latest: Outcome | undefined;
  /**
   * The options of this entry's first `createNodes` call. Nx keeps one value
   * with its copy of the plugin for the entry and passes it to every hook of
   * the entry, also across graph computations, so another value comes from
   * another entry.
   */
  private options: { value: unknown } | undefined;

  constructor() {
    this.createNodes = [
      manifestPattern,
      async (manifests, options, context) => {
        const graph = await this.discover(
          manifests,
          context.workspaceRoot,
          options,
          context.nxJsonConfiguration,
        );
        // Nx's plugin interface has no channel for warnings; standard error
        // reaches the terminal without the daemon and its log file with it.
        // The warnings of the projects' caching are printed where they are
        // found (`cacheContext` in `caching.ts`).
        for (const warning of graph.discovery.warnings) {
          console.warn(warning);
        }
        // A copy: in its own process, Nx merges the lists of the nodes it
        // receives without copying them and rewrites the project names in
        // their dependsOn and inputs in place (EVD-NX-24-PLUGIN-NODES). The
        // graph kept for createDependencies has to stay what the plugin
        // inferred, which DES-TARGET-DEFAULT-GUARD compares with what Nx
        // merged.
        return structuredClone(projectNodes(graph.projects));
      },
    ];
    registrations.set(this.createNodes, this);
  }

  /**
   * Discovers the Cargo workspaces for this entry's `createNodes`, infers
   * their projects and targets and keeps both for its `createDependencies`.
   * Every call requests the reports afresh, sharing them only with the other
   * entries of the same graph computation.
   *
   * Nx calls `createDependencies` after `createNodes` in the same process. A
   * daemon can start a computation while an earlier one is still running and
   * then drops the earlier one, so the result of the call that started last
   * is kept, even if an earlier call finishes after it. Nx 24 hands an entry
   * all its manifests in one call, so each call is taken as a computation of
   * its own.
   *
   * @param options The entry's plugin options.
   * @param nxJson `nx.json`, whose `plugins` name the entries of the plugin,
   *   no two of which may receive manifests of one workspace (`checkEntries`
   *   in `entries.ts`), which says whether Nx analyses the JS lockfile
   *   (`pluginInput` in `plugin-package.ts`), and whose `namedInputs` give
   *   the repository's `default` (`cacheContext` in `caching.ts`).
   * @throws {Error} When the call cannot be this entry's alone (see
   *   {@link Registration.claim}), when the installed Nx is not supported (see
   *   {@link checkNxForGraph}), when the options are invalid, when discovery
   *   fails (see {@link discoverWorkspaces}), when a metadata table is
   *   invalid (see {@link readSettings}), when two entries of the plugin
   *   receive manifests of one workspace, or the plugin cannot tell whether
   *   they do (see {@link checkEntries}), when a `fileInputs` pattern resolves where
   *   Nx cannot hash it, or when the targets cannot be given their names
   *   and tables (see {@link inferProjects}).
   */
  async discover(
    manifests: readonly string[],
    workspaceRoot: string,
    options?: unknown,
    nxJson?: NxJsonConfiguration,
  ): Promise<CargoGraph> {
    // Before the first await: it decides which computation this call joins.
    const reports = computationReports();
    this.claim(options);
    const sequence = ++this.started;
    let graph: CargoGraph | undefined;
    try {
      const nxWarning = checkNxForGraph(workspaceRoot, reports);
      const pluginOptions = readPluginOptions(options);
      const discovery = await discoverWorkspaces(manifests, workspaceRoot, reports);
      const settings = readSettings(discovery, pluginOptions);
      const view = await checkEntries(discovery, manifests, nxJson);
      const strategies = workspaceStrategies(discovery, settings);
      const context = await cacheContext(
        discovery,
        nxJson,
        nxWarning === undefined ? [] : [nxWarning],
        reports,
        view,
        strategies,
      );
      const projects = inferProjects(discovery, settings, context);
      const causes = await targetDefaultCauses(projects, nxJson, workspaceRoot);
      graph = {
        discovery,
        strategies,
        projects: withWarningsInputs(projects, workspaceRoot, causes),
        declaredPatterns: [
          ...projects.flatMap((project) => project.declaredPatterns),
          ...(context.declaredPatterns ?? []),
        ],
      };
      return graph;
    } finally {
      if (this.latest === undefined || this.latest.sequence < sequence) {
        this.latest = { sequence, workspaceRoot, graph };
      }
    }
  }

  /**
   * Takes a `createNodes` call for this entry, or fails where it comes with
   * other options than the entry's first call, which shows that entries
   * share this registration. Calls with the entry's options may overlap, as
   * where the daemon starts a graph computation before an earlier one has
   * finished; {@link Registration.discover} keeps the newest.
   */
  private claim(options: unknown): void {
    if (this.options !== undefined && this.options.value !== options) {
      throw entryError("createNodes", "it got other options than the entry's earlier call");
    }
    this.options ??= { value: options };
  }

  /**
   * This registration, for a later hook of the entry, which Nx calls with the
   * options that it passed to the entry's `createNodes`.
   *
   * @throws {Error} When `options` are not those.
   */
  forHook(hook: string, options: unknown): this {
    if (this.options !== undefined && this.options.value !== options) {
      throw entryError(hook, "it got other options than the entry's createNodes");
    }
    return this;
  }

  /**
   * What this entry's `createNodes` found for the graph computation that
   * `createDependencies` belongs to, or `undefined` when it failed: Nx still
   * calls `createDependencies` then, and graph creation fails with the error
   * of `createNodes`.
   *
   * @throws {Error} When `createNodes` has not run for `workspaceRoot`.
   */
  graphForDependencies(workspaceRoot: string): CargoGraph | undefined {
    if (this.latest === undefined || this.latest.workspaceRoot !== workspaceRoot) {
      throw new Error(
        `nx-rust found no Cargo workspaces for ${workspaceRoot}: Nx asked for the dependencies before the projects. Please report this at https://github.com/convesoft/nx-rust/issues together with the Nx version and command.`,
      );
    }
    return this.latest.graph;
  }

  /**
   * Keeps the warnings that `createDependencies` found for targets of this
   * entry's projects with the graph computation they belong to, for
   * `createMetadata`, which Nx calls after it in the same process.
   */
  recordTargetWarnings(workspaceRoot: string, warnings: readonly PlacedWarning[]): void {
    if (this.latest?.workspaceRoot === workspaceRoot) {
      this.latest.targetWarnings = warnings;
    }
  }

  /**
   * The warnings that `createDependencies` found in the graph computation
   * that `createMetadata` belongs to, by project name, each with its target;
   * none where it found none or did not run.
   */
  targetWarnings(workspaceRoot: string): Map<string, TargetWarning[]> {
    const byProject = new Map<string, TargetWarning[]>();
    if (this.latest?.workspaceRoot !== workspaceRoot) {
      return byProject;
    }
    for (const { project, target, warning } of this.latest.targetWarnings ?? []) {
      byProject.set(project, [...(byProject.get(project) ?? []), { target, warning }]);
    }
    return byProject;
  }
}

const registrations = new WeakMap<object, Registration>();

/**
 * The registration of the plugin entry that `plugin`, Nx's copy of the
 * plugin module for that entry, belongs to.
 *
 * @throws {Error} When `plugin` is no such copy, as where a later hook is
 *   called detached from the copy, after destructuring, rather than as a
 *   method of the copy.
 */
export function registrationOf(plugin: unknown, hook = "createDependencies"): Registration {
  const createNodes = (plugin as { createNodes?: unknown } | null | undefined)?.createNodes;
  const registration =
    typeof createNodes === "object" && createNodes !== null
      ? registrations.get(createNodes)
      : undefined;
  if (registration === undefined) {
    throw entryError(
      hook,
      "Nx did not call it as a method of its copy of the plugin for the entry",
    );
  }
  return registration;
}

/**
 * The registration of the entry whose `hook` Nx called as a method of
 * `plugin` with `options`: {@link registrationOf}, checked against the
 * options of the entry's `createNodes` ({@link Registration.forHook}).
 *
 * @throws {Error} When the plugin cannot tell that the call is the entry's.
 */
export function entryRegistration(plugin: unknown, hook: string, options: unknown): Registration {
  return registrationOf(plugin, hook).forHook(hook, options);
}

// A wrong graph is worse than none (GOAL-TRUSTED-CACHE): where a call may
// belong to another entry, the hook fails instead of answering.
function entryError(hook: string, reason: string): Error {
  return new Error(
    `nx-rust could not tell which of its entries in nx.json Nx called ${hook} for: ${reason}. It stops rather than answer with the projects of another entry. Please report this at https://github.com/convesoft/nx-rust/issues together with the Nx version, the plugin's entries in nx.json and the command.`,
  );
}
