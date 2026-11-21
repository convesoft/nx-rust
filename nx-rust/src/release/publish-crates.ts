import type { ExecutorContext, Task } from "@nx/devkit";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { CargoDependency, CargoMetadata, CargoPackage } from "../cargo/metadata";
import { PackageSpecReportError, workspaceReport } from "../cargo/package-specs";
import { cargoMetadataOf } from "../graph/collisions";
import { realPath } from "../graph/real-path";
import { releasePublishTarget } from "../graph/targets";
import { hackCrateName } from "../graph/unification";
import { dependencyEntries, parseManifest } from "./manifests";
import { isCratesIoIndex, type Registry } from "./publish-cargo";

/** A crate of the repository, as the report of its Cargo workspace gives it. */
export interface Crate {
  /** The real package name. */
  name: string;
  version: string;
  /** The absolute path of its manifest. */
  manifest: string;
  /** The real path of its folder. */
  folder: string;
  /** The real path of its workspace's root folder. */
  workspaceRoot: string;
  /** Its `publish` list; `null` without one, `[]` for `publish = false`. */
  publish: string[] | null;
  dependencies: CargoDependency[];
  /** Its Nx project, where it has one. */
  project?: string;
  /** Whether its project has the target `nx-release-publish`. */
  hasPublishTarget: boolean;
  /** Whether it is the hack crate that the cargo-hakari configuration of its workspace names (`DES-RELEASE`, "Hack crate"). */
  hack: boolean;
}

/** What a crate's cargo commands run with: a task's label and environment. */
export interface Runner {
  /** `<project>:nx-release-publish`. */
  label: string;
  /** The task, as the task graph holds it, with its project's root. */
  task: Task;
  /** The environment of the task's cargo commands (`perTaskVariables` left out). */
  env: NodeJS.ProcessEnv;
  /** A key of {@link env}, equal for equal environments. */
  envKey: string;
}

/** A task whose checks before cargo passed so far. */
export interface Prepared extends Runner {
  id: string;
  crate: Crate;
  dryRun: boolean;
  /** What the task prints before anything else: its project's warnings and the lines for ignored options. */
  head: string[];
  start: number;
}

/**
 * Where a crate goes: a registry, with the setting that chooses it, or why
 * the executor cannot tell.
 */
export type Target =
  | { kind: "registry"; registry: Registry; source: string }
  | { kind: "unknown"; reason: string };

/**
 * Another `nx-release-publish` task of the run, which the executor did not
 * receive, as for a task run on its own (`DES-RELEASE`, "Checks before the
 * first call"). Its environment is that of a task the executor received
 * whose dotenv files give the same Cargo settings; where none does, it runs
 * with the first such task's environment and `foreign` says how they differ.
 */
export interface Other extends Prepared {
  foreign?: string;
}

/** A dependency of a crate on another crate of the repository, with what its entry says. */
export interface DependencyLink {
  dependency: Crate;
  /** Where the dependency's entry points: crates.io, or the registry it names with its index URL. */
  points: { kind: "crates-io" } | { kind: "named"; name: string; index: string };
  /** The manifest that holds the entry, relative to the repository root: the root manifest for an inherited one. */
  entryManifest: string;
}

/** Cached workspace metadata, project index, hack crates and dependency links for one publish run. */
export interface CrateStore {
  readonly root: string;
  /** The projects of the graph by the real path of their crate's folder. */
  readonly projects: Map<
    string,
    { project: string; workspaceRoot: string; hasPublishTarget: boolean }
  >;
  readonly reports: Map<string, CargoMetadata | { failure: string }>;
  /** The hack crate's name by the real path of its workspace root, `undefined` for none. */
  readonly hackCrates: Map<string, string | undefined>;
  readonly linksOf: Map<Prepared, Promise<DependencyLink[]>>;
}

/** An entry of a crate's normal or build dependency tables, with what it inherits. */
interface ManifestEntry {
  kind: "normal" | "build";
  key: string;
  /** The absolute path of the manifest that holds what the entry says: the root manifest for an inherited one. */
  manifest: string;
  folder?: string;
  requirement?: string;
  registry?: string;
}

/** Why the dependencies of a crate cannot be read; its message is the reason. */
export class LinkError extends Error {}

export function createCrateStore(context: ExecutorContext): CrateStore {
  const root = context.root;
  const projects = new Map<
    string,
    { project: string; workspaceRoot: string; hasPublishTarget: boolean }
  >();
  for (const [name, project] of Object.entries(context.projectsConfigurations?.projects ?? {})) {
    const cargo = cargoMetadataOf(project);
    if (cargo?.packageName === undefined) {
      continue;
    }
    projects.set(realPath(join(root, dirname(cargo.manifest))), {
      project: name,
      workspaceRoot: realPath(join(root, dirname(cargo.workspaceManifest))),
      hasPublishTarget: project.targets?.[releasePublishTarget] !== undefined,
    });
  }
  return {
    root,
    projects,
    reports: new Map(),
    hackCrates: new Map(),
    linksOf: new Map(),
  };
}

