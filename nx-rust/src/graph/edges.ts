import type {
  CreateDependenciesContext,
  DependencyType,
  RawProjectGraphDependency,
} from "@nx/devkit";
import { dirname, relative } from "node:path";
import type { CargoGraph } from "./projects";

// Nx's `DependencyType.implicit`, written out because the plugin does not
// load @nx/devkit at run time.
//
// An edge of another type names a source file, and Nx caches such edges by
// that file: while the file is unchanged, it keeps the edges it found the
// last time instead of the ones returned now. A crate's edges also depend on
// files other than its manifest, such as the `[workspace.dependencies]` of
// its workspace and the ignore files that decide which crates are projects.
const implicit = "implicit" as DependencyType.implicit;

/**
 * The edges of the projects that one plugin entry created: from each crate
 * to every crate it depends on through a path, whether as a normal, build
 * or dev-dependency, and from each workspace project to every member of its
 * workspace.
 *
 * An edge exists only where both crates are Nx projects, and names each end
 * by the project that Nx has at the crate's folder, as `projects` lists it:
 * a `package.json` or `project.json` in that folder may have renamed it.
 * A path dependency on a crate without a project gives no edge. Edges that
 * close a cycle are kept.
 *
 * @param projects The projects that `createDependencies` receives, by name.
 */
// @mara implements DES-PROJECT-GRAPH
export function projectEdges(
  graph: CargoGraph,
  projects: CreateDependenciesContext["projects"],
): RawProjectGraphDependency[] {
  const { workspaceRoot } = graph.discovery;
  const nameByRoot = new Map(
    Object.entries(projects).map(([name, project]) => [project.root, name] as const),
  );
  const nameAt = (folder: string) => nameByRoot.get(relative(workspaceRoot, folder) || ".");
  const edges = new Map<string, RawProjectGraphDependency>();
  const add = (source: string | undefined, target: string | undefined) => {
    if (source !== undefined && target !== undefined && source !== target) {
      edges.set(JSON.stringify([source, target]), { source, target, type: implicit });
    }
  };
  for (const project of graph.projects) {
    const source = nameByRoot.get(project.root);
    for (const dependency of project.pkg?.dependencies ?? []) {
      if (typeof dependency.path === "string") {
        add(source, nameAt(dependency.path));
      }
    }
    if (project.isWorkspaceProject) {
      for (const member of project.workspace.report.packages) {
        add(source, nameAt(dirname(member.manifest_path)));
      }
    }
  }
  return [...edges.values()];
}
