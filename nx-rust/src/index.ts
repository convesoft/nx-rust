import type { CreateDependenciesContext, CreateNodes, RawProjectGraphDependency } from "@nx/devkit";
import { failOnNameCollisions } from "./graph/collisions";
import { projectEdges } from "./graph/edges";
import { Registration, registrationOf } from "./graph/registration";
import { failOnTargetDefaults } from "./graph/target-defaults";

/**
 * The edges between the projects that this entry's `createNodes` created in
 * the same graph computation, from the reports it requested there; none when
 * that call failed, whose error already fails graph creation.
 *
 * It fails first when projects of the plugin still share a name once Nx has
 * merged the projects of all plugins and entries, which only the projects
 * and files that Nx passes here can show. It then reports the
 * `targetDefaults` entries of `nx.json` that change the inferred targets,
 * which only the merged projects show (`DES-TARGET-DEFAULT-GUARD`).
 *
 * Nx calls it as a method of its copy of the plugin for the entry, which is
 * `this`.
 */
function createDependencies(
  this: unknown,
  _options: unknown,
  context: CreateDependenciesContext,
): RawProjectGraphDependency[] {
  const graph = registrationOf(this).graphForDependencies(context.workspaceRoot);
  if (graph === undefined) {
    return [];
  }
  failOnNameCollisions(graph, context);
  failOnTargetDefaults(graph, context, this);
  return projectEdges(graph, context.projects);
}

/**
 * The plugin as Nx loads it.
 *
 * Nx hands each entry's `createNodes` every `Cargo.toml` that `.gitignore`
 * and `.nxignore` do not ignore and that the entry's `include` and `exclude`
 * in `nx.json` let through. The plugin finds the Cargo workspaces among them
 * with one `cargo metadata` report each, and creates a project for each crate
 * and for each workspace whose root manifest defines no crate, with the
 * targets of its shape.
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
