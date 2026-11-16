import { dirname, isAbsolute, relative } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import type { ReportedWorkspace } from "./discovery";
import { realPath } from "./real-path";
import { testReplacesExecutables } from "./targets";

/**
 * Which crates' targets the plugin leaves uncached because another crate
 * puts a file of the same name into their artifact directory, and the
 * warnings that say so (`DES-OUTPUTS`, "Files of one name").
 */
export interface SharedArtifactNames {
  /** Why the plugin leaves a crate's `build` uncached, by the crate's manifest path. */
  build: ReadonlyMap<string, string>;
  /** Why the plugin leaves a crate's `test` uncached, by the crate's manifest path. */
  test: ReadonlyMap<string, string>;
  /**
   * For each crate whose library has the file name of another crate's
   * `cdylib`, `dylib`, proc-macro or `staticlib` file, by the crate's manifest
   * path: the shared name and the other crates, for the message with which
   * its `napi-build` fails before cargo runs (`DES-NAPI`, "Library names").
   */
  libraries: ReadonlyMap<string, string>;
  /**
   * One warning for each file name that crates of one artifact directory
   * share, with the manifest paths of the crates that it names, in whose
   * projects' warnings it belongs (`DES-DIAGNOSTICS`).
   */
  warnings: readonly { message: string; manifests: readonly string[] }[];
}

/** A final artifact that a crate's target puts into the folders of its artifact directory. */
export interface NamedArtifact {
  /** The file's name on Linux, such as `cli`, `libshared.so` or `libshared.a`. */
  file: string;
  kind: "binary" | "library";
  /** Whether the crate's `build` declares the file as an output (`targetOutputs` in `outputs.ts`). */
  declared: boolean;
}

/** A crate that writes a file of a shared name. */
interface Writer extends NamedArtifact {
  pkg: CargoPackage;
  workspace: ReportedWorkspace;
}

/**
 * The final artifacts that each crate puts into the folders of its
 * artifact directory under a name of its target, not of the crate
 * (`EVD-CARGO-ARTIFACT-WRITERS`): the executable of each binary, named
 * after the binary; and the file of a library, `lib<name>` with each `-` as
 * `_`, `.so` on Linux and `.dylib` on macOS for a `cdylib`, a `dylib` and a
 * proc macro, and `.a` for a `staticlib`. Only the executables and the
 * `cdylib` and `staticlib` files are outputs of `build`; cargo copies a
 * `dylib` there also where it builds it as another crate's dependency, and a
 * proc macro where a command selects its crate. A binary's name holds no
 * `.`, which rustc refuses in a crate name, so it is never the name of a
 * library's file. The file of a dynamic library is named here by its Linux
 * name alone: its macOS name is shared exactly where that one is.
 */
export function namedArtifacts(pkg: CargoPackage): NamedArtifact[] {
  return pkg.targets.flatMap((target): NamedArtifact[] => {
    if (target.kind.includes("bin")) {
      return [{ file: target.name, kind: "binary", declared: true }];
    }
    const library = `lib${target.name.replace(/-/g, "_")}`;
    const artifacts: NamedArtifact[] = [];
    if (["cdylib", "dylib", "proc-macro"].some((kind) => target.kind.includes(kind))) {
      artifacts.push({
        file: `${library}.so`,
        kind: "library",
        declared: target.kind.includes("cdylib"),
      });
    }
    if (target.kind.includes("staticlib")) {
      artifacts.push({ file: `${library}.a`, kind: "library", declared: true });
    }
    return artifacts;
  });
}

/**
 * A file's name as a file system that ignores case and Unicode
 * normalisation, such as macOS's default one, compares it, erring towards
 * taking two names for one: upper case and then lower case, so that `ß`
 * and `ss` agree, in one normal form.
 */
export function foldedFileName(name: string): string {
  return name.normalize("NFD").toUpperCase().toLowerCase().normalize("NFD");
}

/**
 * Finds the crates whose final artifacts share a file name in one artifact
 * directory (`DES-OUTPUTS`, "Files of one name"). Cargo writes one file
 * for them in every folder that both crates build into, that of the crate it
 * wrote last, and warns of an output filename collision only where one
 * call builds both (`EVD-CARGO-ARTIFACT-WRITERS`).
 *
 * The workspaces that share an artifact directory, as `sharers` gives them
 * for `doc`, also through a third, are compared as one, with every member of
 * each, those without a project too: workspaces whose artifact directory is
 * the same folder, and those whose artifact directory lies inside
 * another's, since a folder of a triple or a profile in one can be the
 * other. Those of other entries of the plugin count as well. Names count as one where they differ
 * only in case or Unicode normalisation ({@link foldedFileName}), on every
 * host, so that the graph is the same on Linux and macOS. Triples and
 * profiles play no part: the outputs interpolate the task's `targetTriple`
 * and `profile` options, so that two crates of one artifact directory can
 * always build into one folder. Two targets of one crate do not count: one
 * command writes both, and a restore puts back what it left.
 *
 * Every crate that declares such a file as an output of its `build` gets
 * that `build` left uncached, as a whole, because one cargo command writes
 * all of its files; and so does its `test` where the file is the executable
 * of a binary and `cargo test` builds the crate's binaries
 * ({@link testReplacesExecutables}), because its tests run that file as
 * `CARGO_BIN_EXE_<name>`, which another crate's command can replace first.
 *
 * @param directoryOf The artifact directory that a workspace's warnings name.
 * @param repositoryRoot The repository root, against which the warnings name
 *   the crates' folders.
 */
