import type {
  CreateDependenciesContext,
  DependencyType,
  RawProjectGraphDependency,
} from "@nx/devkit";
import { dirname, join, relative } from "node:path";
import type { CargoGraph } from "./projects";
import { realPath } from "./real-path";
import { knownPackages, projectsBehindCratesWithoutProject } from "./reached-projects";
import { redirectedUses } from "./redirected-uses";

// Nx's `DependencyType.implicit`, written out because the plugin does not
// load @nx/devkit at run time.
//
// An edge of another type names a source file, and Nx records it under that
// file. For a file whose hash is unchanged, Nx puts back the records it
// cached in an earlier computation in place of the new ones, while a crate's
// edges also depend on other files, such as the `[workspace.dependencies]` of
// its workspace and the ignore files that decide which crates are projects
// (EVD-NX-EDGE-CACHE). Implicit edges are taken as returned every time.
const implicit = "implicit" as DependencyType.implicit;

/**
 * The edges of the projects that one plugin entry created: from each crate
 * to every crate it depends on through a path, whether as a normal, build
 * or dev-dependency, and to every crate with a project that it reaches only
 * through path dependencies on crates without one
 * ({@link projectsBehindCratesWithoutProject}), from each workspace project
 * to every member of its workspace, and from members to the crates that
 * their workspace's `[patch]`, `[replace]` and `paths` tables redirect to
 * ({@link redirectedUses}).
 *
 * An edge exists only where both crates are Nx projects, and names each end
 * by the project that Nx has at the crate's folder, as `projects` lists it:
 * a `package.json` or `project.json` in that folder may have renamed it.
 * A path dependency on a crate without a project gives no edge to it. Edges
 * that close a cycle are kept, apart from the redirected uses that
 * {@link redirectedUses} leaves without an edge.
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
  // The same by real folder, for the crates behind crates without a project.
  const realPaths = new Map<string, string>();
  const real = (path: string) => {
    let resolved = realPaths.get(path);
    if (resolved === undefined) {
      resolved = realPath(path);
      realPaths.set(path, resolved);
    }
    return resolved;
  };
  const nameByRealFolder = new Map<string, string>();
  for (const [name, project] of Object.entries(projects)) {
    const folder = real(join(workspaceRoot, project.root));
    if (!nameByRealFolder.has(folder)) {
      nameByRealFolder.set(folder, name);
    }
  }
  const known = knownPackages(graph, real);
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
    if (project.pkg !== undefined) {
      const behind = projectsBehindCratesWithoutProject(
        project.pkg,
        (folder) => nameByRealFolder.has(folder),
        known,
        real,
      );
      for (const folder of behind) {
        add(source, nameByRealFolder.get(folder));
      }
    }
    if (project.isWorkspaceProject) {
      for (const member of project.workspace.report.packages) {
        add(source, nameAt(dirname(member.manifest_path)));
      }
    }
  }
  const roots = Object.values(projects).map((project) => project.root);
  for (const use of redirectedUses(graph, roots)) {
    if (use.edge && use.projectRoot !== undefined) {
      add(nameAt(dirname(use.member.manifest_path)), nameByRoot.get(use.projectRoot));
    }
  }
  return [...edges.values()];
}
