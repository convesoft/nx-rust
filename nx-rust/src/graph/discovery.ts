import { dirname, isAbsolute, join, relative } from "node:path";
import { CargoMetadata, CargoPackage, requestMetadata } from "../cargo/metadata";
import { CargoError } from "../cargo/run-cargo";

/** A Cargo workspace, which may be a standalone crate: a workspace of one. */
export interface CargoWorkspace {
  /** The folder of the root manifest, relative to the repository root: `.` for the root itself. */
  root: string;
  /** The workspace's `cargo metadata` report. */
  report: CargoMetadata;
  /**
   * The members whose manifests Nx handed to the plugin, sorted by manifest
   * path. A member whose manifest Nx left out, because it is ignored or
   * matched by `exclude`, is in the report but not here.
   */
  members: CargoPackage[];
}

/** The report of a path dependency that has no project of its own. */
export interface PathDependencyReport {
  /** The manifest the report was requested for, relative to the repository root. */
  manifest: string;
  /** Its report, which covers the workspace it belongs to, if any. */
  report: CargoMetadata;
}

/** Every Cargo workspace that one graph computation found. */
export interface CargoDiscovery {
  /** The absolute path of the repository root. */
  workspaceRoot: string;
  /** The workspaces in the order they were found, shallowest root manifest first. */
  workspaces: CargoWorkspace[];
  /**
   * The reports requested on top of one per workspace: one for each crate
   * that a member reaches through path dependencies, that has no project and
   * that no workspace report covers.
   */
  pathDependencyReports: PathDependencyReport[];
}

/**
 * Finds the Cargo workspaces among the manifests that Nx hands to the plugin
 * and requests one `cargo metadata` report for each.
 *
 * Until every manifest is claimed, the shallowest unclaimed one is read, and
 * the workspace its report describes claims its root manifest and its
 * members. A crate outside every workspace, or excluded by the workspace
 * around it, is still unclaimed after that workspace's step and becomes a
 * workspace of one. Afterwards, every path dependency without a project
 * whose crate no report covers yet gets a report of its own, so that the
 * path dependencies behind it are known.
 *
 * @param manifests The `Cargo.toml` files, relative to `workspaceRoot`.
 * @param workspaceRoot The absolute path of the repository root.
 * @throws {Error} When cargo cannot be started or a report fails, naming the manifest.
 */
// @mara implements DES-DISCOVERY
export async function discoverWorkspaces(
  manifests: readonly string[],
  workspaceRoot: string,
): Promise<CargoDiscovery> {
  const handed = new Set(manifests);
  const claimed = new Set<string>();
  const workspaces: CargoWorkspace[] = [];
  for (const manifest of [...manifests].sort(shallowestFirst)) {
    if (claimed.has(manifest)) {
      continue;
    }
    const report = await readWorkspace(manifest, workspaceRoot);
    const members = new Set(report.workspace_members);
    const memberPackages = report.packages.filter((pkg) => members.has(pkg.id));
    claimed.add(manifest);
    claimed.add(repositoryPath(workspaceRoot, join(report.workspace_root, "Cargo.toml")));
    for (const pkg of memberPackages) {
      claimed.add(repositoryPath(workspaceRoot, pkg.manifest_path));
    }
    workspaces.push({
      root: repositoryPath(workspaceRoot, report.workspace_root) || ".",
      report,
      members: memberPackages
        .filter((pkg) => handed.has(repositoryPath(workspaceRoot, pkg.manifest_path)))
        .sort((a, b) => compare(a.manifest_path, b.manifest_path)),
    });
  }
  const pathDependencyReports = await readPathDependencies(workspaces, workspaceRoot);
  return { workspaceRoot, workspaces, pathDependencyReports };
}

/**
 * Requests a report for each crate that the members reach through path
 * dependencies, directly or through other such crates, that has no project
 * and that no report covers yet. Cargo starts in the root folder of the
 * workspace whose member the walk started from, where that member's tasks
 * run and so where plain cargo reads the dependency.
 */
