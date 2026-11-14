import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { CargoMetadata, CargoPackage } from "../cargo/metadata";
import { ConfiguredTools, configuredTools } from "../cargo/configured-tools";
import { cratesBelowPathsFolder } from "../cargo/paths-crates";
import { readRedirections, Redirection } from "../cargo/redirections";
import { configuredTriples, PickedTriples, pickedTriples } from "../cargo/target-triples";
import { CargoError } from "../cargo/run-cargo";
import { UnsupportedCargoError } from "../compatibility/cargo-version";
import { ComputationReports } from "./computation-reports";
import { realPath } from "./real-path";
import { filesNxSees } from "./visibility";

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
  /**
   * The folders of the crates that each `paths` entry among
   * {@link redirections} can redirect to, by the entry's folder as the entry
   * names it: real paths of the crates that cargo finds below the folder
   * ({@link cratesBelowPathsFolder}) and of their path dependencies of every
   * kind, to any depth ({@link pathsCandidates}), without those whose report
   * shows a virtual manifest. Absent where the workspace has no `paths`
   * entry.
   */
  pathsCrates?: ReadonlyMap<string, readonly string[]>;
  /**
   * The target triples that cargo builds for in the workspace root when a
   * command names none, as Cargo's configuration and the `CARGO_BUILD_TARGET`
   * of the graph's environment pick them ({@link pickedTriples}).
   */
  triples: PickedTriples;
  /**
   * The triples that Cargo's configuration alone picks there, without
   * `CARGO_BUILD_TARGET` ({@link configuredTriples}).
   */
  configuredTriples: PickedTriples;
  /**
   * The programs that `build.rustc` and `build.rustdoc` in the Cargo
   * configuration of the workspace root name, as graph creation reads them
   * ({@link configuredTools}). The toolchain input asks them for their
   * version where no variable of the task's environment names another.
   */
  configuredTools: ConfiguredTools;
  /**
   * The configuration files that `include` adds for the workspace
   * ({@link readRedirections}).
   */
  configIncludes: string[];
  /**
   * The warnings, also in {@link CargoDiscovery.warnings}, about the
   * workspace's redirections: an included file that is no valid TOML, a
   * file with redirections whose changes Nx does not see, because it lies
   * outside the repository or is ignored, and a redirected crate that
   * `cargo metadata` fails for. The projects of the workspace repeat them at
   * the start of their tasks.
   */
  warnings: string[];
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
   * `[patch]`, `[replace]` or `paths` entry redirects to, that has no project
   * and that no workspace report covers.
   */
  pathDependencyReports: PathDependencyReport[];
  /** What graph creation has to tell the user without failing, one message each. */
  warnings: string[];
  /**
   * The warning, also in `warnings`, for each path dependency whose report
   * cargo refused for a reason that it checks only for the crate it reports,
   * such as that the crate is no member of the workspace that holds it, by
   * the real path of the crate's folder: the projects of the crates that
   * reach it repeat it at the start of their tasks.
   */
  unreportedPathDependencies: Map<string, string>;
}

