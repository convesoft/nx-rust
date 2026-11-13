import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

/**
 * Variables that the developer's shell must not pass to a test, because they
 * change which toolchain or which directories cargo uses. A test that needs
 * one sets it itself.
 */
const unsetVariables = [
  "RUSTUP_TOOLCHAIN",
  "CARGO_TARGET_DIR",
  "CARGO_BUILD_TARGET_DIR",
  "CARGO_BUILD_BUILD_DIR",
];

/** How long a test that runs Nx or cargo in a fixture may take. */
export const HARNESS_TIMEOUT = 120_000;

/**
 * The environment for an `nx` or `cargo` command that a test runs in a
 * fixture.
 *
 * It is the test process's environment without the `NX_` variables that the
 * Nx run of this repository sets for its own tasks, which would otherwise
 * point the inner Nx at this repository. The Nx daemon is off, so every
 * command computes the graph afresh, and rustup does not install a toolchain
 * that a fixture names: a missing toolchain fails the test instead.
 *
 * Where rustup is installed, its folder comes first on `PATH`. Nx runs this
 * repository's tests through `nx:run-commands`, which puts the folder of the
 * Node executable ahead of the inherited `PATH`; where that folder also holds
 * a cargo, as with a system Node and a system Rust, that cargo would shadow
 * rustup's proxies and ignore the fixtures' toolchain files.
 *
 * @param overrides Variables to set; `undefined` removes a variable.
 */
export function testEnvironment(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith("NX_") && !unsetVariables.includes(name)) {
      env[name] = value;
    }
  }
  const rustup = findExecutable("rustup", env.PATH ?? "");
  if (rustup) {
    const folder = resolve(rustup, "..");
    const rest = (env.PATH ?? "").split(delimiter).filter((entry) => resolve(entry) !== folder);
    env.PATH = [folder, ...rest].join(delimiter);
  }
  env.NX_DAEMON = "false";
  env.RUSTUP_AUTO_INSTALL = "0";
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }
  return env;
}

/**
 * The first executable called `name` in the folders of `path`.
 *
 * @param skip A folder to pass over.
 */
export function findExecutable(name: string, path: string, skip?: string): string | undefined {
  for (const folder of path.split(delimiter)) {
    if (folder === "" || (skip !== undefined && resolve(folder) === resolve(skip))) {
      continue;
    }
    const candidate = join(folder, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Not in this folder.
    }
  }
  return undefined;
}
