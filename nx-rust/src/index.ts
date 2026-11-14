import type {
  CreateDependenciesContext,
  CreateMetadataContext,
  CreateNodes,
  ProjectGraph,
  ProjectsMetadata,
  RawProjectGraphDependency,
} from "@nx/devkit";
import { checkNxOnLoad } from "./compatibility/nx-version";
import { postTasksExecution, preTasksExecution } from "./executors/nx-command";
import { cargoMetadataKey, failOnNameCollisions } from "./graph/collisions";
import { failOnUncoveredProjectFolders } from "./graph/declared-files";
import { nxSegmentMatcher } from "./graph/nx-glob";
import { projectEdges } from "./graph/edges";
import { failOnPluginVersionOption } from "./graph/plugin-version";
import { Registration, registrationOf } from "./graph/registration";
import { failOnTargetDefaults } from "./graph/target-defaults";
import { failOnAffectedTestsOption } from "./graph/target-tables";

/**
 * The edges between the projects that this entry's `createNodes` created in
 * the same graph computation, from the reports it requested there; none when
 * that call failed, whose error already fails graph creation.
 *
 * It fails first when projects of the plugin still share a name once Nx has
 * merged the projects of all plugins and entries, which only the projects
 * and files that Nx passes here can show, when a `fileInputs` pattern names
 * files in the folder of a project of another plugin or entry that its
 * filesets do not cover (`DES-INPUTS`), and when what Nx merged over a
 * crate's `test` target turns on `affectedTests` where the workspace does
 * not use selection, and when it gives an inferred target a `pluginVersion`
 * that the plugin did not set (`DES-PLUGIN-OPTIONS`). It then reports the
 * `targetDefaults` entries of `nx.json` that change the inferred targets,
 * which only the merged projects show (`DES-TARGET-DEFAULT-GUARD`), and keeps
 * their warnings for {@link createMetadata}.
 *
 * Nx calls it as a method of its copy of the plugin for the entry, which is
 * `this`.
 */
function createDependencies(
  this: unknown,
  _options: unknown,
  context: CreateDependenciesContext,
): RawProjectGraphDependency[] | Promise<RawProjectGraphDependency[]> {
  const registration = registrationOf(this);
  const graph = registration.graphForDependencies(context.workspaceRoot);
  if (graph === undefined) {
    return [];
  }
  failOnNameCollisions(graph, context);
  failOnUncoveredProjectFolders(
    graph.declaredPatterns ?? [],
    context.projects,
    nxSegmentMatcher(context.workspaceRoot),
  );
  failOnAffectedTestsOption(graph, context.projects);
  const edges = projectEdges(graph, context.projects);
  return failOnPluginVersionOption(graph, context, this)
    .then(() => failOnTargetDefaults(graph, context, this))
    .then((warnings) => {
      registration.recordTargetWarnings(context.workspaceRoot, warnings);
      return edges;
    });
}

/**
 * Gives each project whose targets `createDependencies` found warnings for
 * those warnings in its metadata, under `cargo.targetWarnings`, each with
 * its target, so that the executor prints each at the start of a task of
 * its target, where the Nx daemon keeps graph creation's output from the
 * terminal (`DES-DIAGNOSTICS`, "Warnings where they are seen"). Nx merges
 * the metadata into the project's own and keeps it out of task keys.
 *
 * Nx calls it after `createDependencies`, in the same process, as a method
 * of its copy of the plugin for the entry, which is `this`.
 */
// @mara implements DES-DIAGNOSTICS
// @mara implements DES-TARGET-DEFAULT-GUARD
function createMetadata(
  this: unknown,
  _graph: ProjectGraph,
  _options: unknown,
  context: CreateMetadataContext,
): ProjectsMetadata {
  const metadata: ProjectsMetadata = {};
  for (const [project, targetWarnings] of registrationOf(this).targetWarnings(
    context.workspaceRoot,
  )) {
    metadata[project] = {
      metadata: { [cargoMetadataKey]: { targetWarnings } } as ProjectsMetadata[string]["metadata"],
    };
  }
  return metadata;
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
 * ({@link Registration}). Nx reads it when it loads the plugin for an entry,
 * and an unsupported Nx stops the plugin there, which fails graph creation
 * also where Nx calls none of its hooks ({@link checkNxOnLoad}).
 *
 * Before a command runs its tasks, `preTasksExecution` records the command's
 * arguments for them and gives the command an id ({@link preTasksExecution});
 * afterwards `postTasksExecution` removes what the command's lockfile tasks
 * kept under that id ({@link postTasksExecution}).
 */
const plugin = {
  get createNodes(): CreateNodes {
    checkNxOnLoad();
    return new Registration().createNodes;
  },
  createDependencies,
  createMetadata,
  preTasksExecution,
  postTasksExecution,
};

export = plugin;