/**
 * Finds the Cargo workspaces among the manifests that Nx hands to the plugin
 * and reads each one's `cargo metadata` report as cargo gives it in the
 * workspace's root folder, where the workspace's tasks run cargo: where Nx
 * does not hand the root manifest, that takes a second request
 * ({@link readWorkspace}).
 *
 * Until every manifest is claimed, the shallowest unclaimed one is read, and
 * the workspace its report describes claims its root manifest and its
 * members. A crate outside every workspace, or excluded by the workspace
 * around it, is still unclaimed after that workspace's step and becomes a
 * workspace of one. Each workspace's redirections are read from its root
 * manifest and the configuration files that apply to it.
 *
 * A manifest whose folder holds `.cargo-checksum.json` belongs to a package
 * of a directory source, such as a crate that `cargo vendor` wrote, and is
 * never read: such a crate gets a project only as a member of a workspace
 * that another manifest's report describes, as when a path dependency makes
 * cargo enrol it ({@link isDirectorySourcePackage}).
 *
 * Afterwards, every path dependency without a project, and every crate
 * without a project that `[patch]`, `[replace]` or `paths` redirects to,
 * whose crate no report covers yet gets a report of its own, so that the
 * path dependencies behind it are known. A package of a directory source
 * gets none. The crates of a `paths` entry are found below its folder as
 * cargo finds them, once per folder, and only where a workspace has such an
 * entry ({@link cratesBelowPathsFolder}), together with their path
 * dependencies of every kind ({@link pathsCandidates}).
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
  const warnings: string[] = [];
  const readable = manifests.filter(
    (manifest) => !isDirectorySourcePackage(join(workspaceRoot, manifest)),
  );
  for (const manifest of readable.sort(shallowestFirst)) {
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
    const found = await readRedirections(report.workspace_root);
    warnings.push(...found.warnings);
    workspaces.push({
      root: repositoryPath(workspaceRoot, report.workspace_root) || ".",
      rootManifest,
      rootManifestHanded: handed.has(rootManifest),
      report,
      members: memberPackages
        .filter((pkg) => handed.has(repositoryPath(workspaceRoot, pkg.manifest_path)))
        .sort((a, b) => compare(a.manifest_path, b.manifest_path)),
      redirections: found.redirections,
      triples: pickedTriples(report.workspace_root, process.env),
      configuredTriples: configuredTriples(report.workspace_root, process.env),
      configuredTools: configuredTools(report.workspace_root, process.env),
      configIncludes: found.includedFiles,
      warnings: [...new Set(found.warnings)],
    });
  }
  const unreportedPathDependencies = new Map<string, string>();
  const pathsFolders = pathsFolderCrates(workspaces);
  const { pathDependencyReports, candidates } = await readPathDependencies(
    workspaces,
    workspaceRoot,
    reports,
    warnings,
    unreportedPathDependencies,
    pathsFolders,
  );
  for (const workspace of workspaces) {
    const paths = workspace.redirections.filter((redirection) => redirection.table === "paths");
    if (paths.length > 0) {
      workspace.pathsCrates = new Map(
        paths.map(({ folder }) => [folder, candidates.get(realPath(folder)) ?? []]),
      );
    }
  }
  warnings.push(...(await unwatchedRedirectionWarnings(workspaces, workspaceRoot)));
  return {
    workspaceRoot,
    workspaces,
    pathDependencyReports,
    warnings: [...new Set(warnings)],
    unreportedPathDependencies,
  };
}

/**
 * One warning for each file that redirects dependencies of a workspace and
 * whose changes Nx does not see: a configuration file outside the
 * repository, and a configuration file or root manifest inside it that an
 * ignore rule, such as one in `.gitignore` or `.nxignore`, leaves out of the
 * files that Nx reads ({@link filesNxSees}). The plugin applies such a file,
 * but the Nx daemon does not create the graph again when it changes, so a
 * change reaches the graph only once Nx creates the graph again for another
 * reason (`EVD-CARGO-REDIRECTIONS`). Each warning also joins the
 * {@link CargoWorkspace.warnings} of the workspaces it names.
 */