// @mara implements DES-OUTPUTS
export function sharedArtifactNames(
  workspaces: readonly ReportedWorkspace[],
  sharers: ReadonlyMap<ReportedWorkspace, readonly ReportedWorkspace[]>,
  directoryOf: (workspace: ReportedWorkspace) => string,
  repositoryRoot: string,
): SharedArtifactNames {
  const build = new Map<string, string[]>();
  const test = new Map<string, string[]>();
  const libraries = new Map<string, string[]>();
  const warnings: { message: string; manifests: string[] }[] = [];
  const folderOf = (pkg: CargoPackage) =>
    repositoryFolder(dirname(pkg.manifest_path), repositoryRoot);
  for (const group of directoryGroups(workspaces, sharers)) {
    const byName = new Map<string, Writer[]>();
    for (const workspace of group) {
      for (const pkg of workspace.report.packages) {
        for (const artifact of namedArtifacts(pkg)) {
          const name = foldedFileName(artifact.file);
          byName.set(name, [...(byName.get(name) ?? []), { ...artifact, pkg, workspace }]);
        }
      }
    }
    for (const [, writers] of [...byName].sort(([a], [b]) => compare(a, b))) {
      const crates = uniqueCrates(writers).sort((a, b) => compare(folderOf(a), folderOf(b)));
      if (crates.length < 2) {
        continue;
      }
      const label = crateLabels(crates, folderOf);
      const builds = crates.filter((pkg) =>
        writers.some((writer) => writer.pkg === pkg && writer.declared),
      );
      const binary = writers[0].kind === "binary";
      const tests = binary ? builds.filter(testReplacesExecutables) : [];
      if (!binary) {
        for (const pkg of crates) {
          add(libraries, pkg.manifest_path, sharedClause(pkg, writers, crates, folderOf));
        }
      }
      for (const pkg of builds) {
        const clause = sharedClause(pkg, writers, crates, folderOf);
        add(build, pkg.manifest_path, clause);
        if (tests.includes(pkg)) {
          add(test, pkg.manifest_path, clause);
        }
      }
      warnings.push({
        message: sharedNameWarning({
          crates: crates.map((pkg) => `${pkg.name} in ${folderOf(pkg)}`),
          files: [...new Set(writers.map((writer) => writer.file))].sort(compare),
          binary,
          directories: [
            ...new Set(
              group
                .filter((workspace) => writers.some((writer) => writer.workspace === workspace))
                .map(directoryOf),
            ),
          ].sort(compare),
          builds: builds.map(label),
          tests: tests.map(label),
          workspaces: new Set(
            writers
              .filter((writer) => crates.includes(writer.pkg))
              .map((writer) => writer.workspace),
          ).size,
        }),
        manifests: crates.map((pkg) => pkg.manifest_path),
      });
    }
  }
  return {
    build: new Map(
      [...build].map(([manifest, clauses]) => [
        manifest,
        `files that its build writes can lie at the paths of files that other crates write, in the same artifact directory or in one inside the other, where cargo keeps the file that it wrote last, so that a stored result could hold another crate's file: ${clauses.join("; ")}`,
      ]),
    ),
    test: new Map(
      [...test].map(([manifest, clauses]) => [
        manifest,
        `its integration tests or benches run its executables as CARGO_BIN_EXE_<name>, which can lie at the paths of files that other crates write, in the same artifact directory or in one inside the other, so that the tests could run another crate's executable: ${clauses.join("; ")}`,
      ]),
    ),
    libraries: new Map([...libraries].map(([manifest, clauses]) => [manifest, clauses.join("; ")])),
    warnings,
  };
}

/**
 * The workspaces that share an artifact directory, each group once: those
 * that `sharers` links, also through a third.
 */
