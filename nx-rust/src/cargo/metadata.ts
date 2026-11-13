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
  /** The path of the package's `Cargo.toml`. */
  manifest_path: string;
  /** The dependencies as the manifest declares them, unresolved. */
  dependencies: CargoDependency[];
  /** `[package.metadata]`, or `null`. */
  metadata: unknown;
}

/** A declared dependency of a {@link CargoPackage}. */
export interface CargoDependency {
  /** The name of the package depended on. */
  name: string;
  /** `null` for a normal dependency. */
  kind: "dev" | "build" | null;
  /** The folder of a path dependency; absent for any other dependency. */
  path?: string;
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
