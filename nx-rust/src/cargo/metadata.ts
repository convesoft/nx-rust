import { checkCargoReport } from "../compatibility/cargo-version";
import { runCargoForGraph } from "./run-cargo";

/**
 * The report of `cargo metadata --format-version 1 --no-deps`, as far as the
 * plugin reads it. Paths are absolute. Cargo describes the format in
 * https://doc.rust-lang.org/cargo/commands/cargo-metadata.html#json-format.
 */
export interface CargoMetadata {
  /** The members of the workspace, which are all its packages without dependency resolution. */
  packages: CargoPackage[];
  /** The ids of the members. */
  workspace_members: string[];
  /** The folder of the workspace's root manifest. */
  workspace_root: string;
  /** Cargo's artifact directory. */
  target_directory: string;
  /** Cargo's build directory, reported by recent versions of Cargo. */
  build_directory?: string;
  /** `[workspace.metadata]`, or `null`. */
  metadata: unknown;
}

/** A package in a {@link CargoMetadata} report. */
export interface CargoPackage {
  /** Cargo's package id, which `workspace_members` refers to. */
  id: string;
  name: string;
  /** The package's version, such as `0.1.0`. */
  version: string;
  /** The path of the package's `Cargo.toml`. */
  manifest_path: string;
  /** The dependencies as the manifest declares them, unresolved. */
  dependencies: CargoDependency[];
  /** The package's Cargo targets: its library, binaries, examples, tests, benches and build script. */
  targets: CargoTarget[];
  /**
   * The package's features, each with what it turns on: other features of
   * the package, `dep:<name>` and `<dependency>/<feature>` entries. Cargo
   * lists the implicit feature of an optional dependency too.
   */
  features?: Record<string, string[]>;
  /** `[package.metadata]`, or `null`. */
  metadata: unknown;
}

/** A Cargo target of a {@link CargoPackage}. */
export interface CargoTarget {
  name: string;
  /**
   * What the target is: `bin`, `example`, `test`, `bench` or `custom-build`,
   * or the crate types of a library, such as `lib`, `rlib` or `cdylib`.
   */
  kind: string[];
  /** The features that cargo needs on to build the target, from its `required-features`. */
  "required-features"?: string[];
}

/** A declared dependency of a {@link CargoPackage}. */
export interface CargoDependency {
  /** The name of the package depended on. */
  name: string;
  /** `null` for a normal dependency. */
  kind: "dev" | "build" | null;
  /** The version requirement as Cargo writes it, such as `^0.1`; `*` where none is given. */
  req: string;
  /**
   * Where the dependency comes from, such as
   * `registry+https://github.com/rust-lang/crates.io-index` or
   * `git+https://example.com/repo.git?branch=main`; `null` for a path dependency.
   */
  source: string | null;
  /** The folder of a path dependency; absent for any other dependency. */
  path?: string;
  /** Whether the dependency is optional, so that a feature turns it on. */
  optional?: boolean;
  /** The name under which the manifest lists the dependency, where it renames it. */
  rename?: string | null;
  /** The platform that the dependency is limited to, such as `cfg(windows)`; `null` for none. */
  target?: string | null;
}

/** The arguments after `cargo` that request the report for `manifest`. */
export function metadataArguments(manifest: string): string[] {
  return ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest];
}

/**
 * Requests the report of the workspace that `manifest` belongs to. With
 * `--no-deps`, Cargo needs no network and neither creates nor changes
 * `Cargo.lock`.
 *
 * @param manifest The absolute path of a `Cargo.toml`.
 * @param cwd The folder cargo starts in.
 * @throws {CargoError} When cargo cannot be started or fails.
 * @throws {SyntaxError} When cargo's output is no report.
 * @throws {UnsupportedCargoError} When the report comes from a Cargo older than 1.91.
 */
// @mara implements DES-METADATA-REPORT
export async function requestMetadata(manifest: string, cwd: string): Promise<CargoMetadata> {
  const output = await runCargoForGraph(metadataArguments(manifest), cwd);
  const report = JSON.parse(output) as CargoMetadata;
  if (
    typeof report?.workspace_root !== "string" ||
    !Array.isArray(report.packages) ||
    !Array.isArray(report.workspace_members)
  ) {
    throw new SyntaxError("the output has no workspace_root, packages or workspace_members");
  }
  await checkCargoReport(report, cwd);
  return report;
}