/**
 * The normal and build dependencies of `task`'s crate with a version
 * requirement on crates of the repository, those with `publish = false`
 * included, with where each entry points (`DES-RELEASE`, "Where a
 * dependency points").
 *
 * @throws {LinkError} When the crate's manifest or a dependency's report
 *   cannot be read, or a dependency has no entry in the manifest.
 */
export function crateLinks(store: CrateStore, task: Prepared): Promise<DependencyLink[]> {
  let links = store.linksOf.get(task);
  if (links === undefined) {
    links = readLinks(store, task);
    store.linksOf.set(task, links);
  }
  return links;
}

async function readLinks(store: CrateStore, task: Prepared): Promise<DependencyLink[]> {
  const { crate } = task;
  const links: DependencyLink[] = [];
  let entries: ManifestEntry[] | undefined;
  for (const dependency of crate.dependencies) {
    if (
      (dependency.kind !== null && dependency.kind !== "build") ||
      dependency.path === undefined
    ) {
      continue;
    }
    const folder = realPath(dependency.path);
    if (!insideRepository(store.root, folder)) {
      continue;
    }
    entries ??= manifestEntries(store, crate);
    const entry = matchingEntry(entries, dependency, folder);
    if (entry === undefined) {
      throw new LinkError(
        `cargo reports a dependency of ${crate.name} on ${dependency.name} in ${dependency.path}, but @convesoft/nx-rust finds no entry for it in ${relativePath(store.root, crate.manifest)} or in the [workspace.dependencies] of its workspace, so it cannot tell which registry the entry names, and nothing was uploaded for ${crate.name}. Check that the manifests are saved and valid, and run nx release publish again.`,
      );
    }
    if (entry.requirement === undefined) {
      // Left to cargo, which refuses a normal or build path dependency
      // without a version requirement before it uploads anything.
      continue;
    }
    const target = crateAt(store, folder, crate, task);
    if ("failure" in target) {
      throw new LinkError(target.failure);
    }
    links.push({
      dependency: target,
      points: isCratesIoIndex(dependency.registry)
        ? { kind: "crates-io" }
        : { kind: "named", name: entry.registry ?? "", index: dependency.registry as string },
      entryManifest: relativePath(store.root, entry.manifest),
    });
  }
  return links;
}

/** The folders of the crates that `crate` depends on through a normal or build path dependency. */
export function dependencyFolders(crate: Crate): string[] {
  return crate.dependencies
    .filter(
      (dependency) =>
        (dependency.kind === null || dependency.kind === "build") &&
        dependency.path !== undefined &&
        dependency.req !== "*",
    )
    .map((dependency) => realPath(dependency.path as string));
}

/** The entries of the dependency tables of `crate`'s manifest, with what they inherit. */
function manifestEntries(store: CrateStore, crate: Crate): ManifestEntry[] {
  const rootManifest = join(crate.workspaceRoot, "Cargo.toml");
  const read = (file: string) => {
    try {
      return parseManifest(readFileSync(file, "utf8"), relativePath(store.root, file));
    } catch (error) {
      throw new LinkError(
        `@convesoft/nx-rust cannot read ${relativePath(store.root, file)} to tell which registry the dependencies of ${crate.name} name (${error instanceof Error ? error.message : String(error)}), and nothing was uploaded for it. Correct the file and run nx release publish again.`,
      );
    }
  };
  const inherited = new Map(
    dependencyEntries(read(rootManifest))
      .filter((entry) => entry.kind === "workspace")
      .map((entry) => [entry.key, entry]),
  );
  return dependencyEntries(read(crate.manifest))
    .filter((entry) => entry.kind === "normal" || entry.kind === "build")
    .map((entry) => {
      const [source, manifest] =
        entry.entry.workspace === true
          ? [inherited.get(entry.key), rootManifest]
          : [entry, crate.manifest];
      const { path, version, registry } = source?.entry ?? {};
      return {
        kind: entry.kind as "normal" | "build",
        key: entry.key,
        manifest,
        folder: typeof path === "string" ? realPath(resolve(dirname(manifest), path)) : undefined,
        requirement: typeof version === "string" ? version : undefined,
        registry: typeof registry === "string" ? registry : undefined,
      };
    });
}

/**
 * The crate of the repository in `folder`, from the report of its Cargo
 * workspace with `task`'s environment: the workspace of its Nx project, the
 * workspace of `dependent` where it is a member, or the workspace that
 * cargo finds from the folder.
 */
