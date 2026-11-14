import { isAbsolute, relative } from "node:path";
import type { CargoPackage, CargoTarget } from "../cargo/metadata";
import type { CargoWorkspace } from "./discovery";
import { physicalPath, realPath } from "./real-path";

/**
 * What the executor of `build` needs to name the dependency files that
 * `cargo build -p <crate>` exports beside the crate's library and binaries,
 * without asking cargo (`DES-BUILD-INPUT-CHECK`, points 1 and 2). Graph
 * creation takes it from the `cargo metadata` report and puts it into the
 * metadata of the crate's `build` target, which Nx keeps out of task hashes.
 */
export interface BuildRecordSource {
  /**
   * Cargo's artifact directory, as the system reaches it: relative to the
   * repository's real path where it lies inside it, absolute otherwise.
   */
  artifactDirectory: string;
  /** Cargo's build directory, in the same form. */
  buildDirectory: string;
  /** The crate's library, if it has one. */
  library?: {
    /** The library's name as Cargo reports it. */
    name: string;
    /** Whether it is a proc macro, which cargo builds for the host whatever the triple. */
    procMacro: boolean;
  };
  /** The crate's binaries, with the features that each requires. */
  binaries: { name: string; requiredFeatures: string[] }[];
  /** The crate's features, each with what it turns on, as the report lists them. */
  features: Record<string, string[]>;
  /**
   * The names under which the crate lists its optional dependencies that
   * no platform limits, sorted: a `<dependency>/<feature>` entry for one of
   * them also turns on the crate's feature of the dependency's name.
   */
  optionalDependencies?: string[];
  /**
   * The names of the crate's records that a target of another crate with
   * the same artifact directory shares, such as `cli.d` for two binaries
   * called `cli`. Cargo keeps one record for such a name, that of the crate
   * it built last.
   */
  shared: string[];
}

/** The `kind` values of a library target in the `cargo metadata` report. */
const libraryKinds = new Set(["lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro"]);

/** The name of the record that cargo exports for a library: `lib<name>.d`, with `-` as `_`. */
export function libraryRecordName(name: string): string {
  return `lib${name.replace(/-/g, "_")}.d`;
}

/** The name of the record that cargo exports for a binary: `<name>.d`. */
export function binaryRecordName(name: string): string {
  return `${name}.d`;
}

/**
 * The record names that targets of more than one crate with the same
 * artifact directory give, for each workspace by its root folder
 * (`DES-BUILD-INPUT-CHECK`, point 2, "A shared name"). Every member of every
 * workspace counts, those without a project too.
 *
 * @param reached Each workspace's artifact directory as the system reaches it.
 */
// @mara implements DES-BUILD-INPUT-CHECK
export function sharedRecordNames(
  workspaces: readonly CargoWorkspace[],
  reached: ReadonlyMap<CargoWorkspace, string>,
): Map<string, string[]> {
  const byDirectory = new Map<string, Map<string, number>>();
  const directoryOf = (workspace: CargoWorkspace) =>
    reached.get(workspace) ?? workspace.report.target_directory;
  for (const workspace of workspaces) {
    const directory = directoryOf(workspace);
    const counts = byDirectory.get(directory) ?? new Map<string, number>();
    byDirectory.set(directory, counts);
    for (const pkg of workspace.report.packages) {
      for (const name of recordNames(pkg)) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return new Map(
    workspaces.map((workspace) => {
      const counts = byDirectory.get(directoryOf(workspace)) ?? new Map<string, number>();
      return [
        workspace.root,
        [...counts]
          .filter(([, count]) => count > 1)
          .map(([name]) => name)
          .sort(),
      ];
    }),
  );
}

/**
 * The {@link BuildRecordSource} of a crate.
 *
 * @param shared The record names that targets of several crates with the
 *   crate's artifact directory give ({@link sharedRecordNames}).
 * @param repositoryRoot The absolute path of the repository root.
 */
// @mara implements DES-BUILD-INPUT-CHECK
export function buildRecordSource(
  pkg: CargoPackage,
  workspace: Pick<CargoWorkspace, "report">,
  shared: readonly string[],
  repositoryRoot: string,
): BuildRecordSource {
  const realRoot = realPath(repositoryRoot);
  const shown = (directory: string) => {
    const reached = physicalPath(directory);
    const path = relative(realRoot, reached);
    return path === "" || path === ".." || path.startsWith("../") || isAbsolute(path)
      ? reached
      : path;
  };
  const { target_directory: artifacts, build_directory: build } = workspace.report;
  const library = pkg.targets.find(isLibrary);
  const own = new Set(recordNames(pkg));
  return {
    artifactDirectory: shown(artifacts),
    buildDirectory: shown(build ?? artifacts),
    ...(library === undefined
      ? {}
      : { library: { name: library.name, procMacro: library.kind.includes("proc-macro") } }),
    binaries: pkg.targets
      .filter((target) => target.kind.includes("bin"))
      .map((target) => ({
        name: target.name,
        requiredFeatures: [...(target["required-features"] ?? [])],
      })),
    features: Object.fromEntries(
      Object.entries(pkg.features ?? {}).map(([name, enables]) => [name, [...enables]]),
    ),
    optionalDependencies: [
      ...new Set(
        pkg.dependencies
          .filter((dependency) => dependency.optional === true && !dependency.target)
          .map((dependency) => dependency.rename ?? dependency.name),
      ),
    ].sort(),
    shared: shared.filter((name) => own.has(name)),
  };
}

// The names of the records that a package's library and binaries give.
function recordNames(pkg: CargoPackage): string[] {
  return pkg.targets.flatMap((target) =>
    isLibrary(target)
      ? [libraryRecordName(target.name)]
      : target.kind.includes("bin")
        ? [binaryRecordName(target.name)]
        : [],
  );
}

function isLibrary(target: CargoTarget): boolean {
  return target.kind.some((kind) => libraryKinds.has(kind));
}
