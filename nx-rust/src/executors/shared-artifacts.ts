import type { ProjectConfiguration } from "@nx/devkit";
import { foldedFileName } from "../graph/artifact-names";
import { type TargetCargoMetadata, targetCargoMetadataKey } from "../graph/targets";

/** What a task of the plugin is about to cache, as far as the check needs it. */
export interface CachedTask {
  /** The task, as `project:target`. */
  task: string;
  /** The task's project. */
  project: string;
  /** The task's target by its default name. */
  target: "build" | "doc" | "test";
}

/** A target of another project whose files can lie where the task's do. */
export interface SharedArtifact {
  /** The other target, as `project:target`. */
  other: string;
  /** The file that both write, or for `doc` the `doc` folder. */
  file: string;
  /** The task's artifact directory, relative to the repository's real path. */
  directory: string;
  /** The other target's artifact directory, relative to the repository's real path. */
  otherDirectory: string;
}

/**
 * The backstop of `DES-OUTPUTS` ("Files of one name") for what graph
 * creation could not see, such as projects that another installation of the
 * plugin, registered in `nx.json` under another name, creates: a target of
 * another project in `projects`, the whole project graph that Nx hands the
 * executor, whose artifact directory is the task's or lies inside it or
 * holds it, and which writes a file of a name that the task declares, the
 * names compared as graph creation compares them ({@link foldedFileName});
 * for `doc`, another `doc` target with such an artifact directory. For a
 * `test`, the files are the executables of the crate's `build`, which its
 * integration tests and benches run. `undefined` where there is none.
 *
 * Graph creation leaves every such target uncached among the projects that
 * it sees, and a run of the check matches no pair that it would not, so a
 * cached task of a repository without such a pair never fails it: the
 * check reads only artifact directories inside the repository, which the
 * metadata of `build` and `doc` records, and the files that each crate's
 * `build` records, falling back to the binaries of its build records where
 * a graph of an older version of the plugin recorded no files.
 */
// @mara implements DES-OUTPUTS
export function sharedArtifact(
  projects: Readonly<Record<string, ProjectConfiguration>>,
  cached: CachedTask,
): SharedArtifact | undefined {
  const own = cargoTargets(projects[cached.project]);
  const kind = cached.target === "doc" ? "doc" : "build";
  const source = own.find((target) => target.metadata.target === kind)?.metadata;
  const directory = source?.artifactDirectory;
  if (source === undefined || directory === undefined) {
    return undefined;
  }
  const files =
    cached.target === "doc"
      ? []
      : artifactFiles(source).filter((file) =>
          cached.target === "test" ? file.binary : file.declared,
        );
  const names = new Map(files.map((file) => [foldedFileName(file.file), file.file]));
  if (cached.target !== "doc" && names.size === 0) {
    return undefined;
  }
  for (const [name, project] of Object.entries(projects)) {
    if (name === cached.project) {
      continue;
    }
    for (const { name: targetName, metadata } of cargoTargets(project)) {
      const otherDirectory = metadata.artifactDirectory;
      if (
        metadata.target !== kind ||
        otherDirectory === undefined ||
        !nested(directory, otherDirectory)
      ) {
        continue;
      }
      const other = `${name}:${targetName}`;
      if (kind === "doc") {
        return { other, file: "doc", directory, otherDirectory };
      }
      const shared = artifactFiles(metadata).find((file) => names.has(foldedFileName(file.file)));
      if (shared !== undefined) {
        return {
          other,
          file: names.get(foldedFileName(shared.file)) as string,
          directory,
          otherDirectory,
        };
      }
    }
  }
  return undefined;
}

/** The message with which the executor fails a cached task for a {@link SharedArtifact}. */
export function sharedArtifactMessage(cached: CachedTask, shared: SharedArtifact): string {
  const { task } = cached;
  const where =
    shared.directory === shared.otherDirectory
      ? `the same artifact directory, ${shared.directory}`
      : `the artifact directory ${shared.otherDirectory}, which lies inside ${task}'s, ${shared.directory}, or holds it`;
  const unseen = `@convesoft/nx-rust left ${task} cached because it did not see ${shared.other} when it created the graph, as where another installation of the plugin, registered in nx.json under another name, creates it. The task does not run, so that Nx stores no result for it.`;
  if (cached.target === "doc") {
    return [
      `${task}: ${shared.other} has ${where}, so that restoring one workspace's doc folder from the cache could delete or replace files of the other.`,
      unseen,
      `Give each Cargo workspace an artifact directory of its own, none inside another, with build.target-dir in its .cargo/config.toml, or register both workspaces through one installation of the plugin, which then leaves both doc targets uncached.`,
    ].join("\n");
  }
  const harm =
    cached.target === "test"
      ? "the tests could run the other crate's executable"
      : `a result stored for ${task} could hold the other crate's file`;
  return [
    `${task}: ${shared.other} writes ${shared.file} into ${where}, where cargo keeps one file for both crates, that of the one it built last, so that ${harm}.`,
    unseen,
    `Give one of the binaries another name, with the name key of its [[bin]] table in Cargo.toml, or for a library of its [lib] table, or register both Cargo workspaces through one installation of the plugin, which then leaves both builds uncached.`,
  ].join("\n");
}

// The targets of a project that carry the plugin's metadata, whichever
// installation of the plugin created them.
function cargoTargets(
  project: ProjectConfiguration | undefined,
): { name: string; metadata: TargetCargoMetadata }[] {
  return Object.entries(project?.targets ?? {}).flatMap(([name, target]) => {
    const metadata = target?.metadata?.[targetCargoMetadataKey] as
      | Partial<TargetCargoMetadata>
      | undefined;
    return typeof metadata?.target === "string"
      ? [{ name, metadata: metadata as TargetCargoMetadata }]
      : [];
  });
}

// The files that a crate's `build` records, or the binaries of its build
// records where a graph of an older version of the plugin recorded none.
function artifactFiles(
  metadata: TargetCargoMetadata,
): { file: string; binary: boolean; declared: boolean }[] {
  if (Array.isArray(metadata.artifactFiles)) {
    return metadata.artifactFiles
      .filter((file) => typeof file?.file === "string")
      .map((file) => ({
        file: file.file,
        binary: file.kind === "binary",
        declared: file.declared === true,
      }));
  }
  const binaries = Array.isArray(metadata.records?.binaries) ? metadata.records.binaries : [];
  return binaries
    .filter((binary) => typeof binary?.name === "string")
    .map((binary) => ({ file: binary.name, binary: true, declared: true }));
}

// Whether two artifact directories, relative to the repository's real
// path, are one folder or one lies inside the other, compared as graph
// creation compares them.
function nested(a: string, b: string): boolean {
  const [x, y] = [a, b].map((path) => foldedFileName(path.replace(/\/+$/, "")));
  return x === y || x === "." || y === "." || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}
