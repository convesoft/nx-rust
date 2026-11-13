import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { CargoMetadata, CargoPackage } from "../cargo/metadata";
import { readRedirections, Redirection } from "../cargo/redirections";
import { CargoError } from "../cargo/run-cargo";
import { ComputationReports } from "./computation-reports";

/** A Cargo workspace, which may be a standalone crate: a workspace of one. */
export interface CargoWorkspace {
  /** The folder of the root manifest, relative to the repository root: `.` for the root itself. */
  root: string;
  /** The root manifest, relative to the repository root. */
  rootManifest: string;
  /**
   * Whether Nx handed the root manifest to the plugin. A root manifest that
   * is ignored or matched by `exclude` gives no project, like a member's.
   */
  rootManifestHanded: boolean;
  /** The workspace's `cargo metadata` report. */
  report: CargoMetadata;
  /**
   * The members whose manifests Nx handed to the plugin, sorted by manifest
   * path. A member whose manifest Nx left out, because it is ignored or
   * matched by `exclude`, is in the report but not here.
   */
  members: CargoPackage[];
  /**
   * The crates that cargo may build in place of the workspace's registry and
   * git dependencies, as its `[patch]`, `[replace]` and `paths` tables say
   * ({@link readRedirections}).
   */
  redirections: Redirection[];
}

/** The report of a crate without a project that a member may use. */
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
   * that a member reaches through path dependencies or that a workspace's
   * `[patch]` or `[replace]` table redirects to, that has no project and that
   * no workspace report covers.
   */
  pathDependencyReports: PathDependencyReport[];
  /** What graph creation has to tell the user without failing, one message each. */
  warnings: string[];
}

/**
 * Finds the Cargo workspaces among the manifests that Nx hands to the plugin
 * and requests one `cargo metadata` report for each.
 *
 * Until every manifest is claimed, the shallowest unclaimed one is read, and
 * the workspace its report describes claims its root manifest and its
 * members. A crate outside every workspace, or excluded by the workspace
 * around it, is still unclaimed after that workspace's step and becomes a
 * workspace of one. Each workspace's redirections are read from its root
 * manifest and the configuration files that apply to it. Afterwards, every
 * path dependency without a project, and every crate without a project that
 * `[patch]` or `[replace]` redirects to, whose crate no report covers yet
 * gets a report of its own, so that the path dependencies behind it are
 * known.
 *
 * @param manifests The `Cargo.toml` files, relative to `workspaceRoot`.
 * @param workspaceRoot The absolute path of the repository root.
 * @param reports Where the reports come from: the reports of the graph
 *   computation, which other plugin entries may share.
 * @throws {Error} When cargo cannot be started or a report fails, naming the
 *   manifest, or when a manifest or configuration file is no valid TOML.
 */
// @mara implements DES-DISCOVERY
export async function discoverWorkspaces(
  manifests: readonly string[],
  workspaceRoot: string,
  reports: ComputationReports = new ComputationReports(),
): Promise<CargoDiscovery> {
  const handed = new Set(manifests);
  const claimed = new Set<string>();
  const workspaces: CargoWorkspace[] = [];
  for (const manifest of [...manifests].sort(shallowestFirst)) {
    if (claimed.has(manifest)) {
      continue;
    }
    const report = await readWorkspace(manifest, workspaceRoot, reports);
    const members = new Set(report.workspace_members);
    const memberPackages = report.packages.filter((pkg) => members.has(pkg.id));
    const rootManifest = repositoryPath(workspaceRoot, join(report.workspace_root, "Cargo.toml"));
    claimed.add(manifest);
    claimed.add(rootManifest);
    for (const pkg of memberPackages) {
      claimed.add(repositoryPath(workspaceRoot, pkg.manifest_path));
    }
    workspaces.push({
      root: repositoryPath(workspaceRoot, report.workspace_root) || ".",
      rootManifest,
      rootManifestHanded: handed.has(rootManifest),
      report,
      members: memberPackages
        .filter((pkg) => handed.has(repositoryPath(workspaceRoot, pkg.manifest_path)))
        .sort((a, b) => compare(a.manifest_path, b.manifest_path)),
      redirections: await readRedirections(report.workspace_root),
    });
  }
  const pathDependencyReports = await readPathDependencies(workspaces, workspaceRoot, reports);
  return {
    workspaceRoot,
    workspaces,
    pathDependencyReports,
    warnings: outsideRedirectionWarnings(workspaces, workspaceRoot),
  };
}

/**
 * One warning for each configuration file outside the repository that
 * redirects dependencies of a workspace: the plugin applies it, but Nx does
 * not watch it, so a change to it reaches the graph only once Nx computes
 * the graph again for another reason.
 */
// @mara implements DES-DIAGNOSTICS
function outsideRedirectionWarnings(workspaces: CargoWorkspace[], workspaceRoot: string): string[] {
  const byFile = new Map<string, string[]>();
  for (const workspace of workspaces) {
    for (const { file } of workspace.redirections) {
      const folders = byFile.get(file) ?? [];
      if (isOutside(workspaceRoot, file) && !folders.includes(workspace.root)) {
        byFile.set(file, [...folders, workspace.root]);
      }
    }
  }
  return [...byFile].map(([file, folders]) =>
    [
      `nx-rust: ${file} redirects dependencies of ${describeWorkspaces(folders)} through [patch] or paths, so nx-rust gives the crates that may use the redirected crates edges to them.`,
      "The file lies outside the repository, so Nx does not see when it changes: with the Nx daemon, the graph keeps these edges until a file in the repository changes or the daemon restarts (`nx reset`).",
      "To let Nx follow the redirections, move them into the root Cargo.toml of the workspace that needs them or into a .cargo/config.toml inside the repository.",
    ].join("\n"),
  );
}

