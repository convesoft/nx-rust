import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import type { CargoDiscovery } from "./discovery";
import { realPath } from "./real-path";
import type { RedirectedUse } from "./redirected-uses";
import { foldersNxSees } from "./visibility";

/** A crate without an Nx project that a crate with a project reaches. */
export interface PathDependency {
  /** Its package name, or its folder's name where no report describes it. */
  name: string;
  /** Its folder relative to the repository root, or its absolute path outside it. */
  folder: string;
  /** Whether Nx sees its files: it lies inside the repository and Nx does not ignore it. */
  seen: boolean;
  /** How the crate reaches it: by a path, or by a `[patch]`, `[replace]` or `paths` entry. */
  via: "path" | "redirection";
  /**
   * The root manifest of the workspace it belongs to, where that is not its
   * own manifest, relative to the repository root and inside it: cargo
   * applies the fields that the crate inherits from there, also when
   * another workspace builds it (`EVD-CARGO-DEPENDENCY-SIDE`).
   */
  workspaceManifest?: string;
}

/** The crates whose files a crate's inputs name beyond its edges, by the crate's manifest path. */
export interface CrateFolders {
  /**
   * The crates without a project that the crate reaches, directly or through
   * other crates without a project: by path, or as a crate that a
   * redirection of its workspace may put in place of a dependency. Their
   * folders go into the crate's own named input.
   */
  withoutProject: Map<string, PathDependency[]>;
  /**
   * The crates with a project that a redirection may put in place of a
   * dependency of the crate, but whose edge from it `redirectedUses` leaves
   * out. Their folders and workspace manifests go onto the crate's targets.
   */
  leftOutEdges: Map<string, PathDependency[]>;
}

/**
 * The crates whose files reach a crate's key through its inputs rather than
 * through an edge (`DES-INPUTS`, "Path dependencies" and "Redirected
 * crates"), for each crate with a project.
 *
 * A crate without a project is excluded by `exclude` on the plugin's entry,
 * ignored by Nx, outside the repository, or a package of a directory source
 * whose folder holds `.cargo-checksum.json`. One that a path dependency or a
 * redirection reaches counts with the crates without a project behind it
 * where a report describes it; without a report, as for such a package or
 * one whose report failed, its folder counts alone. What lies behind a crate with a project
 * reaches the crate through that project's own input.
 *
 * Whether Nx sees a crate's files is whether it sees its manifest, or any
 * file of a folder without one.
 *
 * @param uses The redirected uses of the members (`redirectedUses`), for the
 *   projects that this plugin entry creates.
 */
// @mara implements DES-INPUTS
export async function findCrateFolders(
  discovery: CargoDiscovery,
  uses: readonly RedirectedUse[],
): Promise<CrateFolders> {
  const { workspaceRoot } = discovery;
  const repositoryRoot = realPath(workspaceRoot);
  const withProject = new Set(
    discovery.workspaces.flatMap((workspace) => workspace.members.map((pkg) => pkg.manifest_path)),
  );
  const known = new Map<string, CargoPackage>();
  const byRealFolder = new Map<string, CargoPackage>();
  // The root manifest of each known crate's workspace, by the crate's real folder.
  const workspaceManifests = new Map<string, string>();
  for (const report of [
    ...discovery.workspaces.map((workspace) => workspace.report),
    ...discovery.pathDependencyReports.map((entry) => entry.report),
  ]) {
    for (const pkg of report.packages) {
      if (!known.has(pkg.manifest_path)) {
        known.set(pkg.manifest_path, pkg);
      }
      const real = realPath(dirname(pkg.manifest_path));
      if (!workspaceManifests.has(real)) {
        workspaceManifests.set(real, join(report.workspace_root, "Cargo.toml"));
      }
      const folder = realPath(dirname(pkg.manifest_path));
      if (!byRealFolder.has(folder)) {
        byRealFolder.set(folder, pkg);
      }
    }
  }

  type Reached = { name: string; folder: string; via: PathDependency["via"] };
  const reached = new Map<string, Reached[]>();
  const leftOutEdges = new Map<string, PathDependency[]>();
  for (const workspace of discovery.workspaces) {
    for (const crate of workspace.members) {
      reached.set(
        crate.manifest_path,
        reachedWithoutProject(crate, withProject, known).map((behind) => ({
          name: behind.name,
          folder: dirname(behind.manifest),
          via: "path",
        })),
      );
    }
  }
  for (const use of uses.filter((use) => !use.edge)) {
    const member = use.member.manifest_path;
    if (use.projectRoot !== undefined) {
      const crate = byRealFolder.get(use.folder);
      leftOutEdges.set(member, [
        ...(leftOutEdges.get(member) ?? []),
        {
          name: crate?.name ?? basename(use.folder),
          folder: use.projectRoot,
          seen: true,
          via: "redirection",
          workspaceManifest: ownWorkspaceManifest(use.folder),
        },
      ]);
      continue;
    }
    const pkg = use.reported ? byRealFolder.get(use.folder) : undefined;
    const crates: Reached[] = [
      { name: pkg?.name ?? basename(use.folder), folder: use.folder, via: "redirection" },
      ...(pkg === undefined ? [] : reachedWithoutProject(pkg, withProject, known)).map(
        (behind): Reached => ({
          name: behind.name,
          folder: dirname(behind.manifest),
          via: "redirection",
        }),
      ),
    ];
    reached.set(member, [...(reached.get(member) ?? []), ...crates]);
  }

  // Each folder once per crate, relative to the repository root where it lies inside.
  const located = new Map<string, (Reached & { inside?: string })[]>();
  for (const [manifest, crates] of reached) {
    const seenFolders = new Set<string>();
    located.set(
      manifest,
      crates.flatMap((crate) => {
        const folder = realPath(crate.folder);
        if (seenFolders.has(folder)) {
          return [];
        }
        seenFolders.add(folder);
        return [{ ...crate, folder, inside: inside(repositoryRoot, folder) }];
      }),
    );
  }
  const seen = await foldersNxSees(workspaceRoot, [
    ...new Set(
      [...located.values()]
        .flat()
        .map((crate) => crate.inside)
        .filter((path): path is string => path !== undefined),
    ),
  ]);
  const withoutProject = new Map<string, PathDependency[]>();
  for (const [manifest, crates] of located) {
    withoutProject.set(
      manifest,
      crates.map((crate) => ({
        name: crate.name,
        folder: crate.inside ?? crate.folder,
        seen: crate.inside !== undefined && seen.has(crate.inside),
        via: crate.via,
        workspaceManifest: ownWorkspaceManifest(crate.folder),
      })),
    );
  }
  for (const [manifest, crates] of leftOutEdges) {
    const folders = new Set<string>();
    leftOutEdges.set(
      manifest,
      crates.filter((crate) => !folders.has(crate.folder) && folders.add(crate.folder)),
    );
  }
  return { withoutProject, leftOutEdges };

  // The root manifest of the workspace of the crate in `folder`, a real
  // path, where it is not the crate's own and lies inside the repository.
  function ownWorkspaceManifest(folder: string): string | undefined {
    const manifest = workspaceManifests.get(folder);
    if (manifest === undefined || realPath(dirname(manifest)) === folder) {
      return undefined;
    }
    const path = inside(repositoryRoot, realPath(manifest));
    return path === "." ? undefined : path;
  }
}

