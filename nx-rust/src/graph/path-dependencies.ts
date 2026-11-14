import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type { CargoMetadata, CargoPackage } from "../cargo/metadata";
import { declaredFiles } from "./declared-files";
import type { CargoDiscovery } from "./discovery";
import type { Input, InputDefinition } from "./inputs";
import { realPath } from "./real-path";
import type { RedirectedUse } from "./redirected-uses";
import { readCrateAddedInputs, readCrateFileInputs } from "./settings";
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
  /**
   * The filesets for the `fileInputs` of its own table and of its
   * workspace's, which travel with its folder (`DES-INPUTS`, "Declared
   * files"); none where no report describes it or Nx does not see it.
   */
  declared: InputDefinition[];
  /**
   * An `env` input for each variable and a `runtime` input for each command
   * that its own table and its workspace's add with `envInputs` and
   * `runtimeInputs`, each once, which an edge would have brought in its
   * named input (`DES-INPUTS`, "Added variables and commands"): also where
   * Nx does not see its files, and none where no report describes it.
   */
  added: InputDefinition[];
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
   * dependency of the crate, or that lie behind a redirected crate without a
   * project, but whose edge from it `redirectedUses` leaves out, each
   * followed by the crates that cargo builds with it, with a project or
   * without (`RedirectedUse.brings`). Their folders and workspace manifests
   * go onto the crate's targets.
   */
  leftOutEdges: Map<string, PathDependency[]>;
  /**
   * The problems of the declared files of those crates, each once, which
   * stop graph creation (`declaredFiles` in `declared-files.ts`).
   */
  problems: string[];
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
 * one whose report failed, its folder counts alone. A crate with a project
 * behind such crates is no folder here: the crate has an edge to it
 * (`projectsReachedByPath` in `reached-projects.ts`, and `redirectedUses`
 * behind a redirected crate), and its input, with what lies behind it,
 * reaches the crate through `^` inputs; where `redirectedUses` leaves that
 * edge out, its folder is among the left-out edges.
 * A path names the crate at the real path of its folder, symbolic links
 * resolved, so a path through a link to a crate with a project is that
 * project's.
 *
 * Whether Nx sees a crate's files is whether it sees its manifest, or any
 * file of a folder without one. The files that a crate seen there declares
 * with `fileInputs`, in its own table or its workspace's, travel with its
 * folder, and so do the variables and commands that any of these crates
 * adds there with `envInputs` and `runtimeInputs`, also where Nx does not
 * see its files; they are read from its report, so a crate without one
 * declares and adds none.
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
  // The real folders of the crates with a project.
  const withProject = new Set(
    discovery.workspaces.flatMap((workspace) =>
      workspace.members.map((pkg) => realPath(dirname(pkg.manifest_path))),
    ),
  );
  const byRealFolder = new Map<string, CargoPackage>();
  // The report of each known crate's workspace, by the crate's real folder.
  const reportOf = new Map<string, CargoMetadata>();
  // The root manifest of each known crate's workspace, by the crate's real folder.
  const workspaceManifests = new Map<string, string>();
  for (const report of [
    ...discovery.workspaces.map((workspace) => workspace.report),
    ...discovery.pathDependencyReports.map((entry) => entry.report),
  ]) {
    for (const pkg of report.packages) {
      const real = realPath(dirname(pkg.manifest_path));
      if (!workspaceManifests.has(real)) {
        workspaceManifests.set(real, join(report.workspace_root, "Cargo.toml"));
      }
      const folder = realPath(dirname(pkg.manifest_path));
      if (!byRealFolder.has(folder)) {
        byRealFolder.set(folder, pkg);
        reportOf.set(folder, report);
      }
    }
  }

  const declared = new Map<string, InputDefinition[]>();
  const added = new Map<string, InputDefinition[]>();
  const problems = new Set<string>();
  type Reached = { name: string; folder: string; via: PathDependency["via"] };
  const reached = new Map<string, Reached[]>();
  const leftOutEdges = new Map<string, PathDependency[]>();
  // The crates behind those of the left-out edges, by the member's manifest path.
  const behindLeftOut = new Map<string, Reached[]>();
  for (const workspace of discovery.workspaces) {
    for (const crate of workspace.members) {
      reached.set(
        crate.manifest_path,
        reachedWithoutProject(crate, withProject, byRealFolder).map((behind) => ({
          name: behind.name,
          folder: behind.folder,
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
          declared: declaredOf(use.folder),
          added: addedOf(use.folder),
        },
      ]);
      behindLeftOut.set(member, [
        ...(behindLeftOut.get(member) ?? []),
        ...(use.brings ?? []).slice(1).map((folder): Reached => ({
          name: byRealFolder.get(folder)?.name ?? basename(folder),
          folder,
          via: "redirection",
        })),
      ]);
      continue;
    }
    const pkg = use.reported ? byRealFolder.get(use.folder) : undefined;
    const crates: Reached[] = [
      { name: pkg?.name ?? basename(use.folder), folder: use.folder, via: "redirection" },
      ...(pkg === undefined ? [] : reachedWithoutProject(pkg, withProject, byRealFolder)).map(
        (behind): Reached => ({ name: behind.name, folder: behind.folder, via: "redirection" }),
      ),
    ];
    reached.set(member, [...(reached.get(member) ?? []), ...crates]);
  }

  const located = locate(reached);
  const locatedBehind = locate(behindLeftOut);
  const seen = await foldersNxSees(workspaceRoot, [
    ...new Set(
      [...located.values(), ...locatedBehind.values()]
        .flat()
        .map((crate) => crate.inside)
        .filter((path): path is string => path !== undefined),
    ),
  ]);
  const withoutProject = new Map<string, PathDependency[]>();
  for (const [manifest, crates] of located) {
    withoutProject.set(manifest, crates.map(pathDependency));
  }
  for (const [manifest, crates] of locatedBehind) {
    leftOutEdges.set(manifest, [
      ...(leftOutEdges.get(manifest) ?? []),
      ...crates.map(pathDependency),
    ]);
  }
  for (const [manifest, crates] of leftOutEdges) {
    const folders = new Set<string>();
    leftOutEdges.set(
      manifest,
      crates.filter((crate) => !folders.has(crate.folder) && folders.add(crate.folder)),
    );
  }
  return { withoutProject, leftOutEdges, problems: [...problems] };

  // Each folder once per crate, relative to the repository root where it
  // lies inside.
  function locate(crates: Map<string, Reached[]>): Map<string, (Reached & { inside?: string })[]> {
    const found = new Map<string, (Reached & { inside?: string })[]>();
    for (const [manifest, list] of crates) {
      const seenFolders = new Set<string>();
      found.set(
        manifest,
        list.flatMap((crate) => {
          const folder = realPath(crate.folder);
          if (seenFolders.has(folder)) {
            return [];
          }
          seenFolders.add(folder);
          return [{ ...crate, folder, inside: inside(repositoryRoot, folder) }];
        }),
      );
    }
    return found;
  }

  // The entry for a located crate, with its declared files where Nx sees it.
  function pathDependency(crate: Reached & { inside?: string }): PathDependency {
    const isSeen = crate.inside !== undefined && seen.has(crate.inside);
    return {
      name: crate.name,
      folder: crate.inside ?? crate.folder,
      seen: isSeen,
      via: crate.via,
      workspaceManifest: ownWorkspaceManifest(crate.folder),
      declared: isSeen ? declaredOf(crate.folder) : [],
      added: addedOf(crate.folder),
    };
  }

  // The `env` and `runtime` inputs for what the crate in `folder`, a real
  // path, adds with `envInputs` and `runtimeInputs`, read once per crate
  // from its report; none without one.
  function addedOf(folder: string): InputDefinition[] {
    const pkg = byRealFolder.get(folder);
    const report = reportOf.get(folder);
    if (pkg === undefined || report === undefined) {
      return [];
    }
    let inputs = added.get(folder);
    if (inputs === undefined) {
      const found: string[] = [];
      const { envInputs, runtimeInputs } = readCrateAddedInputs(pkg, report, workspaceRoot, found);
      for (const problem of found) {
        problems.add(problem);
      }
      inputs = [
        ...envInputs.map((env): InputDefinition => ({ env })),
        ...runtimeInputs.map((runtime): InputDefinition => ({ runtime })),
      ];
      added.set(folder, inputs);
    }
    return inputs;
  }

  // The filesets for the files that the crate in `folder`, a real path,
  // declares, read once per crate from its report; none without one.
  function declaredOf(folder: string): InputDefinition[] {
    const pkg = byRealFolder.get(folder);
    const report = reportOf.get(folder);
    if (pkg === undefined || report === undefined) {
      return [];
    }
    let filesets = declared.get(folder);
    if (filesets === undefined) {
      const found: string[] = [];
      const fileInputs = readCrateFileInputs(pkg, report, workspaceRoot, found);
      const workspace = { root: relative(workspaceRoot, report.workspace_root) || ".", report };
      const result = declaredFiles(fileInputs, workspace, workspaceRoot);
      for (const problem of [...found, ...result.problems]) {
        problems.add(problem);
      }
      filesets = result.filesets;
      declared.set(folder, filesets);
    }
    return filesets;
  }

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
 * The inputs for a crate without an edge: its folder, the root manifest of
 * its workspace and the files it declares, where Nx can see them, and the
 * variables and commands it adds, also where Nx cannot.
 */
export function crateInputs(crate: PathDependency): Input[] {
  if (!crate.seen) {
    return crate.added;
  }
  const folder = crate.folder === "." ? "{workspaceRoot}" : `{workspaceRoot}/${crate.folder}`;
  return [
    `${folder}/**/*`,
    ...(crate.workspaceManifest === undefined
      ? []
      : [`{workspaceRoot}/${crate.workspaceManifest}`]),
    ...crate.declared,
    ...crate.added,
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
// order the walk meets them, each by its package name and the real path of
// its folder. A path names the crate at the real path of its folder, so one
// through a symbolic link to a crate with a project stops the walk as that
// crate does. A crate without a report, such as one whose folder holds
// `.cargo-checksum.json` or one whose report failed, counts too; only the
// path dependencies behind it stay unknown.
function reachedWithoutProject(
  crate: CargoPackage,
  withProject: ReadonlySet<string>,
  known: ReadonlyMap<string, CargoPackage>,
): { name: string; folder: string }[] {
  const reached: { name: string; folder: string }[] = [];
  const visited = new Set<string>([realPath(dirname(crate.manifest_path))]);
  const queue = [crate];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependency of current.dependencies) {
      if (typeof dependency.path !== "string") {
        continue;
      }
      const folder = realPath(dependency.path);
      if (visited.has(folder) || withProject.has(folder)) {
        continue;
      }
      visited.add(folder);
      const pkg = known.get(folder);
      reached.push({ name: pkg?.name ?? dependency.name, folder });
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
