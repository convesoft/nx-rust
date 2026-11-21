import type { ProjectGraph, Tree } from "@nx/devkit";
import { accessSync, constants } from "node:fs";
import type { CargoDependency } from "../cargo/metadata";
import { realPath } from "../graph/real-path";
import { crateVersion, ReleaseError } from "./manifests";
import { memberEntries, readDocument, readTreeText, type Requirement } from "./places";
import type { ReleaseCrate, ReleaseRepository } from "./repository";
import { replaceStrings, type StringEdit, TomlEditError } from "./toml-edit";

/** A requirement on a dependent's entry that a run rewrites. */
export interface Rewrite {
  requirement: Requirement;
  /** The crate whose version changes. */
  crate: ReleaseCrate;
  to: string;
}

// Fails where the run versions only some of the crates that share the inherited version.
export function checkVersionedTogether(
  projects: ReadonlySet<string>,
  crate: ReleaseCrate,
  sharing: readonly ReleaseCrate[],
): void {
  const left = sharing.filter(
    (other) => other.project === undefined || !projects.has(other.project),
  );
  if (left.length > 0) {
    const versioned = sharing.filter((other) => !left.includes(other));
    throw new ReleaseError(
      `nx release version would version ${sentenceList(versioned.map((other) => other.name))} but not ${sentenceList(left.map((other) => other.name))}, although they inherit version.workspace = true from ${crate.workspace.rootManifest} and share one version. Nx adds a crate to a run as a dependent of a crate in another release group without the rest of its group: run the command for their whole release group as well, such as with --groups naming it, or without --projects and --groups.`,
    );
  }
}

// The lines that name the edges of the project graph through which Nx
// bumps this project's fixed group: those into a project of another
// release group in which the run has written a new version.
export function graphBumpLines(
  project: string,
  group: string,
  versioned: ReadonlySet<string>,
  graph: ProjectGraph,
  repository: ReleaseRepository | undefined,
  groupOf: (project: string | undefined) => string | undefined,
): string[] {
  const bumpedGroups = new Set([...versioned].map(groupOf));
  const edges = (graph.dependencies[project] ?? []).filter((edge) => {
    const target = groupOf(edge.target);
    return target !== undefined && target !== group && bumpedGroups.has(target);
  });
  if (edges.length === 0) {
    return [
      `⚠️  Nx bumps the fixed release group "${group}" as a whole, because ${project} has an edge in the project graph to a project of a release group that it bumped before; nx-rust's guide lists this as a known limit of Nx release.`,
    ];
  }
  return [...new Set(edges.map((edge) => edge.target))].map(
    (target) =>
      `⚠️  Nx bumps the fixed release group "${group}" as a whole, because the project graph has an edge from ${project} to ${target}, whose release group "${groupOf(target)}" it bumped before. ${edgeInCargo(repository, project, target)} nx-rust's guide lists this as a known limit of Nx release.`,
  );
}

// What the edge between two crates' projects is in Cargo, as a sentence.
function edgeInCargo(
  repository: ReleaseRepository | undefined,
  source: string,
  target: string,
): string {
  const from = repository?.crateOfProject(source);
  const to = repository?.crateOfProject(target);
  if (from === undefined || to === undefined) {
    return "";
  }
  const uses = from.dependencies.filter(
    (dependency) => dependency.path !== undefined && realPath(dependency.path) === to.folder,
  );
  if (uses.length === 0) {
    return `In Cargo, ${from.name} names ${to.name} in no dependency: nx-rust adds the edge for the cache key, as through a crate without a project or a [patch].`;
  }
  const kinds = [
    ...new Set(
      uses.map((dependency) =>
        dependency.kind === "dev"
          ? "a dev-dependency"
          : `a ${dependency.kind === "build" ? "build" : "normal"} dependency`,
      ),
    ),
  ];
  return `In Cargo, ${from.name} depends on ${to.name} through ${sentenceList(kinds)}.`;
}

