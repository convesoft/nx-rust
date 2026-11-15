import type { ExecutorContext, ProjectConfiguration, Task } from "@nx/devkit";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  type CommandEnd,
  commandEnd,
  type OutputCrate,
  readJsonStep,
  readTestStep,
} from "../src/executors/cargo-output";
import { type BatchReport, runBatch } from "../src/executors/batch";
import { declaredOptionsOf } from "../src/executors/declared-options";
import { formGroups, groupsShareCommands } from "../src/executors/groups";
import { type GroupMember, runGroup } from "../src/executors/group-run";
import {
  type GroupInvocation,
  groupInvocations,
  type PluginExecutor,
  type PreparedTask,
  prepareTask,
} from "../src/executors/task";
import * as taskModule from "../src/executors/task";
import { cargoExecutor, cargoOutputsExecutor, outputsTargets } from "../src/graph/targets";
import {
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  packageSpec,
  testEnvironment,
} from "./harness";

// The part of VER-BATCHING that runs a group of several crates with one cargo
// command per step (DES-BATCH), with a real cargo in copies of the
// batch-groups fixture: the group runner that the batch executor uses for
// every group. Until a strategy of DES-UNIFICATION lets crates share a
// command (nxr-8f9dz2), the batch forms only groups of one crate
// (groupsShareCommands), so these tests form their groups with sharing on and
// run them through the runner, as the batch would.

const executors: Record<string, PluginExecutor> = {
  cargo: {
    name: cargoExecutor,
    shortName: "cargo",
    declared: declaredOptionsOf(cargoExecutor),
    serves: (target) => !outputsTargets.has(target) && target !== "run" && target !== "lockfile",
  },
  outputs: {
    name: cargoOutputsExecutor,
    shortName: "cargo-outputs",
    declared: declaredOptionsOf(cargoOutputsExecutor),
    serves: (target) => outputsTargets.has(target),
  },
};

/** A crate of batch-groups whose library does not compile. */
const brokenLibrary: FileChanges = {
  "rust/crates/breakable/src/lib.rs": "pub fn breakable() -> u32 {\n    not_defined_anywhere\n}\n",
};

/** scripted's build script panics. */
const failingBuildScript: FileChanges = {
  "rust/crates/scripted/build.rs":
    'fn main() {\n    panic!("the build script of scripted fails");\n}\n',
};

/** indep's integration test fails. */
const failingTest: FileChanges = {
  "rust/crates/indep/tests/it.rs":
    '#[test]\nfn indep_is_three() {\n    assert_eq!(indep::indep(), 4, "indep is not four");\n}\n',
};

interface Prepared extends PreparedTask {
  context: ExecutorContext;
}

/**
 * Prepares the tasks of `target` of `crates` as the batch does, each with an
 * executor context of its own whose task graph holds nothing else, so that
 * no task checks the lockfile's digests or the order of `test` and `build`,
 * which the batch tests through Nx check. The build input check is left out
 * here too: it needs the project graph of a real Nx run.
 */
async function prepare(
  workspace: FixtureWorkspace,
  target: string,
  crates: readonly string[],
  env: NodeJS.ProcessEnv = workspace.cargo.environment(testEnvironment()),
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
      // As Nx gives it to an executor: a node for each project, which Nx's
      // getEnvFilesForTask reads for the task's dotenv files.
      projectGraph: {
        nodes: Object.fromEntries(
          Object.entries(configurations).map(([name, data]) => [name, { name, type: "lib", data }]),
        ),
        dependencies: {},
      },
      taskGraph: { tasks: {}, dependencies: {}, continuousDependencies: {}, roots: [] },
    };
    const executor = outputsTargets.has(target as never) ? executors.outputs : executors.cargo;
    const options = { ...configurations[crate].targets?.[target]?.options };
    const { records: _records, ...prepared } = prepareTask(executor, options, context, env);
    return { ...prepared, context };
  });
}

/** Forms the tasks' groups with sharing on, expects one, and runs it. */
async function runShared(
  workspace: FixtureWorkspace,
  tasks: readonly Prepared[],
): Promise<Record<string, { success: boolean; output: string }>> {
  const groups = formGroups(tasks, true);
  expect(groups).toHaveLength(1);
  const [group] = groups;
  const invocations = groupInvocations(group, workspace.root);
  const members: GroupMember[] = group.map((task, index) => {
    const invocation = invocations[index];
    if (typeof invocation === "string") {
      throw new Error(invocation);
    }
    return { prepared: task, invocation, context: task.context };
  });
  const results = await runGroup(members);
  return Object.fromEntries(group.map((task, index) => [task.crate as string, results[index]]));
}

