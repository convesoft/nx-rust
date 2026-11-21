import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Env,
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  holdCargo,
  lockfileCalls,
  defaultToolchain,
  otherToolchain,
  pinnedToolchain,
  runNx,
  sortedCalls,
  taskCalls,
  testEnvironment,
  withoutColours,
  taskOutput,
  withoutRunner,
  workspaceArgs,
  workspaceTestSteps,
} from "./harness";
import {
  nxRunVariables,
  runDependentVariables,
  taskNameVariables,
} from "../src/executors/task-env";

// VER-BATCHING through real Nx runs with `--batch`, which hands the plugin's
// tasks to the batch implementation of DES-BATCH: until a strategy of
// DES-UNIFICATION lets crates share a command (nxr-8f9dz2), the executors do
// not set preferBatch, and every task of a batch forms a group of one crate,
// which runs the command that the task runs on its own. group-run.spec.ts
// covers groups of several crates.

/** How Nx marks a task that it restored from the cache, with or without copying outputs. */
const hit = String.raw`\[(?:local cache|existing outputs match the cache, left as is)\]`;

/** A port that nothing listens on now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" && address !== null ? address.port : 0),
      );
    });
  });
}

/** The tasks that Nx says it restored from the cache, sorted. */
const restoredTasks = (output: string) =>
  [...output.matchAll(new RegExp(String.raw`nx run (\S+)[^\n]*?${hit}`, "g"))]
    .map((match) => match[1])
    .sort();

/** The tasks that Nx lists as failed at the end of a run, sorted. */
function failedTasks(output: string): string[] {
  const list = /Failed tasks:\n\n((?:- \S+\n?)+)/.exec(output)?.[1] ?? "";
  return [...list.matchAll(/^- (\S+)$/gm)].map((match) => match[1]).sort();
}

/** What Nx printed for one task, which the test expects it to print. */
function taskBlock(output: string, task: string): string {
  const block = taskOutput(output, task);
  if (block === "") {
    throw new Error(`Nx printed no block for ${task}:\n${output}`);
  }
  const end = block.search(/\n\s*NX\s+(Running|Successfully|Ran|Running target)/);
  return end === -1 ? block : block.slice(0, end);
}

/** Runs Nx after forgetting the logged cargo calls. */
async function nx(
  workspace: FixtureWorkspace,
  args: string[],
  env: Env = {},
): Promise<{ status: number | null; output: string }> {
  workspace.cargo.clear();
  return runNx(workspace, args, env);
}

/** The keys under which Nx's cache holds entries, sorted. */
function cacheEntries(workspace: FixtureWorkspace): string[] {
  const folder = join(workspace.root, ".nx", "cache");
  return existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => /^\d+$/.test(name))
        .sort()
    : [];
}

/** The task calls of cargo, as their arguments, in a stable order, the runner's paths left out. */
function calls(workspace: FixtureWorkspace): string[] {
  return sortedCalls(taskCalls(workspace)).map((call) => withoutRunner(call.args.join(" ")));
}

/** The check of the whole workspace that a group of check tasks shares. */
const checkAll = workspaceArgs("check").join(" ");

const crates = ["base", "breakable", "dep", "devuser", "indep", "scripted", "user"];

/** batch-groups' crate breakable no longer compiles. */
const brokenLibrary: FileChanges = {
  "rust/crates/breakable/src/lib.rs": "pub fn breakable() -> u32 {\n    not_defined_anywhere\n}\n",
};