// Stops the run where a crate of the release would get a rewritten
// requirement on a bumped crate without a new version (nxr-5a9w1y, part 2).
export function checkDependentsVersioned(
  tree: Tree,
  repository: ReleaseRepository,
  rewrites: readonly Rewrite[],
  versioned: ReadonlySet<string>,
  groupOf: (project: string | undefined) => string | undefined,
): void {
  const lines = new Set<string>();
  for (const { requirement, crate, to } of rewrites) {
    if (
      requirement.kind !== "normal" &&
      requirement.kind !== "build" &&
      requirement.kind !== "workspace"
    ) {
      continue;
    }
    // A [workspace.dependencies] entry is the requirement of each member
    // that inherits it in a normal or build table.
    const holders =
      requirement.kind === "workspace"
        ? requirement.workspace.crates.filter((member) =>
            memberEntries(tree, repository, member).some(
              (entry) =>
                (entry.kind === "normal" || entry.kind === "build") &&
                entry.entry.workspace === true &&
                entry.key === requirement.key,
            ),
          )
        : requirement.holder === undefined
          ? []
          : [requirement.holder];
    for (const holder of holders) {
      const group = groupOf(holder.project);
      if (holder.project === undefined || group === undefined || versioned.has(holder.project)) {
        continue;
      }
      lines.add(
        `- ${holder.name}, in the release group "${group}": its requirement on ${crate.name} in ${requirement.file} [${requirement.table}] becomes "${to}", but Nx gives ${holder.name} no new version`,
      );
    }
  }
  if (lines.size > 0) {
    throw new ReleaseError(
      [
        "nx release version would rewrite requirements of crates in the release on crates that it bumps, without bumping those crates:",
        ...lines,
        "Release each of them in the same run: give it a bump of its own, through a version plan or a conventional commit, or name a version on the command line, which applies to every crate of the run. Nx bumps no crate of an independent group for a dependency in a fixed group. No file has been changed.",
      ].join("\n"),
    );
  }
}

// The setting is on as `true`, and as a list, which names npm's dependency
// collections and so means nothing more specific for a crate, while it is
// not empty.
export function isOn(setting: boolean | readonly string[]): boolean {
  return Array.isArray(setting) ? setting.length > 0 : setting === true;
}

// Whether the manifest's entries for a dependency whose report gives the
// requirement `*` write a version: the entries of its kind and key that
// name its folder, in any target table, however the table's header spells
// the platform. Fails where the manifest has no such entry.
export function writesRequirement(
  tree: Tree,
  repository: ReleaseRepository,
  crate: ReleaseCrate,
  dependency: CargoDependency,
): boolean {
  const kind = dependency.kind === "build" ? "build" : "normal";
  const key = dependency.rename ?? dependency.name;
  const folder = realPath(dependency.path ?? "");
  const entries = memberEntries(tree, repository, crate).filter(
    (entry) => entry.kind === kind && entry.key === key && entry.folder === folder,
  );
  if (entries.length === 0) {
    throw new ReleaseError(
      `cargo reports that ${crate.name} depends on the crate in ${dependency.path} as ${key}, but nx release version finds no such entry in ${crate.manifest} to tell whether it writes a version requirement. Run nx reset and the command again; if this stays, report the manifest to nx-rust.`,
    );
  }
  return entries.some((entry) => entry.requirement !== undefined);
}

// The members of the crate's workspace that inherit their version, the crate among them.
export function inheritingCrates(
  tree: Tree,
  repository: ReleaseRepository,
  crate: ReleaseCrate,
): ReleaseCrate[] {
  return crate.workspace.crates.filter(
    (other) =>
      other === crate ||
      crateVersion(readDocument(tree, repository, other.manifest)).kind === "inherited",
  );
}

// Whether the file at `path` exists and the run may write it.
export function writable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// The file with the edits made, read at its tree path (`treePath`).
export function editedFile(tree: Tree, file: string, edits: readonly StringEdit[]): string {
  const text = readTreeText(tree, file);
  try {
    return replaceStrings(text, edits);
  } catch (error) {
    if (!(error instanceof TomlEditError)) {
      throw error;
    }
    throw new ReleaseError(
      `nx release version could not change the version strings in ${file} without changing anything else of it: ${error.message}. No file has been changed; change the versions by hand, and report the file to nx-rust.`,
    );
  }
}

// "a", "a and b", "a, b and c".
export function sentenceList(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