/** The task calls of cargo that the wrapper logged, as their arguments, `metadata` included. */
function calls(workspace: FixtureWorkspace): string[] {
  return workspace.cargoCalls().map((call) => call.args.join(" "));
}

/** How the plugin selects `crate` of batch-groups, as the wrapper logs it. */
function spec(workspace: FixtureWorkspace, crate: string): string {
  return packageSpec(workspace.root, "rust", crate);
}

function passed(results: Record<string, { success: boolean }>): string[] {
  return Object.entries(results)
    .filter(([, result]) => result.success)
    .map(([crate]) => crate)
    .sort();
}

const all = ["base", "breakable", "dep", "devuser", "indep", "scripted", "user"];

describe("a group of several crates", () => {
  it("is not formed by the batch until a strategy lets crates share a command (nxr-8f9dz2)", () => {
    expect(groupsShareCommands).toBe(false);
  });

  it(
    "runs one check for all its crates, with --keep-going and JSON messages, selecting each by the specifications of one cargo metadata call",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups");
      try {
        const tasks = await prepare(workspace, "check", all);
        workspace.cargo.clear();
        const results = await runShared(workspace, tasks);
        expect(passed(results)).toEqual(all);
        expect(calls(workspace)).toEqual([
          "metadata --format-version 1 --no-deps",
          [
            "check --all-targets --keep-going --message-format=json",
            ...all.map((crate) => `-p ${spec(workspace, crate)}`),
          ].join(" "),
        ]);
        // Each task's output holds its own crate's lines and not another's.
        expect(results.base.output).toMatch(/Checking base v0\.1\.0/);
        expect(results.base.output).not.toMatch(/Checking indep v0\.1\.0/);
        expect(results.indep.output).toMatch(/Checking indep v0\.1\.0/);
        expect(results.base.output).toMatch(/Finished `dev` profile/);
        expect(results.base.output).not.toMatch(/"reason":/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails in a check only the crates that do not compile, whose build script fails or that need such a crate, and names the failed crates",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", brokenLibrary, failingBuildScript);
      try {
        const results = await runShared(workspace, await prepare(workspace, "check", all));
        // devuser needs breakable only for its unit test: cargo checks its
        // library and leaves out its test, which a check of devuser alone
        // fails on.
        expect(passed(results)).toEqual(["base", "dep", "indep"]);
        expect(results.breakable.output).toMatch(/not_defined_anywhere/);
        const failed =
          "cargo reported `breakable` and `scripted` as failed: a task fails when its own crate fails or when it needs a crate that failed.";
        expect(results.breakable.output).toContain(
          `breakable:check: cargo reported errors in breakable, and cargo did not report these targets of breakable as built: the library, the library compiled as a test. ${failed}`,
        );
        expect(results.user.output).toContain(
          `user:check: cargo did not report these targets of user as built: the library, the library compiled as a test. ${failed}`,
        );
        expect(results.devuser.output).toContain(
          `devuser:check: cargo did not report this target of devuser as built: the library compiled as a test. ${failed}`,
        );
        expect(results.scripted.output).toMatch(/the build script of scripted fails/);
        expect(results.scripted.output).toContain(
          `scripted:check: cargo did not report these targets of scripted as built: the library, the library compiled as a test. ${failed}`,
        );
        // An unrelated crate passes with a warning, and without the error
        // of the broken crate in its output.
        expect(results.base.output).toMatch(
          /check: cargo failed, but not for base: its output shows every target of base that this task builds as built, and no error in it\./,
        );
        expect(results.base.output).not.toMatch(/not_defined_anywhere/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails in a build the crate that does not compile and the crates that need it, from the JSON artifacts",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", brokenLibrary);
      try {
        const crates = ["base", "breakable", "dep", "user"];
        const tasks = await prepare(workspace, "build", crates);
        workspace.cargo.clear();
        const results = await runShared(workspace, tasks);
        expect(passed(results)).toEqual(["base", "dep"]);
        // For the cached builds' artifact directory (DES-OUTPUTS), one report
        // of Cargo's directories, and one of the members, for the group.
        expect(calls(workspace)).toEqual([
          "metadata --format-version 1 --no-deps --manifest-path {workspaceRoot}/rust/Cargo.toml",
          "metadata --format-version 1 --no-deps",
          [
            "build --keep-going --message-format=json",
            ...crates.map((crate) => `-p ${spec(workspace, crate)}`),
          ].join(" "),
        ]);
        expect(results.user.output).toContain(
          "user:build: cargo did not report this target of user as built: the library. cargo reported `breakable` as failed",
        );
        expect(results.base.output).not.toMatch(/not_defined_anywhere/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs one cargo test with --no-fail-fast, and a failing test fails its crate's task and no other",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", failingTest);
      try {
        const crates = ["base", "dep", "indep"];
        const tasks = await prepare(workspace, "test", crates);
        workspace.cargo.clear();
        const results = await runShared(workspace, tasks);
        expect(passed(results)).toEqual(["base", "dep"]);
        expect(calls(workspace)).toEqual([
          "metadata --format-version 1 --no-deps",
          ["test --no-fail-fast", ...crates.map((crate) => `-p ${spec(workspace, crate)}`)].join(
            " ",
          ),
        ]);
        expect(results.indep.output).toMatch(/indep is not four/);
        expect(results.indep.output).toMatch(
          /indep:test: a test target of indep failed: `-p indep --test it`\./,
        );
        // Each crate's blocks are its own: the doctest of base runs in base's.
        expect(results.base.output).toMatch(/Doc-tests base/);
        expect(results.base.output).toMatch(
          /test crates\/base\/src\/lib\.rs - base \(line 3\) \.\.\. ok/,
        );
        expect(results.dep.output).not.toMatch(/Doc-tests base/);
        expect(results.base.output).not.toMatch(/indep is not four/);
        expect(results.dep.output).toMatch(/dep_is_two \.\.\. ok/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails every test task of the step after a compile error, naming the crate that did not compile and saying that the other tests were not run",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", brokenLibrary);
      try {
        const results = await runShared(
          workspace,
          await prepare(workspace, "test", ["base", "breakable", "indep"]),
        );
        expect(passed(results)).toEqual([]);
        for (const crate of ["base", "breakable", "indep"]) {
          expect(results[crate].output).toContain(
            `${crate}:test: the tests of ${crate} were not run: cargo test stopped before running any test, because \`breakable\` did not compile. The tests of every crate of this cargo command were not run.`,
          );
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the command of a group of several crates in a verbose batch", () => {
  it(
    "is printed once by the batch process, before cargo runs, naming every task of the command, and goes into no task's output",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups");
      const written: string[] = [];
      const write = jest.spyOn(process.stderr, "write").mockImplementation(((
        chunk: string | Uint8Array,
        ...rest: unknown[]
      ) => {
        written.push(String(chunk));
        const done = rest.find((arg) => typeof arg === "function") as (() => void) | undefined;
        done?.();
        return true;
      }) as typeof process.stderr.write);
      try {
        const tasks = await prepare(workspace, "check", ["base", "dep"]);
        const groups = formGroups(tasks, true);
        const invocations = groupInvocations(groups[0], workspace.root);
        const members = groups[0].map((task, index) => ({
          prepared: task,
          invocation: invocations[index] as GroupInvocation,
          context: task.context,
        }));
        const results = await runGroup(members, true);
        write.mockRestore();
        // The wrapper's log writes the repository root as {workspaceRoot}.
        const absolute = (logged: string) => logged.replace("{workspaceRoot}", workspace.root);
        const heading =
          "base:check, dep:check: @convesoft/nx-rust runs cargo as these lines do in a POSIX shell:";
        const blocks = written
          .join("")
          .split("\n")
          .filter((line) => line.includes("runs cargo as these lines do"));
        expect(blocks).toEqual([heading]);
        expect(written.join("")).toContain(
          `  cargo check --all-targets --keep-going --message-format=json -p '${absolute(spec(workspace, "base"))}' -p '${absolute(spec(workspace, "dep"))}'`,
        );
        for (const result of results) {
          expect(result.success).toBe(true);
          expect(result.output).not.toContain("runs cargo as these lines do");
        }
      } finally {
        write.mockRestore();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the groups of a batch", () => {
  it(
    "put tasks into one group only where their commands differ in nothing but their crates, and an ignored option splits no group",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups", {
        // An option that the executor does not know, with different values.
        "rust/crates/base/project.json": JSON.stringify({
          targets: { check: { options: { passWithNoTests: true } } },
        }),
        "rust/crates/dep/project.json": JSON.stringify({
          targets: { check: { options: { passWithNoTests: false } } },
        }),
        // Options that shape the command: a profile, and the switch for --all-targets.
        "rust/crates/indep/project.json": JSON.stringify({
          targets: { check: { options: { profile: "release" } } },
        }),
        "rust/crates/scripted/project.json": JSON.stringify({
          targets: { check: { options: { allTargets: false } } },
        }),
      });
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const tasks = await prepare(
          workspace,
          "check",
          ["base", "dep", "indep", "user", "scripted"],
          env,
        );
        expect(tasks[0].warnings).toEqual([
          expect.stringContaining("base:check: ignoring option `passWithNoTests`"),
        ]);
        const crates = (groups: Prepared[][]) =>
          groups.map((group) => group.map((task) => task.crate));
        expect(crates(formGroups(tasks, true))).toEqual([
          ["base", "dep", "user"],
          ["indep"],
          ["scripted"],
        ]);
        // The batch's own grouping, until nxr-8f9dz2: one crate per group.
        expect(crates(formGroups(tasks))).toEqual([
          ["base"],
          ["dep"],
          ["indep"],
          ["user"],
          ["scripted"],
        ]);
        // Another environment splits a group.
        const other = await prepare(workspace, "check", ["dep"], {
          ...env,
          RUSTFLAGS: "--cfg nx_rust_other",
        });
        expect(crates(formGroups([tasks[0], other[0], tasks[3]], true))).toEqual([
          ["base", "user"],
          ["dep"],
        ]);
        // Tasks of two kinds never share a group.
        const tests = await prepare(workspace, "test", ["base"], env);
        expect(crates(formGroups([tasks[0], tests[0]], true))).toEqual([["base"], ["base"]]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the batch", () => {
  it("reports every task it receives as failed, and throws nothing, where it cannot rebuild the tasks' environments", async () => {
    const task = (project: string): Task => ({
      id: `${project}:check`,
      target: { project, target: "check" },
      overrides: {},
      outputs: [],
      parallelism: true,
      continuous: false,
      cache: true,
    });
    const tasks = { "a:check": task("a"), "b:check": task("b") };
    const reports: BatchReport[] = [];
    // Without a project graph, Nx's function for a task's environment cannot run.
    for await (const report of runBatch(
      executors.cargo,
      { tasks, dependencies: {}, continuousDependencies: {}, roots: Object.keys(tasks) },
      {},
      // A context that lacks what Nx 24 always gives, as a broken Nx might.
      { root: "/nowhere", cwd: "/nowhere", isVerbose: false } as unknown as ExecutorContext,
    )) {
      reports.push(report);
    }
    expect(reports.map(({ task, result }) => [task, result.success, result.status])).toEqual([
      ["a:check", false, "failure"],
      ["b:check", false, "failure"],
    ]);
    expect(reports[0].result.terminalOutput).toBe(
      "a:check: @convesoft/nx-rust cannot rebuild this task's environment in a batch, because Nx gave the batch no project graph. The task does not run, so that Nx stores no result for it. Run the tasks with --batch=false, or use an Nx version that @convesoft/nx-rust supports.\n",
    );
  });
});

describe("the output of a command for several crates, where it is not whole", () => {
  const crates: OutputCrate[] = ["base", "dep"].map((name) => ({
    task: `${name}:test`,
    name,
    spec: `path+file:///repo/rust/crates/${name}#0.1.0`,
    selection: {},
  }));
  const failed: CommandEnd = { kind: "failed" };
  const passedNames = (outcomes: { passed: boolean }[]) =>
    crates.filter((_, index) => outcomes[index].passed).map((crate) => crate.name);

  it("fails every test task where the list of failed targets is shorter than its first line announces, malformed, or followed by a signal", () => {
    const list = (header: string, ...entries: string[]) =>
      ["   Doc-tests base", "test result: ok.", header, ...entries].join("\n");
    // A whole list that names dep only: base passes, the control.
    expect(
      passedNames(
        readTestStep(list("error: 1 target failed:", "    `-p dep --lib`"), failed, crates),
      ),
    ).toEqual(["base"]);
    // Cut short: two announced, one listed.
    const short = readTestStep(
      list("error: 2 targets failed:", "    `-p dep --lib`"),
      failed,
      crates,
    );
    expect(passedNames(short)).toEqual([]);
    expect(short[0].message).toContain("cargo announced 2 failed test targets and listed 1");
    // Announced, and nothing listed, as when cargo was killed right after the header.
    expect(passedNames(readTestStep(list("error: 1 target failed:"), failed, crates))).toEqual([]);
    // A line of the list that names no target.
    const malformed = readTestStep(list("error: 1 target failed:", "    -p dep"), failed, crates);
    expect(passedNames(malformed)).toEqual([]);
    expect(malformed[0].message).toContain("malformed");
    // A whole list, but cargo ended by a signal.
    const stopped = readTestStep(
      list("error: 1 target failed:", "    `-p dep --lib`"),
      commandEnd(null, "SIGTERM"),
      crates,
    );
    expect(passedNames(stopped)).toEqual([]);
    expect(stopped[0].message).toContain("cargo was stopped by SIGTERM");
    // A status that cargo gives no failed command.
    expect(passedNames(readTestStep("", commandEnd(1, null), crates))).toEqual([]);
  });

  it("fails every task of a JSON step whose messages end without build-finished, hold a line cut short, or contradict cargo's status", () => {
    const artifact = (name: string) =>
      JSON.stringify({
        reason: "compiler-artifact",
        package_id: `path+file:///repo/rust/crates/${name}#0.1.0`,
        target: { name, kind: ["lib"] },
        profile: { test: false },
      });
    const finished = (success: boolean) => JSON.stringify({ reason: "build-finished", success });
    const lib = (name: string) =>
      ({
        name,
        id: "",
        version: "0.1.0",
        manifest_path: `/repo/rust/crates/${name}/Cargo.toml`,
        dependencies: [],
        targets: [{ name, kind: ["lib"] }],
        features: {},
        metadata: null,
      }) as never;
    const withPackages = crates.map((crate) => ({ ...crate, package: lib(crate.name) }));
    const read = (lines: string[], end: CommandEnd) =>
      passedNames(readJsonStep(lines.join("\n"), end, withPackages, false));
    // The control: both libraries built, cargo succeeded.
    expect(
      read([artifact("base"), artifact("dep"), finished(true)], { kind: "succeeded" }),
    ).toEqual(["base", "dep"]);
    // And where cargo failed elsewhere, both were still shown built.
    expect(read([artifact("base"), artifact("dep"), finished(false)], failed)).toEqual([
      "base",
      "dep",
    ]);
    expect(read([artifact("base"), artifact("dep")], failed)).toEqual([]);
    expect(read([artifact("base"), artifact("dep")], { kind: "succeeded" })).toEqual([]);
    expect(read([artifact("base"), artifact("dep").slice(0, 40)], failed)).toEqual([]);
    expect(
      read([artifact("base"), artifact("dep"), finished(false)], { kind: "succeeded" }),
    ).toEqual([]);
    expect(
      read([artifact("base"), artifact("dep"), finished(true)], commandEnd(null, "SIGKILL")),
    ).toEqual([]);
  });

  it(
    "fails both test tasks of a group whose cargo prints that one target failed and is then killed by SIGTERM",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups");
      const folder = mkdtempSync(join(tmpdir(), "nx-rust-killed-cargo-"));
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const real = spawnSync("sh", ["-c", "command -v cargo"], {
          env,
          encoding: "utf8",
        }).stdout.trim();
        writeFileSync(
          join(folder, "cargo"),
          `#!/bin/sh\nif [ "$1" = test ]; then\n  echo "error: 1 target failed:" >&2\n  kill -TERM $$\nfi\nexec ${JSON.stringify(real)} "$@"\n`,
          { mode: 0o755 },
        );
        const killing = { ...env, PATH: `${folder}${delimiter}${env.PATH ?? ""}` };
        const results = await runShared(
          workspace,
          await prepare(workspace, "test", ["base", "dep"], killing),
        );
        expect(passed(results)).toEqual([]);
        for (const crate of ["base", "dep"]) {
          expect(results[crate].output).toContain(`${crate}:test: cargo was stopped by SIGTERM.`);
        }
      } finally {
        rmSync(folder, { recursive: true, force: true });
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the preparation of a batch's tasks", () => {
  it(
    "fails only the task whose preparation throws an unexpected error, and runs the others",
    async () => {
      const workspace = FixtureWorkspace.create("batch-groups");
      const original = taskModule.prepareTask;
      const prepare = jest.spyOn(taskModule, "prepareTask");
      const runId = process.env.NX_RUST_RUN_ID;
      try {
        const { projects } = await workspace.graph();
        const task = (project: string): Task => ({
          id: `${project}:check`,
          target: { project, target: "check" },
          projectRoot: projects[project].root,
          overrides: {},
          outputs: [],
          parallelism: true,
          continuous: false,
          cache: true,
        });
        const tasks = { "base:check": task("base"), "indep:check": task("indep") };
        const graph = {
          tasks,
          dependencies: {},
          continuousDependencies: {},
          roots: Object.keys(tasks),
        };
        prepare.mockImplementation((executor, options, context, env) => {
          if (context.projectName === "base") {
            throw new Error("an error injected for base");
          }
          return original(executor, options, context, env);
        });
        // A run that excludes task dependencies: the tasks need no lockfile task.
        process.env.NX_RUST_RUN_ID = "a run without the lockfile task";
        const reports: BatchReport[] = [];
        for await (const report of runBatch(
          executors.cargo,
          graph,
          { "base:check": { allTargets: true }, "indep:check": { allTargets: true } },
          {
            root: workspace.root,
            cwd: workspace.root,
            isVerbose: false,
            projectsConfigurations: { version: 2, projects },
            nxJsonConfiguration: {},
            projectGraph: {
              nodes: Object.fromEntries(
                Object.entries(projects).map(([name, data]) => [name, { name, type: "lib", data }]),
              ),
              dependencies: {},
            },
            taskGraph: graph,
          },
        )) {
          reports.push(report);
        }
        const byTask = Object.fromEntries(reports.map(({ task, result }) => [task, result]));
        expect(byTask["base:check"].success).toBe(false);
        expect(byTask["base:check"].terminalOutput).toContain(
          "base:check: @convesoft/nx-rust could not prepare this task in its batch. The task does not run, so that Nx stores no result for it.",
        );
        expect(byTask["base:check"].terminalOutput).toContain("an error injected for base");
        expect(byTask["indep:check"]).toMatchObject({
          success: true,
          status: "success",
          terminalOutput: expect.stringMatching(/Checking indep v0\.1\.0/),
        });
        expect(byTask["indep:check"].terminalOutput).not.toContain("injected");
      } finally {
        if (runId === undefined) {
          delete process.env.NX_RUST_RUN_ID;
        } else {
          process.env.NX_RUST_RUN_ID = runId;
        }
        prepare.mockRestore();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("a list of failed targets that a test prints", () => {
  const crates: OutputCrate[] = ["base", "dep"].map((name) => ({
    task: `${name}:test`,
    name,
    spec: `path+file:///repo/rust/crates/${name}#0.1.0`,
    selection: {},
  }));
  const passedNames = (outcomes: { passed: boolean }[]) =>
    crates.filter((_, index) => outcomes[index].passed).map((crate) => crate.name);

  it("changes nothing where cargo's own list ends the output, and fails every task where a list does not end it", () => {
    const forged = ["error: 1 target failed:", "    `-p base --lib`"];
    const real = ["error: 1 target failed:", "    `-p dep --lib`"];
    const body = [
      "     Running tests/forge.rs (target/debug/deps/forge-0123456789abcdef)",
      ...forged,
      "   Doc-tests base",
      "test result: ok.",
    ];
    expect(
      passedNames(readTestStep([...body, ...real].join("\n"), { kind: "failed" }, crates)),
    ).toEqual(["base"]);
    // The forged list is the last one, and output follows it: not cargo's list.
    const dangling = readTestStep(body.join("\n"), { kind: "failed" }, crates);
    expect(passedNames(dangling)).toEqual([]);
    expect(dangling[0].message).toContain(
      "the list of failed test targets that ends cargo's output is malformed or does not end it",
    );
  });

  it(
    "leaves a passing crate whose test prints a forged list passing, and fails the crate that cargo's own list names, with real cargo",
    async () => {
      const forge =
        'fn main() {\n    println!("error: 1 target failed:");\n    println!("    `-p dep --lib`");\n    eprintln!("error: 1 target failed:");\n    eprintln!("    `-p dep --lib`");\n}\n';
      const workspace = FixtureWorkspace.create("batch-groups", {
        "rust/crates/base/Cargo.toml": (manifest = "") =>
          `${manifest}\n[[test]]\nname = "forge"\nharness = false\n`,
        "rust/crates/base/tests/forge.rs": forge,
        "rust/crates/indep/tests/it.rs":
          '#[test]\nfn indep_is_three() {\n    assert_eq!(indep::indep(), 4, "indep is not four");\n}\n',
      });
      try {
        const results = await runShared(
          workspace,
          await prepare(workspace, "test", ["base", "dep", "indep"]),
        );
        expect(passed(results)).toEqual(["base", "dep"]);
        expect(results.indep.output).toContain(
          "indep:test: a test target of indep failed: `-p indep --test it`.",
        );
        // The forged lines are in base's output, as its test printed them.
        expect(results.base.output).toContain("`-p dep --lib`");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
