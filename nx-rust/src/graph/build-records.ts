import type { CargoPackage, CargoTarget } from "../cargo/metadata";
import { directoryGroups } from "./artifact-names";
import type { ReportedWorkspace } from "./discovery";

/**
 * What the executor of `build` needs to name the dependency files that
 * `cargo build -p <crate>` exports beside the crate's library and binaries,
 * without asking cargo (`DES-BUILD-INPUT-CHECK`, points 1 and 2). Graph
 * creation takes it from the `cargo metadata` report and puts it into the
 * metadata of the crate's `build` target, which Nx keeps out of task hashes.
 * Cargo's directories are not part of it: the executor asks cargo for them
 * with the task's environment, which a dotenv file of the task can change.
 */
export interface BuildRecordSource {
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
 * (`DES-BUILD-INPUT-CHECK`, point 2, "A shared name"). Workspaces count as
 * having the same artifact directory where `sharers` links them, also
 * through a third, as for the files of `build` (`directoryGroups` in
 * `artifact-names.ts`). Every member of every workspace counts, those
 * without a project too.
 */
// @mara implements DES-BUILD-INPUT-CHECK
export function sharedRecordNames(
  workspaces: readonly ReportedWorkspace[],
  sharers: ReadonlyMap<ReportedWorkspace, readonly ReportedWorkspace[]>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const group of directoryGroups(workspaces, sharers)) {
    const counts = new Map<string, number>();
    for (const workspace of group) {
      for (const pkg of workspace.report.packages) {
        for (const name of recordNames(pkg)) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    const shared = [...counts]
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
      .sort();
    for (const workspace of group) {
      result.set(workspace.root, shared);
    }
  }
  return result;
}

/**
 * The {@link BuildRecordSource} of a crate.
 *
 * @param shared The record names that targets of several crates with the
 *   crate's artifact directory give ({@link sharedRecordNames}).
 */
// @mara implements DES-BUILD-INPUT-CHECK
export function buildRecordSource(pkg: CargoPackage, shared: readonly string[]): BuildRecordSource {
  const library = pkg.targets.find(isLibrary);
  const own = new Set(recordNames(pkg));
  return {
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
