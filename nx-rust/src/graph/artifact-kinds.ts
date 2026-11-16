import type { CargoPackage } from "../cargo/metadata";
import type { ArtifactKind } from "./settings";

/** What the inference reads of a project to tell whether it produces an artifact. */
export interface ArtifactSubject {
  /** The crate; absent for a workspace project without a crate. */
  pkg?: CargoPackage;
  /** The project's settings, of which the crate's `artifacts` replace the inference. */
  settings?: { artifacts?: readonly ArtifactKind[] };
}

/** The package that a crate depends on directly when it produces each kind of artifact. */
const artifactPackages: Readonly<Record<ArtifactKind, string>> = {
  napi: "napi",
  wasm: "wasm-bindgen",
};

/**
 * Whether a crate produces an artifact of the kind (`DES-ARTIFACT-STEPS`):
 * its library target has the crate type `cdylib` and it depends directly,
 * through a normal dependency, on `napi` for a Node addon or on
 * `wasm-bindgen` for a wasm package, also one declared for one platform
 * only. An `artifacts` list in the crate's `[package.metadata.nx]` replaces
 * the inference.
 */
// @mara implements DES-ARTIFACT-STEPS
export function producesArtifact(subject: ArtifactSubject, kind: ArtifactKind): boolean {
  const { pkg } = subject;
  if (pkg === undefined) {
    return false;
  }
  const artifacts = subject.settings?.artifacts;
  if (artifacts !== undefined) {
    return artifacts.includes(kind);
  }
  return (
    pkg.targets.some((target) => target.kind.includes("cdylib")) &&
    pkg.dependencies.some(
      (dependency) => dependency.name === artifactPackages[kind] && dependency.kind === null,
    )
  );
}

/**
 * The `artifacts` of a crate's `[package.metadata.nx]` as the `cargo
 * metadata` report gives them, for code that reads a member without its
 * settings, such as `init`'s table of tools: the strings of the list, or
 * `undefined` where the table names none.
 */
export function reportedArtifacts(pkg: CargoPackage): ArtifactKind[] | undefined {
  const artifacts = (pkg.metadata as { nx?: { artifacts?: unknown } } | null)?.nx?.artifacts;
  return Array.isArray(artifacts)
    ? artifacts.filter((kind): kind is ArtifactKind => kind === "napi" || kind === "wasm")
    : undefined;
}

/** Quotes a value for `sh`, for the commands of `runtime` inputs. */
export function shellQuote(value: string): string {
  return `'${value.split("'").join(`'"'"'`)}'`;
}
