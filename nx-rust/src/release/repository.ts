import type { ProjectGraph } from "@nx/devkit";
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "smol-toml";
import type { CargoDependency } from "../cargo/metadata";
import { PackageSpecReportError, workspaceReport } from "../cargo/package-specs";
import { configFiles } from "../cargo/redirections";
import { cargoMetadataKey, ProjectCargoMetadata } from "../graph/collisions";
import { realPath } from "../graph/real-path";
import { isTable, ReleaseError } from "./manifests";

/** A member of a Cargo workspace, as the release flow reads it. */
export interface ReleaseCrate {
  /** The real package name. */
  name: string;
  /** The crate's manifest, relative to the repository root with `/`; `..` leads outside it. */
  manifest: string;
  /** The real path of the crate's folder, which path dependencies are matched against. */
  folder: string;
  /** The crate's version before the run, as cargo reports it. */
  version: string;
  workspace: ReleaseWorkspace;
  /** The crate's Nx project, as the project graph names it; absent for a crate without one. */
  project?: string;
  /** The dependencies that the `cargo metadata --no-deps` report gives the crate. */
  dependencies: CargoDependency[];
}

/** A Cargo workspace of the repository with at least one project in the graph. */
export interface ReleaseWorkspace {
  /** The root manifest, relative to the repository root with `/`. */
  rootManifest: string;
  /** Its members, from its `cargo metadata --no-deps` report. */
  crates: ReleaseCrate[];
  /** The real path of its root folder. */
  root: string;
  /**
   * The absolute paths of the Cargo configuration files that cargo reads
   * for a command started in the root folder, those that `include` adds
   * among them, as `configFiles` in `redirections.ts` finds them.
   */
  configFiles: string[];
}

/**
 * The Cargo workspaces of the repository that the plugin reads, with their
 * members, as the version actions need them (`DES-RELEASE`): the
 * workspaces whose root manifest one of the graph's projects names in its
 * `metadata.cargo`, each from a `cargo metadata --no-deps` report of its
 * own, started in its root folder.
 */
export class ReleaseRepository {
  private readonly byFolder = new Map<string, ReleaseCrate>();
  private readonly byProject = new Map<string, ReleaseCrate>();

  private constructor(
    readonly root: string,
    readonly workspaces: readonly ReleaseWorkspace[],
  ) {
    for (const crate of workspaces.flatMap((workspace) => workspace.crates)) {
      this.byFolder.set(crate.folder, crate);
      if (crate.project !== undefined) {
        this.byProject.set(crate.project, crate);
      }
    }
  }

  /**
   * Reads the workspaces of `graph` in the repository at `root`.
   *
   * @throws {ReleaseError} When cargo cannot report a workspace.
   */
  static read(root: string, graph: ProjectGraph): ReleaseRepository {
    const projects = new Map<string, string>();
    const rootManifests = new Set<string>();
    for (const [name, node] of Object.entries(graph.nodes)) {
      const cargo = cargoMetadataOf(node.data.metadata);
      if (cargo === undefined) {
        continue;
      }
      rootManifests.add(cargo.workspaceManifest);
      if (cargo.packageName !== undefined) {
        projects.set(crateKey(cargo.workspaceManifest, cargo.packageName), name);
      }
    }
    const workspaces = [...rootManifests].sort().map((rootManifest) => {
      const workspaceRoot = dirname(join(root, rootManifest));
      const workspace: ReleaseWorkspace = {
        rootManifest,
        crates: [],
        root: realPath(workspaceRoot),
        configFiles: cargoConfigFiles(workspaceRoot),
      };
      const report = reportOf(root, rootManifest);
      const members = new Set(report.workspace_members);
      for (const pkg of report.packages.filter((candidate) => members.has(candidate.id))) {
        workspace.crates.push({
          name: pkg.name,
          manifest: repositoryPath(root, pkg.manifest_path),
          folder: realPath(dirname(pkg.manifest_path)),
          version: pkg.version,
          workspace,
          project: projects.get(crateKey(rootManifest, pkg.name)),
          dependencies: pkg.dependencies ?? [],
        });
      }
      return workspace;
    });
    return new ReleaseRepository(root, workspaces);
  }

  /** The crate of the Nx project `project`. */
  crateOfProject(project: string): ReleaseCrate | undefined {
    return this.byProject.get(project);
  }

