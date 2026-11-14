import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { CargoDependency, CargoPackage } from "../cargo/metadata";
import type { Redirection } from "../cargo/redirections";
import { satisfies } from "../cargo/version-req";
import type { CargoWorkspace } from "./discovery";
import type { CargoGraph } from "./projects";
import { knownPackages, projectsBehindDependency, projectsReachedByPath } from "./reached-projects";
import { realPath as resolveRealPath } from "./real-path";

/**
 * A crate that a member of a workspace uses, or may use, because a
 * `[patch]`, `[replace]` or `paths` entry of the workspace puts it in place
 * of a registry or git dependency, or because it is a crate with a project
 * behind such a crate without a project, which cargo builds with it.
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
   * dependency that may lead there. `assumed` where the member has none that
   * a report shows, but reaches a path crate that no report describes, whose
   * dependencies may lead there. A crate with a project behind a redirected
   * crate without one has the kind of the member's use of that crate, and
   * the strongest of them where several lead there or the crate is
   * redirected itself.
   */
  kind: "direct" | "possible" | "assumed";
  /**
   * Whether the member gets an edge to the crate's project. Otherwise its
   * targets get the crate's folder as an input, and for a crate with a
   * project those of the crates behind it ({@link RedirectedUse.brings}):
   * where the crate has no project, where a possible or assumed use would close a cycle with real
   * dependencies, where two crates may only possibly use each other, and
   * where an assumed use meets another edge in the opposite direction.
   */
  edge: boolean;
  /**
   * For a crate with a project whose edge is left out: the real paths of the
   * folders whose files the member's targets get in place of the edge
   * ({@link broughtFolders}), the crate's own first.
   */
  brings?: string[];
}

/**
 * The crates that the members of each workspace use, or may use, through the
 * workspace's redirections (DES-PROJECT-GRAPH).
 *
 * - Behind a redirected crate without a project, the member uses each crate
 *   with a project that cargo builds with it, through its normal and build
 *   path dependencies and any number of crates without a project
 *   ({@link projectsBehindDependency}), with the kind of its use of the
 *   redirected crate. Each such use weighs as a use of that kind of a
 *   redirected crate with a project, below.
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
 * - A member that has no such dependency that a report shows, but reaches
 *   a path crate without a report, may use every other redirected crate as
 *   well: an assumed use, the weakest kind, which never removes or weakens
 *   another edge. Its own edge is left out where the redirected crate
 *   reaches the member through real dependencies of kind normal or build,
 *   and where any other edge between the two projects points the opposite
 *   way: a path dependency, also one through crates without a project
 *   ({@link projectsReachedByPath}), a direct, possible or other assumed
 *   use.
 *
 * A use of a crate with a project whose edge is left out brings, in
 * {@link RedirectedUse.brings}, what the edge would have brought: the crate
 * and every crate that cargo builds with it ({@link broughtFolders}).
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
  const known = knownPackages(graph, realPath);
  const rootByFolder = new Map<string, string>();
  for (const root of projectRoots) {
    const folder = realPath(join(workspaceRoot, root));
    if (!rootByFolder.has(folder)) {
      rootByFolder.set(folder, root);
    }
  }
  const uses: RedirectedUse[] = [];
  // How cargo resolves a dependency in each workspace that redirects.
  const resolvers = new Map<CargoWorkspace, Resolver>();
  for (const workspace of graph.discovery.workspaces) {
    if (workspace.redirections.length > 0) {
      const found = workspaceUses(workspace, known, rootByFolder);
      uses.push(...found.uses);
      resolvers.set(workspace, found.resolved);
    }
  }
  // An assumed use gives way to every other edge in the opposite direction.
  const edges = new Set(
    uses.filter((use) => use.edge).map((use) => pair(folderOf(use.member), use.folder)),
  );
  const hasProject = (folder: string) => rootByFolder.has(folder);
  for (const use of uses) {
    if (
      use.kind === "assumed" &&
      use.edge &&
      (edges.has(pair(use.folder, folderOf(use.member))) ||
        reachesByPath(known.get(use.folder), folderOf(use.member), hasProject, known))
    ) {
      use.edge = false;
    }
  }
  for (const use of uses) {
    if (!use.edge && use.projectRoot !== undefined) {
      use.brings = broughtFolders(
        use.folder,
        folderOf(use.member),
        known,
        resolvers.get(use.workspace),
      );
    }
  }
  return uses;
}

/**
 * The crates whose files a member's targets get in place of a left-out edge
 * to the crate with a project in `folder` (DES-INPUTS, "Redirected crates"):
 * what the edge would have brought through `^` inputs, by the real paths of
 * their folders. That is the crate itself and every crate that it reaches
 * through dependencies of kind normal or build, to any depth, with or
 * without a project: path dependencies, matched by real folder, and the
 * dependencies that a redirection of the member's workspace resolves
 * directly, since cargo builds the crate for the member in that workspace.
 * Cargo builds the dev-dependencies of none of them for the member.
 *
 * The walk ends at the member, which is never among them, so that it stops
 * where a cycle would lead back to the member and on to the crates that
 * depend on it; at a crate it has met before; and at a crate that no report
 * describes, whose folder counts alone because what it depends on is not
 * known. Registry and git crates that a crate on the way depends on are no
 * folders: the member's lockfile digest covers them (DES-LOCKFILE-HASHING).
 */