// @mara implements DES-DIAGNOSTICS
async function unwatchedRedirectionWarnings(
  workspaces: CargoWorkspace[],
  workspaceRoot: string,
): Promise<string[]> {
  const byFile = new Map<string, { concerned: CargoWorkspace[]; tables: Set<string> }>();
  for (const workspace of workspaces) {
    for (const { file, table } of workspace.redirections) {
      const entry = byFile.get(file) ?? { concerned: [], tables: new Set<string>() };
      if (!entry.concerned.includes(workspace)) {
        entry.concerned.push(workspace);
      }
      entry.tables.add(table);
      byFile.set(file, entry);
    }
  }
  const inside = [...byFile.keys()]
    .filter((file) => !isOutside(workspaceRoot, file))
    .map((file) => repositoryPath(workspaceRoot, file));
  const seen = await filesNxSees(workspaceRoot, inside);
  const messages: string[] = [];
  for (const [file, { concerned, tables }] of byFile) {
    const outside = isOutside(workspaceRoot, file);
    if (!outside && seen.has(repositoryPath(workspaceRoot, file))) {
      continue;
    }
    const through = ["patch", "replace", "paths"]
      .filter((table) => tables.has(table))
      .map((table) => (table === "paths" ? table : `[${table}]`))
      .join(" and ");
    const message = [
      `nx-rust: ${displayPath(workspaceRoot, file)} redirects dependencies of ${describeWorkspaces(concerned.map((workspace) => workspace.root))} through ${through}, so nx-rust gives the crates that may use the redirected crates edges to them.`,
      ...(outside
        ? [
            "The file lies outside the repository, so Nx does not see when it changes: with the Nx daemon, the graph keeps these edges until a file in the repository changes or the daemon restarts (`nx reset`).",
            "To let Nx follow the redirections, move them into the root Cargo.toml of the workspace that needs them or into a .cargo/config.toml inside the repository.",
          ]
        : [
            "An ignore rule, such as one in .gitignore or .nxignore, leaves the file out of the files that Nx reads, so Nx does not see when it changes: with the Nx daemon, the graph keeps these edges until a file that Nx reads changes or the daemon restarts (`nx reset`).",
            "To let Nx follow the redirections, stop ignoring the file, or run `nx reset` after each change to it.",
          ]),
    ].join("\n");
    for (const workspace of concerned) {
      addWarning(workspace, message);
    }
    messages.push(message);
  }
  return messages;
}

// Adds a warning to those that the workspace's projects repeat, once.
function addWarning(workspace: CargoWorkspace, message: string): void {
  if (!workspace.warnings.includes(message)) {
    workspace.warnings.push(message);
  }
}

