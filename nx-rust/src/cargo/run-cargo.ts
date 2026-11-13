import { spawn } from "node:child_process";

/** Cargo gave no result: it could not be started, or it failed. */
export class CargoError extends Error {
  constructor(
    message: string,
    /** True when cargo could not be started at all, such as when it is not on `PATH`. */
    readonly notStarted: boolean,
    /** What cargo wrote to standard error. */
    readonly stderr: string,
  ) {
    super(message);
    this.name = "CargoError";
  }
}

/**
 * Runs cargo for the creation of the project graph and returns what it wrote
 * to standard output.
 *
 * Every cargo call that graph creation makes starts here, so that a setting
 * that applies to graph creation only, and not to tasks, has one place.
 *
 * Cargo runs with `RUSTUP_AUTO_INSTALL=0`, set for this child only: where
 * cargo is a rustup proxy, a toolchain that is pinned for `cwd` and not
 * installed fails the call with rustup's message, which names the toolchain,
 * instead of being downloaded. A cargo that is no rustup proxy ignores the
 * variable. Tasks run cargo elsewhere and keep rustup's default.
 *
 * @param args The arguments after `cargo`.
 * @param cwd The folder cargo starts in, which decides the toolchain that
 *   rustup picks and the configuration files that Cargo reads.
 * @throws {CargoError} When cargo cannot be started or exits unsuccessfully.
 */
// @mara implements DES-METADATA-REPORT
export function runCargoForGraph(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void) => {
      if (!settled) {
        settled = true;
        finish();
      }
    };
    const child = spawn("cargo", args, {
      cwd,
      env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      const reason =
        error.code === "ENOENT" ? `cargo was not found on PATH (${error.message})` : error.message;
      settle(() => reject(new CargoError(reason, true, "")));
    });
    child.on("close", (code, signal) => {
      const errorOutput = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        settle(() => resolve(Buffer.concat(stdout).toString("utf8")));
      } else {
        const reason = signal
          ? `cargo was stopped by ${signal}`
          : `cargo exited with status ${code}`;
        settle(() => reject(new CargoError(reason, false, errorOutput)));
      }
    });
  });
}