function broughtFolders(
  folder: string,
  member: string,
  known: Map<string, CargoPackage>,
  resolved: Resolver,
): string[] {
  const folders = [folder];
  const visited = new Set<string>([member, folder]);
  const start = known.get(folder);
  const queue = start === undefined ? [] : [start];
  while (queue.length > 0) {
    const pkg = queue.shift();
    for (const dependency of pkg.dependencies) {
      if (dependency.kind === "dev") {
        continue;
      }
      const next =
        typeof dependency.path === "string"
          ? [realPath(dependency.path)]
          : resolved(dependency).map((target) => folderOf(target));
      for (const reached of next) {
        if (visited.has(reached)) {
          continue;
        }
        visited.add(reached);
        folders.push(reached);
        const behind = known.get(reached);
        if (behind !== undefined) {
          queue.push(behind);
        }
      }
    }
  }
  return folders;
}

/** The crates that cargo resolves a dependency to in a workspace. */
type Resolver = (dependency: CargoDependency) => CargoPackage[];

// Whether `pkg` has an edge to the crate in `folder`, which has a project,
// through its path dependencies: directly, or through crates without a
// project.
function reachesByPath(
  pkg: CargoPackage | undefined,
  folder: string,
  hasProject: (folder: string) => boolean,
  known: Map<string, CargoPackage>,
): boolean {
  return (
    pkg !== undefined && projectsReachedByPath(pkg, hasProject, known, realPath).includes(folder)
  );
}

function pair(from: string, to: string): string {
  return JSON.stringify([from, to]);
}

// How strong each kind of use is: a member that uses a crate in two ways
// uses it in the stronger.
const strength: Record<RedirectedUse["kind"], number> = { assumed: 0, possible: 1, direct: 2 };

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
): { uses: RedirectedUse[]; resolved: Resolver } {
  const targets = redirectedCrates(workspace, known, rootByFolder);
  const byName = new Map<string, Target[]>();
  for (const target of targets.values()) {
    if (target.pkg) {
      byName.set(target.pkg.name, [...(byName.get(target.pkg.name) ?? []), target]);
    }
  }
  // The crates that cargo resolves a dependency to, in this workspace.
  const resolved: Resolver = (dependency) => {
    if (typeof dependency.path === "string") {
      const pkg = known.get(realPath(dependency.path));
      return pkg ? [pkg] : [];
    }
    return (byName.get(dependency.name) ?? [])
      .filter((target) => redirects(target, dependency))
      .map((target) => target.pkg);
  };
  // The crates with a project behind each redirected crate without one, by
  // the redirected crate's folder.
  const hasProject = (folder: string) => rootByFolder.has(folder);
  const behind = new Map<string, string[]>();
  for (const target of targets.values()) {
    if (target.projectRoot === undefined && target.pkg !== undefined) {
      behind.set(target.folder, projectsBehindDependency(target.pkg, hasProject, known, realPath));
    }
  }
  const members = new Set(workspace.members.map((pkg) => folderOf(pkg)));
  const uses: RedirectedUse[] = [];
  for (const member of workspace.members) {
    const own = folderOf(member);
    const direct = directTargets(member, own, members, targets, resolved);
    const external = reachesExternal(member, known);
    // The member's strongest use of each crate, by its folder.
    const used = new Map<string, Omit<RedirectedUse, "edge">>();
    const use = (folder: string, kind: RedirectedUse["kind"], projectRoot: string | undefined) => {
      const earlier = used.get(folder);
      if (folder !== own && (earlier === undefined || strength[kind] > strength[earlier.kind])) {
        used.set(folder, {
          member,
          workspace,
          folder,
          projectRoot,
          reported: known.has(folder),
          kind,
        });
      }
    };
    for (const target of targets.values()) {
      const kind = direct.has(target.folder) ? "direct" : external;
      if (target.folder === own || kind === undefined) {
        continue;
      }
      use(target.folder, kind, target.projectRoot);
      for (const folder of behind.get(target.folder) ?? []) {
        use(folder, kind, rootByFolder.get(folder));
      }
    }
    for (const found of used.values()) {
      const pkg = known.get(found.folder);
      const cycle = found.kind !== "direct" && pkg !== undefined && reaches(pkg, own, resolved);
      uses.push({ ...found, edge: found.projectRoot !== undefined && !cycle });
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
  return { uses, resolved };
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

// `possible` where the member, or a path crate that it reaches through its
// own dependencies and then through normal and build dependencies, has a
// registry or git dependency. Cargo builds no dev-dependency of a crate
// other than the one it builds or tests. Otherwise `assumed` where such a
// path crate has no report, so that what it depends on is not known, and
// `undefined` where the member reaches no registry or git crate.
function reachesExternal(
  member: CargoPackage,
  known: Map<string, CargoPackage>,
): "possible" | "assumed" | undefined {
  const visited = new Set<string>([folderOf(member)]);
  const queue = [member];
  let unreported = false;
  while (queue.length > 0) {
    const pkg = queue.shift();
    for (const dependency of pkg.dependencies) {
      if (pkg !== member && dependency.kind === "dev") {
        continue;
      }
      if (typeof dependency.path !== "string") {
        return "possible";
      }
      const next = known.get(realPath(dependency.path));
      if (next === undefined) {
        unreported = true;
      } else if (!visited.has(folderOf(next))) {
        visited.add(folderOf(next));
        queue.push(next);
      }
    }
  }
  return unreported ? "assumed" : undefined;
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