describe("a batch of the plugin's tasks", () => {
  it(
    "runs the tasks of each target in shared cargo commands without --batch, one check and three test steps, each task with its own status and output; run on its own, each task runs its group's steps itself",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups");
      try {
        // A fresh copy: nothing is stored yet, and this run stores every task.
        const batched = await nx(workspace, ["run-many", "-t", "check", "test"]);
        expect(batched.status).toBe(0);
        expect(batched.output).toMatch(/Running 14 tasks with @convesoft\/nx-rust:cargo\b/);
        expect(calls(workspace)).toEqual([checkAll, ...workspaceTestSteps()].sort());
        for (const crate of crates) {
          // Each task's output holds its own crate's part of the command.
          const check = taskBlock(batched.output, `${crate}:check`);
          // A crate with a build script compiles it first: cargo says Compiling.
          expect(check).toMatch(new RegExp(`(Checking|Compiling) ${crate} v0\\.1\\.0`));
          expect(check).toMatch(/Finished `dev` profile/);
          for (const other of crates.filter((other) => other !== crate)) {
            expect(check).not.toMatch(new RegExp(`(Checking|Compiling) ${other} v`));
          }
          expect(taskBlock(batched.output, `${crate}:test`)).toMatch(/test result: ok\./);
        }
        expect(taskBlock(batched.output, "dep:test")).toMatch(/dep_is_two \.\.\. ok/);
        expect(taskBlock(batched.output, "base:test")).not.toMatch(/dep_is_two/);
        expect(taskBlock(batched.output, "base:test")).toMatch(/Doc-tests base/);
        expect(taskBlock(batched.output, "dep:test")).not.toMatch(/Doc-tests base/);

        // A second run restores every task without a cargo call.
        const again = await nx(workspace, ["run-many", "-t", "check", "test"]);
        expect(again.status).toBe(0);
        expect(restoredTasks(again.output)).toEqual(
          crates.flatMap((crate) => [`${crate}:check`, `${crate}:test`]).sort(),
        );
        expect(taskCalls(workspace)).toEqual([]);

        // With --batch=false, each task runs the steps of its group itself,
        // which select the whole workspace as well.
        const alone = await nx(workspace, [
          "run-many",
          "-t",
          "check",
          "test",
          "--skip-nx-cache",
          "--batch=false",
        ]);
        expect(alone.status).toBe(0);
        expect(alone.output).not.toMatch(/Running \d+ tasks with @convesoft\/nx-rust/);
        const ran = calls(workspace);
        expect(ran.filter((call) => call === checkAll)).toHaveLength(crates.length);
        expect(ran.filter((call) => call === workspaceTestSteps()[0])).toHaveLength(crates.length);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "prints one line for each cargo command that it starts in a static run, which belongs to no task and is never stored or replayed",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups");
      try {
        const run = await nx(workspace, ["run-many", "-t", "check", "-p", "base", "indep"]);
        expect(run.status).toBe(0);
        const status = run.output
          .split("\n")
          .filter((line) => line.startsWith("@convesoft/nx-rust: cargo"));
        expect(status).toEqual(["@convesoft/nx-rust: cargo check for base, indep (step 1 of 1)"]);
        // No task's stored output holds it, and a run from the cache shows none.
        const outputs = join(workspace.root, ".nx", "cache", "terminalOutputs");
        const stored = readdirSync(outputs).map((file) =>
          readFileSync(join(outputs, file), "utf8"),
        );
        expect(stored.length).toBeGreaterThan(0);
        expect(stored.join("\n")).not.toContain("@convesoft/nx-rust: cargo");
        const again = await nx(workspace, [
          "run-many",
          "-t",
          "check",
          "-p",
          "base",
          "indep",
          "--batch",
        ]);
        expect(again.status).toBe(0);
        expect(again.output).not.toContain("@convesoft/nx-rust: cargo");
        expect(taskBlock(again.output, "base:check")).toMatch(/Checking base v0\.1\.0/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stores each task under the key it has without a batch: Nx's hasher gives both runs the same keys, a second run restores every task without a cargo call, and either run restores what the other stored",
    async () => {
      const targets = ["run-many", "-t", "check", "test", "build", "doc"];
      const tasks = [
        ...crates.flatMap((crate) => [`${crate}:build`, `${crate}:check`, `${crate}:test`]),
        "rust:doc",
      ].sort();
      const batched = FixtureWorkspace.create("batch-groups");
      const unbatched = FixtureWorkspace.create("batch-groups");
      try {
        const first = await nx(batched, [...targets, "--batch"]);
        expect(first.status).toBe(0);
        expect(first.output).toMatch(/Running 8 tasks with @convesoft\/nx-rust:cargo-outputs/);
        const keys = cacheEntries(batched);
        expect(keys).toHaveLength(tasks.length);

        const again = await nx(batched, [...targets, "--batch"]);
        expect(again.status).toBe(0);
        expect(restoredTasks(again.output)).toEqual(tasks);
        expect(taskCalls(batched)).toEqual([]);
        expect(lockfileCalls(batched)).toHaveLength(1);

        const without = await nx(batched, [...targets, "--batch=false"]);
        expect(without.status).toBe(0);
        expect(restoredTasks(without.output)).toEqual(tasks);
        expect(taskCalls(batched)).toEqual([]);

        // The same tasks run without a batch in a copy with an empty cache:
        // Nx's own hasher gives them the keys that the batched run stored.
        const plain = await nx(unbatched, [...targets, "--batch=false"]);
        expect(plain.status).toBe(0);
        expect(cacheEntries(unbatched)).toEqual(keys);
        const restored = await nx(unbatched, [...targets, "--batch"]);
        expect(restored.status).toBe(0);
        expect(restoredTasks(restored.output)).toEqual(tasks);
        expect(taskCalls(unbatched)).toEqual([]);
      } finally {
        batched.remove();
        unbatched.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails only the task of the crate whose test fails",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", {
        "rust/crates/indep/tests/it.rs":
          '#[test]\nfn indep_is_three() {\n    assert_eq!(indep::indep(), 4, "indep is not four");\n}\n',
      });
      try {
        const run = await nx(workspace, ["run-many", "-t", "test"]);
        expect(run.status).toBe(1);
        expect(failedTasks(run.output)).toEqual(["indep:test"]);
        expect(taskBlock(run.output, "indep:test")).toMatch(/indep is not four/);
        expect(taskBlock(run.output, "base:test")).not.toMatch(/indep is not four/);
        // Nx stored the others, and runs only the failed one again, in a group
        // that builds the whole workspace; once its test binaries have
        // failed, its doctest step is left out.
        const again = await nx(workspace, ["run-many", "-t", "test"]);
        expect(restoredTasks(again.output)).toEqual(
          crates.filter((crate) => crate !== "indep").map((crate) => `${crate}:test`),
        );
        expect(calls(workspace)).toEqual(workspaceTestSteps().slice(0, 2).sort());
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails in check and test the tasks of a crate that does not compile, of one whose build script fails and of those that need them, and the others still succeed",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", brokenLibrary, {
        "rust/crates/scripted/build.rs":
          'fn main() {\n    panic!("the build script of scripted fails");\n}\n',
      });
      try {
        const run = await nx(workspace, ["run-many", "-t", "check", "test"]);
        expect(run.status).toBe(1);
        // check keeps going after an error: only the failed crates and those
        // that need them fail. The test build stops at a compile error, so
        // every test task of the group fails (DES-BATCH, "Test runs").
        expect(failedTasks(run.output)).toEqual(
          [
            "breakable:check",
            "devuser:check",
            "scripted:check",
            "user:check",
            ...crates.map((crate) => `${crate}:test`),
          ].sort(),
        );
        expect(taskBlock(run.output, "breakable:check")).toMatch(/not_defined_anywhere/);
        expect(taskBlock(run.output, "user:check")).toMatch(/cargo reported `breakable`/);
        expect(taskBlock(run.output, "scripted:check")).toMatch(
          /the build script of scripted fails/,
        );
        const indep = taskBlock(run.output, "indep:test");
        expect(indep).toContain(
          "indep:test: the tests of indep were not run: cargo test --no-run stopped before running any test, because ",
        );
        // In the order in which cargo reported them.
        expect(indep).toMatch(
          /because (`breakable` and `scripted`|`scripted` and `breakable`) did not compile/,
        );
        expect(taskBlock(run.output, "base:check")).not.toMatch(/not_defined_anywhere/);
        // Nothing of the step is stored: a second run runs every test task again.
        const again = await nx(workspace, ["run-many", "-t", "test"]);
        expect(restoredTasks(again.output)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs each cargo command with the environment of its task: RUSTFLAGS in one crate's .env reaches that crate's group and no other, and each group builds the whole workspace",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", {
        "rust/crates/indep/.env": "RUSTFLAGS=--cfg nx_rust_flag\n",
        "rust/crates/indep/src/lib.rs":
          '#[cfg(not(nx_rust_flag))]\ncompile_error!("indep needs the RUSTFLAGS of its .env");\n\npub fn indep() -> u32 {\n    3\n}\n',
        "rust/crates/base/src/lib.rs":
          '#[cfg(nx_rust_flag)]\ncompile_error!("base got the RUSTFLAGS of indep");\n\npub fn base() -> u32 {\n    1\n}\n',
      });
      try {
        const run = await nx(workspace, ["run-many", "-t", "check", "-p", "base", "indep"]);
        expect(run.status).toBe(0);
        // Two groups, one with indep's RUSTFLAGS, each checking the whole
        // workspace: there the crate that needs the other environment fails
        // outside the selection, which is a warning.
        expect(calls(workspace)).toEqual([checkAll, checkAll]);
        expect(taskBlock(run.output, "base:check")).toMatch(
          /cargo reported `indep` as failed\. `indep` is outside the selection of this run/,
        );
        expect(taskBlock(run.output, "indep:check")).toMatch(
          /cargo reported `base` as failed\. `base` is outside the selection of this run/,
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/** The size of the terminal of the ways of running that open Nx's terminal UI. */
const terminalSize = { columns: 120, rows: 35 };

/**
 * The ways of running a task that can change what Nx gives its process
 * (`EVD-NX-24-BATCHES`, "Task environment"), each run alone and with
 * `--batch`, and those marked `daemon` with the daemon as well. Nx starts a
 * single task in its pseudo-terminal only where the command runs in a
 * terminal, with the dynamic styles, the terminal UI or
 * `stream-without-prefixes`. {@link FixtureWorkspace.nxInTerminal} gives a
 * command a terminal through util-linux's `script`, which macOS lacks (its
 * own takes other arguments, and it has no `timeout`): the ways in a
 * terminal run on Linux only, which is where CI runs
 * (`RISK-TERMINAL-ENVIRONMENT-MACOS`). The ways that open Nx's terminal UI
 * give the terminal a `size`, without which Nx runs another output style.
 * On Nx 24.0.6 `--output-style=dynamic` in a terminal with a size opens the
 * terminal UI as `--tui` does, so these two ways differ in the flag and not
 * in the renderer.
 */
const waysOfRunning: {
  name: string;
  args: string[];
  terminal?: boolean;
  size?: { columns: number; rows: number };
  daemon?: boolean;
  env?: Env;
}[] = [
  { name: "static", args: ["--output-style=static"], daemon: true },
  { name: "stream", args: ["--output-style=stream"] },
  { name: "static with --verbose", args: ["--output-style=static", "--verbose"] },
  ...(process.platform === "linux"
    ? [
        { name: "static in a terminal", args: ["--output-style=static"], terminal: true },
        {
          name: "stream-without-prefixes in a terminal",
          args: ["--output-style=stream-without-prefixes"],
          terminal: true,
          daemon: true,
        },
        {
          name: "dynamic-legacy in a terminal",
          args: ["--output-style=dynamic-legacy"],
          terminal: true,
        },
        {
          name: "dynamic in a terminal",
          args: ["--output-style=dynamic", "--tui-auto-exit"],
          terminal: true,
          size: terminalSize,
        },
        {
          name: "the terminal UI",
          args: ["--tui", "--tui-auto-exit"],
          terminal: true,
          size: terminalSize,
          daemon: true,
          env: { NX_TUI: "true" },
        },
      ]
    : []),
];

/** Sets entries of a fixture copy's nx.json. */
function nxJsonWith(entries: object): (nxJson: string | undefined) => string {
  return (nxJson) => `${JSON.stringify({ ...JSON.parse(nxJson ?? "{}"), ...entries }, null, 2)}\n`;
}

// The variables that differ between any two nx commands, batched or not:
// the process ids of the nx command, the plugin's id of the command and the
// command's own arguments, which here differ in --batch.
const perCommand = ["NX_INVOCATION_ANCESTOR_PIDS", "NX_RUST_COMMAND_ID", "NX_RUST_NX_COMMAND"];

/**
 * An integration test and a build script of batch-groups' crate indep that
 * write their whole environment, which is cargo's with what cargo adds for
 * them.
 */
const environmentDumps: FileChanges = {
  "rust/crates/indep/tests/environment.rs":
    '#[test]\nfn dump_environment() {\n    let mut vars: Vec<String> = std::env::vars().map(|(k, v)| format!("{k}={v}")).collect();\n    vars.sort();\n    std::fs::write(concat!(env!("CARGO_TARGET_TMPDIR"), "/test-env.txt"), vars.join("\\0")).unwrap();\n}\n',
  "rust/crates/indep/build.rs":
    'fn main() {\n    println!("cargo::rerun-if-changed=always-missing");\n    let mut vars: Vec<String> = std::env::vars().map(|(k, v)| format!("{k}={v}")).collect();\n    vars.sort();\n    let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/tmp");\n    std::fs::create_dir_all(&target).unwrap();\n    std::fs::write(target.join("build-env.txt"), vars.join("\\0")).unwrap();\n}\n',
};

/** The environment that one of {@link environmentDumps} wrote, read and removed. */
function readDump(workspace: FixtureWorkspace, name: string): Record<string, string> {
  const file = join(workspace.root, "rust/target/tmp", name);
  const content = readFileSync(file, "utf8");
  rmSync(file);
  return Object.fromEntries(
    content
      .split("\0")
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

/**
 * Runs indep:test once for each way, alone and with `--batch`, each run
 * succeeding, and returns the environments that the test and the build script
 * wrote, by run. Every way runs with the `TERM` that
 * {@link FixtureWorkspace.nxInTerminal} gives a terminal, so that the tasks'
 * environments do not differ in it, and a way in a terminal opens Nx's
 * terminal UI exactly where it has a size.
 */
async function dumpsOfRuns(
  workspace: FixtureWorkspace,
  ways: typeof waysOfRunning,
  env: Env,
  label = "",
): Promise<Record<string, Record<string, string>>> {
  const dumps: Record<string, Record<string, string>> = {};
  for (const way of ways) {
    for (const batch of [false, true]) {
      const args = [
        ...(batch
          ? ["run-many", "-t", "test", "-p", "indep", "--batch"]
          : ["run", "indep:test", "--batch=false"]),
        "--skip-nx-cache",
        ...way.args,
      ];
      const name = `${way.name}${batch ? ", in a batch" : ""}${label}`;
      const wayEnv = { TERM: "xterm-256color", ...env, ...way.env };
      const run = way.terminal
        ? await workspace.nxInTerminal(args, wayEnv, undefined, way.size)
        : { ...(await workspace.nx(args, wayEnv)), terminalUi: false };
      const output = withoutColours(run.output);
      expect({
        name,
        status: run.status,
        output: run.status === 0 ? "" : output,
        terminalUi: run.terminalUi,
        fallback: output.includes("Nx Terminal UI was not enabled"),
      }).toEqual({
        name,
        status: 0,
        output: "",
        terminalUi: way.size !== undefined,
        fallback: false,
      });
      dumps[`${name}: test`] = readDump(workspace, "test-env.txt");
      dumps[`${name}: build script`] = readDump(workspace, "build-env.txt");
    }
  }
  return dumps;
}

/**
 * Expects every test's and every build script's environment of `dumps` to be
 * the first one's, apart from {@link perCommand}, and returns the first
 * test's.
 */
function expectOneEnvironment(
  dumps: Record<string, Record<string, string>>,
): Record<string, string> {
  const without = (dumped: Record<string, string>) =>
    Object.fromEntries(Object.entries(dumped).filter(([name]) => !perCommand.includes(name)));
  for (const kind of ["test", "build script"]) {
    const [first, ...others] = Object.entries(dumps).filter(([name]) => name.endsWith(`: ${kind}`));
    for (const [name, dumped] of others) {
      expect({ name, env: without(dumped) }).toEqual({ name, env: without(first[1]) });
    }
  }
  return dumps[Object.keys(dumps).find((name) => name.endsWith(": test")) as string];
}

/** The ways of {@link waysOfRunning} named, where they run. */
const ways = (...names: string[]) => waysOfRunning.filter((way) => names.includes(way.name));

describe("the environment of a task in a batch", () => {
  it(
    "is the environment that the task's cargo gets in every way of running the task, alone or in a batch, apart from what differs between any two nx commands",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", environmentDumps, {
        // Dotenv files that define a variable that Nx sets itself and refer
        // to one another, which the check lets through.
        "rust/crates/indep/.env": "NX_RUST_TEST_CRATE_DOTENV=crate\nFORCE_COLOR=1\n",
        ".env.test":
          "NX_RUST_TEST_TARGET_DOTENV=${NX_RUST_TEST_CRATE_DOTENV}-test\nNX_RUST_TEST_FROM_COMMAND=${NX_RUST_TEST_COMMAND_VALUE}\n",
        // No analytics prompt in a terminal; the daemon as each run sets it.
        "nx.json": nxJsonWith({ analytics: false, useDaemonProcess: false }),
      });
      // The daemon is chosen in nx.json, so that every command has the same
      // environment. The command also has variables that Nx removes from a
      // task, or leaves without a value, and that Nx's pseudo-terminal would
      // give back from the nx process: NX_SET_CLI, NX_ORIGINAL_FORCE_COLOR,
      // which Nx sets for FORCE_COLOR=0, and NX_TASK_TARGET_CONFIGURATION of a
      // task that ran the command.
      const env = {
        NX_DAEMON: undefined,
        NX_ISOLATE_PLUGINS: "true",
        NX_RUST_TEST_COMMAND_VALUE: "command",
        NX_SET_CLI: "from the command",
        FORCE_COLOR: "0",
        NX_TASK_TARGET_CONFIGURATION: "outer",
      };
      try {
        const dumps: Record<string, Record<string, string>> = {};
        for (const daemon of [false, true]) {
          const file = join(workspace.root, "nx.json");
          writeFileSync(file, nxJsonWith({ useDaemonProcess: daemon })(readFileSync(file, "utf8")));
          Object.assign(
            dumps,
            await dumpsOfRuns(
              workspace,
              waysOfRunning.filter((way) => !daemon || way.daemon),
              env,
              daemon ? ", with the daemon" : "",
            ),
          );
          await workspace.nx(["daemon", "--stop"], env);
        }
        const first = expectOneEnvironment(dumps);
        // Nx's per-task layer, but for the variables that name the task's
        // project, and the task's dotenv files are there.
        expect(first).toMatchObject({
          NX_TASK_TARGET_TARGET: "test",
          NX_TUI: "false",
          NX_FORKED_TASK_EXECUTOR: "true",
          NX_CLI_SET: "true",
          NX_RUST_TEST_CRATE_DOTENV: "crate",
          NX_RUST_TEST_TARGET_DOTENV: "crate-test",
          NX_RUST_TEST_FROM_COMMAND: "command",
        });
        // What tells a task how Nx runs and records it is in none, nor what
        // the pseudo-terminal would give back.
        for (const name of [
          ...nxRunVariables,
          ...taskNameVariables,
          "NX_TASK_TARGET_CONFIGURATION",
        ]) {
          expect({ name, value: first[name] }).toEqual({ name, value: undefined });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 5,
  );

  it(
    "is the same alone and in a batch where the root .env holds Nx's own settings, with Nx loading the task's dotenv files and without",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", environmentDumps, {
        // Settings that Nx documents for the root .env, which the nx process
        // loads when it starts, beside a variable of the repository's own.
        ".env":
          "NX_DAEMON=false\nNX_VERBOSE_LOGGING=true\nNX_PARALLEL=3\nNX_SKIP_NX_CACHE=true\nNX_NO_CLOUD=true\nNX_TUI=false\nNX_RUST_TEST_ROOT_DOTENV=root\n",
        "rust/crates/indep/.env.test":
          "NX_RUST_TEST_TASK_DOTENV=${NX_RUST_TEST_ROOT_DOTENV}-task\n",
        "nx.json": nxJsonWith({ analytics: false }),
      });
      try {
        const chosen = ways("static", "stream-without-prefixes in a terminal");
        const loaded = expectOneEnvironment(await dumpsOfRuns(workspace, chosen, {}));
        expect(loaded).toMatchObject({
          NX_DAEMON: "false",
          NX_PARALLEL: "3",
          NX_SKIP_NX_CACHE: "true",
          NX_NO_CLOUD: "true",
          NX_RUST_TEST_ROOT_DOTENV: "root",
          NX_RUST_TEST_TASK_DOTENV: "root-task",
        });
        // Without the task's dotenv files, Nx removes the root .env's values
        // from the task and loads none back; a task in a terminal would get
        // them back from the nx process.
        const unloaded = expectOneEnvironment(
          await dumpsOfRuns(workspace, chosen, { NX_LOAD_DOT_ENV_FILES: "false" }, ", unloaded"),
        );
        for (const name of [
          "NX_RUST_TEST_ROOT_DOTENV",
          "NX_RUST_TEST_TASK_DOTENV",
          "NX_PARALLEL",
        ]) {
          expect({ name, value: unloaded[name] }).toEqual({ name, value: undefined });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );

  it(
    "gets NX_FORKED_TASK_EXECUTOR and NX_CLI_SET from Nx, alone and in a batch, where the root .env and the task's .env.test define them",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", environmentDumps, {
        ".env": "NX_FORKED_TASK_EXECUTOR=true\nNX_CLI_SET=true\n",
        "rust/crates/indep/.env.test": "NX_FORKED_TASK_EXECUTOR=false\nNX_CLI_SET=false\n",
      });
      try {
        const first = expectOneEnvironment(await dumpsOfRuns(workspace, ways("static"), {}));
        expect(first).toMatchObject({ NX_FORKED_TASK_EXECUTOR: "true", NX_CLI_SET: "true" });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "runs a task whose .env.test refers to one variable fourteen times, alone and in a batch",
    async () => {
      const origins = Array.from({ length: 14 }, (_, port) => `http://\${HOST}:80${10 + port}`);
      const workspace = FixtureWorkspace.create("batch-groups", environmentDumps, {
        "rust/crates/indep/.env.test": `HOST=localhost\nORIGINS=${origins.join(",")}\n`,
      });
      try {
        const first = expectOneEnvironment(await dumpsOfRuns(workspace, ways("static"), {}));
        expect(first.ORIGINS).toBe(origins.join(",").split("${HOST}").join("localhost"));
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "is refused to a task whose dotenv file defines NX_LOAD_DOT_ENV_FILES, which fails before cargo runs, alone as in a batch",
    async () => {
      // The reviewer's files: the root .env's value, which Nx removes from the
      // task's environment, and the task's file, which then gives its own.
      const reviewed: FileChanges = {
        ".env": "NX_LOAD_DOT_ENV_FILES=true\n",
        "rust/crates/indep/.env.test":
          "NX_LOAD_DOT_ENV_FILES=false\nREVIEW_COLOR=${FORCE_COLOR-unset}\n",
      };
      const workspace = FixtureWorkspace.create("batch-groups", reviewed);
      const runs = [
        ["run", "indep:test", "--skip-nx-cache"],
        ["run-many", "-t", "test", "-p", "indep", "--batch", "--skip-nx-cache"],
      ];
      try {
        // The workspace's lockfile task, which the test depends on, loads the
        // root .env too, and fails first.
        for (const args of runs) {
          const run = await nx(workspace, args);
          expect({ args, status: run.status }).toEqual({ args, status: 1 });
          expect(run.output).toContain(
            "rust:lockfile: .env defines NX_LOAD_DOT_ENV_FILES, which decides in the nx process whether Nx loads the task's dotenv files at all",
          );
          expect(calls(workspace)).toEqual([]);
        }
        workspace.reset({ "rust/crates/indep/.env.test": reviewed["rust/crates/indep/.env.test"] });
        // Also with loading switched off in the command, as the message says.
        for (const [args, env] of [
          ...runs.map((args) => [args, {}] as const),
          [runs[0], { NX_LOAD_DOT_ENV_FILES: "false" }] as const,
        ]) {
          const run = await nx(workspace, [...args], env);
          expect({ args, status: run.status }).toEqual({ args, status: 1 });
          expect(run.output).toContain(
            "indep:test: rust/crates/indep/.env.test defines NX_LOAD_DOT_ENV_FILES, which decides in the nx process whether Nx loads the task's dotenv files at all",
          );
          expect(run.output).toContain(
            "Remove the definition of NX_LOAD_DOT_ENV_FILES from rust/crates/indep/.env.test; to switch the loading of dotenv files off, set NX_LOAD_DOT_ENV_FILES=false in the environment of the nx command, in the shell or the CI settings.",
          );
          expect(calls(workspace)).toEqual([]);
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "is refused to a task where dotenv would read a root vault without a plain dotenv file, alone, in a terminal and in a batch",
    async () => {
      // The reviewer's vault, which decrypts with the key to REVIEW_VAULT=secret.
      const workspace = FixtureWorkspace.create("batch-groups", {
        ".env.vault":
          "DOTENV_VAULT_TEST=AwMDAwMDAwMDAwMDd7v1Sh9/ARQ7FQ8I1iSab59ZlOWMBKuvFAC/hi8OKy8QioBd\n",
        "nx.json": nxJsonWith({ analytics: false }),
      });
      const env = {
        REVIEW_VAULT: "secret",
        DOTENV_KEY:
          "dotenv://:0707070707070707070707070707070707070707070707070707070707070707@dotenvx.com/.env.vault?environment=test",
      };
      try {
        const runs: [string, boolean, string[]][] = [
          ["alone", false, ["run", "indep:test", "--skip-nx-cache", "--output-style=static"]],
          ...(process.platform === "linux"
            ? [
                [
                  "in a terminal",
                  true,
                  [
                    "run",
                    "indep:test",
                    "--skip-nx-cache",
                    "--output-style=stream-without-prefixes",
                  ],
                ] as [string, boolean, string[]],
              ]
            : []),
          [
            "in a batch",
            false,
            ["run-many", "-t", "test", "-p", "indep", "--batch", "--skip-nx-cache"],
          ],
        ];
        for (const [name, terminal, args] of runs) {
          workspace.cargo.clear();
          const run = terminal
            ? await workspace.nxInTerminal(args, env)
            : await workspace.nx(args, env);
          expect({ name, status: run.status }).toEqual({ name, status: 1 });
          expect(withoutColours(run.output)).toContain("DOTENV_KEY is set and .env.vault exists");
          expect(calls(workspace)).toEqual([]);
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "runs a task whose .env.test lists 257 references to a variable of the command, alone and in a batch",
    async () => {
      const list = Array.from({ length: 257 }, (_, port) => `http://\${HOST}:${8000 + port}`);
      const workspace = FixtureWorkspace.create("batch-groups", environmentDumps, {
        "rust/crates/indep/.env.test": `ORIGINS=${list.join(",")}\n`,
      });
      try {
        const first = expectOneEnvironment(
          await dumpsOfRuns(workspace, ways("static"), { HOST: "localhost" }),
        );
        expect(first.ORIGINS).toBe(list.join(",").split("${HOST}").join("localhost"));
        expect(first.ORIGINS).toHaveLength(5653);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "gives a task the same environment alone and in a batch where a root .env.local defines NX_ORIGINAL_FORCE_COLOR through a variable of the command that refers to itself",
    async () => {
      // Alone, the nx process has NX_ORIGINAL_FORCE_COLOR=0 from FORCE_COLOR=0
      // and does not expand the file's value; the batch process lacks it, and
      // without the batch's own value its expansion would grow without end.
      const workspace = FixtureWorkspace.create("batch-groups", environmentDumps, {
        ".env.local": "NX_ORIGINAL_FORCE_COLOR=${CMD}z\n",
        "nx.json": nxJsonWith({ analytics: false }),
      });
      try {
        const first = expectOneEnvironment(
          await dumpsOfRuns(workspace, ways("static", "stream-without-prefixes in a terminal"), {
            FORCE_COLOR: "0",
            CMD: "x${CMD}",
          }),
        );
        expect(first.CMD).toBe("x${CMD}");
        expect(first.NX_ORIGINAL_FORCE_COLOR).toBeUndefined();
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it.each([
    ["FORCE_COLOR", "REVIEW_COLOR=${FORCE_COLOR-unset}", "REVIEW_COLOR"],
    ["NX_FORKED_TASK_EXECUTOR", "REVIEW_FORKED=${NX_FORKED_TASK_EXECUTOR:-no}", "REVIEW_FORKED"],
  ])(
    "is refused to a task whose dotenv file makes Nx look up %s, which fails before cargo runs, alone as in a batch",
    async (name, line, variable) => {
      const workspace = FixtureWorkspace.create("batch-groups", {
        "rust/crates/indep/.env.test": `${line}\n`,
      });
      try {
        const message = `indep:test: rust/crates/indep/.env.test makes Nx look up ${name} where it expands ${variable}, and ${name} has a value there that depends on how the task runs: ${runDependentVariables[name]}.`;
        const alone = await nx(workspace, ["run", "indep:test", "--skip-nx-cache"]);
        expect(alone.status).toBe(1);
        expect(alone.output).toContain(message);
        expect(calls(workspace)).toEqual([]);
        const batched = await nx(workspace, [
          "run-many",
          "-t",
          "test",
          "-p",
          "indep",
          "--batch",
          "--skip-nx-cache",
        ]);
        expect(batched.status).toBe(1);
        expect(batched.output).toContain(message);
        expect(calls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs a task that depends on a continuous task in the batch, unless it waits for one that reports ready by signal, which Nx tells only a task run on its own",
    async () => {
      const port = await freePort();
      const target = (name: string, readyWhen?: object) => ({
        executor: "nx:run-commands",
        options: { command: `node svc/server.js ${name} ${port}` },
        continuous: true,
        ...(readyWhen === undefined ? {} : { readyWhen }),
      });
      const workspace = FixtureWorkspace.create("batch-groups", {
        "svc/project.json": JSON.stringify({
          name: "svc",
          targets: {
            serve: target("plain"),
            "serve-port": target("port", { port }),
            "serve-signal": target("signal", { signal: true }),
          },
        }),
        "svc/server.js": [
          'const http = require("node:http");',
          "const [kind, port] = process.argv.slice(2);",
          "const server = http.createServer((_, response) => response.end());",
          'server.listen(kind === "port" ? Number(port) : 0, "127.0.0.1", () => {',
          '  if (kind === "signal") require("nx/src/devkit-exports.js").emitReadySignal(server);',
          "});",
          "",
        ].join("\n"),
        "rust/crates/indep/tests/ready.rs":
          '#[test]\nfn writes_the_ready_url() {\n    let url = std::env::var("NX_READY_URL").unwrap_or_else(|_| "<unset>".into());\n    std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/ready-url.txt"), url).unwrap();\n}\n',
      });
      const waitFor = (producer: string, ready: boolean) =>
        JSON.stringify({
          targets: {
            test: {
              dependsOn: [
                { projects: ["directory:rust"], target: "lockfile" },
                { projects: ["svc"], target: producer, ...(ready ? { waitFor: "ready" } : {}) },
              ],
            },
          },
        });
      const readyUrl = () =>
        readFileSync(join(workspace.root, "rust", "crates", "indep", "ready-url.txt"), "utf8");
      try {
        for (const [producer, ready] of [
          ["serve", false],
          ["serve-port", true],
        ] as const) {
          writeFileSync(
            join(workspace.root, "rust", "crates", "indep", "project.json"),
            waitFor(producer, ready),
          );
          const run = await nx(workspace, [
            "run-many",
            "-t",
            "test",
            "-p",
            "indep",
            "--batch",
            "--skip-nx-cache",
          ]);
          expect({ producer, status: run.status }).toEqual({ producer, status: 0 });
          expect(run.output).toMatch(
            /Running 1 task with @convesoft\/nx-rust:cargo|nx-rust: cargo test for indep/,
          );
          expect(readyUrl()).toBe("<unset>");
        }
        writeFileSync(
          join(workspace.root, "rust", "crates", "indep", "project.json"),
          waitFor("serve-signal", true),
        );
        const refused = await nx(workspace, [
          "run-many",
          "-t",
          "test",
          "-p",
          "indep",
          "--batch",
          "--skip-nx-cache",
        ]);
        expect(refused.status).toBe(1);
        expect(refused.output).toContain(
          'indep:test: this task waits for svc:serve-signal to be ready, and that continuous task reports ready by signal (readyWhen: { "signal": true }), so Nx gives the task NX_READY_URL when it runs on its own, which a batch cannot give it.',
        );
        expect(refused.output).toContain("set NX_BATCH_MODE=false in the root .env");
        expect(calls(workspace).filter((call) => call.startsWith("test "))).toEqual([]);
        // On its own it runs, with the URL.
        const alone = await nx(workspace, [
          "run-many",
          "-t",
          "test",
          "-p",
          "indep",
          "--batch=false",
          "--skip-nx-cache",
        ]);
        expect(alone.status).toBe(0);
        expect(readyUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

// A crate's .env chooses another installed toolchain than rustup's default,
// whatever the default is: 1.91.0 beside a default stable, or stable where
// the tests run with 1.91.0 as the default.
const chosenToolchain = otherToolchain();
const fallbackToolchain = defaultToolchain();
if (chosenToolchain !== undefined && fallbackToolchain !== undefined) {
  describe("a batch with another toolchain", () => {
    it(
      `runs a crate whose .env sets RUSTUP_TOOLCHAIN with that toolchain, ${chosenToolchain}, and the others with rustup's default, ${fallbackToolchain}`,
      async () => {
        // A unit test that checks the toolchain that compiled it, which
        // rustup gives the compiler as RUSTUP_TOOLCHAIN, by its full name.
        const toolchain = (check: string) =>
          `\n#[cfg(test)]\nmod toolchain {\n    #[test]\n    fn toolchain() {\n        let toolchain = option_env!("RUSTUP_TOOLCHAIN").unwrap_or_default();\n        assert!(${check}, "{toolchain}");\n    }\n}\n`;
        const workspace = FixtureWorkspace.create("batch-groups", {
          "rust/crates/dep/.env": `RUSTUP_TOOLCHAIN=${chosenToolchain}\n`,
          "rust/crates/dep/src/lib.rs": (source) =>
            `${source}${toolchain(`toolchain.starts_with("${chosenToolchain}-")`)}`,
          "rust/crates/indep/src/lib.rs": (source) =>
            `${source}${toolchain(`toolchain == "${fallbackToolchain}"`)}`,
        });
        try {
          const run = await nx(workspace, [
            "run-many",
            "-t",
            "test",
            "-p",
            "dep",
            "indep",
            "--batch",
          ]);
          expect(taskBlock(run.output, "dep:test")).toMatch(/toolchain::toolchain \.\.\. ok/);
          expect(taskBlock(run.output, "indep:test")).toMatch(/toolchain::toolchain \.\.\. ok/);
          expect(run.status).toBe(0);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });
} else {
  it.todo(
    `a batch with another toolchain: install a toolchain besides rustup's default, ${pinnedToolchain} or stable, to check that a crate's .env chooses it`,
  );
}

// binary-tests: every binary prints "plain" as cargo build writes it, and
// "extra" as cargo test rewrites it in the crates whose test waits for their
// build (DES-TARGETS); gated's binary needs a feature that no run turns on.
const binaries = ["app", "benched", "harnessless", "showcase", "timed", "unit", "untested"];

/** Runs cargo in binary-tests' Cargo workspace, with nothing logged. */
function cargo(workspace: FixtureWorkspace, ...args: string[]): void {
  execFileSync("cargo", args, {
    cwd: join(workspace.root, "rust"),
    env: testEnvironment(),
    stdio: "pipe",
  });
}

/** What each binary in the artifact directory prints, by name; absent ones left out. */
function printed(workspace: FixtureWorkspace): Record<string, string> {
  return Object.fromEntries(
    binaries.flatMap((name) => {
      const file = join(workspace.root, "rust", "target", "debug", name);
      return existsSync(file) ? [[name, execFileSync(file, { encoding: "utf8" }).trim()]] : [];
    }),
  );
}

/** The crates of binary-tests whose executables a whole-workspace cargo test replaces. */
const waitedBuilds = ["app", "benched", "gated", "harnessless"];

describe("the two batch executors", () => {
  it.each<[string, string[]]>([
    ["off", ["--batch=false"]],
    ["on", []],
  ])(
    "order every test after the builds whose executables its whole-workspace cargo test replaces, with batching %s, so that every stored build holds what cargo build writes",
    async (_case, flags) => {
      const workspace = FixtureWorkspace.create("binary-tests");
      // Plain cargo warms the build directory for both kinds of executable.
      cargo(workspace, "build", "--workspace");
      cargo(workspace, "test", "--workspace", "--no-run");
      const hold = holdCargo("test");
      try {
        const run = nx(workspace, ["run-many", "-t", "build", "test", ...flags], hold.env);
        await hold.held();
        // No test starts before every build that it waits for is stored.
        const whileHeld = cacheEntries(workspace);
        hold.release();
        const { status } = await run;
        expect(status).toBe(0);
        expect(whileHeld.length).toBeGreaterThanOrEqual(waitedBuilds.length);
        // The artifact directory holds what cargo test wrote last.
        expect(printed(workspace).app).toBe("extra");
        // Each build entry restores the executable of cargo build.
        for (const name of binaries) {
          rmSync(join(workspace.root, "rust", "target", "debug", name), { force: true });
        }
        const restored = await nx(workspace, ["run-many", "-t", "build", ...flags]);
        expect(restored.status).toBe(0);
        expect(taskCalls(workspace)).toEqual([]);
        expect(printed(workspace)).toEqual(
          Object.fromEntries(binaries.map((name) => [name, "plain"])),
        );
      } finally {
        hold.release();
        hold.remove();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "run build and doc in batches of their own, and every stored build holds what cargo build writes after a run that also ran the tests",
    async () => {
      const workspace = FixtureWorkspace.create("binary-tests");
      try {
        const run = await nx(workspace, ["run-many", "-t", "build", "test", "--batch"]);
        expect(run.status).toBe(0);
        expect(run.output).toMatch(/Running 11 tasks with @convesoft\/nx-rust:cargo-outputs/);
        expect(run.output).toMatch(/Running \d+ tasks with @convesoft\/nx-rust:cargo\b/);
        expect(run.output).toMatch(/test runs_the_executable_that_cargo_test_built \.\.\. ok/);
        // The artifact directory holds what cargo test wrote last, as plain
        // cargo build and then cargo test leave it.
        expect(printed(workspace).app).toBe("extra");

        for (const name of binaries) {
          rmSync(join(workspace.root, "rust", "target", "debug", name), { force: true });
        }
        const restored = await nx(workspace, ["run-many", "-t", "build", "--batch"]);
        expect(restored.status).toBe(0);
        expect(taskCalls(workspace)).toEqual([]);
        expect(printed(workspace)).toEqual(
          Object.fromEntries(binaries.map((name) => [name, "plain"])),
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, string[]]>([
    ["build test", ["-t", "build", "test"]],
    ["build test --parallel=1", ["-t", "build", "test", "--parallel=1"]],
    ["test build", ["-t", "test", "build"]],
    ["test", ["-t", "test"]],
    [
      "build test --exclude-task-dependencies",
      ["-t", "build", "test", "--exclude-task-dependencies"],
    ],
  ])(
    "store a crate's build before the batch of its test starts, so that the build entry holds what cargo build writes (run-many %s)",
    async (_case, targets) => {
      const workspace = FixtureWorkspace.create("binary-tests");
      // Plain cargo warms the build directory for both executables.
      cargo(workspace, "build", "-p", "app");
      cargo(workspace, "test", "-p", "app", "--no-run");
      const hold = holdCargo("test");
      try {
        const run = nx(workspace, ["run-many", ...targets, "-p", "app", "--batch"], hold.env);
        await hold.held();
        // While app's cargo test waits, Nx has stored app's build and those
        // of the other crates whose executables its whole-workspace cargo
        // test replaces, which app's test waits for, unless the run excludes
        // task dependencies.
        const whileHeld = cacheEntries(workspace);
        hold.release();
        const { status, output } = await run;
        expect(status).toBe(0);
        expect(whileHeld).toHaveLength(
          targets.includes("--exclude-task-dependencies") ? 1 : waitedBuilds.length,
        );
        expect(output).toMatch(/test runs_the_executable_that_cargo_test_built \.\.\. ok/);
        expect(printed(workspace).app).toBe("extra");
        if (targets.includes("--exclude-task-dependencies")) {
          // A run that excludes task dependencies stores what no later run
          // restores (DES-LOCKFILE-HASHING); there is nothing more to compare.
          return;
        }
        rmSync(join(workspace.root, "rust", "target", "debug", "app"));
        const restored = await nx(workspace, ["run", "app:build"]);
        expect(restored.status).toBe(0);
        expect(taskCalls(workspace)).toEqual([]);
        expect(printed(workspace).app).toBe("plain");
      } finally {
        hold.release();
        hold.remove();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fail the test of a batch whose dependency on build a project.json took away, before cargo runs, and leave the other tasks their own results",
    async () => {
      const workspace = FixtureWorkspace.create("binary-tests", {
        "rust/crates/app/project.json": JSON.stringify({
          targets: {
            test: { dependsOn: [{ projects: ["directory:rust"], target: "lockfile" }] },
          },
        }),
      });
      try {
        const run = await nx(workspace, ["run-many", "-t", "build", "test", "--batch"]);
        expect(run.status).toBe(1);
        expect(failedTasks(run.output)).toEqual(["app:test"]);
        // Under workspace-build, app's test waits for the builds of every
        // crate whose executables its cargo test replaces.
        expect(run.output).toContain(
          "app:test: the cargo test of this task, which builds the whole workspace under workspace-build, replaces the executables that app:build and benched:build and gated:build and harnessless:build declare as their outputs, because those crates have a binary and an integration test or a bench that cargo test builds, and this run holds app:build and benched:build and gated:build and harnessless:build without the dependency of app:test on them that @convesoft/nx-rust infers.",
        );
        // The other ten tests share the steps of one group.
        expect(calls(workspace).filter((call) => call.startsWith("test "))).toEqual(
          workspaceTestSteps().sort(),
        );
        expect(calls(workspace)).not.toContainEqual(expect.stringMatching(/^test -p \S+\/app#/));
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
