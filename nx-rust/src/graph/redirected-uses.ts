import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { CargoDependency, CargoPackage } from "../cargo/metadata";
import type { Redirection } from "../cargo/redirections";
import { satisfies } from "../cargo/version-req";
import type { CargoWorkspace } from "./discovery";
import type { CargoGraph } from "./projects";
import { realPath as resolveRealPath } from "./real-path";

/**
 * A crate that a member of a workspace uses, or may use, because a
 * `[patch]`, `[replace]` or `paths` entry of the workspace puts it in place
 * of a registry or git dependency.
 *
 * This is the one place that says which members get an edge to such a
 * crate and which get its files as an input instead.
 */
export interface RedirectedUse {
  /** The member, which has a project. */
  member: CargoPackage;
  /** The workspace whose entry redirects. */
  workspace: CargoWorkspace;
  /** The real path of the crate's folder, symbolic links resolved. */
  folder: string;
  /** The root of the crate's Nx project, as Nx lists it; absent without a project. */
  projectRoot?: string;
  /**
   * Whether a `cargo metadata` report describes the crate. Without one, the
   * path dependencies behind it are unknown.
   */
  reported: boolean;
  /**
   * `direct` where cargo resolves a dependency of the member to the crate:
   * the member, or a crate it reaches without passing another member of
   * the workspace, declares a dependency of the crate's name whose source
   * the entry redirects and whose version requirement the crate's version
   * satisfies. `possible` where the member only has a registry or git
   * dependency that may lead there.
   */
  kind: "direct" | "possible";
  /**
   * Whether the member gets an edge to the crate's project. Otherwise its
   * targets get the crate's folder as an input: where the crate has no
   * project, where a possible use would close a cycle with real
   * dependencies, and where two crates may only possibly use each other.
   */
  edge: boolean;
}

/**
 * The crates that the members of each workspace use, or may use, through the
 * workspace's redirections (DES-PROJECT-GRAPH).
 *
 * - A direct use is always an edge, cycles included, as for a path
 *   dependency.
 * - A member with a registry or git dependency, of its own or of a path
 *   crate it reaches through normal or build dependencies, may use every
 *   other redirected crate. Its edge is left out where that crate already
 *   reaches the member through real dependencies of kind normal or build:
 *   path dependencies and direct redirections. Cargo would reject such a
 *   use as a cycle.
 * - Two redirected crates that may only possibly use each other get no edge
 *   either way: cargo can have at most one of them, and which one is not
 *   known.
 *
 * A requirement that the plugin cannot evaluate, or a source it cannot
 * match to the entry, makes a declaration possible, not direct.
 *
 * @param projectRoots The roots of the projects that Nx knows, relative to
 *   the repository root.
 */
// @mara implements DES-PROJECT-GRAPH
export function redirectedUses(
  graph: CargoGraph,
  projectRoots: readonly string[],
): RedirectedUse[] {
  realPaths = new Map();
  const { workspaceRoot } = graph.discovery;
  const known = knownPackages(graph);
  const rootByFolder = new Map<string, string>();
  for (const root of projectRoots) {
    const folder = realPath(join(workspaceRoot, root));
    if (!rootByFolder.has(folder)) {
      rootByFolder.set(folder, root);
    }
  }
  const uses: RedirectedUse[] = [];
  for (const workspace of graph.discovery.workspaces) {
    if (workspace.redirections.length > 0) {
      uses.push(...workspaceUses(workspace, known, rootByFolder));
    }
  }
  return uses;
}

/** A crate that a workspace's entries redirect to. */
interface Target {
  folder: string;
  projectRoot?: string;
  pkg?: CargoPackage;
  redirections: Redirection[];
}

