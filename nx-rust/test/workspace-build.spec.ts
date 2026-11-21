import type { ExecutorContext, ProjectConfiguration } from "@nx/devkit";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { declaredOptionsOf } from "../src/executors/declared-options";
import {
  batchLiveOutput,
  type GroupMember,
  type LiveOutput,
  runGroup,
} from "../src/executors/group-run";
import { formGroups, planGroups } from "../src/executors/groups";
import * as runnerScriptModule from "../src/executors/runner-script";
import {
  groupInvocations,
  type PluginExecutor,
  type PreparedTask,
  prepareTask,
} from "../src/executors/task";
import { cargoExecutor } from "../src/graph/targets";
import {
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  packageSpec,
  pluginPackage,
  runNx,
  taskCalls,
  taskOutput,
  testEnvironment,
  withoutRunner,
  workspaceArgs,
  workspaceTestSteps,
} from "./harness";

// The parts of VER-BATCHING that run `test`, `check` and `lint` under
// workspace-build (DES-UNIFICATION, DES-TEST-RUN), with a real cargo in copies
// of the workspace-tests fixture: groups that select the whole workspace,
// formed and run as the batch forms and runs them with sharing on
// (groupsShareCommands, which stays off until the questions of nxr-8f9dz2 are
// decided). The selecting runner is the compiled plugin's.

const executor: PluginExecutor = {
  name: cargoExecutor,
  shortName: "cargo",
  declared: declaredOptionsOf(cargoExecutor),
  serves: (target) =>
    target !== "build" && target !== "doc" && target !== "run" && target !== "lockfile",
};

interface Prepared extends PreparedTask {
  context: ExecutorContext;
}

/** Prepares the tasks of `target` of `crates` as the batch does. */
async function prepare(
  workspace: FixtureWorkspace,
  target: string,
  crates: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<Prepared[]> {
  const { projects } = await workspace.graph();
  const configurations: Record<string, ProjectConfiguration> = projects;
  return crates.map((crate) => {
    const context: ExecutorContext = {
      root: workspace.root,
      cwd: workspace.root,
      isVerbose: false,
      projectName: crate,
      targetName: target,
      target: configurations[crate].targets?.[target],
      projectsConfigurations: { version: 2, projects: configurations },
      nxJsonConfiguration: {},
      projectGraph: {
        nodes: Object.fromEntries(
          Object.entries(configurations).map(([name, data]) => [name, { name, type: "lib", data }]),
        ),
        dependencies: {},
      },
      taskGraph: { tasks: {}, dependencies: {}, continuousDependencies: {}, roots: [] },
    };
    const options = { ...configurations[crate].targets?.[target]?.options };
    const { records: _records, ...prepared } = prepareTask(executor, options, context, env);
    return { ...prepared, context };
  });
}

/**
 * Forms and plans the tasks' groups with sharing on, expects one group that
 * selects the whole workspace, and runs it.
 */
async function runWorkspaceGroup(
  workspace: FixtureWorkspace,
  tasks: readonly Prepared[],
  live: LiveOutput = "none",
): Promise<Record<string, { success: boolean; output: string }>> {
  const planned = planGroups(formGroups(tasks, true), true);
  expect(planned.map((group) => group.selection.kind)).toEqual(["workspace"]);
  const [{ tasks: group, selection }] = planned;
  const invocations = groupInvocations(group, workspace.root, selection);
  const members: GroupMember[] = group.map((task, index) => {
    const invocation = invocations[index];
    if (typeof invocation === "string") {
      throw new Error(invocation);
    }
    return { prepared: task, invocation, context: (task as Prepared).context };
  });
  const results = await runGroup(members, false, live);
  return Object.fromEntries(group.map((task, index) => [task.crate as string, results[index]]));
}

/** The cargo calls of the group, with the runner's command and the host replaced. */
function calls(workspace: FixtureWorkspace): string[] {
  return workspace
    .cargoCalls()
    .filter((call) => call.args[0] !== "metadata")
    .map((call) =>
      call.args
        .join(" ")
        .replace(/target\.[A-Za-z0-9_.-]+\.runner=\[[^\]]*\]/, "target.HOST.runner=[RUNNER]"),
    );
}

function passed(results: Record<string, { success: boolean }>): string[] {
  return Object.entries(results)
    .filter(([, result]) => result.success)
    .map(([crate]) => crate)
    .sort();
}

