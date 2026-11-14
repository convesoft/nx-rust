import { dirname } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import type { CargoGraph } from "./projects";

/**
 * Every package that a report of the graph computation describes, by the
 * real path of its folder: the members of each workspace and the crates
 * without a project whose reports discovery requested.
 *
 * @param realPath Resolves symbolic links, as the caller compares folders.
 */
export function knownPackages(
  graph: CargoGraph,
  realPath: (path: string) => string,
): Map<string, CargoPackage> {
  const known = new Map<string, CargoPackage>();
  const reports = [
    ...graph.discovery.workspaces.map((workspace) => workspace.report),
    ...graph.discovery.pathDependencyReports.map((entry) => entry.report),
  ];
  for (const report of reports) {
    for (const pkg of report.packages) {
      const folder = realPath(dirname(pkg.manifest_path));
      if (!known.has(folder)) {
        known.set(folder, pkg);
      }
    }
  }
  return known;
}

/**
 * The crates with a project that `crate` reaches by path, by the real paths
 * of their folders (DES-PROJECT-GRAPH, "Edges"): its own path dependencies
 * on crates with a project, of every kind, and the crates with a project
 * that it reaches only through path dependencies on crates without a
 * project, through any number of them.
 *
 * A path names the crate at the real path of its folder, symbolic links
 * resolved, as cargo builds the crate it finds there. The walk takes the
 * crate's own path dependencies of every kind, and from each crate without
 * a project only its normal and build dependencies: cargo builds the
 * dev-dependencies of the crate it tests, never those of a crate it builds
 * for that one. It stops at a crate with a project, whose own edges carry
 * on from there, and at a crate that no report describes, such as one whose
 * folder holds `.cargo-checksum.json` or whose report failed: what that one
 * depends on is unknown and gives nothing. The crate itself is never among
 * them, also where a dev-dependency leads back to it.
 *
 * @param hasProject Whether the crate in a folder, a real path, is an Nx project.
 * @param known The packages that a report describes ({@link knownPackages}).
 * @param realPath Resolves symbolic links, as `known` and `hasProject` do.
 */
// @mara implements DES-PROJECT-GRAPH
export function projectsReachedByPath(
  crate: CargoPackage,
  hasProject: (folder: string) => boolean,
  known: ReadonlyMap<string, CargoPackage>,
  realPath: (path: string) => string,
): string[] {
  return reachedProjects(crate, true, hasProject, known, realPath);
}

/**
 * The crates with a project behind `crate`, a crate without a project that
 * cargo builds as a dependency, such as one that a `[patch]`, `[replace]`
 * or `paths` entry puts in place of a registry or git dependency
 * (DES-PROJECT-GRAPH, "Redirected crates"): those that it reaches through
 * its normal and build path dependencies, through any number of crates
 * without a project, by the real paths of their folders.
 *
 * It walks as {@link projectsReachedByPath} does from a crate without a
 * project behind the one it starts from, so it takes no dev-dependency of
 * `crate` either: cargo builds those only where it tests `crate`.
 */
// @mara implements DES-PROJECT-GRAPH
export function projectsBehindDependency(
  crate: CargoPackage,
  hasProject: (folder: string) => boolean,
  known: ReadonlyMap<string, CargoPackage>,
  realPath: (path: string) => string,
): string[] {
  return reachedProjects(crate, false, hasProject, known, realPath);
}

// The walk of both: from `crate`, whose dev-dependencies count where
// `ownDevDependencies` says so, through crates without a project.
function reachedProjects(
  crate: CargoPackage,
  ownDevDependencies: boolean,
  hasProject: (folder: string) => boolean,
  known: ReadonlyMap<string, CargoPackage>,
  realPath: (path: string) => string,
): string[] {
  const reached: string[] = [];
  const visited = new Set<string>([realPath(dirname(crate.manifest_path))]);
  const queue = [crate];
  while (queue.length > 0) {
    const pkg = queue.shift();
    const devDependencies = pkg === crate && ownDevDependencies;
    for (const dependency of pkg.dependencies) {
      if (typeof dependency.path !== "string" || (!devDependencies && dependency.kind === "dev")) {
        continue;
      }
      const folder = realPath(dependency.path);
      if (visited.has(folder)) {
        continue;
      }
      visited.add(folder);
      if (hasProject(folder)) {
        reached.push(folder);
        continue;
      }
      const next = known.get(folder);
      if (next !== undefined) {
        queue.push(next);
      }
    }
  }
  return reached;
}
