import type {
  CreateDependenciesContext,
  DependencyType,
  RawProjectGraphDependency,
} from "@nx/devkit";
import { dirname, join, relative, sep } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import type { CargoWorkspace } from "./discovery";
import type { CargoGraph } from "./projects";

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
 * or dev-dependency, from each workspace project to every member of its
 * workspace, and from members to the crates that their workspace's
 * `[patch]`, `[replace]` and `paths` tables redirect to
 * ({@link redirectedUses}).
 *
 * An edge exists only where both crates are Nx projects, and names each end
 * by the project that Nx has at the crate's folder, as `projects` lists it:
 * a `package.json` or `project.json` in that folder may have renamed it.
 * A path dependency on a crate without a project gives no edge. Edges that
 * close a cycle are kept, apart from the redirected uses that
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
  const roots = Object.values(projects).map((project) => join(workspaceRoot, project.root));
  for (const use of redirectedUses(graph, roots)) {
    if (use.edge) {
      add(nameAt(dirname(use.member.manifest_path)), nameAt(use.folder));
    }
  }
  return [...edges.values()];
}

/** A crate that a member may use because a table of its workspace redirects to it. */
export interface RedirectedUse {
  /** The member, which has a project. */
  member: CargoPackage;
  /** The workspace whose table redirects. */
  workspace: CargoWorkspace;
  /** The absolute path of the folder of the crate that the member may use. */
  folder: string;
  /**
   * Whether the member gets an edge to the crate's project. Where the crate
   * reaches the member through normal or build dependencies, cargo would
   * reject a normal or build use as a cycle, so only the member's
   * dev-dependencies can lead to it: the edge is left out, so that it closes
   * no cycle, and the member's targets get the crate's files as an input
   * instead.
   */
  edge: boolean;
}

/**
 * The crates that each member of a workspace may use because the
 * workspace's `[patch]`, `[replace]` or `paths` tables redirect a registry
 * or git dependency to them.
 *
 * The tables do not say which crates use a redirected crate: one can reach
 * it through a registry crate that depends on it, or through a path crate of
 * another workspace whose registry dependency the workspace redirects. So
 * every member that has a registry or git dependency, of its own or of a
 * path crate it reaches through normal or build dependencies, may use every
 * redirected crate but itself. A member without one can reach no
 * redirected crate. The result holds such a crate only where it lies in one
 * of `folders`: the folder of a `[patch]` or `[replace]` entry, or a folder
 * at or below a `paths` entry.
 *
 * @param folders The absolute paths of the folders that may hold a crate,
 *   such as the roots of the projects that Nx knows.
 */
// @mara implements DES-PROJECT-GRAPH
export function redirectedUses(graph: CargoGraph, folders: readonly string[]): RedirectedUse[] {
  const known = knownPackages(graph);
  const uses: RedirectedUse[] = [];
  for (const workspace of graph.discovery.workspaces) {
    if (workspace.redirections.length === 0) {
      continue;
    }
    const targets = new Set<string>();
    for (const { table, folder } of workspace.redirections) {
      for (const candidate of folders) {
        if (candidate === folder || (table === "paths" && isBelow(candidate, folder))) {
          targets.add(candidate);
        }
      }
    }
    // The redirected crates that the reports know, by package name, which
    // a registry or git dependency of that name may resolve to.
    const byName = new Map<string, CargoPackage[]>();
    for (const folder of targets) {
      const pkg = known.get(join(folder, "Cargo.toml"));
      if (pkg) {
        byName.set(pkg.name, [...(byName.get(pkg.name) ?? []), pkg]);
      }
    }
    for (const member of workspace.members) {
      if (!reachesExternal(member, known)) {
        continue;
      }
      const own = dirname(member.manifest_path);
      for (const folder of [...targets].sort()) {
        if (folder === own) {
          continue;
        }
        const target = known.get(join(folder, "Cargo.toml"));
        const edge = target === undefined || !reaches(target, member, known, byName);
        uses.push({ member, workspace, folder, edge });
      }
    }
  }
  return uses;
}

// Every package that a report of the graph computation describes, by manifest.
function knownPackages(graph: CargoGraph): Map<string, CargoPackage> {
  const known = new Map<string, CargoPackage>();
  const reports = [
    ...graph.discovery.workspaces.map((workspace) => workspace.report),
    ...graph.discovery.pathDependencyReports.map((entry) => entry.report),
  ];
  for (const report of reports) {
    for (const pkg of report.packages) {
      if (!known.has(pkg.manifest_path)) {
        known.set(pkg.manifest_path, pkg);
      }
    }
  }
  return known;
}

// Whether the member, or a path crate that it reaches through its own
// dependencies and then through normal and build dependencies, has a
// registry or git dependency. Cargo builds no dev-dependency of a crate
// other than the one it builds or tests.
function reachesExternal(member: CargoPackage, known: Map<string, CargoPackage>): boolean {
  const visited = new Set<string>([member.manifest_path]);
  const queue = [member];
  while (queue.length > 0) {
    const pkg = queue.shift();
    for (const dependency of pkg.dependencies) {
      if (pkg !== member && dependency.kind === "dev") {
        continue;
      }
      if (typeof dependency.path !== "string") {
        return true;
      }
      const next = known.get(join(dependency.path, "Cargo.toml"));
      if (next && !visited.has(next.manifest_path)) {
        visited.add(next.manifest_path);
        queue.push(next);
      }
    }
  }
  return false;
}

// Whether `from` reaches `to` through normal and build dependencies: path
// dependencies, and registry or git dependencies named like a redirected
// crate of the workspace.
function reaches(
  from: CargoPackage,
  to: CargoPackage,
  known: Map<string, CargoPackage>,
  byName: Map<string, CargoPackage[]>,
): boolean {
  const visited = new Set<string>([from.manifest_path]);
  const queue = [from];
  while (queue.length > 0) {
    const pkg = queue.shift();
    for (const dependency of pkg.dependencies) {
      if (dependency.kind === "dev") {
        continue;
      }
      const next =
        typeof dependency.path === "string"
          ? [known.get(join(dependency.path, "Cargo.toml"))]
          : (byName.get(dependency.name) ?? []);
      for (const candidate of next) {
        if (candidate === undefined || visited.has(candidate.manifest_path)) {
          continue;
        }
        if (candidate.manifest_path === to.manifest_path) {
          return true;
        }
        visited.add(candidate.manifest_path);
        queue.push(candidate);
      }
    }
  }
  return false;
}

function isBelow(path: string, folder: string): boolean {
  return path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
}
