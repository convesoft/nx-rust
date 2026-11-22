import type { ExecutorContext, ProjectConfiguration } from "@nx/devkit";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { hostTriple } from "../src/cargo/host-triple";
import { type CargoTargetOptions, cargoSteps } from "../src/executors/command";
import { declaredOptionsOf } from "../src/executors/declared-options";
import { formGroups, planGroups } from "../src/executors/groups";
import { type PluginExecutor, type PreparedTask, prepareTask } from "../src/executors/task";
import { testModeNote } from "../src/executors/test-mode";
import { cargoExecutor } from "../src/graph/targets";
import {
  describeCacheKeyMatrix,
  expectStatus,
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  packageSpec,
  runNx,
  StubCargoAffected,
  taskCalls,
  taskOutput,
  testEnvironment,
  withoutRunner,
  workspaceTestSteps,
  writeBaseline,
} from "./harness";

// The parts of VER-TESTING about the `test` option, which runs one test
// target of a crate as cargo's `--test` does (DES-TEST-RUN, "One test
// target"): the commands of both runners, the groups of one crate that such
// tasks form under every strategy (DES-BATCH, "Groups of one crate"), runs
// with the real cargo through Nx, the cache keys with Nx's own hasher, and
// the test mode, in which such a task never selects (DES-TEST-MODE).

const spec = "path+file:///w/rust/crates/a#0.1.0";

describe("the commands of a test task with the test option", () => {
  const one = { target: "test" as const, crates: [{ name: "a", spec }], locked: false };

  it("passes --test to cargo test after the crate, beside the other flags", () => {
    expect(cargoSteps(one, { test: "it", profile: "release" })).toEqual([
      { kind: "command", args: ["test", "-p", spec, "--test", "it", "--profile", "release"] },
    ]);
    expect(cargoSteps({ ...one, locked: true }, { test: "perf*" })).toEqual([
      { kind: "command", args: ["test", "-p", spec, "--test", "perf*", "--locked"] },
    ]);
  });

  it("passes --test to cargo nextest run and leaves out the doctest step", () => {
    const nextest = { ...one, testRunner: "nextest" as const };
    expect(cargoSteps(nextest, { test: "it", profile: "release" })).toEqual([
      {
        kind: "command",
        args: [
          "nextest",
          "run",
          "--no-tests=pass",
          "-p",
          spec,
          "--test",
          "it",
          "--cargo-profile",
          "release",
        ],
      },
    ]);
    // Without the option, the doctests keep their step.
    expect(cargoSteps(nextest, {}).map((step) => step.kind)).toEqual(["command", "doctests"]);
  });

  it("refuses a command that would select more than its crate", () => {
    const two = { ...one, crates: [...one.crates, { name: "b", spec: `${spec}b` }] };
    const options: CargoTargetOptions = { test: "it" };
    expect(() => cargoSteps({ ...two, testRunner: "nextest" }, options)).toThrow(
      /group of one crate/,
    );
    const runner = { host: "x86_64-unknown-linux-gnu", command: ["node", "runner.js"] };
    expect(() => cargoSteps({ ...one, workspace: true }, options, runner)).toThrow(
      /group of one crate/,
    );
  });

  it("says in the test mode note that the task runs the whole named target", () => {
    expect(
      testModeNote("a:test", { kind: "affected", commits: ["c0ffee"], reason: "x" }, false, "it"),
    ).toBe(
      'a:test: runs the test target "it" that its option test names, as in test mode full, and selects no affected tests; the test mode is affected:c0ffee.',
    );
  });
});

const executor: PluginExecutor = {
  name: cargoExecutor,
  shortName: "cargo",
  declared: declaredOptionsOf(cargoExecutor),
  serves: (target) =>
    target !== "build" && target !== "doc" && target !== "run" && target !== "lockfile",
};

