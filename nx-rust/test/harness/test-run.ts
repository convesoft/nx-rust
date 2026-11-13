import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The variables that tell the test processes where the current test run
 * keeps what its commands share. They start with `NX_`, so that
 * `testEnvironment` keeps them from the commands themselves.
 */
const runFolderVariable = "NX_RUST_TEST_RUN_FOLDER";
const socketFolderVariable = "NX_RUST_TEST_RUN_SOCKETS";

/**
 * Creates the folders of one test run and records them in the environment
 * that Jest's test processes inherit. A Jest global setup calls it, and the
 * matching global teardown calls {@link endTestRun}, which removes the
 * folders with whatever the run left in them.
 *
 * - {@link testRunFolder}, in the temporary folder, for what the commands of
 *   the run share, such as Node's compile cache.
 * - {@link testRunSocketFolder}, in `XDG_RUNTIME_DIR` where there is one,
 *   for the folders that hold the sockets of each fixture's Nx. A socket's
 *   path has to stay short, which the temporary folder does not promise, and
 *   `XDG_RUNTIME_DIR` is short, such as `/run/user/1000`.
 */
export function startTestRun(): void {
  // The real path, as for the fixture copies.
  process.env[runFolderVariable] = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-test-run-")));
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime) {
    try {
      process.env[socketFolderVariable] = mkdtempSync(join(runtime, "nx-rust-"));
    } catch {
      // Not writable: Nx keeps the sockets in its own folder.
    }
  }
}

/** Removes the folders of {@link startTestRun}. */
export function endTestRun(): void {
  for (const variable of [runFolderVariable, socketFolderVariable]) {
    const folder = process.env[variable];
    if (folder) {
      rmSync(folder, { recursive: true, force: true });
    }
    delete process.env[variable];
  }
}

/** The folder of the current test run, if a global setup created one. */
export function testRunFolder(): string | undefined {
  return process.env[runFolderVariable] || undefined;
}

/** The folder for the socket folders of the current test run, if it has one. */
export function testRunSocketFolder(): string | undefined {
  return process.env[socketFolderVariable] || undefined;
}