function workspaceUses(
  workspace: CargoWorkspace,
  known: Map<string, CargoPackage>,
  rootByFolder: Map<string, string>,
): RedirectedUse[] {
  const targets = redirectedCrates(workspace, known, rootByFolder);
  const byName = new Map<string, Target[]>();
  for (const target of targets.values()) {
    if (target.pkg) {
      byName.set(target.pkg.name, [...(byName.get(target.pkg.name) ?? []), target]);
    }
  }
  // The crates that cargo resolves a dependency to, in this workspace.
  const resolved = (dependency: CargoDependency): CargoPackage[] => {
    if (typeof dependency.path === "string") {
      const pkg = known.get(realPath(dependency.path));
      return pkg ? [pkg] : [];
    }
    return (byName.get(dependency.name) ?? [])
      .filter((target) => redirects(target, dependency))
      .map((target) => target.pkg);
  };
  const members = new Set(workspace.members.map((pkg) => folderOf(pkg)));
  const uses: RedirectedUse[] = [];
  for (const member of workspace.members) {
    const own = folderOf(member);
    const direct = directTargets(member, own, members, targets, resolved);
    const external = reachesExternal(member, known);
    for (const target of targets.values()) {
      if (target.folder === own) {
        continue;
      }
      const base = {
        member,
        workspace,
        folder: target.folder,
        projectRoot: target.projectRoot,
        reported: target.pkg !== undefined,
      };
      if (direct.has(target.folder)) {
        uses.push({ ...base, kind: "direct", edge: target.projectRoot !== undefined });
      } else if (external) {
        const cycle = target.pkg !== undefined && reaches(target.pkg, own, resolved);
        uses.push({
          ...base,
          kind: "possible",
          edge: target.projectRoot !== undefined && !cycle,
        });
      }
    }
  }
  // Two crates that may only possibly use each other.
  const possible = new Set(
    uses
      .filter((use) => use.kind === "possible" && use.edge)
      .map((use) => JSON.stringify([folderOf(use.member), use.folder])),
  );
  for (const use of uses) {
    if (
      use.kind === "possible" &&
      use.edge &&
      possible.has(JSON.stringify([use.folder, folderOf(use.member)]))
    ) {
      use.edge = false;
    }
  }
  return uses;
}

// The crates that the workspace's entries name, by real folder: the crate
// of a `[patch]` or `[replace]` entry, and every crate at or below the
// folder of a `paths` entry, or that folder itself where it holds none.
function redirectedCrates(
  workspace: CargoWorkspace,
  known: Map<string, CargoPackage>,
  rootByFolder: Map<string, string>,
): Map<string, Target> {
  const targets = new Map<string, Target>();
  const add = (folder: string, redirection: Redirection) => {
    const target = targets.get(folder) ?? {
      folder,
      projectRoot: rootByFolder.get(folder),
      pkg: known.get(folder),
      redirections: [],
    };
    target.redirections.push(redirection);
    targets.set(folder, target);
  };
  for (const redirection of workspace.redirections) {
    const folder = realPath(redirection.folder);
    if (redirection.table !== "paths") {
      if (existsSync(join(folder, "Cargo.toml"))) {
        add(folder, redirection);
      }
      continue;
    }
    if (!existsSync(folder)) {
      continue;
    }
    const crates = [...new Set([...known.keys(), ...rootByFolder.keys()])].filter(
      (candidate) =>
        (candidate === folder || candidate.startsWith(folder + sep)) &&
        existsSync(join(candidate, "Cargo.toml")),
    );
    for (const crate of crates.length > 0 ? crates : [folder]) {
      add(crate, redirection);
    }
  }
  return targets;
}

// Whether the entries of `target` redirect `dependency` to it: the name is
// the crate's, the entry applies to the dependency's source, and the crate's
// version satisfies the requirement.
function redirects(target: Target, dependency: CargoDependency): boolean {
  if (target.pkg === undefined || dependency.name !== target.pkg.name) {
    return false;
  }
  return (
    target.redirections.some((redirection) => appliesTo(redirection, dependency)) &&
    satisfies(dependency.req, target.pkg.version) === true
  );
}

const cratesIo = "https://github.com/rust-lang/crates.io-index";

// Whether an entry applies to a dependency's source, as far as the plugin
// can tell without reading the configuration of registries.
function appliesTo(redirection: Redirection, dependency: CargoDependency): boolean {
  const source = dependency.source;
  if (source === null) {
    return false;
  }
  if (redirection.table === "paths") {
    return true;
  }
  let url: string | undefined;
  if (redirection.table === "patch") {
    url =
      redirection.key === "crates-io"
        ? cratesIo
        : redirection.key?.includes("://")
          ? redirection.key
          : undefined;
  } else {
    // A package id specification: `name:version`, `name@version` or
    // `url#name@version`; without a URL, the package is from crates.io.
    const spec = redirection.key ?? "";
    url = spec.includes("#") ? spec.slice(0, spec.indexOf("#")) : cratesIo;
  }
  return url !== undefined && sameSource(sourceUrl(source), url);
}

