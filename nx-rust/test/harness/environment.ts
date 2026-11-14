import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { testRunFolder } from "./test-run";

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

/**
 * Variables that tell a command an AI agent runs it: those that `isAiAgent()`
 * in the native code of Nx 24.0.6 reads, of which Cursor's two count only
 * together with `PAGER`, and `AI_AGENT`, which agents such as Claude Code set
 * for any tool and which Nx 24 does not read.
 */
export const agentVariables = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CODEX_THREAD_ID",
  "COMPOSER_NO_INTERACTION",
  "COPILOT_CLI",
  "CURSOR_TRACE_ID",
  "GEMINI_CLI",
  "OPENCODE",
  "REPL_ID",
  "SUPERSET_AGENT_ID",
  "VSCODE_AGENT",
];

/**
 * Variables that turn colours on or off. Nx gives its tasks `FORCE_COLOR`,
 * `true` where it is unset, the tests of this repository among them; with an
 * inherited `NO_COLOR` beside it, as some agents' sessions have, every Node
 * process warns that `NO_COLOR` is ignored, in lines that `withoutColours`
 * leaves in the output.
 */
const colourVariables = ["FORCE_COLOR", "NO_COLOR", "NODE_DISABLE_COLORS"];

/** The variables, besides those starting with `NX_`, that the commands do not inherit. */
const leftOut = new Set([
  ...unsetVariables,
  ...agentVariables,
  ...colourVariables,
  "GITHUB_ACTIONS",
]);

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
 * Nx sees neither an AI agent nor CI, wherever the tests run, so that a test
 * sees the same Nx in an agent's session, on a developer's machine and in
 * GitHub Actions. A test that needs either sets the variables itself, and
 * so does a test that needs other colours than Nx's default: the
 * {@link colourVariables} are left out as well. Nx then colours its output
 * in every command, because picocolors, which it uses, takes any `CI` as a
 * request for colours, `CI=false` too.
 *
 * - Nx has no setting that turns its agent detection off, so the
 *   {@link agentVariables} are left out. With an agent, `nx show` prints JSON
 *   without `--json`, and the output style that `nx run` takes by default is
 *   `summary`, which prints no task output.
 * - `CI=false` overrides every variable from which Nx, pnpm and npm conclude
 *   that they run in CI. In CI, Nx turns the daemon off unless `NX_DAEMON`
 *   is `true`, `nx run` applies no sync generators, a daemon asks no
 *   start-up questions, Nx warns about cache artifacts it has no record of,
 *   and its performance report suggests distributing tasks; pnpm requires a
 *   lockfile.
 * - `GITHUB_ACTIONS` is left out. With it, Nx wraps each task's output in a
 *   log group, which starts its `> nx run` line with `::group::` and a
 *   status icon, and appends its performance report to the job's summary
 *   page for every command: `NX_TASK_TARGET_PROJECT`, by which Nx tells a
 *   nested run, is among the `NX_` variables left out.
 *
 * `NX_USE_LOCAL` keeps an Nx daemon from installing `nx@latest`. Outside CI,
 * a daemon that starts asks the latest Nx whether to offer Nx Console and
 * whether the workspace's AI agent configuration is outdated, and for that
 * installs it from the npm registry into `~/.nx/tmp`, about 73 MB for each
 * daemon. It removes the installation when it stops, but not one that is
 * still in progress. With the variable, the installed Nx answers both
 * questions; it also makes `nx migrate`, `nx init` and
 * `nx configure-ai-agents` run the installed Nx, which no test runs.
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
    if (value !== undefined && !name.startsWith("NX_") && !leftOut.has(name)) {
      env[name] = value;
    }
  }
  env.CI = "false";
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
