import type { ExecutorContext, ProjectConfiguration } from "@nx/devkit";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { declaredOptionsOf } from "../src/executors/declared-options";
import { type GroupMember, runGroup } from "../src/executors/group-run";
import { formGroups, planGroups } from "../src/executors/groups";
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
  runNx,
  taskCalls,
  taskOutput,
  testEnvironment,
} from "./harness";

// The parts of VER-TESTING and VER-BATCHING ("Tests under workspace-build")
// that run the nextest runner, with the real cargo-nextest in copies of the
// workspace-tests fixture whose workspace sets testRunner = "nextest": groups
// formed, planned and run as the batch runs them, and runs through Nx.
// cargo-nextest is the user's to install (ADR-V1-SCOPE), and the plugin
// installs nothing: where it is missing, these tests skip and say so, and
// missing-tools.spec.ts checks the task's message for a missing nextest.

/** Whether cargo finds `cargo nextest` with the tests' environment. */
function nextestInstalled(): boolean {
  const run = spawnSync("cargo", ["nextest", "--version"], {
    env: testEnvironment(),
    stdio: "ignore",
  });
  return run.status === 0;
}

const installed = nextestInstalled();
if (!installed) {
  it.todo(
    "the nextest runner with the real tool: cargo-nextest is not installed where cargo looks for it (PATH or the Cargo home), so these checks are skipped; install it as https://nexte.st/docs/installation/ describes to run them",
  );
}
const describeWithNextest = installed ? describe : describe.skip;

/** The workspace table that chooses the nextest runner. */
const nextestRunner: FileChanges = {
  "rust/Cargo.toml": (manifest) => `${manifest}\n[workspace.metadata.nx]\ntestRunner = "nextest"\n`,
};

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

/** Prepares the `test` tasks of `crates` as the batch does. */
async function prepare(
  workspace: FixtureWorkspace,
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
      targetName: "test",
      target: configurations[crate].targets?.test,
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
    const options = { ...configurations[crate].targets?.test?.options };
    return { ...prepareTask(executor, options, context, env), context };
  });
}

/** Forms and plans the tasks' groups, expects one that selects the whole workspace, and runs it. */
async function runWorkspaceGroup(
  workspace: FixtureWorkspace,
  tasks: readonly Prepared[],
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
  const results = await runGroup(members, false, "none");
  return Object.fromEntries(group.map((task, index) => [task.crate as string, results[index]]));
}

/**
 * The cargo calls of `test` tasks, with the path of the plugin's tool
 * configuration replaced; a run through Nx also builds the binaries that
 * the tests wait for.
 */
function calls(workspace: FixtureWorkspace): string[] {
  return taskCalls(workspace)
    .filter((call) => call.args[0] === "nextest" || call.args[0] === "test")
    .map((call) => call.args.join(" ").replace(/nx-rust:\/\S+\/nextest\.toml/, "nx-rust:FILE"));
}

function passed(results: Record<string, { success: boolean }>): string[] {
  return Object.entries(results)
    .filter(([, result]) => result.success)
    .map(([crate]) => crate)
    .sort();
}

const groupCommand = (packages: string) =>
  `nextest run --tool-config-file nx-rust:FILE --workspace --no-fail-fast --no-tests=pass -E ${packages}`;
const listCommand = (packages: string) =>
  `nextest list --message-format json --workspace -E ${packages}`;
const doctestCommand = "test --workspace --doc --no-fail-fast";

/** a's library with a test `must_run` that fails, beside its passing unit test. */
const failingMustRun: FileChanges = {
  "rust/crates/a/src/lib.rs": (source) =>
    `${source}\n#[cfg(test)]\nmod t {\n    #[test]\n    fn must_run() {\n        panic!("a's must_run fails");\n    }\n}\n`,
};

