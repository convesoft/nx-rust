import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { testRunFolder } from "./test-run";

/**
 * Variables that the developer's shell must not pass to a test, because they
 * change which toolchain, which triples or which directories cargo uses. A
 * test that needs one sets it itself.
 */
const unsetVariables = [
  "RUSTUP_TOOLCHAIN",
  "CARGO_BUILD_TARGET",
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
 * `DISABLE_V8_COMPILE_CACHE` turns off v8-compile-cache-lib, through which
 * ts-node loads TypeScript. Nx registers ts-node's ESM loader in each task
 * process that loads the plugin from source, and the library keeps one cache
 * file per workspace root in the temporary folder, which every task of a run
 * reads at start and rewrites in place, without a lock for readers. A task
 * that reads it while another writes it hands V8 a torn cache, and V8 aborts
 * the task's process (`Check failed: current == end_slot_index.`). The cache
 * files of the fixtures' random folders were also never removed.
 *
 * `NX_USE_LOCAL` keeps an Nx daemon from installing `nx@latest`. Outside CI,
 * a daemon that starts asks the latest Nx whether to offer Nx Console and
 * whether the workspace's AI agent configuration is outdated, and for that
 * installs it from the npm registry into `~/.nx/tmp`, about 73 MB for each
 * daemon. It removes the installation when it stops, but not one that is
 * still in progress. With the variable, the installed Nx answers both
 * questions; it also makes `nx migrate`, `nx init` and
 * `nx configure-ai-agents` run the installed Nx, which no test runs. `CI`
 * would stop the download too, but changes more, such as whether `nx run`
 * applies sync generators and whether pnpm requires a lockfile.
 *
 * Nx keeps two caches in `/tmp/.nx/<uid>`, whatever `TMPDIR` says, and on
 * some machines `/tmp` is memory. One holds a copy of its native binary per
 * Nx version and installation; Nx here loads the binary from where it is
 * installed instead. The other is Node's compile cache, whose entries are
 * keyed by file path, so that every fixture with a copy of Nx would add
 * entries for all of Nx's modules. Node keeps it in the folder of the test
 * run instead (`startTestRun`), whatever `NODE_COMPILE_CACHE` said, and
 * without one it is off.
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
  env.NX_USE_LOCAL = "true";
  env.RUSTUP_AUTO_INSTALL = "0";
  env.DISABLE_V8_COMPILE_CACHE = "1";
  env.NX_SKIP_NATIVE_FILE_CACHE = "true";
  const run = testRunFolder();
  if (run !== undefined) {
    env.NODE_COMPILE_CACHE = join(run, "compile-cache");
  } else {
    delete env.NODE_COMPILE_CACHE;
    env.NX_COMPILE_CACHE = "false";
  }
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
