import { CargoDiscovery, discoverWorkspaces } from "./discovery";

/** What the `createNodes` call that started last found. */
interface Outcome {
  /** Orders the calls by their start. */
  sequence: number;
  workspaceRoot: string;
  /** Absent when discovery failed, which has already failed graph creation. */
  discovery?: CargoDiscovery;
}

let started = 0;
let latest: Outcome | undefined;

/**
 * Discovers the Cargo workspaces for the `createNodes` hook of one graph
 * computation and keeps the result for the `createDependencies` hook of the
 * same computation, so that the two hooks read the same reports and cargo
 * runs once per workspace. Every call requests the reports afresh.
 *
 * Nx calls `createDependencies` after `createNodes` in the same process. A
 * daemon can start a computation while an earlier one is still running and
 * then drops the earlier one, so the result of the call that started last
 * is kept, even if an earlier call finishes after it.
 *
 * @throws {Error} When discovery fails; see {@link discoverWorkspaces}.
 */
// @mara implements DES-METADATA-REPORT
export async function discoverForNodes(
  manifests: readonly string[],
  workspaceRoot: string,
): Promise<CargoDiscovery> {
  const sequence = ++started;
  let discovery: CargoDiscovery | undefined;
  try {
    discovery = await discoverWorkspaces(manifests, workspaceRoot);
    return discovery;
  } finally {
    if (latest === undefined || latest.sequence < sequence) {
      latest = { sequence, workspaceRoot, discovery };
    }
  }
}

/**
 * The discovery that `createNodes` made for the graph computation that
 * `createDependencies` belongs to, or `undefined` when it failed: Nx still
 * calls `createDependencies` then, and graph creation fails with the error
 * of `createNodes`.
 *
 * @throws {Error} When `createNodes` has not run for `workspaceRoot` in this process.
 */
export function discoveryForDependencies(workspaceRoot: string): CargoDiscovery | undefined {
  if (latest === undefined || latest.workspaceRoot !== workspaceRoot) {
    throw new Error(
      `nx-rust found no Cargo workspaces for ${workspaceRoot}: Nx asked for the dependencies before the projects. Please report this at https://github.com/convesoft/nx-rust/issues together with the Nx version and command.`,
    );
  }
  return latest.discovery;
}