/** "the Cargo workspace in rust", or "the Cargo workspaces in rust and shared". */
export function describeWorkspaces(folders: string[]): string {
  const named = folders.map((folder) => (folder === "." ? "the repository root" : folder));
  if (named.length === 1) {
    return folders[0] === "."
      ? "the Cargo workspace at the repository root"
      : `the Cargo workspace in ${named[0]}`;
  }
  return `the Cargo workspaces in ${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * The folders of the crates that cargo finds below the folder of each
 * `paths` entry of the workspaces ({@link cratesBelowPathsFolder}), by the
 * real path of the entry's folder, each folder walked once. Without a
 * `paths` entry, nothing is walked.
 */
// @mara implements DES-METADATA-REPORT
function pathsFolderCrates(workspaces: CargoWorkspace[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const workspace of workspaces) {
    for (const redirection of workspace.redirections) {
      const real = realPath(redirection.folder);
      if (redirection.table === "paths" && !found.has(real)) {
        found.set(real, cratesBelowPathsFolder(real));
      }
    }
  }
  return found;
}

/**
 * The crates that a `paths` entry can redirect to, by real folder: those
 * that cargo finds below its folder (`found`) and, as cargo takes them as
 * well, the path dependencies of each, of every kind, dev-dependencies and
 * those for other platforms included, to any depth, inside or outside the
 * folder, through crates with a project or without
 * (`EVD-CARGO-REDIRECTIONS`). A crate that no report describes counts,
 * but what it depends on is not known.
 *
 * This is not the walk that says what cargo builds with a crate, which
 * takes normal and build dependencies only (`projectsBehindDependency` in
 * `reached-projects.ts`): cargo takes these crates as candidates whether or
 * not it compiles the crate that names them.
 */
// @mara implements DES-METADATA-REPORT
function pathsCandidates(
  found: readonly string[],
  known: ReadonlyMap<string, CargoPackage>,
): string[] {
  const candidates: string[] = [];
  const visited = new Set<string>();
  const queue = [...found];
  while (queue.length > 0) {
    const folder = queue.shift() as string;
    if (visited.has(folder)) {
      continue;
    }
    visited.add(folder);
    candidates.push(folder);
    for (const dependency of known.get(folder)?.dependencies ?? []) {
      if (typeof dependency.path === "string") {
        queue.push(realPath(dependency.path));
      }
    }
  }
  return candidates;
}

/**
 * Requests a report for each crate that the members reach through path
 * dependencies, directly or through other such crates, and for each crate
 * that a workspace's `[patch]` or `[replace]` entry redirects to, or that
 * cargo takes from the folder of a `paths` entry (`pathsFolders`), that has
 * no project and that no report covers yet; then for the crates that those
 * reach through path dependencies, of every kind. Then it returns, by the
 * real path of each `paths` folder, the crates that the entry can redirect
 * to ({@link pathsCandidates}), without a folder whose report describes no
 * package there, which holds a virtual manifest and no crate, as the root
 * folder of a workspace whose report lists no package there does. Cargo
 * starts in the root folder of the workspace whose member the walk started
 * from, or whose table redirects to the crate: there the member's tasks
 * run, and so there plain cargo reads the crate. A redirection to a folder
 * without a `Cargo.toml` gets no report: cargo fails when it applies one,
 * and the plugin leaves that failure to the cargo of the tasks. A crate,
 * whether a path or a redirection names it, is compared with the crates
 * that have projects and with those that a report describes by the real
 * path of its folder, through symbolic links, so a path through a link to a
 * crate with a project asks for no report.
 *
 * When cargo fails for a redirected crate, as for a crate inside a
 * workspace's folder that is not its member, which cargo builds as a patch
 * but does not report, graph creation goes on: a warning in `warnings` names
 * the manifest and cargo's message, and the crate has no report. So it does
 * for a path dependency whose report cargo refuses for a reason that it
 * checks only for the crate it reports, which it builds as a dependency all
 * the same ({@link isUnreportedPathDependency}); any other failure of a
 * path dependency's report fails graph creation. Such a path dependency's warning
 * also goes into `unreported`, by the real path of the crate's folder, and
 * the warning of a redirected crate joins the {@link CargoWorkspace.warnings}
 * of each workspace whose table redirects to it.
 *
 * A package of a directory source that no workspace report lists as a
 * member gets no report ({@link isDirectorySourcePackage}); like any crate
 * without a project, its folder is an input of the crates that use it.
 */
// @mara implements DES-METADATA-REPORT
async function readPathDependencies(
  workspaces: CargoWorkspace[],
  workspaceRoot: string,
  reports: ComputationReports,
  warnings: string[],
  unreported: Map<string, string>,
  pathsFolders: ReadonlyMap<string, readonly string[]>,
): Promise<{
  pathDependencyReports: PathDependencyReport[];
  candidates: Map<string, string[]>;
}> {
  // Crates by the real paths of their folders: a path names the crate at
  // the real path of its folder, also where it passes a symbolic link.
  const folderOf = (manifest: string) => realPath(dirname(manifest));
  const withProject = new Set(
    workspaces.flatMap((workspace) => workspace.members.map((pkg) => folderOf(pkg.manifest_path))),
  );
  const known = new Map<string, CargoPackage>();
  for (const workspace of workspaces) {
    for (const pkg of workspace.report.packages) {
      known.set(folderOf(pkg.manifest_path), pkg);
    }
  }
  // The root folders of the workspaces, whose reports describe any package there.
  const workspaceRoots = new Set(
    workspaces.map((workspace) => realPath(workspace.report.workspace_root)),
  );
  const pathDependencyReports: PathDependencyReport[] = [];
  const noCrate = new Set<string>();
  const visited = new Set<string>();
  // The warning for each crate whose report cargo refused, by its real folder.
  const failures = new Map<string, string>();
  const queue: { pkg: CargoPackage; cwd: string }[] = [];
  // Requests the report of a crate without a project, unless one covers it
  // already, and queues the crate so that its path dependencies follow. A
  // failure of cargo that graph creation goes on after, for a crate reached
  // by path or by redirection, becomes a warning and leaves the crate
  // without a report.
  const reach = async (
    manifest: string,
    cwd: string,
    subject: () => string,
    via: "path" | "redirection",
  ) => {
    const folder = folderOf(manifest);
    if (withProject.has(folder) || visited.has(folder)) {
      return;
    }
    visited.add(folder);
    if (!known.has(folder) && workspaceRoots.has(folder)) {
      noCrate.add(folder);
      return;
    }
    if (!known.has(folder) && isDirectorySourcePackage(manifest)) {
      return;
    }
    if (!known.has(folder)) {
      const report = await readPathDependency(
        manifest,
        subject(),
        cwd,
        workspaceRoot,
        reports,
        via === "path" ? (error) => isUnreportedPathDependency(error, manifest) : () => true,
      );
      if (typeof report === "string") {
        warnings.push(report);
        failures.set(folder, report);
        if (via === "path") {
          unreported.set(folder, report);
        }
        return;
      }
      pathDependencyReports.push({ manifest: repositoryPath(workspaceRoot, manifest), report });
      for (const pkg of report.packages) {
        if (!known.has(folderOf(pkg.manifest_path))) {
          known.set(folderOf(pkg.manifest_path), pkg);
        }
      }
    }
    const pkg = known.get(folder);
    if (pkg) {
      queue.push({ pkg, cwd });
    } else {
      noCrate.add(folder);
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
            "path",
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
      const manifests =
        table === "paths"
          ? (pathsFolders.get(realPath(folder)) ?? []).map((crate) => join(crate, "Cargo.toml"))
          : [join(folder, "Cargo.toml")];
      for (const manifest of manifests.filter((manifest) => existsSync(manifest))) {
        await reach(
          manifest,
          workspace.report.workspace_root,
          () =>
            `a crate that ${displayPath(workspaceRoot, file)} redirects dependencies of the Cargo workspace in ${workspace.root} to, which has no project of its own`,
          "redirection",
        );
        const failure = failures.get(folderOf(manifest));
        if (failure !== undefined) {
          addWarning(workspace, failure);
        }
        await drain();
      }
    }
  }
  const candidates = new Map<string, string[]>();
  for (const [folder, found] of pathsFolders) {
    candidates.set(
      folder,
      pathsCandidates(found, known).filter((crate) => !noCrate.has(crate)),
    );
  }
  return { pathDependencyReports, candidates };
}

/**
 * Whether the crate of a manifest, by its absolute path, is a package of a
 * directory source, such as one that `cargo vendor` wrote: its folder holds
 * `.cargo-checksum.json`, which `cargo vendor` writes for every crate it
 * vendors and without which cargo refuses such a package. It is a package of
 * the source that the directory replaces, not a crate of the repository,
 * whatever configuration names the folder and wherever it lies.
 */
// @mara implements DES-DISCOVERY
function isDirectorySourcePackage(manifest: string): boolean {
  return existsSync(join(dirname(manifest), ".cargo-checksum.json"));
}

/**
 * Reads the workspace of a manifest that Nx handed to the plugin. The
 * report requested in the manifest's folder names the workspace root. Where
 * that is another folder, because Nx did not hand the root manifest to the
 * plugin, one more report is requested in the root folder, where the
 * workspace's tasks run cargo, and replaces the first: cargo takes its
 * configuration files, a relative `CARGO_TARGET_DIR` and rustup its
 * toolchain from the folder it starts in, so only that report names the
 * artifact and build directories that the tasks use (`DES-DISCOVERY`).
 */
// @mara implements DES-DISCOVERY
async function readWorkspace(
  manifest: string,
  workspaceRoot: string,
  reports: ComputationReports,
): Promise<CargoMetadata> {
  const path = join(workspaceRoot, manifest);
  const found = await requestWorkspace(manifest, workspaceRoot, dirname(path), () =>
    reports.request(path, dirname(path)),
  );
  if (reports.fromRoot(found)) {
    return found;
  }
  const root = found.workspace_root;
  return requestWorkspace(manifest, workspaceRoot, root, () =>
    reports.requestFromRoot(join(root, "Cargo.toml")),
  );
}

// Makes one request of `readWorkspace`, with cargo started in `cwd`.
async function requestWorkspace(
  manifest: string,
  workspaceRoot: string,
  cwd: string,
  request: () => Promise<CargoMetadata>,
): Promise<CargoMetadata> {
  try {
    return await request();
  } catch (error) {
    const folder = displayPath(workspaceRoot, cwd) || "the repository root";
    throw new Error(
      failureMessage(error, `the Cargo workspace of ${manifest}`, [
        `Fix what cargo reports, so that \`cargo metadata --no-deps\` succeeds in ${folder}.`,
        `If Nx should not read this manifest, add its path to "exclude" on the @convesoft/nx-rust entry in nx.json.`,
      ]),
    );
  }
}