/** A preload for `NODE_OPTIONS` that acts only in the selecting runner's process. */
function preload(folder: string, name: string, body: string): string {
  const file = join(folder, `${name}.cjs`);
  writeFileSync(file, `if ((process.argv[1] || "").endsWith("test-runner.js")) {\n${body}\n}\n`);
  return `--require=${file}`;
}

let seams: string;

beforeAll(() => {
  // The batch starts the compiled plugin's runner; the source has none.
  jest
    .spyOn(runnerScriptModule, "runnerCommand")
    .mockReturnValue([
      process.execPath,
      join(pluginPackage(), "src", "executors", "test-runner.js"),
    ]);
  seams = mkdtempSync(join(tmpdir(), "nx-rust-runner-seams-"));
});

afterAll(() => {
  rmSync(seams, { recursive: true, force: true });
});

describe("test under workspace-build", () => {
  it(
    "runs the build, the group's test binaries through the selecting runner and every doctest, in three cargo commands, and each task shows only its own crate",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests");
      try {
        const env = workspace.cargo.environment(testEnvironment({ NX_RUST_FIXTURE_FAIL: "1" }));
        const tasks = await prepare(workspace, "test", ["a", "b"], env);
        workspace.cargo.clear();
        const results = await runWorkspaceGroup(workspace, tasks);
        expect(passed(results)).toEqual(["a", "b"]);
        expect(calls(workspace)).toEqual([
          "test --workspace --no-run",
          "test --workspace --tests --no-fail-fast --message-format=json-render-diagnostics --config target.HOST.runner=[RUNNER]",
          "test --workspace --doc --no-fail-fast",
        ]);
        // No unit or integration test of c ran: the runner skipped them, and
        // the run ended long before c's integration test would have.
        const rust = join(workspace.root, "rust");
        expect(existsSync(join(rust, "c-unit-test-ran"))).toBe(false);
        expect(existsSync(join(rust, "c-integration-test-ran"))).toBe(false);
        const { a, b } = results;
        expect(a.output).toMatch(/a_unit_test \.\.\. ok/);
        expect(a.output).toMatch(/a_integration_test \.\.\. ok/);
        expect(a.output).toMatch(/Doc-tests a/);
        expect(b.output).toMatch(/b_unit_test \.\.\. ok/);
        expect(b.output).toMatch(/b_integration_test \.\.\. ok/);
        expect(b.output).toMatch(/Doc-tests b/);
        for (const [result, other] of [
          [a, "b"],
          [b, "a"],
        ] as const) {
          expect(result.output).not.toMatch(
            new RegExp(`${other}_unit_test|${other}_integration_test|Doc-tests ${other}\\b`),
          );
          expect(result.output).not.toMatch(/Doc-tests (c|d|shared|h)\b|Running .*[/(]c-/);
          // c's doctest ran and failed, which fails no task and warns in each.
          expect(result.output).toMatch(/warning: the doctests of `c` failed/);
          expect(result.output).not.toMatch(/c's doctest fails/);
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails every task of the group where a crate does not compile in the build step, also outside the selection, and names that crate",
    async () => {
      const brokenExample: FileChanges = {
        "rust/crates/a/examples/demo.rs": "fn main() {\n    not_defined_anywhere();\n}\n",
      };
      const brokenOutside: FileChanges = {
        "rust/crates/c/tests/it.rs": "#[test]\nfn broken() {\n    not_defined_anywhere();\n}\n",
      };
      for (const [files, crate, outside] of [
        [brokenExample, "a", false],
        [brokenOutside, "c", true],
      ] as const) {
        const workspace = FixtureWorkspace.create("workspace-tests", files);
        try {
          const env = workspace.cargo.environment(testEnvironment());
          const results = await runWorkspaceGroup(
            workspace,
            await prepare(workspace, "test", ["a", "b"], env),
          );
          expect(passed(results)).toEqual([]);
          for (const name of ["a", "b"]) {
            expect(results[name].output).toContain(
              `${name}:test: the tests of ${name} were not run: cargo test --no-run stopped before running any test, because \`${crate}\``,
            );
            expect(
              results[name].output.includes("which is outside the selection of this run"),
            ).toBe(outside);
          }
          // The build step failed for every task, so no later step ran.
          expect(calls(workspace)).toEqual(["test --workspace --no-run"]);
        } finally {
          workspace.remove();
        }
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails only the task of a crate whose test fails, and leaves out the doctest step where no crate of the group has a library",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        "rust/crates/c/src/lib.rs":
          'pub fn c() -> u32 {\n    3\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn c_unit_test() {\n        assert_eq!(super::c(), 4, "c\'s unit test fails");\n    }\n}\n',
        "rust/crates/c/tests/it.rs": "#[test]\nfn c_integration_test() {}\n",
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const failing = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, "test", ["a", "c"], env),
        );
        expect(passed(failing)).toEqual(["a"]);
        expect(failing.c.output).toMatch(/c's unit test fails/);
        expect(failing.c.output).toMatch(
          /exited with status 101, as a test binary does where a test failed/,
        );
        expect(failing.a.output).not.toMatch(/c's unit test fails/);
        // tool has a binary only: its group has no doctest step.
        workspace.cargo.clear();
        const binary = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, "test", ["tool"], env),
        );
        expect(passed(binary)).toEqual(["tool"]);
        expect(binary.tool.output).toMatch(/tool_unit_test \.\.\. ok/);
        expect(calls(workspace)).toEqual([
          "test --workspace --no-run",
          "test --workspace --tests --no-fail-fast --message-format=json-render-diagnostics --config target.HOST.runner=[RUNNER]",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "builds the whole workspace for a group left with one task, so that its crate gets the features that another member turns on",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        "rust/crates/a/tests/it.rs":
          '#[test]\nfn a_integration_test() {\n    assert!(!shared::x_on(), "x is on in shared");\n}\n',
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        workspace.cargo.clear();
        const results = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, "test", ["a"], env),
        );
        expect(passed(results)).toEqual([]);
        expect(results.a.output).toMatch(/x is on in shared/);
        expect(calls(workspace)[0]).toBe("test --workspace --no-run");
        expect(calls(workspace).join("\n")).not.toMatch(/ -p /);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the evidence for test binaries", () => {
  it(
    "fails every task where the runner cannot start, ends before it records anything, cannot record, refuses its list or is killed after its start, and passes without those faults",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests");
      try {
        const base = workspace.cargo.environment(testEnvironment());
        // The cargo wrapper is a Node script too: an option that keeps Node
        // from starting runs with the real cargo.
        const plain = testEnvironment();
        const faults: { name: string; env: NodeJS.ProcessEnv; message: RegExp }[] = [
          {
            name: "an option that keeps Node from starting",
            env: { ...plain, NODE_OPTIONS: "--not-a-real-node-option" },
            message: /has no record.*\n.*left no record at all.*NODE_OPTIONS/,
          },
          ...[{}, { CARGO_TERM_QUIET: "true" }, { CARGO_TERM_VERBOSE: "true" }].map((terminal) => ({
            name: `a preload that exits with 0 ${JSON.stringify(terminal)}`,
            env: { ...terminal, NODE_OPTIONS: preload(seams, "exit", "process.exit(0);") },
            message: /has no record/,
          })),
          {
            name: "a list that is not of its form",
            env: {
              NODE_OPTIONS: preload(seams, "bad", 'process.env.NX_RUST_TEST_PACKAGES = "bad";'),
            },
            message: /refused to run a test executable: NX_RUST_TEST_PACKAGES is "bad"/,
          },
          {
            name: "a record folder that it cannot write",
            env: {
              NODE_OPTIONS: preload(
                seams,
                "unwritable",
                'require("node:fs").chmodSync(process.env.NX_RUST_TEST_RECORD, 0o500);',
              ),
            },
            message: /has no record/,
          },
          {
            name: "a record folder that cannot be read",
            env: {
              NODE_OPTIONS: preload(
                seams,
                "unreadable",
                'process.on("exit", () => require("node:fs").chmodSync(process.env.NX_RUST_TEST_RECORD, 0o300));',
              ),
            },
            message: /record of @convesoft\/nx-rust's test runner cannot be read/,
          },
          {
            name: "a kill after the start",
            env: {
              NODE_OPTIONS: preload(
                seams,
                "killed",
                'const cp = require("node:child_process"); const spawn = cp.spawn; cp.spawn = (...args) => { process.kill(process.pid, "SIGKILL"); return spawn(...args); };',
              ),
            },
            message: /has no end: the runner started it and was stopped before it ended/,
          },
        ];
        for (const fault of faults) {
          const results = await runWorkspaceGroup(
            workspace,
            await prepare(workspace, "test", ["a", "b", "h"], { ...base, ...fault.env }),
          );
          expect({ fault: fault.name, passed: passed(results) }).toEqual({
            fault: fault.name,
            passed: [],
          });
          for (const crate of ["a", "b", "h"]) {
            expect({ fault: fault.name, output: results[crate].output }).toEqual({
              fault: fault.name,
              output: expect.stringMatching(fault.message),
            });
          }
        }
        for (const terminal of [{}, { CARGO_TERM_QUIET: "true" }, { CARGO_TERM_VERBOSE: "true" }]) {
          const results = await runWorkspaceGroup(
            workspace,
            await prepare(workspace, "test", ["a", "b", "h"], { ...base, ...terminal }),
          );
          expect({ terminal, passed: passed(results) }).toEqual({
            terminal,
            passed: ["a", "b", "h"],
          });
        }
      } finally {
        workspace.remove();
      }
    },
    4 * HARNESS_TIMEOUT,
  );

  it(
    "takes no line that a proc macro or a test prints for cargo's: a forged build-finished passes no task, and forged lines can only fail one",
    async () => {
      const pm = {
        "rust/crates/pm/Cargo.toml":
          '[package]\nname = "pm"\nversion = "0.1.0"\nedition = "2024"\n\n[lib]\nproc-macro = true\n',
        "rust/crates/pm/src/lib.rs":
          'use proc_macro::TokenStream;\n\n#[proc_macro]\npub fn forged(input: TokenStream) -> TokenStream {\n    println!("{{\\"reason\\":\\"build-finished\\",\\"success\\":true}}");\n    input\n}\n',
        "rust/crates/mu/Cargo.toml":
          '[package]\nname = "mu"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\npm = { path = "../pm" }\n',
        "rust/crates/mu/build.rs":
          'fn main() {\n    println!("cargo:rerun-if-changed=never-exists");\n}\n',
        "rust/crates/mu/src/lib.rs":
          "pm::forged!(\n    pub fn mu() -> u32 {\n        5\n    }\n);\n",
      } satisfies FileChanges;
      const failing = '#[test]\nfn mu_fails() {\n    assert_eq!(mu::mu(), 6, "mu fails");\n}\n';
      const workspace = FixtureWorkspace.create("workspace-tests", {
        ...pm,
        "rust/crates/mu/tests/it.rs": failing,
      });
      try {
        const base = workspace.cargo.environment(testEnvironment());
        const exits = preload(seams, "exit-forged", "process.exit(0);");
        const forged = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, "test", ["mu"], { ...base, NODE_OPTIONS: exits }),
        );
        expect(passed(forged)).toEqual([]);
        expect(forged.mu.output).toMatch(/has no record/);
        workspace.reset({
          ...pm,
          "rust/crates/mu/tests/it.rs":
            "#[test]\nfn mu_passes() {\n    assert_eq!(mu::mu(), 5);\n}\n",
        });
        const good = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, "test", ["mu"], base),
        );
        expect(passed(good)).toEqual(["mu"]);
      } finally {
        workspace.remove();
      }
    },
    2 * HARNESS_TIMEOUT,
  );
});

