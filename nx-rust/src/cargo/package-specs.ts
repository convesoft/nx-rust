import { spawnSync } from "node:child_process";
import type { CargoMetadata } from "./metadata";

/** Cargo could not list the members of a workspace with their package ID specifications. */
export class PackageSpecReportError extends Error {
  constructor(
    message: string,
    /** What cargo wrote to standard error. */
    readonly stderr: string,
  ) {
    super(message);
    this.name = "PackageSpecReportError";
  }
}

/**
 * The package ID specification of each member of the Cargo workspace whose
 * root folder is `workspaceRoot`, by package name, as cargo gives it to a
 * command that starts there with `env` (`DES-INVOCATION`): the `id` of the
 * member in the `cargo metadata --format-version 1 --no-deps` report, which
 * is what `cargo pkgid` prints for the member's manifest, such as
 * `path+file:///repo/rust/crates/core#core-lib@0.1.0`.
 *
 * The report lists the members only, whose package names cargo keeps
 * distinct, so the name identifies the entry. Cargo starts in the folder
 * without `--manifest-path`, as the task's own command does: the
 * specification holds the path through which cargo reached the workspace,
 * and a specification asked through another path, such as a symbolic link,
 * matches no package there (`EVD-CARGO-PACKAGE-SPECS`). With `--no-deps`
 * cargo needs no network and neither needs nor writes `Cargo.lock`, which
 * `cargo pkgid` needs.
 *
 * @param env The whole environment of the task's command, also where rustup
 *   may install a toolchain for it, as for the command itself.
 * @throws {PackageSpecReportError} When cargo cannot be started, fails or
 *   prints no report.
 */
// @mara implements DES-INVOCATION
export function memberSpecs(workspaceRoot: string, env: NodeJS.ProcessEnv): Map<string, string> {
  const run = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
    cwd: workspaceRoot,
    env,
    encoding: "utf8",
    // The report lists every member with its targets and dependencies.
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (run.error !== undefined) {
    const code = (run.error as NodeJS.ErrnoException).code;
    throw new PackageSpecReportError(
      code === "ENOENT" ? `cargo was not found on PATH (${run.error.message})` : run.error.message,
      "",
    );
  }
  if (run.status !== 0) {
    throw new PackageSpecReportError(
      run.signal ? `cargo was stopped by ${run.signal}` : `cargo exited with status ${run.status}`,
      run.stderr,
    );
  }
  let report: Partial<CargoMetadata>;
  try {
    report = JSON.parse(run.stdout) as Partial<CargoMetadata>;
  } catch {
    report = {};
  }
  if (!Array.isArray(report?.packages)) {
    throw new PackageSpecReportError("cargo printed no report with packages", run.stderr);
  }
  const specs = new Map<string, string>();
  for (const pkg of report.packages) {
    if (typeof pkg?.name === "string" && typeof pkg.id === "string") {
      specs.set(pkg.name, pkg.id);
    }
  }
  return specs;
}