function crateAt(
  store: CrateStore,
  folder: string,
  dependent: Crate,
  task: Prepared,
): Crate | { failure: string } {
  const candidates = [store.projects.get(folder)?.workspaceRoot, dependent.workspaceRoot].filter(
    (root): root is string => root !== undefined,
  );
  for (const root of candidates) {
    const report = reportOf(store, root, task.env, task.envKey);
    if ("failure" in report) {
      return report;
    }
    const pkg = report.packages.find(
      (candidate) => realPath(dirname(candidate.manifest_path)) === folder,
    );
    if (pkg !== undefined) {
      return crateOf(store, pkg, realPath(report.workspace_root), report);
    }
  }
  const report = reportOf(store, folder, task.env, task.envKey);
  if ("failure" in report) {
    return report;
  }
  const pkg = report.packages.find(
    (candidate) => realPath(dirname(candidate.manifest_path)) === folder,
  );
  if (pkg === undefined) {
    return {
      failure: `@convesoft/nx-rust finds no crate in ${relativePath(store.root, folder)}, on which ${dependent.name} depends, in the report of its Cargo workspace, so it cannot check that crate's version in the registry, and nothing was uploaded for ${dependent.name}.`,
    };
  }
  return crateOf(store, pkg, realPath(report.workspace_root), report);
}

/** The crate `pkg` of the workspace whose root and report these are. */
export function crateOf(
  store: CrateStore,
  pkg: CargoPackage,
  workspaceRoot: string,
  report: CargoMetadata,
): Crate {
  const folder = realPath(dirname(pkg.manifest_path));
  const project = store.projects.get(folder);
  if (!store.hackCrates.has(workspaceRoot)) {
    const members = new Set(report.workspace_members);
    store.hackCrates.set(
      workspaceRoot,
      hackCrateName(
        report.workspace_root,
        report.packages.filter((member) => members.has(member.id)).map((member) => member.name),
      ),
    );
  }
  return {
    name: pkg.name,
    version: pkg.version,
    manifest: pkg.manifest_path,
    folder,
    workspaceRoot,
    publish: Array.isArray(pkg.publish) ? pkg.publish : null,
    dependencies: pkg.dependencies ?? [],
    ...(project === undefined ? {} : { project: project.project }),
    hasPublishTarget: project?.hasPublishTarget ?? false,
    hack: store.hackCrates.get(workspaceRoot) === pkg.name,
  };
}

/**
 * The `cargo metadata --no-deps` report of the Cargo workspace that cargo
 * finds from `folder`, asked once per folder and environment, with that
 * environment (`DES-RELEASE`, "Where a dependency points").
 */
export function reportOf(
  store: CrateStore,
  folder: string,
  env: NodeJS.ProcessEnv,
  envKey: string,
): CargoMetadata | { failure: string } {
  const key = [folder, envKey].join("\u0000");
  let report = store.reports.get(key);
  if (report === undefined) {
    try {
      report = workspaceReport(folder, env);
    } catch (error) {
      if (!(error instanceof PackageSpecReportError)) {
        throw error;
      }
      const output = error.stderr.trim();
      report = {
        failure: [
          `cargo metadata failed in ${folderLabel(store.root, folder)}, so @convesoft/nx-rust cannot read the crates and dependencies there, and nothing was uploaded: ${error.message}.`,
          ...(output === "" ? [] : [output]),
          "Correct what cargo reports, such as a `registry` key that names a registry no Cargo configuration names, and run nx release publish again.",
        ].join("\n"),
      };
    }
    store.reports.set(key, report);
  }
  return report;
}

/**
 * The entry of the manifest for a dependency of the report, matched by kind,
 * key and folder, not by platform, which the report writes normalised, as
 * the version actions match it (`DES-RELEASE`, "Dependents"). Among several
 * that match, as in several target tables, one with a version requirement
 * and a `registry` key comes first.
 */
function matchingEntry(
  entries: readonly ManifestEntry[],
  dependency: CargoDependency,
  folder: string,
): ManifestEntry | undefined {
  const kind = dependency.kind === "build" ? "build" : "normal";
  const key = dependency.rename ?? dependency.name;
  const matching = entries.filter(
    (entry) => entry.kind === kind && entry.key === key && entry.folder === folder,
  );
  return (
    matching.find((entry) => entry.requirement !== undefined && entry.registry !== undefined) ??
    matching.find((entry) => entry.requirement !== undefined) ??
    matching[0]
  );
}

function insideRepository(root: string, path: string): boolean {
  const rel = relative(realPath(root), path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("/");
}

export function relativePath(root: string, path: string): string {
  const rel = relative(realPath(root), realPath(path));
  return rel === "" ? "." : rel.split(sep).join("/");
}

export function folderLabel(root: string, folder: string): string {
  return `the folder ${relativePath(root, folder)}`;
}