/**
 * Whether cargo refused the report of a crate for a reason that it checks
 * only for the crate it reports, never for a path dependency or patch that
 * it builds for another workspace, so that such a crate builds as before
 * (`EVD-CARGO-UNREPORTED-CRATES`). Cargo 1.91 and later state each reason
 * with one message:
 *
 * - "current package believes it's in a workspace when it's not": the crate
 *   lies in the folder of a workspace, or names one in `package.workspace`,
 *   without being its member;
 * - "root of a workspace inferred but wasn't a root": the manifest that the
 *   crate's `package.workspace`, or that of a crate above it, names has no
 *   `[workspace]` table;
 * - "failed to read" a manifest other than the crate's own: cargo cannot
 *   read that manifest, as where `package.workspace` names a missing folder.
 *
 * The last two count only as cargo's error itself, the first line of its
 * output that starts with `error:`. Cargo prints them also below another
 * error, as the cause of a manifest that it rejects, such as one that takes
 * a key from a workspace that it cannot read, and then it fails to build the
 * crate as a dependency as well. "failed to load manifest for workspace
 * member" stays an error: cargo prints it also where the member that fails
 * to load is one that the crate depends on.
 *
 * @param manifest The absolute path of the crate's manifest, which cargo
 *   names where it cannot read that manifest itself.
 */
