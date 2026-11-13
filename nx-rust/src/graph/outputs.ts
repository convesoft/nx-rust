import type { CargoPackage } from "../cargo/metadata";
import type { InferredTargetName } from "./targets";

/**
 * Where a workspace's artifact directory lies, as far as caching cares: the
 * folder that the system reaches through the path that cargo reports, with
 * every symbolic link followed (`DES-OUTPUTS`).
 */
export type ArtifactDirectory =
  /** Inside the repository, at `path` relative to its real path; `shared` when it is another workspace's too. */
  | { inside: true; path: string; shared: boolean }
  /** Outside the repository, where Nx cannot store files. */
  | { inside: false };

/**
 * The folder of a build's final artifacts below the artifact directory, as
 * Nx interpolates it from the task's options: the triple's folder when the
 * task names a triple, then the profile's folder, `debug` without a profile.
 * The executor rejects the profiles `dev`, `test` and `bench` on `build` and
 * `doc`, whose folders Cargo names `debug` and `release`, which this
 * expression cannot map; and a triple that `CARGO_BUILD_TARGET` or Cargo's
 * configuration chooses leaves the target uncached or failed
 * ({@link uncachedReason}).
 */
const artifactFolder = "{options.targetTriple ?? .}/{options.profile ?? debug}";

/**
 * Why `DES-TARGETS` and `DES-WORKSPACE-TARGETS` leave a target uncached in
 * every project, for the message of a task whose configuration caches it
 * anyway.
 */
export const uncachedByDesign: Partial<Record<InferredTargetName, string>> = {
  fmt: "it rewrites the crate's files, which a result restored from the cache would not do",
  bench: "benchmark timings differ between runs",
  run: "it runs a binary, whose effects a result restored from the cache would not repeat",
  audit:
    "cargo-audit fetches the advisory database each time it runs, and no input covers it, so a cached pass could hide a newer advisory",
  deny: "cargo-deny fetches the advisory database each time it runs, and no input covers it, so a cached pass could hide a newer advisory",
  update: "it exists to change Cargo.lock",
  lockfile:
    "whether cargo changes Cargo.lock also depends on files outside the repository, such as a [patch] in the Cargo home's configuration, which Nx cannot hash",
};

/** What decides, beyond the target, whether the plugin can cache it in a workspace. */
export interface CachePlace {
  /** Where the workspace's artifact directory lies. */
  artifacts: ArtifactDirectory;
  /** The configuration files that set `build.target` for the workspace. */
  buildTargetFiles: readonly string[];
}

/**
 * Why the plugin leaves a target that `DES-TARGETS` caches uncached in one
 * project, or `undefined` where it caches it (`DES-OUTPUTS`): `build` and
 * `doc` where the artifact directory lies outside the repository, or where
 * Cargo's configuration chooses the triple and the target's options name
 * none, and `doc` where another workspace shares the artifact directory.
 * The plugin cannot name or store the artifacts of such a task.
 *
 * @param namesTriple Whether the target's options or configurations name a triple.
 */
// @mara implements DES-OUTPUTS
export function uncachedReason(
  target: InferredTargetName,
  place: CachePlace,
  namesTriple: boolean,
): string | undefined {
  if (target !== "build" && target !== "doc") {
    return undefined;
  }
  if (!place.artifacts.inside) {
    return "its workspace's artifact directory lies outside the repository, where Nx cannot store files";
  }
  if (target === "doc" && place.artifacts.shared) {
    return "another workspace shares its artifact directory, and restoring one workspace's doc folder from the cache would delete the pages of the others";
  }
  if (place.buildTargetFiles.length > 0 && !namesTriple) {
    return `build.target in ${place.buildTargetFiles[0]} chooses the target triple, so the plugin cannot name the folder where cargo puts the artifacts; give the triple as the targetTriple option instead`;
  }
  return undefined;
}

/**
 * The outputs of a cached target, which name final artifacts only and never
 * a path inside Cargo's build directory (`DES-OUTPUTS`, `DES-BUILD-DIRS`):
 *
 * - `build`: the executable of each binary target, and the `cdylib` and
 *   `staticlib` files of the library, in the artifact directory's folder
 *   for the task's triple and profile. A library's file is named for both
 *   Linux and macOS, and Nx stores what exists.
 * - `doc`: the whole `doc` folder of the artifact directory, or of its
 *   triple's folder when the task names a triple.
 *
 * Other targets store their result only and have no outputs, and neither
 * do targets that are not cached. The list is empty rather than absent,
 * because Nx gives a `build` target without `outputs` folders such as
 * `{projectRoot}/build` of its own accord.
 */
// @mara implements DES-OUTPUTS
// @mara implements DES-BUILD-DIRS
// @mara implements REQ-CACHE-OUTPUTS
export function targetOutputs(
  target: InferredTargetName,
  pkg: CargoPackage | undefined,
  artifacts: ArtifactDirectory,
  cached: boolean,
): string[] {
  if (!artifacts.inside || !cached) {
    return [];
  }
  const directory = `{workspaceRoot}/${artifacts.path}`;
  if (target === "doc") {
    return [`${directory}/{options.targetTriple ?? .}/doc`];
  }
  if (target !== "build" || pkg === undefined) {
    return [];
  }
  const files: string[] = [];
  for (const cargoTarget of pkg.targets) {
    if (cargoTarget.kind.includes("bin")) {
      files.push(cargoTarget.name);
    }
    const library = cargoTarget.name.replace(/-/g, "_");
    if (cargoTarget.kind.includes("cdylib")) {
      files.push(`lib${library}.so`, `lib${library}.dylib`);
    }
    if (cargoTarget.kind.includes("staticlib")) {
      files.push(`lib${library}.a`);
    }
  }
  return files.map((file) => `${directory}/${artifactFolder}/${file}`);
}