describeWithNextest("test with the nextest runner under workspace-build", () => {
  it(
    "runs one cargo nextest run with the filterset of the group's packages and one doctest step for the whole workspace, and runs no test of another crate",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", nextestRunner);
      try {
        const env = workspace.cargo.environment(testEnvironment({ NX_RUST_FIXTURE_FAIL: "1" }));
        const tasks = await prepare(workspace, ["a", "b"], env);
        expect(tasks.map((task) => task.testRunner)).toEqual(["nextest", "nextest"]);
        workspace.cargo.clear();
        const results = await runWorkspaceGroup(workspace, tasks);
        expect(passed(results)).toEqual(["a", "b"]);
        expect(calls(workspace)).toEqual([
          groupCommand("package(=a) | package(=b)"),
          doctestCommand,
        ]);
        expect(calls(workspace).join("\n")).not.toMatch(/--profile|--ignore-default-filter|runner/);
        // c's tests did not run: the filterset left them out.
        const rust = join(workspace.root, "rust");
        expect(existsSync(join(rust, "c-unit-test-ran"))).toBe(false);
        expect(existsSync(join(rust, "c-integration-test-ran"))).toBe(false);
        const { a, b } = results;
        expect(a.output).toMatch(/PASS .* a tests::a_unit_test/);
        expect(a.output).toMatch(/PASS .* a::it a_integration_test/);
        expect(a.output).toMatch(/Doc-tests a/);
        expect(a.output).toContain("a:test: nextest ran 2 tests of a, as its JUnit report shows.");
        expect(b.output).toMatch(/PASS .* b tests::b_unit_test/);
        expect(b.output).not.toMatch(/ a tests::a_unit_test|Doc-tests a\b/);
        expect(a.output).not.toMatch(/ b tests::b_unit_test|Doc-tests b\b/);
        for (const result of [a, b]) {
          // nextest's own lines on the run, and c's failing doctest as a warning.
          expect(result.output).toMatch(/Starting 4 tests across \d+ binar/);
          expect(result.output).toMatch(/Summary .* 4 tests run: 4 passed/);
          expect(result.output).toMatch(/warning: the doctests of `c` failed/);
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails only the task whose crate's test or doctest fails, through the JUnit report and the doctest list, and passes a crate without tests",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        ...nextestRunner,
        "rust/crates/c/src/lib.rs":
          'pub fn c() -> u32 {\n    3\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn c_unit_test() {\n        assert_eq!(super::c(), 4, "c\'s unit test fails");\n    }\n}\n',
        "rust/crates/c/tests/it.rs": "#[test]\nfn c_integration_test() {}\n",
        // d's only tests are doctests, and one of them fails.
        "rust/crates/d/src/lib.rs": (source) =>
          source.replace("assert_ne!(d::d(), 5)", "assert_ne!(d::d(), 4)"),
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const results = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, ["a", "c", "d"], env),
        );
        expect(passed(results)).toEqual(["a"]);
        expect(results.c.output).toMatch(/c's unit test fails/);
        expect(results.c.output).toContain("c:test: a test of c failed: c tests::c_unit_test.");
        expect(results.a.output).not.toMatch(/c's unit test fails/);
        expect(results.d.output).toContain("d:test: nextest ran no test of d");
        expect(results.d.output).toMatch(/d:test: a doctest target of d failed/);
        // A group whose only crate has no test passes, and one without a
        // library has no doctest step.
        for (const [crate, steps] of [
          ["shared", [groupCommand("package(=shared)"), doctestCommand]],
          ["tool", [groupCommand("package(=tool)")]],
        ] as const) {
          workspace.cargo.clear();
          const alone = await runWorkspaceGroup(workspace, await prepare(workspace, [crate], env));
          expect(passed(alone)).toEqual([crate]);
          expect(calls(workspace)).toEqual(steps);
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails every task of the group where a crate does not compile, also outside the selection, and names that crate",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        ...nextestRunner,
        "rust/crates/c/tests/it.rs": "#[test]\nfn broken() {\n    not_defined_anywhere();\n}\n",
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const results = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, ["a", "b"], env),
        );
        expect(passed(results)).toEqual([]);
        for (const name of ["a", "b"]) {
          expect(results[name].output).toContain(
            `${name}:test: the tests of ${name} were not run: cargo nextest run stopped before running any test, because \`c\`, which is outside the selection of this run`,
          );
        }
        // The nextest step failed every task, so the doctests did not run.
        expect(calls(workspace)).toEqual([groupCommand("package(=a) | package(=b)")]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describeWithNextest("the repository's nextest configuration", () => {
  const configuration = (text: string): FileChanges => ({
    ...nextestRunner,
    ...failingMustRun,
    "rust/.config/nextest.toml": text,
  });

  it(
    "applies the default filter and the profile that NEXTEST_PROFILE chooses, as a plain cargo nextest run does",
    async () => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        configuration(
          '[profile.default]\ndefault-filter = "not test(=t::must_run)"\n\n[profile.ci]\ndefault-filter = "all()"\n',
        ),
      );
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const skipped = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, ["a", "b"], env),
        );
        expect(passed(skipped)).toEqual(["a", "b"]);
        expect(skipped.a.output).toMatch(
          /Starting 4 tests across \d+ binaries \(1 test and \d+ binaries skipped, including 1 test via profile\.default\.default-filter\)/,
        );
        expect(skipped.a.output).toContain("a:test: nextest ran 2 tests of a");

        const ci = workspace.cargo.environment(testEnvironment({ NEXTEST_PROFILE: "ci" }));
        const all = await runWorkspaceGroup(workspace, await prepare(workspace, ["a", "b"], ci));
        expect(passed(all)).toEqual(["b"]);
        expect(all.a.output).toContain("a:test: a test of a failed: a t::must_run.");
        expect(all.a.output).toMatch(/a's must_run fails/);
        expect(calls(workspace).join("\n")).not.toMatch(/--profile|--ignore-default-filter/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails every task of the group, saying why, where the repository's profile sets its own junit.path and a test fails, and passes where every test passes",
    async () => {
      const ownPath: FileChanges = {
        ...nextestRunner,
        "rust/.config/nextest.toml": '[profile.default.junit]\npath = "repo-junit.xml"\n',
      };
      const workspace = FixtureWorkspace.create("workspace-tests", ownPath, failingMustRun);
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const failing = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, ["a", "b"], env),
        );
        expect(passed(failing)).toEqual([]);
        expect(failing.b.output).toMatch(
          /b:test: nextest exited with status 100, which it gives where a test failed or the run ended early, and wrote no JUnit report to \S+junit\.xml, the file that @convesoft\/nx-rust's tool configuration names\. .*sets its own junit\.path/,
        );
        expect(
          existsSync(
            join(workspace.root, "rust", "target", "nextest", "default", "repo-junit.xml"),
          ),
        ).toBe(true);

        workspace.reset(ownPath);
        const passing = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, ["a", "b"], env),
        );
        expect(passed(passing)).toEqual(["a", "b"]);
        expect(passing.a.output).toMatch(/wrote no JUnit report .* so the number of tests/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describeWithNextest("a run that nextest ends early", () => {
  /** One test at a time, a's tests first, and `extra` added to the default profile. */
  const ordered = (extra = ""): FileChanges => ({
    ...nextestRunner,
    "rust/.config/nextest.toml": `[profile.default]\ntest-threads = 1\n${extra}\n[[profile.default.overrides]]\nfilter = "package(a)"\npriority = 10\n`,
  });
  /** a's integration test runs `body` and then sleeps three seconds. */
  const slowA = (body = ""): FileChanges => ({
    "rust/crates/a/tests/it.rs": `#[test]\nfn a_integration_test() {\n${body}    std::thread::sleep(std::time::Duration::from_secs(3));\n}\n`,
  });

  for (const [how, files] of [
    ["a global timeout", { ...ordered('global-timeout = "1s"'), ...slowA() }],
    [
      "an interrupt",
      {
        ...ordered(),
        ...slowA(
          '    let nextest = std::os::unix::process::parent_id().to_string();\n    std::process::Command::new("kill").args(["-INT", &nextest]).status().unwrap();\n',
        ),
      },
    ],
  ] as const) {
    it(
      `fails the task of a crate whose tests did not run after ${how} ended the run, and lists the tests that the run was to run`,
      async () => {
        const workspace = FixtureWorkspace.create("workspace-tests", files);
        try {
          const env = workspace.cargo.environment(testEnvironment());
          workspace.cargo.clear();
          const results = await runWorkspaceGroup(
            workspace,
            await prepare(workspace, ["a", "b"], env),
          );
          expect(passed(results)).toEqual([]);
          expect(results.b.output).toContain(
            "b:test: the run was not complete: nextest did not run 2 of the 2 tests of b that it was to run",
          );
          expect(results.a.output).toContain(
            "a:test: a test of a failed: a::it a_integration_test.",
          );
          expect(calls(workspace)).toEqual([
            groupCommand("package(=a) | package(=b)"),
            listCommand("package(=a) | package(=b)"),
          ]);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  }

  it(
    "runs every test in spite of fail-fast and max-fail in the repository's profile, so that a crate whose tests passed passes",
    async () => {
      for (const setting of ["fail-fast = true", "fail-fast = { max-fail = 1 }"]) {
        const workspace = FixtureWorkspace.create(
          "workspace-tests",
          ordered(setting),
          failingMustRun,
        );
        try {
          const env = workspace.cargo.environment(testEnvironment());
          const results = await runWorkspaceGroup(
            workspace,
            await prepare(workspace, ["a", "b"], env),
          );
          expect({ setting, passed: passed(results) }).toEqual({ setting, passed: ["b"] });
          expect(results.b.output).toContain("b:test: nextest ran 2 tests of b");
        } finally {
          workspace.remove();
        }
      }
    },
    HARNESS_TIMEOUT,
  );

  const setupScripts = (command: string): FileChanges => ({
    ...nextestRunner,
    "rust/.config/nextest.toml": `experimental = ["setup-scripts"]\n\n[scripts.setup.prepare]\ncommand = "${command}"\n\n[[profile.default.scripts]]\nfilter = "all()"\nsetup = "prepare"\n`,
  });

  it(
    "passes the tasks where a setup script passed, and fails every task, naming the script, where it failed",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", setupScripts("true"));
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const passing = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, ["a", "b"], env),
        );
        expect(passing.a.output).toContain("a:test: nextest ran 2 tests of a");
        expect(passed(passing)).toEqual(["a", "b"]);

        workspace.reset(setupScripts("false"));
        workspace.cargo.clear();
        const failing = await runWorkspaceGroup(
          workspace,
          await prepare(workspace, ["a", "b"], env),
        );
        expect(passed(failing)).toEqual([]);
        expect(failing.b.output).toContain(
          "b:test: the setup script `prepare` of the repository's nextest configuration failed",
        );
        expect(calls(workspace)).toEqual([groupCommand("package(=a) | package(=b)")]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describeWithNextest("nextest through Nx", () => {
  it(
    "runs a batched test run as one nextest run, its list where a test failed and one doctest step, gives each task its own result, and restores both from the cache",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        ...nextestRunner,
        ...failingMustRun,
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        workspace.cargo.clear();
        const first = await runNx(workspace, ["run-many", "-t", "test", "-p", "a,b"], env);
        expect(first.status).toBe(1);
        // A test failed: nextest's list says which tests the run was to run.
        expect(calls(workspace)).toEqual([
          groupCommand("package(=a) | package(=b)"),
          listCommand("package(=a) | package(=b)"),
          doctestCommand,
        ]);
        expect(taskOutput(first.output, "a:test")).toContain(
          "a:test: a test of a failed: a t::must_run.",
        );
        expect(taskOutput(first.output, "b:test")).toContain("b:test: nextest ran 2 tests of b");
        expect(taskOutput(first.output, "b:test")).not.toMatch(/must_run/);

        // b passed and is restored; a failed and runs again, alone in its
        // group, whose doctest step is left out once its only task failed.
        workspace.cargo.clear();
        await runNx(workspace, ["run-many", "-t", "test", "-p", "a,b"], env);
        expect(calls(workspace)).toEqual([groupCommand("package(=a)"), listCommand("package(=a)")]);

        // On its own, without a batch, the task runs the same steps.
        workspace.cargo.clear();
        const alone = await runNx(
          workspace,
          ["run", "b:test", "--skip-nx-cache", "--batch=false"],
          env,
        );
        expect(alone.status).toBe(0);
        expect(alone.output).toContain("b:test: nextest ran 2 tests of b");
        expect(calls(workspace)).toEqual([groupCommand("package(=b)"), doctestCommand]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs a crate whose own options set a feature set in plain commands of its own, with -p",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        ...nextestRunner,
        "rust/crates/shared/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx.targets.test.options]\nfeatures = ["x"]\n`,
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        workspace.cargo.clear();
        const run = await runNx(workspace, ["run", "shared:test"], env);
        expect(run.status).toBe(0);
        const spec = expect.stringMatching(/^path\+file:\/\/\S+\/rust\/crates\/shared#0\.1\.0$/);
        expect(
          taskCalls(workspace)
            .map((call) => call.args)
            .filter(([command]) => command === "nextest" || command === "test"),
        ).toEqual([
          ["nextest", "run", "--no-tests=pass", "-p", spec, "--features", "x"],
          ["test", "-p", spec, "--doc", "--features", "x"],
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
