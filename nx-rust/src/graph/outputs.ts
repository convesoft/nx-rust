import type { CargoPackage } from "../cargo/metadata";
import type { InferredTargetName } from "./targets";

/**
 * Where a workspace's artifact directory lies, as far as caching cares
 * (`DES-OUTPUTS`).
 */
export type ArtifactDirectory =
  /** Inside the repository, at `path` relative to its root; `shared` when another workspace reports it too. */
  | { inside: true; path: string; shared: boolean }
  /** Outside the repository, where Nx cannot store files. */
  | { inside: false };

/**
 * The folder of a build's final artifacts below the artifact directory, as
 * Nx interpolates it from the task's options: the triple's folder when the
 * task names a triple, then the profile's folder, `debug` without a profile.
 *
 * Cargo's folder for the profiles `dev` and `test` is `debug`, and for
 * `bench` it is `release`, which this expression cannot map: given one of
 * those three by name, the task's outputs name a folder that cargo does not
 * write (nxr-fqkbw9). Nor can it see a triple that `CARGO_BUILD_TARGET` or
 * Cargo's configuration chooses (nxr-3svm6z).
 */
const artifactFolder = "{options.targetTriple ?? .}/{options.profile ?? debug}";

/**
 * Whether the target is cached (`DES-TARGETS`, `DES-OUTPUTS`): `build`,
 * `check`, `lint`, `test`, `fmt-check` and the workspace project's `doc`
 * are, apart from `build` and `doc` where the artifact directory lies
 * outside the repository, and `doc` where another workspace shares it.
 */
// @mara implements DES-OUTPUTS
export function isCached(target: InferredTargetName, artifacts: ArtifactDirectory): boolean {
  switch (target) {
    case "check":
    case "lint":
    case "test":
    case "fmt-check":
      return true;
    case "build":
      return artifacts.inside;
    case "doc":
      return artifacts.inside && !artifacts.shared;
    default:
      return false;
  }
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
): string[] {
  if (!artifacts.inside || !isCached(target, artifacts)) {
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