// The URL of a source as the report writes it, without its kind, query and fragment.
function sourceUrl(source: string): string {
  const url = source.replace(/^(git|registry|sparse)\+/, "");
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

function sameSource(a: string, b: string): boolean {
  const normal = (url: string) =>
    url === "https://index.crates.io/" || url === "https://index.crates.io"
      ? cratesIo
      : url.replace(/\/+$/, "").replace(/\.git$/, "");
  return normal(a) === normal(b);
}

// The redirected crates that cargo resolves the member's dependencies to:
// its own, of every kind, and those of the crates it reaches through normal
// and build dependencies, without passing another member of the workspace,
// whose own edges carry on from there.
function directTargets(
  member: CargoPackage,
  own: string,
  members: Set<string>,
  targets: Map<string, Target>,
  resolved: (dependency: CargoDependency) => CargoPackage[],
): Set<string> {
  const direct = new Set<string>();
  const visited = new Set<string>([own]);
  const queue = [member];
  while (queue.length > 0) {
    const pkg = queue.shift();
    for (const dependency of pkg.dependencies) {
      if (pkg !== member && dependency.kind === "dev") {
        continue;
      }
      const redirected = typeof dependency.path !== "string";
      for (const next of resolved(dependency)) {
        const folder = folderOf(next);
        if (redirected && targets.has(folder)) {
          direct.add(folder);
        }
        if (!visited.has(folder) && !members.has(folder)) {
          visited.add(folder);
          queue.push(next);
        }
      }
    }
  }
  return direct;
}

// Whether `from` reaches the crate in `to` through real dependencies of kind
// normal or build: path dependencies and direct redirections.
function reaches(
  from: CargoPackage,
  to: string,
  resolved: (dependency: CargoDependency) => CargoPackage[],
): boolean {
  const visited = new Set<string>([folderOf(from)]);
  const queue = [from];
  while (queue.length > 0) {
    const pkg = queue.shift();
    for (const dependency of pkg.dependencies) {
      if (dependency.kind === "dev") {
        continue;
      }
      for (const next of resolved(dependency)) {
        const folder = folderOf(next);
        if (folder === to) {
          return true;
        }
        if (!visited.has(folder)) {
          visited.add(folder);
          queue.push(next);
        }
      }
    }
  }
  return false;
}

// Whether the member, or a path crate that it reaches through its own
// dependencies and then through normal and build dependencies, has a
// registry or git dependency. Cargo builds no dev-dependency of a crate
// other than the one it builds or tests.
function reachesExternal(member: CargoPackage, known: Map<string, CargoPackage>): boolean {
  const visited = new Set<string>([folderOf(member)]);
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
      const next = known.get(realPath(dependency.path));
      if (next && !visited.has(folderOf(next))) {
        visited.add(folderOf(next));
        queue.push(next);
      }
    }
  }
  return false;
}

// Every package that a report of the graph computation describes, by the
// real path of its folder.
function knownPackages(graph: CargoGraph): Map<string, CargoPackage> {
  const known = new Map<string, CargoPackage>();
  const reports = [
    ...graph.discovery.workspaces.map((workspace) => workspace.report),
    ...graph.discovery.pathDependencyReports.map((entry) => entry.report),
  ];
  for (const report of reports) {
    for (const pkg of report.packages) {
      const folder = folderOf(pkg);
      if (!known.has(folder)) {
        known.set(folder, pkg);
      }
    }
  }
  return known;
}

// The real path of a package's folder.
function folderOf(pkg: CargoPackage): string {
  return realPath(dirname(pkg.manifest_path));
}

// The real paths that one call of redirectedUses has looked up.
let realPaths = new Map<string, string>();

function realPath(path: string): string {
  let real = realPaths.get(path);
  if (real === undefined) {
    real = resolveRealPath(path);
    realPaths.set(path, real);
  }
  return real;
}