// "the Cargo workspace in rust", or "the Cargo workspaces in rust and shared".
function describeWorkspaces(folders: string[]): string {
  const named = folders.map((folder) => (folder === "." ? "the repository root" : folder));
  if (named.length === 1) {
    return folders[0] === "."
      ? "the Cargo workspace at the repository root"
      : `the Cargo workspace in ${named[0]}`;
  }
  return `the Cargo workspaces in ${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * Requests a report for each crate that the members reach through path
 * dependencies, directly or through other such crates, and for each crate
 * that a workspace's `[patch]` or `[replace]` table redirects to, that has
 * no project and that no report covers yet; then for the crates that those
 * reach through path dependencies. Cargo starts in the root folder of the
 * workspace whose member the walk started from, or whose table redirects to
 * the crate: there the member's tasks run, and so there plain cargo reads
 * the crate. A redirection to a folder without a `Cargo.toml` gets no
 * report: cargo fails when it applies one, and the plugin leaves that
 * failure to the cargo of the tasks.
 */
// @mara implements DES-METADATA-REPORT
async function readPathDependencies(
  workspaces: CargoWorkspace[],
  workspaceRoot: string,
  reports: ComputationReports,
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
  const pathDependencyReports: PathDependencyReport[] = [];
  const visited = new Set<string>();
  const queue: { pkg: CargoPackage; cwd: string }[] = [];
  // Requests the report of a crate without a project, unless one covers it
  // already, and queues the crate so that its path dependencies follow.
  const reach = async (manifest: string, cwd: string, subject: () => string) => {
    if (withProject.has(manifest) || visited.has(manifest)) {
      return;
    }
    visited.add(manifest);
    if (!known.has(manifest)) {
      const report = await readPathDependency(manifest, subject(), cwd, workspaceRoot, reports);
      pathDependencyReports.push({ manifest: repositoryPath(workspaceRoot, manifest), report });
      for (const pkg of report.packages) {
        if (!known.has(pkg.manifest_path)) {
          known.set(pkg.manifest_path, pkg);
        }
      }
    }
    const pkg = known.get(manifest);
    if (pkg) {
      queue.push({ pkg, cwd });
    }
  };
  const drain = async () => {
    while (queue.length > 0) {
      const { pkg: dependent, cwd } = queue.shift();
      for (const dependency of dependent.dependencies) {
        if (typeof dependency.path === "string") {
          await reach(
            join(dependency.path, "Cargo.toml"),
            cwd,
            () =>
              `a path dependency of ${displayPath(workspaceRoot, dependent.manifest_path)} that has no project of its own`,
          );
        }
      }
    }
  };
  for (const workspace of workspaces) {
    for (const pkg of workspace.members) {
      queue.push({ pkg, cwd: workspace.report.workspace_root });
    }
  }
  await drain();
  for (const workspace of workspaces) {
    for (const { table, folder, file } of workspace.redirections) {
      const manifest = join(folder, "Cargo.toml");
      if (table !== "paths" && existsSync(manifest)) {
        await reach(
          manifest,
          workspace.report.workspace_root,
          () =>
            `a crate that ${displayPath(workspaceRoot, file)} redirects dependencies of the Cargo workspace in ${workspace.root} to, which has no project of its own`,
        );
        await drain();
      }
    }
  }
  return pathDependencyReports;
}

// Reads the workspace of a manifest that Nx handed to the plugin, in the
// manifest's folder.
async function readWorkspace(
  manifest: string,
  workspaceRoot: string,
  reports: ComputationReports,
): Promise<CargoMetadata> {
  const path = join(workspaceRoot, manifest);
  const folder = dirname(manifest);
  try {
    return await reports.request(path, dirname(path));
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
  subject: string,
  cwd: string,
  workspaceRoot: string,
  reports: ComputationReports,
): Promise<CargoMetadata> {
  const shown = displayPath(workspaceRoot, manifest);
  const folder = displayPath(workspaceRoot, cwd) || "the repository root";
  try {
    return await reports.request(manifest, cwd);
  } catch (error) {
    throw new Error(
      failureMessage(error, `${shown}, ${subject}`, [
        "nx-rust reads such a manifest to find the path dependencies behind it.",
        `Fix what cargo reports, so that \`cargo metadata --no-deps --manifest-path ${shown}\` succeeds in ${folder}.`,
      ]),
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
  return isOutside(workspaceRoot, path) ? path : repositoryPath(workspaceRoot, path);
}

// Whether the path lies outside the repository.
function isOutside(workspaceRoot: string, path: string): boolean {
  const inside = repositoryPath(workspaceRoot, path);
  return inside === ".." || inside.startsWith("../") || isAbsolute(inside);
}

function shallowestFirst(a: string, b: string): number {
  return a.split("/").length - b.split("/").length || compare(a, b);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
