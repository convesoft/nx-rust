import type { CreateDependenciesContext, CreateNodes, RawProjectGraphDependency } from "@nx/devkit";
import { Registration, registrationOf } from "./graph/registration";

/**
 * Reads the reports that this entry's `createNodes` requested in the same
 * graph computation. Edges are not created yet (nxr-1bv0wm).
 *
 * Nx calls it as a method of its copy of the plugin for the entry, which is
 * `this`.
 */
function createDependencies(
  this: unknown,
  _options: unknown,
  context: CreateDependenciesContext,
): RawProjectGraphDependency[] {
  registrationOf(this).discoveryForDependencies(context.workspaceRoot);
  return [];
}

/**
 * The plugin as Nx loads it.
 *
 * Nx hands each entry's `createNodes` every `Cargo.toml` that `.gitignore`
 * and `.nxignore` do not ignore and that the entry's `include` and `exclude`
 * in `nx.json` let through. The plugin finds the Cargo workspaces among them
 * with one `cargo metadata` report each. Projects are not created yet
 * (nxr-1bv0wm).
 *
 * `createNodes` is a getter: Nx copies the module's properties once for each
 * entry in `nx.json`, so that each entry gets a registration of its own
 * ({@link Registration}).
 */
const plugin = {
  get createNodes(): CreateNodes {
    return new Registration().createNodes;
  },
  createDependencies,
};

export = plugin;
