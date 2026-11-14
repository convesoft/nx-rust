import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { type CargoMetadata, metadataArguments } from "./metadata";

/** Cargo's two directories for commands in one workspace root, as cargo reports them. */
export interface CargoDirectories {
  /** The artifact directory (`target_directory`). */
  artifact: string;
  /** The build directory (`build_directory`), the artifact directory where cargo reports none. */
  build: string;
}

/**
 * The environment variables that move Cargo's artifact directory without a
 * change to a file inside the repository: the directory itself, and the
 * Cargo home, whose `config.toml` can set `build.target-dir`.
 */
export const directoryVariableNames = [
  "CARGO_TARGET_DIR",
  "CARGO_BUILD_TARGET_DIR",
  "CARGO_HOME",
] as const;

/** The {@link directoryVariableNames} that `env` sets, with their values. */
export function directoryVariables(env: NodeJS.ProcessEnv): Record<string, string> {
  const set: Record<string, string> = {};
  for (const name of directoryVariableNames) {
    const value = env[name];
    if (value !== undefined) {
      set[name] = value;
    }
  }
  return set;
}

/** Cargo could not report its directories. */
export class DirectoryReportError extends Error {
  constructor(
    message: string,
    /** What cargo wrote to standard error. */
    readonly stderr: string,
  ) {
    super(message);
    this.name = "DirectoryReportError";
  }
}

/**
 * The directories that cargo uses for a command started in `workspaceRoot`
 * with `env`, from its `cargo metadata --no-deps` report, as graph creation
 * reads them from its own report (`DES-METADATA-REPORT`). Cargo resolves
 * every source of them itself: `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`,
 * `CARGO_BUILD_BUILD_DIR`, the configuration files of the folder, of the
 * folders above it and of the Cargo home that `CARGO_HOME` names, the files
 * they include as the cargo version reads them, and the templates of
 * `build.build-dir` (`EVD-CARGO-DIRECTORIES`). With `--no-deps` cargo needs
 * no network and leaves `Cargo.lock` alone.
 *
 * @param env The whole environment of the call, also where rustup may
 *   install a toolchain for it.
 * @throws {DirectoryReportError} When cargo cannot be started, fails or
 *   prints no report.
 */
// @mara implements DES-OUTPUTS
export function reportedDirectories(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
): CargoDirectories {
  const run = spawnSync("cargo", metadataArguments(join(workspaceRoot, "Cargo.toml")), {
    cwd: workspaceRoot,
    env,
    encoding: "utf8",
    // The report lists every member with its targets and dependencies.
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (run.error !== undefined) {
    const code = (run.error as NodeJS.ErrnoException).code;
    throw new DirectoryReportError(
      code === "ENOENT" ? `cargo was not found on PATH (${run.error.message})` : run.error.message,
      "",
    );
  }
  if (run.status !== 0) {
    throw new DirectoryReportError(
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
  if (typeof report?.target_directory !== "string") {
    throw new DirectoryReportError("cargo printed no report with a target_directory", run.stderr);
  }
  return {
    artifact: report.target_directory,
    build:
      typeof report.build_directory === "string" ? report.build_directory : report.target_directory,
  };
}
