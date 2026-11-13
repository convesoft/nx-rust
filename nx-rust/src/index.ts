import type { CreateDependencies, CreateNodes } from "@nx/devkit";
import { discoverForNodes, discoveryForDependencies } from "./graph/graph-discovery";

/**
 * Nx hands the plugin every `Cargo.toml` that `.gitignore` and `.nxignore`
 * do not ignore and that the plugin entry's `include` and `exclude` in
 * `nx.json` let through. The plugin finds the Cargo workspaces among them
 * with one `cargo metadata` report each.
 *
 * Projects are not created yet (nxr-1bv0wm).
 */
// @mara implements DES-DISCOVERY
export const createNodes: CreateNodes = [
  "**/Cargo.toml",
  async (manifests, _options, context) => {
    await discoverForNodes(manifests, context.workspaceRoot);
    return [];
  },
];

/**
 * Reads the reports that `createNodes` requested in the same graph
 * computation. Edges are not created yet (nxr-1bv0wm).
 */
export const createDependencies: CreateDependencies = (_options, context) => {
  discoveryForDependencies(context.workspaceRoot);
  return [];
};
