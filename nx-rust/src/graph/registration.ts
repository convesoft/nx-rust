import type { CreateNodes } from "@nx/devkit";
import { computationReports } from "./computation-reports";
import { discoverWorkspaces } from "./discovery";
import { CargoGraph, inferProjects, projectNodes } from "./projects";

/** What the `createNodes` call that started last found. */
interface Outcome {
  /** Orders the calls by their start. */
  sequence: number;
  workspaceRoot: string;
  /** Absent when the call failed, which has already failed graph creation. */
  graph?: CargoGraph;
}

/**
 * One entry of the plugin in `nx.json`, with what its `createNodes` hook
 * found for its `createDependencies` hook.
 *
 * Nx loads the plugin module once per process and copies its properties for
 * each entry, reading `createNodes` anew for each copy. Each read creates a
 * registration with a `createNodes` of its own ({@link Registration.createNodes}).
 * Nx calls `createDependencies` as a method of the entry's copy, so
 * {@link registrationOf} finds the registration through the copy's
 * `createNodes`. An entry's `createDependencies` therefore sees only what its
 * own `createNodes` discovered, whether Nx runs the entries in one process or
 * each in a worker of its own.
 */
// @mara implements DES-DISCOVERY
// @mara implements DES-METADATA-REPORT
// @mara implements DES-PROJECT-GRAPH
export class Registration {
  /** The `createNodes` hook of this entry. */
  readonly createNodes: CreateNodes;
  private started = 0;
  private latest: Outcome | undefined;

  constructor() {
    this.createNodes = [
      "**/Cargo.toml",
      async (manifests, _options, context) => {
        const graph = await this.discover(manifests, context.workspaceRoot);
        return projectNodes(graph.projects);
      },
    ];
    registrations.set(this.createNodes, this);
  }

  /**
   * Discovers the Cargo workspaces for this entry's `createNodes`, infers
   * their projects and keeps both for its `createDependencies`. Every call
   * requests the reports afresh, sharing them only with the other entries of
   * the same graph computation.
   *
   * Nx calls `createDependencies` after `createNodes` in the same process. A
   * daemon can start a computation while an earlier one is still running and
   * then drops the earlier one, so the result of the call that started last
   * is kept, even if an earlier call finishes after it. Nx 24 hands an entry
   * all its manifests in one call, so each call is taken as a computation of
   * its own.
   *
   * @throws {Error} When discovery fails, see {@link discoverWorkspaces}.
   */
  async discover(manifests: readonly string[], workspaceRoot: string): Promise<CargoGraph> {
    const sequence = ++this.started;
    // Before the first await: it decides which computation this call joins.
    const reports = computationReports();
    let graph: CargoGraph | undefined;
    try {
      const discovery = await discoverWorkspaces(manifests, workspaceRoot, reports);
      graph = { discovery, projects: inferProjects(discovery) };
      return graph;
    } finally {
      if (this.latest === undefined || this.latest.sequence < sequence) {
        this.latest = { sequence, workspaceRoot, graph };
      }
    }
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
}

const registrations = new WeakMap<object, Registration>();

/**
 * The registration of the plugin entry that `plugin`, Nx's copy of the
 * plugin module for that entry, belongs to.
 *
 * @throws {Error} When `plugin` is no such copy.
 */
export function registrationOf(plugin: unknown): Registration {
  const createNodes = (plugin as { createNodes?: unknown } | null | undefined)?.createNodes;
  const registration =
    typeof createNodes === "object" && createNodes !== null
      ? registrations.get(createNodes)
      : undefined;
  if (registration === undefined) {
    throw new Error(
      "nx-rust could not tell which of its entries in nx.json Nx asked for the dependencies. Please report this at https://github.com/convesoft/nx-rust/issues together with the Nx version and command.",
    );
  }
  return registration;
}
