import { runCargoForGraph } from "../cargo/run-cargo";

/** The oldest Cargo that the plugin supports (`REQ-COMPATIBILITY`). */
export const minimumCargo = { major: 1, minor: 91 };

const minimum = `${minimumCargo.major}.${minimumCargo.minor}`;

/**
 * The cargo that produced a `cargo metadata` report is older than the
 * supported ones.
 */
export class UnsupportedCargoError extends Error {
  constructor(
    /** What `cargo --version` printed, or why it could not be run. */
    readonly found: { version: string } | { failure: string },
  ) {
    super(
      "version" in found
        ? `cargo is ${found.version}, and nx-rust needs Cargo ${minimum} or later`
        : `cargo is older than ${minimum}, and nx-rust needs Cargo ${minimum} or later`,
    );
    this.name = "UnsupportedCargoError";
  }

  /**
   * The message for the report of `subject`, such as "the Cargo workspace of
   * rust/Cargo.toml": the version found, the version required and what to do.
   */
  messageFor(subject: string): string {
    const { found } = this;
    if ("version" in found && atLeastMinimum(found.version)) {
      return [
        `nx-rust could not read ${subject}: ${found.version} printed a \`cargo metadata\` report without build_directory, which every Cargo from ${minimum} on reports.`,
        "Please report this at https://github.com/convesoft/nx-rust/issues together with the output of `cargo --version` and `cargo metadata --no-deps --format-version 1` in that folder.",
      ].join("\n");
    }
    return [
      "version" in found
        ? `nx-rust needs Cargo ${minimum} or later, but the cargo that reads ${subject} is ${found.version}.`
        : `nx-rust needs Cargo ${minimum} or later, but the cargo that reads ${subject} is older: its \`cargo metadata\` report has no build_directory, which Cargo reports from ${minimum} on. \`cargo --version\` failed: ${found.failure}.`,
      `Update that toolchain, for example with \`rustup update\`, or pin Rust ${minimum} or later in the rust-toolchain.toml that chooses it.`,
    ].join("\n");
  }
}

/**
 * Fails when `report`, a `cargo metadata` report that cargo produced in
 * `cwd`, comes from a Cargo older than 1.91.
 *
 * The report of a stable Cargo has `build_directory` from 1.91 on
 * (`EVD-CARGO-DIRECTORIES`), so a report with it costs no further cargo
 * call. Only a report without it makes a second call, to name the version
 * that the error reports.
 *
 * @throws {UnsupportedCargoError} When the report has no `build_directory`.
 */
// @mara implements REQ-COMPATIBILITY
// @mara implements DES-DIAGNOSTICS
export async function checkCargoReport(
  report: { build_directory?: unknown },
  cwd: string,
): Promise<void> {
  if (typeof report.build_directory === "string") {
    return;
  }
  let found: UnsupportedCargoError["found"];
  try {
    found = { version: (await runCargoForGraph(["--version"], cwd)).trim() };
  } catch (error) {
    found = { failure: error instanceof Error ? error.message : String(error) };
  }
  throw new UnsupportedCargoError(found);
}

// Whether `cargo --version` output such as "cargo 1.91.0 (ea2d97820 2025-10-10)"
// names 1.91 or later.
function atLeastMinimum(version: string): boolean {
  const match = /^cargo (\d+)\.(\d+)/.exec(version);
  if (match === null) {
    return false;
  }
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return (
    major > minimumCargo.major || (major === minimumCargo.major && minor >= minimumCargo.minor)
  );
}