function isUnreportedPathDependency(error: CargoError, manifest: string): boolean {
  if (error.stderr.includes("current package believes it's in a workspace when it's not")) {
    return true;
  }
  const failure = /^error: (.*)$/m.exec(error.stderr)?.[1].trim() ?? "";
  if (failure.startsWith("root of a workspace inferred but wasn't a root: ")) {
    return true;
  }
  const unread = /^failed to read `(.+)`$/.exec(failure)?.[1];
  return unread !== undefined && realPath(unread) !== realPath(manifest);
}

// Reads a crate without a project. A failure of cargo itself that `goesOn`
// accepts gives the warning to print instead of a report.
async function readPathDependency(
  manifest: string,
  subject: string,
  cwd: string,
  workspaceRoot: string,
  reports: ComputationReports,
  goesOn: (error: CargoError) => boolean,
): Promise<CargoMetadata | string> {
  const shown = displayPath(workspaceRoot, manifest);
  const folder = displayPath(workspaceRoot, cwd) || "the repository root";
  try {
    return await reports.request(manifest, cwd);
  } catch (error) {
    if (error instanceof CargoError && !error.notStarted && goesOn(error)) {
      const output = error.stderr.trim();
      return [
        `nx-rust: \`cargo metadata\` failed for ${shown}, ${subject}: ${error.message}.`,
        ...(output === "" ? [] : [output]),
        "nx-rust goes on without its report, so it does not follow the crates that this crate depends on by path: the crates that use it take only its own folder into their cache keys, and a change in a crate behind it can leave their keys unchanged.",
        `To have those crates followed, fix what cargo reports, so that \`cargo metadata --no-deps --manifest-path ${shown}\` succeeds in ${folder}, or declare their files with fileInputs in the [package.metadata.nx] or [workspace.metadata.nx] table of the crates that use it.`,
      ].join("\n");
    }
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
  if (error instanceof UnsupportedCargoError) {
    return error.messageFor(subject);
  }
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