export function directoryGroups(
  workspaces: readonly ReportedWorkspace[],
  sharers: ReadonlyMap<ReportedWorkspace, readonly ReportedWorkspace[]>,
): ReportedWorkspace[][] {
  const seen = new Set<ReportedWorkspace>();
  const groups: ReportedWorkspace[][] = [];
  for (const workspace of workspaces) {
    if (seen.has(workspace)) {
      continue;
    }
    seen.add(workspace);
    const group: ReportedWorkspace[] = [];
    const queue = [workspace];
    while (queue.length > 0) {
      const next = queue.shift() as ReportedWorkspace;
      group.push(next);
      for (const other of sharers.get(next) ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

// The crates of the writers, each once, by manifest path.
function uniqueCrates(writers: readonly Writer[]): CargoPackage[] {
  const crates = new Map<string, CargoPackage>();
  for (const { pkg } of writers) {
    if (!crates.has(pkg.manifest_path)) {
      crates.set(pkg.manifest_path, pkg);
    }
  }
  return [...crates.values()];
}

// How the warning names each crate in its list of targets: by package name,
// and with its folder where two crates of the list share the name.
function crateLabels(
  crates: readonly CargoPackage[],
  folderOf: (pkg: CargoPackage) => string,
): (pkg: CargoPackage) => string {
  const counts = new Map<string, number>();
  for (const pkg of crates) {
    counts.set(pkg.name, (counts.get(pkg.name) ?? 0) + 1);
  }
  return (pkg) => ((counts.get(pkg.name) ?? 0) > 1 ? `${pkg.name} in ${folderOf(pkg)}` : pkg.name);
}

// The crate's files of one shared name and the other crates that write it,
// for the reasons in the targets' metadata.
function sharedClause(
  pkg: CargoPackage,
  writers: readonly Writer[],
  crates: readonly CargoPackage[],
  folderOf: (pkg: CargoPackage) => string,
): string {
  const own = [
    ...new Set(writers.filter((writer) => writer.pkg === pkg).map((writer) => writer.file)),
  ];
  const others = crates.filter((other) => other !== pkg);
  return `${list(own)}, which ${list(others.map((other) => `${other.name} in ${folderOf(other)}`))} ${others.length > 1 ? "write" : "writes"} too`;
}

// The warning of `DES-DIAGNOSTICS` for one file name that crates of one
// artifact directory share.
// @mara implements DES-DIAGNOSTICS
function sharedNameWarning(shared: {
  crates: string[];
  files: string[];
  binary: boolean;
  directories: string[];
  builds: string[];
  tests: string[];
  /** How many workspaces the crates belong to. */
  workspaces: number;
}): string {
  const { crates, files, binary, directories, builds, tests, workspaces } = shared;
  const what = binary
    ? `executables called ${list(files)}`
    : files.every((file) => file.endsWith(".so"))
      ? `library files called ${list(files)}, ${list(files.map((file) => `${file.slice(0, -3)}.dylib`))} on macOS`
      : `library files called ${list(files)}`;
  const oneFile =
    files.length > 1
      ? ", which a file system that ignores case, as macOS's does by default, takes for one file,"
      : "";
  const uncached = [
    builds.length === 0
      ? undefined
      : `The build ${builds.length > 1 ? "targets" : "target"} of ${list(builds)} ${builds.length > 1 ? "run" : "runs"} uncached`,
    tests.length === 0
      ? undefined
      : `${tests.length > 1 ? "so do the test targets" : "so does the test target"} of ${list(tests)}, whose integration tests or benches run that executable`,
  ]
    .filter((part) => part !== undefined)
    .join(", and ");
  const where =
    directories.length > 1
      ? `Cargo's artifact directories ${list(directories)}, which lie one inside the other, so that the folders of a triple or a profile in one can be those of the other, and where`
      : `Cargo's artifact directory ${list(directories)}, where`;
  const rename = binary
    ? "give one of the binaries another name, with the name key of its [[bin]] table in Cargo.toml"
    : "give one of the libraries another name, with the name key of its [lib] table in Cargo.toml";
  return [
    `nx-rust: the crates ${list(crates)} put ${what}${oneFile} into ${where} cargo keeps the file of the crate that it wrote last, so that a cached build of one crate could hold another crate's file.`,
    `${uncached}; their other targets stay cached.`,
    workspaces > 1
      ? `To cache them, ${rename}, or give each Cargo workspace an artifact directory of its own, none inside another, with build.target-dir in its .cargo/config.toml.`
      : `To cache them, ${rename}.`,
  ].join(" ");
}

// A folder relative to the repository root, `.` for the root itself, also
// where cargo reports it through the repository's real path; absolute
// outside the repository.
function repositoryFolder(folder: string, repositoryRoot: string): string {
  for (const root of [repositoryRoot, realPath(repositoryRoot)]) {
    const path = relative(root, folder);
    if (!path.startsWith("..") && !isAbsolute(path)) {
      return path || ".";
    }
  }
  return folder;
}

function add(map: Map<string, string[]>, key: string, value: string): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function list(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