describe("check and lint under workspace-build", () => {
  it(
    "warn about a crate outside the selection that does not compile and that no selected crate needs, and fail no task",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        "rust/crates/c/src/lib.rs": "pub fn c() -> u32 {\n    not_defined_anywhere\n}\n",
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        workspace.cargo.clear();
        const results = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, "check", ["a", "b"], env),
        );
        expect(passed(results)).toEqual(["a", "b"]);
        expect(calls(workspace)).toEqual([
          "check --all-targets --keep-going --message-format=json --workspace",
        ]);
        for (const crate of ["a", "b"]) {
          expect(results[crate].output).toMatch(/cargo reported `c` as failed/);
          expect(results[crate].output).toMatch(/`c` is outside the selection of this run/);
          // c's error explains the warning; another crate's lines do not show.
          expect(results[crate].output).toMatch(/not_defined_anywhere/);
          expect(results[crate].output).not.toMatch(/Checking (d|h|tool) v0\.1\.0/);
        }
        expect(results.a.output).toMatch(/Checking a v0\.1\.0/);
        expect(results.a.output).not.toMatch(/Checking b v0\.1\.0/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("what a batch shows of cargo while it runs", () => {
  it(
    "is cargo's lines under the terminal UI and a status line per command elsewhere, written beside each task's output, which they do not change",
    async () => {
      expect(batchLiveOutput({ NX_TUI: "true" })).toBe("lines");
      expect(batchLiveOutput({ NX_TUI: "false" })).toBe("status");
      expect(batchLiveOutput({})).toBe("status");
      const workspace = FixtureWorkspace.create("workspace-tests", {
        "rust/crates/a/src/lib.rs": (source) => `${source ?? ""}\nfn unused_in_a() {}\n`,
      });
      const written: string[] = [];
      const write = jest.spyOn(process.stderr, "write").mockImplementation(((
        chunk: string | Uint8Array,
        callback?: () => void,
      ) => {
        written.push(String(chunk));
        callback?.();
        return true;
      }) as typeof process.stderr.write);
      try {
        const env = workspace.cargo.environment(testEnvironment());
        // A first run compiles, so that the three runs compare like with like.
        await runWorkspaceGroup(workspace, await prepare(workspace, "test", ["a", "b"], env));
        const outputs: Record<string, string> = {};
        const shown: Record<string, string[]> = {};
        for (const live of ["lines", "status", "none"] as const) {
          written.length = 0;
          const results = await runWorkspaceGroup(
            workspace,
            await prepare(workspace, "test", ["a", "b"], env),
            live,
          );
          expect(passed(results)).toEqual(["a", "b"]);
          outputs[live] = results.a.output;
          shown[live] = [...written];
        }
        // Cargo's lines of every crate as they arrive, no JSON message, no status line.
        const lines = shown.lines.join("");
        expect(lines).toMatch(/a_unit_test \.\.\. ok/);
        expect(lines).toMatch(/b_unit_test \.\.\. ok/);
        expect(lines).toMatch(/Doc-tests a/);
        expect(lines).not.toMatch(/"reason":/);
        expect(lines).not.toMatch(/@convesoft\/nx-rust: cargo/);
        // One line per command, and nothing of cargo's.
        expect(shown.status.filter((chunk) => chunk.startsWith("@convesoft"))).toEqual([
          "@convesoft/nx-rust: cargo test for a, b (step 1 of 3)\n",
          "@convesoft/nx-rust: cargo test for a, b (step 2 of 3)\n",
          "@convesoft/nx-rust: cargo test for a, b (step 3 of 3)\n",
        ]);
        expect(shown.status.join("")).not.toMatch(/a_unit_test/);
        expect(shown.none.join("")).toBe("");
        // The task's own output is the same whatever the batch shows.
        // Durations and cargo's waits for a lock that another cargo holds,
        // as on a machine that runs other tests, differ between runs.
        const normalize = (text: string) =>
          text
            .split("\n")
            .filter((line) => !/^\s+Blocking waiting for file lock/.test(line))
            .join("\n")
            .replace(/\d+\.\d+s/g, "Ns");
        expect(normalize(outputs.lines)).toBe(normalize(outputs.none));
        expect(normalize(outputs.status)).toBe(normalize(outputs.none));
      } finally {
        write.mockRestore();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("test under workspace-build through Nx", () => {
  it(
    "runs the tests of a and b without --batch as one group of three cargo commands, skipping c's tests, and a second run restores both",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests");
      try {
        const env = { NX_RUST_FIXTURE_FAIL: "1" };
        const run = await runNx(workspace, ["run-many", "-t", "test", "-p", "a", "b"], env);
        expect({ status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
          status: 0,
          output: "",
        });
        // The task calls, without the lockfile task's.
        expect(taskCalls(workspace).map((call) => withoutRunner(call.args.join(" ")))).toEqual(
          workspaceTestSteps(),
        );
        const rust = join(workspace.root, "rust");
        expect(existsSync(join(rust, "c-unit-test-ran"))).toBe(false);
        expect(existsSync(join(rust, "c-integration-test-ran"))).toBe(false);
        for (const [task, own, other] of [
          ["a:test", "a", "b"],
          ["b:test", "b", "a"],
        ]) {
          const block = taskOutput(run.output, task);
          expect(block).toMatch(new RegExp(`${own}_unit_test \\.\\.\\. ok`));
          expect(block).not.toMatch(new RegExp(`${other}_unit_test|Doc-tests ${other}\\b`));
          expect(block).toMatch(/warning: the doctests of `c` failed/);
        }
        workspace.cargo.clear();
        const again = await runNx(workspace, ["run-many", "-t", "test", "-p", "a", "b"], env);
        expect(again.status).toBe(0);
        expect(taskCalls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("feature sets under workspace-build", () => {
  it(
    "give every compiling target the configuration for all features, which shares one command, while a crate whose own options name crate/feature forms a group of one crate",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        "rust/crates/b/Cargo.toml": (manifest) =>
          `${manifest ?? ""}\n[package.metadata.nx.targets.check.options]\nfeatures = ["shared/x"]\n`,
      });
      try {
        // The configuration of every target that compiles, and of no other.
        const { projects } = await workspace.graph();
        for (const target of ["build", "check", "lint", "test"]) {
          expect({ target, configurations: projects.a.targets?.[target]?.configurations }).toEqual({
            target,
            configurations: { "all-features": { allFeatures: true } },
          });
        }
        expect(projects.rust.targets?.doc?.configurations).toEqual({
          "all-features": { allFeatures: true },
        });
        for (const target of ["fmt-check", "fmt"]) {
          expect({
            target,
            configurations: projects.a.targets?.[target]?.configurations ?? {},
          }).toEqual({ target, configurations: {} });
        }

        // Under workspace-build, --all-features acts on every member, so the
        // tasks of both crates share one command.
        const all = await runNx(workspace, [
          "run-many",
          "-t",
          "check",
          "-p",
          "a",
          "c",
          "-c",
          "all-features",
        ]);
        expect({ status: all.status, output: all.status === 0 ? "" : all.output }).toEqual({
          status: 0,
          output: "",
        });
        expect(taskCalls(workspace).map((call) => call.args)).toEqual([
          workspaceArgs("check", ["--all-features"]),
        ]);

        // b's own feature set makes a group of one crate, which selects only
        // b and names the feature of the crate it depends on, after the group
        // that builds the whole workspace (DES-BATCH, "Groups of one crate").
        workspace.cargo.clear();
        const own = await runNx(workspace, ["run-many", "-t", "check", "-p", "a", "b"]);
        expect({ status: own.status, output: own.status === 0 ? "" : own.output }).toEqual({
          status: 0,
          output: "",
        });
        expect(taskCalls(workspace).map((call) => call.args)).toEqual([
          workspaceArgs("check"),
          [
            "check",
            "--all-targets",
            "-p",
            packageSpec(workspace.root, "rust", "b"),
            "--features",
            "shared/x",
          ],
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/** The host's triple, as rustc names it. */
function host(): string {
  const run = spawnSync("rustc", ["-vV"], { env: testEnvironment(), encoding: "utf8" });
  const triple = /^host: (\S+)$/m.exec(run.stdout)?.[1];
  if (triple === undefined) {
    throw new Error(`rustc -vV names no host:\n${run.stdout}${run.stderr}`);
  }
  return triple;
}

/** A triple other than the host's that rustup has installed, as caching-runs.spec.ts uses it. */
const otherTriple = "x86_64-unknown-linux-musl";
function otherTripleInstalled(): boolean {
  const { stdout } = spawnSync("rustup", ["target", "list", "--installed"], {
    env: testEnvironment(),
    encoding: "utf8",
  });
  return host() === "x86_64-unknown-linux-gnu" && (stdout ?? "").split("\n").includes(otherTriple);
}

describe("groups of one crate under workspace-build", () => {
  // Where rustup has the other triple, as caching-runs.spec.ts checks too.
  if (otherTripleInstalled()) {
    it(
      "run a non-host triple one crate per cargo command, while the host's tasks share one command for the whole workspace",
      async () => {
        const workspace = FixtureWorkspace.create("workspace-tests");
        try {
          const other = await runNx(workspace, [
            "run-many",
            "-t",
            "check",
            "-p",
            "a",
            "b",
            `--targetTriple=${otherTriple}`,
          ]);
          expect({ status: other.status, output: other.status === 0 ? "" : other.output }).toEqual({
            status: 0,
            output: "",
          });
          expect(
            taskCalls(workspace)
              .map((call) => call.args.join(" "))
              .sort(),
          ).toEqual(
            ["a", "b"]
              .map(
                (crate) =>
                  `check --all-targets -p ${packageSpec(workspace.root, "rust", crate)} --target ${otherTriple}`,
              )
              .sort(),
          );
          workspace.cargo.clear();
          const onHost = await runNx(workspace, ["run-many", "-t", "check", "-p", "a", "b"]);
          expect(onHost.status).toBe(0);
          expect(taskCalls(workspace).map((call) => call.args)).toEqual([workspaceArgs("check")]);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  }

  it(
    "run the tests one crate per cargo command, each saying why, where a runner for the host is configured, and share a command where the runner is for another triple",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests");
      try {
        const triple = host();
        const log = join(workspace.root, "runner-calls.log");
        const runner = join(workspace.root, "runner.sh");
        writeFileSync(runner, `#!/bin/sh\necho "$1" >> '${log}'\nexec "$@"\n`, { mode: 0o755 });
        const config = join(workspace.root, "rust", ".cargo", "config.toml");
        mkdirSync(join(workspace.root, "rust", ".cargo"), { recursive: true });
        const variable = `CARGO_TARGET_${triple.toUpperCase().replace(/[-.]/g, "_")}_RUNNER`;
        const cases: {
          name: string;
          config?: string;
          dotenv?: string;
          shared: boolean;
          why: string;
        }[] = [
          {
            name: "under [target.<host>]",
            config: `[target.${triple}]\nrunner = "${runner}"\n`,
            shared: false,
            why: `${config} sets runner under [target.${triple}]`,
          },
          {
            name: "under a cfg table",
            config: `[target.'cfg(unix)']\nrunner = ["${runner}"]\n`,
            shared: false,
            why: `${config} sets runner under [target.'cfg(unix)']`,
          },
          {
            name: "in the variable, from the root .env",
            dotenv: `${variable}=${runner}\n`,
            shared: false,
            why: `${variable} is set`,
          },
          {
            name: "for another triple only",
            config: `[target.wasm32-unknown-unknown]\nrunner = "${runner}"\n`,
            shared: true,
            why: "",
          },
        ];
        for (const entry of cases) {
          rmSync(config, { force: true });
          rmSync(join(workspace.root, ".env"), { force: true });
          rmSync(log, { force: true });
          if (entry.config !== undefined) {
            writeFileSync(config, entry.config);
          }
          if (entry.dotenv !== undefined) {
            writeFileSync(join(workspace.root, ".env"), entry.dotenv);
          }
          workspace.cargo.clear();
          const run = await runNx(workspace, [
            "run-many",
            "-t",
            "test",
            "-p",
            "a",
            "b",
            "--skip-nx-cache",
          ]);
          expect({
            name: entry.name,
            status: run.status,
            output: run.status === 0 ? "" : run.output,
          }).toEqual({
            name: entry.name,
            status: 0,
            output: "",
          });
          // Shared, one group with the plugin's runner; otherwise one plain
          // cargo test per crate with the user's runner, which logs the unit
          // and integration tests of a and b and their doctests, which
          // rustdoc runs through it as rust_out, and nothing of c.
          const ran = taskCalls(workspace).map((call) => withoutRunner(call.args.join(" ")));
          const programs = existsSync(log)
            ? [
                ...new Set(
                  readFileSync(log, "utf8")
                    .split("\n")
                    .filter(Boolean)
                    .map((path) => basename(path).replace(/-[0-9a-f]{16}$/, "")),
                ),
              ].sort()
            : [];
          const said = ["a:test", "b:test"].map((task) =>
            taskOutput(run.output, task).includes(
              entry.shared ? "is or may be configured" : entry.why,
            ),
          );
          expect({ name: entry.name, ran: ran.sort(), programs, said }).toEqual({
            name: entry.name,
            ran: entry.shared
              ? workspaceTestSteps().sort()
              : ["a", "b"]
                  .map((crate) => `test -p ${packageSpec(workspace.root, "rust", crate)}`)
                  .sort(),
            programs: entry.shared ? [] : ["a", "b", "it", "rust_out"],
            said: entry.shared ? [false, false] : [true, true],
          });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );
});

// CARGO_TERM_COLOR=always, as CI configurations set it, colours cargo's lines;
// the reading takes them as it takes uncoloured ones (finding of the review
// of nxr-8f9dz2).
describe("cargo's coloured output", () => {
  it(
    "passes a task whose crate passes, where only an unrelated crate's doctest fails, batched and on its own",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests");
      try {
        const env = { CARGO_TERM_COLOR: "always", NX_RUST_FIXTURE_FAIL: "1" };
        for (const mode of [[], ["--batch=false"]]) {
          const run = await runNx(workspace, ["run", "a:test", "--skip-nx-cache", ...mode], env);
          expect({ mode, status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
            mode,
            status: 0,
            output: "",
          });
          const block = taskOutput(run.output, "a:test");
          expect({ mode, warned: /warning: the doctests of `c` failed/.test(block) }).toEqual({
            mode,
            warned: true,
          });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "warns about a crate outside the selection that does not compile in a check, and fails no task",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        "rust/crates/c/src/lib.rs": "pub fn c() -> u32 {\n    not_defined_anywhere\n}\n",
      });
      try {
        const env = workspace.cargo.environment(testEnvironment({ CARGO_TERM_COLOR: "always" }));
        const results = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, "check", ["a", "b"], env),
        );
        expect(passed(results)).toEqual(["a", "b"]);
        expect(results.a.output).toMatch(/`c` is outside the selection of this run/);
        expect(results.a.output).not.toMatch(/Checking b v0\.1\.0/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

// Finding of the review of nxr-8f9dz2: no cargo command of a batch may write
// a file that another task of the batch stores, unless that task's own
// command runs after it (DES-BATCH, "Files that a batch stores").
describe("the files that a batch stores", () => {
  /** Two binary crates, each printing whether its feature extra and the cfg nx_rust_flag are on. */
  const binaries: FileChanges = Object.fromEntries(
    ["pa", "pb"].flatMap((name) => [
      [
        `rust/crates/${name}/Cargo.toml`,
        `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n\n[features]\nextra = []\n\n[lints.rust]\nunexpected_cfgs = { level = "allow" }\n`,
      ],
      [
        `rust/crates/${name}/src/main.rs`,
        'fn main() {\n    let features = if cfg!(feature = "extra") { "extra" } else { "plain" };\n    let flag = if cfg!(nx_rust_flag) { " flag" } else { "" };\n    println!("{features}{flag}");\n}\n',
      ],
    ]),
  );
  const allFeatures = (name: string): FileChanges => ({
    [`rust/crates/${name}/Cargo.toml`]: (manifest) =>
      `${manifest ?? ""}\n[package.metadata.nx.targets.build.options]\nallFeatures = true\n`,
  });
  const prints = (workspace: FixtureWorkspace, name: string) =>
    spawnSync(join(workspace.root, "rust", "target", "debug", name), {
      encoding: "utf8",
    }).stdout.trim();

  /** Builds pa and pb in one batch, then restores each from the cache alone. */
  async function buildAndRestore(workspace: FixtureWorkspace): Promise<Record<string, string>> {
    const run = await runNx(workspace, [
      "run-many",
      "-t",
      "build",
      "-p",
      "pa",
      "pb",
      "--parallel=2",
    ]);
    expect({ status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
      status: 0,
      output: "",
    });
    const restored: Record<string, string> = {};
    for (const name of ["pa", "pb"]) {
      rmSync(join(workspace.root, "rust", "target", "debug", name));
      const again = await runNx(workspace, ["run", `${name}:build`]);
      expect({ name, status: again.status }).toEqual({ name, status: 0 });
      restored[name] = prints(workspace, name);
    }
    return restored;
  }

  it.each<[string, string]>([
    ["pb's own options turn all its features on", "pb"],
    ["pa's own options turn all its features on, in the reverse order", "pa"],
  ])(
    "store each build as its own command builds it where %s",
    async (_case, own) => {
      const workspace = FixtureWorkspace.create("workspace-tests", binaries, allFeatures(own));
      try {
        const restored = await buildAndRestore(workspace);
        const other = own === "pa" ? "pb" : "pa";
        expect(restored).toEqual({ [own]: "extra", [other]: "plain" });
        // The crate with its own feature set ran alone, without a stage,
        // after the build of the whole workspace, in a stage.
        workspace.cargo.clear();
        await runNx(workspace, ["run-many", "-t", "build", "-p", "pa", "pb", "--skip-nx-cache"]);
        expect(taskCalls(workspace).map((call) => call.args.join(" "))).toEqual([
          workspaceArgs("build").join(" "),
          `build -p ${packageSpec(workspace.root, "rust", own)} --all-features`,
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs a second whole-workspace build whose environment differs in the same batch process, each in a stage of its own",
    async () => {
      // pb's .env gives its build other RUSTFLAGS, so its group builds the
      // whole workspace into the same folder with another environment.
      const workspace = FixtureWorkspace.create("workspace-tests", binaries, {
        "rust/crates/pb/.env": "RUSTFLAGS=--cfg nx_rust_flag\n",
      });
      try {
        const restored = await buildAndRestore(workspace);
        expect(restored).toEqual({ pa: "plain", pb: "plain flag" });
        workspace.cargo.clear();
        const run = await runNx(workspace, [
          "run-many",
          "-t",
          "build",
          "-p",
          "pa",
          "pb",
          "--skip-nx-cache",
        ]);
        expect(run.status).toBe(0);
        // One batch, as Nx reports it, with each group's own status line, one
        // staged whole-workspace build each.
        expect(
          run.output.match(/Running \d+ tasks? with @convesoft\/nx-rust:cargo-outputs/g),
        ).toHaveLength(1);
        expect(
          run.output.match(/@convesoft\/nx-rust: cargo build for \w+ \(step 1 of 1\)/g)?.sort(),
        ).toEqual([
          "@convesoft/nx-rust: cargo build for pa (step 1 of 1)",
          "@convesoft/nx-rust: cargo build for pb (step 1 of 1)",
        ]);
        expect(taskCalls(workspace).map((call) => call.args)).toEqual([
          workspaceArgs("build"),
          workspaceArgs("build"),
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