/**
 * The inputs for a crate without an edge: its folder and the root manifest
 * of its workspace, where Nx can see them.
 */
export function crateInputs(crate: PathDependency): string[] {
  if (!crate.seen) {
    return [];
  }
  const folder = crate.folder === "." ? "{workspaceRoot}" : `{workspaceRoot}/${crate.folder}`;
  return [
    `${folder}/**/*`,
    ...(crate.workspaceManifest === undefined
      ? []
      : [`{workspaceRoot}/${crate.workspaceManifest}`]),
  ];
}

/**
 * The warning for a crate without a project whose files Nx does not see
 * (`DES-DIAGNOSTICS`), naming the crate and the dependency.
 *
 * @param crate The crate with a project that reaches it.
 * @param manifest The crate's manifest, relative to the repository root.
 */
// @mara implements DES-DIAGNOSTICS
export function unseenPathDependencyWarning(
  crate: string,
  manifest: string,
  dependency: PathDependency,
): string {
  const outside = isAbsolute(dependency.folder);
  const how =
    dependency.via === "path"
      ? "depends by path on"
      : "may use, through a [patch], [replace] or paths entry of its workspace,";
  return [
    `nx-rust: the crate "${crate}" (${manifest}) ${how} "${dependency.name}" in ${dependency.folder}, which has no Nx project and whose files Nx cannot see, because ${outside ? "it lies outside the repository" : ".gitignore or .nxignore leaves it out"}.`,
    `A change there changes no cache key of "${crate}" or of the crates that depend on it, so Nx can restore results built from the old files.`,
    outside
      ? `Move the crate into the repository, or add a command whose output changes with its files to runtimeInputs in the [package.metadata.nx] table of ${manifest}.`
      : `Stop ignoring ${dependency.folder}, or add a command whose output changes with its files to runtimeInputs in the [package.metadata.nx] table of ${manifest}.`,
  ].join(" ");
}

// The crates without a project that `crate` reaches through path
// dependencies, directly or through other crates without a project, in the
// order the walk meets them, each by its package name and manifest. A crate
// without a report, such as one whose folder holds `.cargo-checksum.json`
// or one whose report failed, counts too; only the path dependencies behind
// it stay unknown.
function reachedWithoutProject(
  crate: CargoPackage,
  withProject: ReadonlySet<string>,
  known: ReadonlyMap<string, CargoPackage>,
): { name: string; manifest: string }[] {
  const reached: { name: string; manifest: string }[] = [];
  const visited = new Set<string>([crate.manifest_path]);
  const queue = [crate];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependency of current.dependencies) {
      if (typeof dependency.path !== "string") {
        continue;
      }
      const manifest = join(dependency.path, "Cargo.toml");
      if (visited.has(manifest) || withProject.has(manifest)) {
        continue;
      }
      visited.add(manifest);
      const pkg = known.get(manifest);
      reached.push({ name: pkg?.name ?? dependency.name, manifest });
      if (pkg !== undefined) {
        queue.push(pkg);
      }
    }
  }
  return reached;
}

// The path relative to the repository root, or `undefined` outside it.
function inside(repositoryRoot: string, path: string): string | undefined {
  const relativePath = relative(repositoryRoot, path);
  if (relativePath === "") {
    return ".";
  }
  return relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)
    ? undefined
    : relativePath;
}