// @mara implements DES-METADATA-REPORT
async function readPathDependencies(
  workspaces: CargoWorkspace[],
  workspaceRoot: string,
): Promise<PathDependencyReport[]> {
  const withProject = new Set(
    workspaces.flatMap((workspace) => workspace.members.map((pkg) => pkg.manifest_path)),
  );
  const known = new Map<string, CargoPackage>();
  for (const workspace of workspaces) {
    for (const pkg of workspace.report.packages) {
      known.set(pkg.manifest_path, pkg);
    }
  }
  const reports: PathDependencyReport[] = [];
  const visited = new Set<string>();
  const queue = workspaces.flatMap((workspace) =>
    workspace.members.map((pkg) => ({ dependent: pkg, cwd: workspace.report.workspace_root })),
  );
  while (queue.length > 0) {
    const { dependent, cwd } = queue.shift();
    for (const dependency of dependent.dependencies) {
      if (typeof dependency.path !== "string") {
        continue;
      }
      const manifest = join(dependency.path, "Cargo.toml");
      if (withProject.has(manifest) || visited.has(manifest)) {
        continue;
      }
      visited.add(manifest);
      if (!known.has(manifest)) {
        const report = await readPathDependency(manifest, dependent, cwd, workspaceRoot);
        reports.push({ manifest: repositoryPath(workspaceRoot, manifest), report });
        for (const pkg of report.packages) {
          if (!known.has(pkg.manifest_path)) {
            known.set(pkg.manifest_path, pkg);
          }
        }
      }
      const pkg = known.get(manifest);
      if (pkg) {
        queue.push({ dependent: pkg, cwd });
      }
    }
  }
  return reports;
}

// Reads the workspace of a manifest that Nx handed to the plugin, in the
// manifest's folder.
async function readWorkspace(manifest: string, workspaceRoot: string): Promise<CargoMetadata> {
  const path = join(workspaceRoot, manifest);
  const folder = dirname(manifest);
  try {
    return await requestMetadata(path, dirname(path));
  } catch (error) {
    throw new Error(
      failureMessage(error, `the Cargo workspace of ${manifest}`, [
        `Fix what cargo reports, so that \`cargo metadata --no-deps\` succeeds in ${folder === "." ? "the repository root" : folder}.`,
        `If Nx should not read this manifest, add its path to "exclude" on the @convesoft/nx-rust entry in nx.json.`,
      ]),
    );
  }
}

async function readPathDependency(
  manifest: string,
  dependent: CargoPackage,
  cwd: string,
  workspaceRoot: string,
): Promise<CargoMetadata> {
  const shown = displayPath(workspaceRoot, manifest);
  const folder = displayPath(workspaceRoot, cwd) || "the repository root";
  try {
    return await requestMetadata(manifest, cwd);
  } catch (error) {
    throw new Error(
      failureMessage(
        error,
        `${shown}, a path dependency of ${displayPath(workspaceRoot, dependent.manifest_path)} that has no project of its own`,
        [
          "nx-rust reads such a manifest to find the path dependencies behind it.",
          `Fix what cargo reports, so that \`cargo metadata --no-deps --manifest-path ${shown}\` succeeds in ${folder}.`,
        ],
      ),
    );
  }
}

// A message that names what failed, for what, and what to do.
function failureMessage(error: unknown, subject: string, fixes: string[]): string {
  if (error instanceof CargoError && error.notStarted) {
    return [
      `nx-rust could not read ${subject}: ${error.message}.`,
      "nx-rust asks cargo for the crates whenever Nx creates the project graph, so every machine that runs nx in this repository needs cargo.",
      "Install a Rust toolchain or put cargo on PATH, then run the command again.",
    ].join("\n");
  }
  if (error instanceof CargoError) {
    const output = error.stderr.trim();
    return [
      `\`cargo metadata\` failed for ${subject}: ${error.message}.`,
      ...(output === "" ? [] : [output]),
      ...fixes,
    ].join("\n");
  }
  const reason = error instanceof Error ? error.message : String(error);
  return [
    `\`cargo metadata\` printed no report that nx-rust can read for ${subject}: ${reason}.`,
    "Check that the cargo on PATH is Cargo 1.91 or later.",
  ].join("\n");
}

// The path relative to the repository root, with `/` separators, or "" for
// the root itself. A path outside the repository starts with "..".
function repositoryPath(workspaceRoot: string, path: string): string {
  return relative(workspaceRoot, path);
}

// A path for a message: relative to the repository root where it lies
// inside, absolute otherwise.
function displayPath(workspaceRoot: string, path: string): string {
  const inside = repositoryPath(workspaceRoot, path);
  return inside === ".." || inside.startsWith("../") || isAbsolute(inside) ? path : inside;
}

function shallowestFirst(a: string, b: string): number {
  return a.split("/").length - b.split("/").length || compare(a, b);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