  /** The crate whose folder lies at `folder`, which any path through symbolic links reaches. */
  crateAt(folder: string): ReleaseCrate | undefined {
    return this.byFolder.get(realPath(folder));
  }

  /**
   * Every manifest whose requirements the version actions update, relative
   * to the repository root: each workspace's root manifest and its members'
   * manifests, apart from those outside the repository, each once.
   */
  manifests(): string[] {
    const manifests = new Set<string>();
    for (const workspace of this.workspaces) {
      manifests.add(workspace.rootManifest);
      for (const crate of workspace.crates) {
        manifests.add(crate.manifest);
      }
    }
    return [...manifests].filter((manifest) => !manifest.startsWith("../") && manifest !== "..");
  }
}

let cached: { root: string; graph: ProjectGraph; repository: ReleaseRepository } | undefined;

/**
 * The {@link ReleaseRepository} of `graph`, read once per graph and
 * repository: one `nx release` reads every workspace once.
 */
export function releaseRepository(root: string, graph: ProjectGraph): ReleaseRepository {
  if (cached?.root !== root || cached.graph !== graph) {
    cached = { root, graph, repository: ReleaseRepository.read(root, graph) };
  }
  return cached.repository;
}

/**
 * The Cargo configuration files that cargo reads for a command started in
 * `workspaceRoot`, in descending precedence, each once: in each folder from
 * there up and in the Cargo home, `.cargo/config` where it exists and
 * `.cargo/config.toml` otherwise, and the files that their `include` names,
 * as graph creation reads them (`DES-METADATA-REPORT`). An included file
 * that cannot be parsed is left out, as graph creation leaves it out.
 *
 * @throws {ReleaseError} When a file that cargo reads in any version is no valid TOML.
 */
function cargoConfigFiles(workspaceRoot: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string, included: boolean) => {
    if (seen.has(file) || !isFile(file)) {
      return;
    }
    seen.add(file);
    let table: unknown;
    try {
      table = parse(readFileSync(file, "utf8"));
    } catch (error) {
      if (included) {
        return;
      }
      throw new ReleaseError(
        `${file} is no valid TOML, so nx release version cannot read the [patch] entries that cargo takes from it: ${(error as Error).message.split("\n")[0]}. Correct the file and run the command again.`,
      );
    }
    files.push(file);
    const include = isTable(table) ? table.include : undefined;
    for (const entry of Array.isArray(include) ? include : [include]) {
      const path = typeof entry === "string" ? entry : isTable(entry) ? entry.path : undefined;
      if (typeof path === "string") {
        visit(resolve(dirname(file), path), true);
      }
    }
  };
  for (const [legacy, current] of configFiles(workspaceRoot, process.env)) {
    visit(isFile(legacy) ? legacy : current, false);
  }
  return files;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** What the plugin put under `cargo` in a project's metadata, where it did. */
export function cargoMetadataOf(metadata: unknown): ProjectCargoMetadata | undefined {
  const cargo =
    typeof metadata === "object" && metadata !== null
      ? (metadata as Record<string, unknown>)[cargoMetadataKey]
      : undefined;
  if (
    typeof cargo === "object" &&
    cargo !== null &&
    typeof (cargo as ProjectCargoMetadata).manifest === "string" &&
    typeof (cargo as ProjectCargoMetadata).workspaceManifest === "string"
  ) {
    return cargo as ProjectCargoMetadata;
  }
  return undefined;
}

/** `path`, relative to the repository root with `/`. */
export function repositoryPath(root: string, path: string): string {
  const relativePath = isAbsolute(path) ? relative(root, path) : path;
  return relativePath.split(sep).join("/");
}

function crateKey(rootManifest: string, packageName: string): string {
  return `${rootManifest}\u0000${packageName}`;
}

function reportOf(root: string, rootManifest: string) {
  try {
    return workspaceReport(dirname(join(root, rootManifest)), process.env);
  } catch (error) {
    if (!(error instanceof PackageSpecReportError)) {
      throw error;
    }
    const output = error.stderr.trim();
    throw new ReleaseError(
      [
        `cargo metadata failed for the Cargo workspace ${rootManifest}, so nx release version cannot read its crates: ${error.message}.`,
        ...(output === "" ? [] : [output]),
        "Correct what cargo reports and run the command again.",
      ].join("\n"),
    );
  }
}
