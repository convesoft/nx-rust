import { spawnSync } from "node:child_process";
import {
  type Env,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  inFixture,
  runNx,
  taskCalls,
  testEnvironment,
} from "./harness";

// Checks the part of VER-CARGO-UNCHANGED about the command that a task
// prints when Nx runs verbosely (REQ-VERBOSE-COMMAND, DES-INVOCATION,
// "Printing the command"). The fixture is shared-names, where `good` depends
// on another package named `good`, so that the rerun hints that cargo prints,
// such as `-p good --lib`, cannot be pasted: the printed lines can.

/** The heading of the lines that `task` prints for its cargo command. */
const heading = (task: string) =>
  `${task}: @convesoft/nx-rust runs cargo as these lines do in a POSIX shell:`;

/** How Nx marks a task that it restored from the cache, with or without copying outputs. */
const hit = /\[(local cache|existing outputs match the cache, left as is)\]/;

/** A unit test of `good` that fails, beside the one that passes. */
const failingTest = (source: string) =>
  `${source}\n#[cfg(test)]\nmod failing {\n    #[test]\n    fn fails() {\n        assert_eq!(super::versions(), (0, 0));\n    }\n}\n`;

/**
 * The shell lines that `task` printed in `output`: the `cd` line and the
 * command line below its heading. Fails unless the heading is there exactly
 * once.
 */
function printedLines(output: string, task: string): { cd: string; command: string } {
  const lines = output.split("\n");
  const at = lines.flatMap((line, index) => (line === heading(task) ? [index] : []));
  expect({ task, headings: at.length }).toEqual({ task, headings: 1 });
  const [cd, command] = lines.slice(at[0] + 1, at[0] + 3);
  expect(cd).toMatch(/^ {2}cd /);
  expect(command).toMatch(/^ {2}cargo /);
  return { cd: cd.trim(), command: command.trim() };
}

/**
 * Runs the printed lines in `sh` from the repository root, with the cargo
 * wrapper first on `PATH` and the log emptied first, and returns the exit
 * status and the calls that the wrapper logged.
 */
function runByHand(workspace: FixtureWorkspace, lines: { cd: string; command: string }) {
  workspace.cargo.clear();
  const run = spawnSync("sh", ["-c", `${lines.cd}\n${lines.command}`], {
    cwd: workspace.root,
    env: workspace.cargo.environment(testEnvironment()),
    encoding: "utf8",
  });
  return { status: run.status, calls: workspace.cargo.calls(), output: run.stdout + run.stderr };
}