/** Prepares the `test` task of each crate with the given options, as the batch does. */
async function prepare(
  workspace: FixtureWorkspace,
  tasks: readonly [string, CargoTargetOptions][],
  env: NodeJS.ProcessEnv,
): Promise<PreparedTask[]> {
  const { projects } = await workspace.graph();
  const configurations: Record<string, ProjectConfiguration> = projects;
  return tasks.map(([crate, given]) => {
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
    const options = { ...configurations[crate].targets?.test?.options, ...given };
    return prepareTask(executor, options, context, env);
  });
}

/** How each planned group selects, with its crates. */
function plan(tasks: readonly PreparedTask[]): string[] {
  return planGroups(formGroups(tasks, true), true).map(
    (group) => `${group.selection.kind} ${group.tasks.map((task) => task.crate).join(",")}`,
  );
}

/** A folder with a `cargo-nextest` that only answers `--version`, for the tool check. */
function versionOnlyNextest(): string {
  const folder = mkdtempSync(join(tmpdir(), "nx-rust-nextest-version-"));
  const file = join(folder, "cargo-nextest");
  writeFileSync(file, "#!/bin/sh\nprintf 'cargo-nextest 0.9.152\\n'\n");
  chmodSync(file, 0o755);
  return folder;
}

describe("groups and test modes of test tasks with the test option", () => {
  it(
    "puts each such task in a group of one crate under every strategy, also beside tasks with the same value",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests");
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const tasks = await prepare(
          workspace,
          [
            ["a", { test: "it" }],
            ["b", { test: "it" }],
            ["c", { test: "other" }],
            ["d", {}],
            ["shared", {}],
          ],
          env,
        );
        expect(plan(tasks)).toEqual(["alone a", "alone b", "alone c", "workspace d,shared"]);
        // Under hakari with the host among its platforms, and under cargo,
        // the ordinary tasks share a command that selects them with -p.
        const host = hostTriple(join(workspace.root, "rust"), env);
        expect(host).toBeDefined();
        for (const strategy of ["hakari", "cargo"] as const) {
          expect(
            plan(
              tasks.map((task) => ({
                ...task,
                featureUnification: strategy,
                hakariPlatforms: [host as string],
              })),
            ),
          ).toEqual(["alone a", "alone b", "alone c", "crates d,shared"]);
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "never selects affected tests in mode affected, and runs the named target without doctests",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        "rust/Cargo.toml": (manifest) =>
          `${manifest}\n[workspace.metadata.nx]\ntestRunner = "nextest"\naffectedTests = true\n`,
      });
      const stub = new StubCargoAffected();
      const nextest = versionOnlyNextest();
      try {
        const base = testEnvironment({ NX_RUST_TEST_MODE: "affected" });
        const env = workspace.cargo.environment({
          ...base,
          PATH: [stub.folder, nextest, base.PATH].filter(Boolean).join(delimiter),
        });
        const sha = "a".repeat(40);
        writeBaseline(join(workspace.root, "rust"), [sha]);
        const [selected, whole] = await prepare(
          workspace,
          [
            ["a", { test: "it" }],
            ["b", {}],
          ],
          env,
        );
        expect(selected.testMode).toEqual({
          mode: expect.objectContaining({ kind: "affected", commits: [sha] }),
          selects: false,
          note: `a:test: runs the test target "it" that its option test names, as in test mode full, and selects no affected tests; the test mode is affected:${sha}.`,
        });
        // b, without the option, selects.
        expect(whole.testMode?.selects).toBe(true);
        expect(plan([selected, whole])).toEqual(["alone a", "workspace b"]);
      } finally {
        rmSync(nextest, { recursive: true, force: true });
        stub.remove();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/** Crate a with a failing unit test, a failing doctest and a failing test target `other`. */
const failingBesideIt: FileChanges = {
  "rust/crates/a/src/lib.rs": (source) =>
    (source ?? "")
      .replace("/// assert_eq!(a::a(), 1);", '/// assert_eq!(a::a(), 2, "a\'s doctest fails");')
      .replace("assert_eq!(super::a(), 1);", 'assert_eq!(super::a(), 2, "a\'s unit test fails");'),
  "rust/crates/a/tests/other.rs":
    '#[test]\nfn a_other_test() {\n    panic!("a\'s other target fails");\n}\n',
};

/** The `test` commands that the cargo wrapper logged. */
function testCalls(workspace: FixtureWorkspace): string[] {
  return taskCalls(workspace)
    .filter((call) => call.args[0] === "test" || call.args[0] === "nextest")
    .map((call) => call.args.join(" "))
    .sort();
}

/** The tasks that Nx lists as failed. */
function failedTasks(output: string): string[] {
  const list = /Failed tasks:\n\n((?:- \S+\n?)+)/.exec(output)?.[1] ?? "";
  return list
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2))
    .sort();
}

describe("test tasks with the test option through Nx", () => {
  it(
    "runs only the named test target of the crate with cargo test, also with the release profile, and fails on its tests or an unknown name",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", failingBesideIt);
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const a = packageSpec(workspace.root, "rust", "a");
        workspace.cargo.clear();
        const it = await runNx(workspace, ["run", "a:test", "--test=it"], env);
        expectStatus(it, 0);
        expect(testCalls(workspace)).toEqual([`test -p ${a} --test it`]);
        expect(it.output).toMatch(/test a_integration_test \.\.\. ok/);
        expect(it.output).not.toMatch(/a_unit_test|a_other_test|Doc-tests/);

        // The selected result serves the same selection, and not the full
        // suite of the same crate, which runs and fails on a's unit test.
        workspace.cargo.clear();
        const again = await runNx(workspace, ["run", "a:test", "--test=it"], env);
        expectStatus(again, 0);
        expect(testCalls(workspace)).toEqual([]);
        workspace.cargo.clear();
        const full = await runNx(workspace, ["run", "a:test"], env);
        expectStatus(full, 1);
        expect(testCalls(workspace)).toContain("test --workspace --no-run");
        expect(full.output).toContain("a's unit test fails");

        workspace.cargo.clear();
        const release = await runNx(
          workspace,
          ["run", "a:test", "--test=it", "--profile=release"],
          env,
        );
        expectStatus(release, 0);
        expect(testCalls(workspace)).toEqual([`test -p ${a} --test it --profile release`]);

        const other = await runNx(workspace, ["run", "a:test", "--test=other"], env);
        expectStatus(other, 1);
        expect(other.output).toContain("a's other target fails");

        const unknown = await runNx(workspace, ["run", "a:test", "--test=nosuch"], env);
        expectStatus(unknown, 1);
        expect(unknown.output).toMatch(
          /no test target named `nosuch` in `\S+\/crates\/a#0\.1\.0` package/,
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs each crate's named target in a cargo command of its own in a batch, and fails a crate without that target",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests");
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const [a, b, h] = ["a", "b", "h"].map((crate) =>
          packageSpec(workspace.root, "rust", crate),
        );
        workspace.cargo.clear();
        const run = await runNx(
          workspace,
          ["run-many", "-t", "test", "-p", "a,b,h", "--test=it"],
          env,
        );
        expectStatus(run, 1);
        expect(failedTasks(run.output)).toEqual(["h:test"]);
        expect(testCalls(workspace)).toEqual(
          [`test -p ${a} --test it`, `test -p ${b} --test it`, `test -p ${h} --test it`].sort(),
        );
        expect(taskOutput(run.output, "h:test")).toMatch(
          /no test target named `it` in `\S+\/crates\/h#0\.1\.0` package/,
        );
        expect(taskOutput(run.output, "a:test")).toMatch(/test a_integration_test \.\.\. ok/);
        expect(taskOutput(run.output, "a:test")).not.toMatch(/a_unit_test|Doc-tests/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs a task with the option in its own command beside a whole-workspace group under workspace-build, each task with its own result",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        ...failingBesideIt,
        "rust/crates/a/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx.targets.test.options]\ntest = "it"\n`,
        "rust/crates/b/src/lib.rs": (source) =>
          (source ?? "").replace(
            "assert_eq!(super::b(), 2);",
            'assert_eq!(super::b(), 3, "b\'s unit test fails");',
          ),
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const a = packageSpec(workspace.root, "rust", "a");
        workspace.cargo.clear();
        const run = await runNx(workspace, ["run-many", "-t", "test", "-p", "a,b,h"], env);
        expectStatus(run, 1);
        expect(failedTasks(run.output)).toEqual(["b:test"]);
        expect(testCalls(workspace).map(withoutRunner)).toEqual(
          [`test -p ${a} --test it`, ...workspaceTestSteps()].sort(),
        );
        expect(taskOutput(run.output, "a:test")).toMatch(/test a_integration_test \.\.\. ok/);
        expect(taskOutput(run.output, "a:test")).not.toMatch(/a's unit test fails|Doc-tests a\b/);
        expect(taskOutput(run.output, "b:test")).toContain("b's unit test fails");
        expect(taskOutput(run.output, "h:test")).toContain("h's test without harness passes");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "keeps the executable that Nx restored for build where the option selects a target with test = false",
    async () => {
      // untested's binary prints "plain" as cargo build writes it and "extra"
      // as a cargo test of its `test = false` target `skipped` rewrites it.
      const workspace = FixtureWorkspace.create("binary-tests", {
        "rust/crates/untested/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx.targets.test.options]\ntest = "skipped"\n`,
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const untested = packageSpec(workspace.root, "rust", "untested");
        const executable = join(workspace.root, "rust", "target", "debug", "untested");
        const printed = () => execFileSync(executable, { encoding: "utf8" }).trim();
        expectStatus(await runNx(workspace, ["build", "untested"], env), 0);
        expect(printed()).toBe("plain");
        workspace.cargo.clear();
        const run = await runNx(
          workspace,
          ["run-many", "-t", "build,test", "-p", "untested", "--parallel=1"],
          env,
        );
        expectStatus(run, 0);
        // build came from the cache, and test ran the selected target; under
        // workspace-build it also waited for the builds of the other crates
        // whose executables a whole-workspace cargo test replaces.
        expect(run.output).toMatch(
          /> nx run untested:build {2}\[(local cache|existing outputs match the cache, left as is)\]/,
        );
        expect(testCalls(workspace)).toEqual([`test -p ${untested} --test skipped`]);
        expect(run.output).toMatch(/test passes \.\.\. ok/);
        expect(existsSync(executable)).toBe(true);
        expect(printed()).toBe("plain");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/** Whether cargo finds `cargo nextest` with the tests' environment. */
function nextestInstalled(): boolean {
  const run = spawnSync("cargo", ["nextest", "--version"], {
    env: testEnvironment(),
    stdio: "ignore",
  });
  return run.status === 0;
}

const withNextest = nextestInstalled();
if (!withNextest) {
  it.todo(
    "the test option with the real cargo-nextest: it is not installed where cargo looks for it (PATH or the Cargo home), so these checks are skipped; install it as https://nexte.st/docs/installation/ describes to run them",
  );
}
const describeWithNextest = withNextest ? describe : describe.skip;

describeWithNextest("test tasks with the test option and the nextest runner", () => {
  it(
    "runs the named target in mode affected without asking cargo-affected, and leaves the next full run of the crate its own run",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        ...failingBesideIt,
        "rust/Cargo.toml": (manifest) =>
          `${manifest}\n[workspace.metadata.nx]\ntestRunner = "nextest"\naffectedTests = true\n`,
      });
      // The stand-in for cargo-affected that the affected specs use.
      const stub = new StubCargoAffected();
      try {
        const base = testEnvironment({ NX_RUST_TEST_MODE: "affected" });
        const env = workspace.cargo.environment({
          ...base,
          PATH: [stub.folder, base.PATH].filter(Boolean).join(delimiter),
          NX_RUST_STUB_AFFECTED_LOG: stub.log,
        });
        const sha = "a".repeat(40);
        writeBaseline(join(workspace.root, "rust"), [sha]);
        const a = packageSpec(workspace.root, "rust", "a");
        workspace.cargo.clear();
        const selected = await runNx(workspace, ["run", "a:test", "--test=it"], env);
        expectStatus(selected, 0);
        expect(selected.output).toContain(
          `a:test: runs the test target "it" that its option test names, as in test mode full, and selects no affected tests; the test mode is affected:${sha}.`,
        );
        expect(testCalls(workspace)).toEqual([`nextest run --no-tests=pass -p ${a} --test it`]);
        expect(existsSync(stub.log)).toBe(false);

        // The crate's run without the option is not served by the selected
        // result: it runs its tests, and fails on a's unit test.
        workspace.cargo.clear();
        const whole = await runNx(workspace, ["run", "a:test"], env);
        expectStatus(whole, 1);
        expect(whole.output).toContain(`a:test: test mode affected:${sha}`);
        expect(testCalls(workspace).some((call) => call.startsWith("nextest run"))).toBe(true);
        expect(whole.output).toContain("a's unit test fails");
      } finally {
        stub.remove();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs only the named test target with cargo nextest run and no doctest step, also with the release profile",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", {
        ...failingBesideIt,
        "rust/Cargo.toml": (manifest) =>
          `${manifest}\n[workspace.metadata.nx]\ntestRunner = "nextest"\n`,
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const a = packageSpec(workspace.root, "rust", "a");
        workspace.cargo.clear();
        const it = await runNx(workspace, ["run", "a:test", "--test=it", "--profile=release"], env);
        expectStatus(it, 0);
        expect(testCalls(workspace)).toEqual([
          `nextest run --no-tests=pass -p ${a} --test it --cargo-profile release`,
        ]);
        expect(it.output).toMatch(/PASS .* a::it a_integration_test/);
        expect(it.output).not.toMatch(/a_unit_test|a_other_test|Doc-tests/);

        const other = await runNx(workspace, ["run", "a:test", "--test=other"], env);
        expectStatus(other, 1);
        expect(other.output).toContain("a's other target fails");

        const unknown = await runNx(workspace, ["run", "a:test", "--test=nosuch"], env);
        expectStatus(unknown, 1);
        expect(unknown.output).toMatch(
          /no test target named `nosuch` in `\S+\/crates\/a#0\.1\.0` package/,
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describeCacheKeyMatrix("keys of test with the test option", [
  {
    change: "the test option given on the command line",
    fixture: "workspace-tests",
    after: { overrides: { test: "it" } },
    keys: { "a:test": "must differ" },
  },
  {
    change: "another value of the test option on the command line",
    fixture: "workspace-tests",
    before: { overrides: { test: "it" } },
    after: { overrides: { test: "other" } },
    keys: { "a:test": "must differ" },
  },
]);

describe("keys of test with a configuration that sets the test option", () => {
  it(
    "gives each configuration a key other than that of the target without it",
    async () => {
      const configurations = (it: string, other: string): FileChanges => ({
        "rust/crates/a/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx.targets.test.configurations.it]\ntest = "${it}"\n\n[package.metadata.nx.targets.test.configurations.other]\ntest = "${other}"\n`,
      });
      const workspace = FixtureWorkspace.create("workspace-tests", configurations("it", "other"));
      try {
        const hashes = await workspace.hashTasks(["a:test", "a:test:it", "a:test:other"]);
        const values = Object.values(hashes).map((hash) => hash.value);
        expect(new Set(values).size).toBe(3);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