describe("the cargo command of a task", () => {
  it(
    "is printed by no task without Nx's verbose mode",
    () =>
      inFixture("shared-names", undefined, async (workspace) => {
        const run = await runNx(workspace, ["run-many", "-t", "build", "test", "-p", "good"]);

        expect({ status: run.status, output: run.output }).toEqual({
          status: 0,
          output: expect.any(String),
        });
        // Both tasks ran their cargo commands, which name the crate by its
        // specification; the output shows neither the lines nor the specification.
        expect(taskCalls(workspace).map((call) => call.args[0])).toEqual(
          expect.arrayContaining(["build", "test"]),
        );
        expect(run.output).not.toContain("@convesoft/nx-rust runs cargo as these lines do");
        expect(run.output).not.toContain("path+file://");
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "is printed with --verbose before cargo runs, for test and build, as lines that run the same cargo command by hand",
    () =>
      inFixture(
        "shared-names",
        { "rust/crates/good/src/lib.rs": failingTest },
        async (workspace) => {
          // A failing test: cargo's hint names the crate by a name that is
          // ambiguous here.
          const test = await runNx(workspace, ["run", "good:test", "--verbose"]);
          expect({ status: test.status, output: test.output }).toEqual({
            status: 1,
            output: expect.stringContaining("-p good --lib"),
          });
          const hint = spawnSync("cargo", ["test", "--offline", "-p", "good", "--lib"], {
            cwd: `${workspace.root}/rust`,
            env: testEnvironment(),
            encoding: "utf8",
          });
          expect(hint.stderr).toContain("specification `good` is ambiguous");

          const testCalls = workspace.cargo.calls().filter((call) => call.args[0] === "test");
          expect(testCalls).toHaveLength(1);
          const testLines = printedLines(test.output, "good:test");
          // The lines come before cargo's own output.
          expect(test.output.indexOf(heading("good:test"))).toBeLessThan(
            test.output.indexOf("test result: FAILED"),
          );
          const testByHand = runByHand(workspace, testLines);
          expect(testByHand.status).toBe(101);
          expect(testByHand.output).toContain("failing::fails");
          expect(testByHand.calls).toEqual(testCalls);

          const build = await runNx(workspace, ["run", "good:build", "--verbose"]);
          expect({ status: build.status, output: build.output }).toEqual({
            status: 0,
            output: expect.any(String),
          });
          const buildCalls = workspace.cargo.calls().filter((call) => call.args[0] === "build");
          expect(buildCalls).toHaveLength(1);
          const buildByHand = runByHand(workspace, printedLines(build.output, "good:build"));
          expect(buildByHand.status).toBe(0);
          expect(buildByHand.calls).toEqual(buildCalls);
          expect(buildCalls[0].args).toEqual([
            "build",
            "-p",
            `path+file://${workspace.root}/rust/crates/good#0.1.0`,
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "is printed by the lockfile task for its own command, separately from the crate task's",
    () =>
      inFixture("shared-names", undefined, async (workspace) => {
        const run = await runNx(workspace, ["run-many", "-t", "check", "-p", "good", "--verbose"]);

        expect({ status: run.status, output: run.output }).toEqual({
          status: 0,
          output: expect.any(String),
        });
        const lockfile = printedLines(run.output, "rust:lockfile");
        expect(lockfile.command).toBe("cargo update --workspace");
        expect(printedLines(run.output, "good:check").command).toMatch(
          /^cargo check --all-targets -p 'path\+file:\/\/.*\/rust\/crates\/good#0\.1\.0'$/,
        );
        const byHand = runByHand(workspace, lockfile);
        expect(byHand.status).toBe(0);
        expect(workspace.cargo.calls(workspace.root)).toEqual([
          { cwd: "rust", args: ["update", "--workspace"] },
        ]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "keeps every task's key, so that a later run without the flag restores what a verbose run stored, lines included",
    () =>
      inFixture("shared-names", undefined, async (workspace) => {
        const tasks = ["good:build", "good:test", "rust:lockfile"];
        const plain = await workspace.hashTasks(tasks);
        const verbose = await workspace.hashTasks(tasks, { env: { NX_VERBOSE_LOGGING: "true" } });
        for (const task of tasks) {
          expect({ task, hash: verbose[task].value }).toEqual({ task, hash: plain[task].value });
        }

        const first = await runNx(workspace, ["run", "good:test", "--verbose"]);
        expect({ status: first.status, output: first.output }).toEqual({
          status: 0,
          output: expect.stringContaining(heading("good:test")),
        });
        expect(first.output).not.toMatch(hit);
        const calls = taskCalls(workspace);

        // Nx stores a task's terminal output and replays it on a hit, the
        // lines of the verbose run included (ADR-VERBOSE-COMMAND).
        const second = await runNx(workspace, ["run", "good:test"]);
        expect({ status: second.status, output: second.output }).toEqual({
          status: 0,
          output: expect.stringMatching(hit),
        });
        expect(second.output).toContain(heading("good:test"));
        expect(taskCalls(workspace)).toEqual(calls);
      }),
    HARNESS_TIMEOUT,
  );

  it.each<[string, Env]>([
    ["without the Nx daemon", { NX_DAEMON: "false" }],
    ["with the Nx daemon", { NX_DAEMON: "true" }],
  ])(
    "follows NX_VERBOSE_LOGGING and --verbose as Nx does, %s",
    async (_case, daemon) => {
      const workspace = FixtureWorkspace.create("shared-names");
      try {
        const shown = async (args: string[], env: Env) => {
          const run = await runNx(workspace, ["run", "good:check", "--skip-nx-cache", ...args], {
            ...daemon,
            ...env,
          });
          expect({ args, env, status: run.status }).toEqual({ args, env, status: 0 });
          return run.output.includes(heading("good:check"));
        };

        expect(await shown([], {})).toBe(false);
        expect(await shown([], { NX_VERBOSE_LOGGING: "true" })).toBe(true);
        expect(await shown(["--verbose"], {})).toBe(true);
        expect(await shown(["--verbose"], { NX_VERBOSE_LOGGING: "false" })).toBe(true);
        expect(await shown(["--verbose=false"], { NX_VERBOSE_LOGGING: "true" })).toBe(false);
      } finally {
        await workspace.nx(["daemon", "--stop"], daemon);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it.each<[string, Env]>([
    ["without the Nx daemon", { NX_DAEMON: "false" }],
    ["with the Nx daemon", { NX_DAEMON: "true" }],
  ])(
    "follows the run's verbose mode where a crate's .env gives the task another NX_VERBOSE_LOGGING, %s",
    async (_case, daemon) => {
      // Nx deletes from the task's environment the false that the root .env
      // repeats and then loads the crate's .env, so the task's environment
      // says true while the run is not verbose.
      const workspace = FixtureWorkspace.create("shared-names", {
        ".env": "NX_VERBOSE_LOGGING=false\n",
        "rust/crates/good/.env": "NX_VERBOSE_LOGGING=true\n",
      });
      try {
        const shown = async (args: string[]) => {
          const run = await runNx(
            workspace,
            ["run", "good:check", "--skip-nx-cache", ...args],
            daemon,
          );
          expect({ args, status: run.status }).toEqual({ args, status: 0 });
          return run.output.includes(heading("good:check"));
        };

        expect(await shown(["--verbose=false"])).toBe(false);
        expect(await shown([])).toBe(false);
        expect(await shown(["--verbose"])).toBe(true);
      } finally {
        await workspace.nx(["daemon", "--stop"], daemon);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );
});

// The batch executor of DES-BATCH: with `--batch`, the plugin's tasks run in
// batches, whose process prints each cargo command's lines itself, once per
// command, so that they belong to no task (DES-INVOCATION, "Printing the
// command"). Until nxr-8f9dz2 every task is a group of one crate, so every
// command names one task.
describe("the cargo command of a batch", () => {
  // kit is the crate in crates/toolkit.
  const command = ["run-many", "-t", "check", "build", "-p", "good", "kit", "--batch"];
  const tasks = ["good:check", "kit:check", "good:build", "kit:build"];
  const folders: Record<string, string> = { good: "/crates/good#", kit: "/crates/toolkit#" };

  it(
    "is printed once for each command of a verbose batch, before cargo runs, as lines that run the same command by hand, and stored with no task",
    () =>
      inFixture("shared-names", undefined, async (workspace) => {
        const run = await runNx(workspace, [...command, "--verbose"]);
        expect({ status: run.status, output: run.output }).toEqual({
          status: 0,
          output: expect.stringMatching(/Running 2 tasks with @convesoft\/nx-rust:cargo-outputs/),
        });
        // printedLines fails unless each heading is there exactly once.
        const lines = Object.fromEntries(
          tasks.map((task) => [task, printedLines(run.output, task)]),
        );
        expect(taskCalls(workspace)).toHaveLength(4);
        // As runByHand logs them, with absolute folders.
        const calls = workspace.cargo.calls();
        for (const task of tasks) {
          const [crate, target] = task.split(":");
          const ran = calls.filter(
            (call) => call.args[0] === target && call.args.join(" ").includes(folders[crate]),
          );
          expect({ task, calls: ran.length }).toEqual({ task, calls: 1 });
          const byHand = runByHand(workspace, lines[task]);
          expect({ task, status: byHand.status }).toEqual({ task, status: 0 });
          expect(byHand.calls).toEqual(ran);
        }

        // The lines belong to no task: a run that restores every task from
        // the cache replays none of them, unlike the lines of a task run on
        // its own (ADR-VERBOSE-COMMAND).
        const restored = await runNx(workspace, [...command]);
        expect({ status: restored.status, output: restored.output }).toEqual({
          status: 0,
          output: expect.stringMatching(hit),
        });
        for (const task of tasks) {
          expect(restored.output).toMatch(new RegExp(`nx run ${task}\\s+\\[`));
        }
        expect(restored.output).not.toContain("@convesoft/nx-rust runs cargo as these lines do");
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "is printed by no batch with --verbose=false, also where NX_VERBOSE_LOGGING is true",
    () =>
      inFixture("shared-names", undefined, async (workspace) => {
        const run = await runNx(workspace, [...command, "--skip-nx-cache", "--verbose=false"], {
          NX_VERBOSE_LOGGING: "true",
        });
        expect({ status: run.status, output: run.output }).toEqual({
          status: 0,
          output: expect.stringMatching(/Running 2 tasks with @convesoft\/nx-rust:cargo\b/),
        });
        // Positive control: the tasks ran their cargo commands.
        expect(taskCalls(workspace)).toHaveLength(4);
        expect(run.output).not.toContain("@convesoft/nx-rust runs cargo as these lines do");
      }),
    HARNESS_TIMEOUT,
  );

  it.each<[string, Env]>([
    ["without the Nx daemon", { NX_DAEMON: "false" }],
    ["with the Nx daemon", { NX_DAEMON: "true" }],
  ])(
    "follows the run's verbose mode where a crate's .env gives its task another NX_VERBOSE_LOGGING, %s",
    async (_case, daemon) => {
      const workspace = FixtureWorkspace.create("shared-names", {
        ".env": "NX_VERBOSE_LOGGING=false\n",
        "rust/crates/good/.env": "NX_VERBOSE_LOGGING=true\n",
      });
      try {
        const shown = async (args: string[]) => {
          workspace.cargo.clear();
          const run = await runNx(workspace, [...command, "--skip-nx-cache", ...args], daemon);
          expect({ args, status: run.status }).toEqual({ args, status: 0 });
          expect({ args, calls: taskCalls(workspace).length }).toEqual({ args, calls: 4 });
          return tasks.filter((task) => run.output.includes(heading(task)));
        };

        expect(await shown(["--verbose=false"])).toEqual([]);
        expect(await shown([])).toEqual([]);
        expect(await shown(["--verbose"])).toEqual(tasks);
      } finally {
        await workspace.nx(["daemon", "--stop"], daemon);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );
});
