import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import {
  Env,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  holdCargo,
  lockfileCalls,
  runNx,
  taskCalls,
  testEnvironment,
  withoutRunner,
  workspaceArgs,
  workspaceTestSteps,
} from "./harness";

// Runs of a crate whose cargo test replaces the executable of its build, with
// a real cargo and real Nx runs: the checks of VER-TARGETS about the
// dependency of test on the crate's own build (DES-TARGETS) and the
// executor's guard for it. In binary-tests, app's dev-dependency turns on
// the feature that makes its executable print "extra", and its integration
// test runs CARGO_BIN_EXE_app and expects "extra", as plain cargo test
// passes it; cargo build writes an executable that prints "plain".

const executable = "rust/target/debug/app";

/** How Nx marks a task that it restored from the cache. */
const hit = String.raw`\[(local cache|existing outputs match the cache, left as is)\]`;

function restored(output: string, task: string): boolean {
  return new RegExp(`nx run ${task}\\s+${hit}`).test(output);
}

/** The cargo calls of tasks, in the order the wrapper logged them, as their arguments. */
function calls(workspace: FixtureWorkspace): string[] {
  return taskCalls(workspace).map((call) => withoutRunner(call.args.join(" ")));
}

/**
 * The cargo commands of a build group under workspace-build, which builds
 * the whole workspace, and of a test group of binary crates, which have no
 * doctest step (DES-TEST-RUN).
 */
const buildCall = workspaceArgs("build").join(" ");
const testCalls = workspaceTestSteps([], false);

/** Runs Nx after forgetting the logged cargo calls. */
async function nx(
  workspace: FixtureWorkspace,
  args: string[],
  env: Env = {},
): Promise<{ status: number | null; output: string }> {
  workspace.cargo.clear();
  return runNx(workspace, args, env);
}

/** Runs cargo in the workspace's Cargo workspace, with nothing logged. */
function cargo(workspace: FixtureWorkspace, ...args: string[]): void {
  execFileSync("cargo", args, {
    cwd: join(workspace.root, "rust"),
    env: testEnvironment(),
    stdio: "pipe",
  });
}

/** What the executable at `path` prints. */
function prints(workspace: FixtureWorkspace, path = executable): string {
  return execFileSync(join(workspace.root, path), { encoding: "utf8" }).trim();
}

/** Whether `condition` holds within `ms` milliseconds, asked every 50 ms. */
async function within(ms: number, condition: () => boolean): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < ms;) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return condition();
}

/**
 * Each task's ordinary and continuous dependencies, by task id, in the task
 * graph that `nx <args> --graph=<file>` writes without running a task.
 */
async function taskGraph(
  workspace: FixtureWorkspace,
  args: string[],
): Promise<Record<"dependencies" | "continuousDependencies", Record<string, string[]>>> {
  // Beside the copy, in its own folder, so that Nx does not see it.
  const file = join(workspace.root, "..", "task-graph.json");
  const { status, output } = await workspace.nx([...args, `--graph=${file}`]);
  expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
  const { tasks } = JSON.parse(readFileSync(file, "utf8"));
  const ids = (edges: Record<string, (string | { id: string })[]> = {}) =>
    Object.fromEntries(
      Object.entries(edges).map(([task, on]) => [
        task,
        on.map((edge) => (typeof edge === "string" ? edge : edge.id)),
      ]),
    );
  return {
    dependencies: ids(tasks.dependencies),
    continuousDependencies: ids(tasks.continuousDependencies),
  };
}

/** Sets the options of the plugin's entry in a fixture copy's `nx.json`. */
function pluginOptions(options: object): (nxJson: string) => string {
  return (nxJson) => {
    const config = JSON.parse(nxJson);
    config.plugins = config.plugins.map((entry: string | { plugin: string }) => ({
      plugin: typeof entry === "string" ? entry : entry.plugin,
      options,
    }));
    return JSON.stringify(config);
  };
}

describe("a crate whose cargo test replaces the executable of its build", () => {
  it.each<[string, string[]]>([
    ["", []],
    [" with --exclude-task-dependencies", ["--exclude-task-dependencies"]],
  ])(
    "runs its test only once its build has ended, so that Nx stores the executable of cargo build and the integration test runs its own%s",
    async (_case, flags) => {
      const workspace = FixtureWorkspace.create("binary-tests");
      // Plain cargo warms the build directory for both executables, as a
      // build directory restored in CI is, so that neither call compiles.
      cargo(workspace, "build", "-p", "app");
      cargo(workspace, "test", "-p", "app", "--no-run");
      const hold = holdCargo("build");
      try {
        const run = nx(
          workspace,
          ["run-many", "-t", "build", "test", "-p", "app", "--batch=false", ...flags],
          hold.env,
        );
        await hold.held();
        // While the cargo call of app:build waits, no cargo test starts. The
        // run schedules task by task (--batch=false): without the dependency,
        // Nx then starts app:test before the first poll of held(), while a run
        // that prefers batches holds app:test back either way, so that only
        // this run shows the order (nxr-7v04ge).
        const early = await within(1000, () =>
          calls(workspace).some((call) => call.startsWith("test")),
        );
        hold.release();
        const { status, output } = await run;

        expect(early).toBe(false);
        expect(status).toBe(0);
        // Task by task, each build that app:test waits for, app's among them,
        // runs its own cargo call of the group's command, and all of them run
        // before cargo test.
        const log = calls(workspace);
        const builds = log.slice(0, -testCalls.length);
        expect(log.slice(builds.length)).toEqual(testCalls);
        expect(builds).not.toHaveLength(0);
        expect(builds).toEqual(builds.map(() => buildCall));
        expect(output).toMatch(/test runs_the_executable_that_cargo_test_built \.\.\. ok/);
        // Task by task, the artifact directory holds what cargo test wrote
        // last, as plain cargo build and then cargo test leave it; a test
        // run on its own puts back nothing (DES-BATCH, "Files that a test
        // batch puts back").
        expect(prints(workspace)).toBe("extra");

        // The entry stored for app:build holds what cargo build writes. A run
        // that excludes task dependencies stores what no later run restores
        // (DES-LOCKFILE-HASHING).
        if (flags.length > 0) {
          return;
        }
        rmSync(join(workspace.root, executable));
        const again = await nx(workspace, ["run", "app:build"]);
        expect(again.status).toBe(0);
        expect(restored(again.output, "app:build")).toBe(true);
        expect(calls(workspace)).toEqual([]);
        expect(lockfileCalls(workspace)).toHaveLength(1);
        const stored = readFileSync(join(workspace.root, executable));
        expect(prints(workspace)).toBe("plain");
        cargo(workspace, "build", "-p", "app");
        expect(readFileSync(join(workspace.root, executable)).equals(stored)).toBe(true);
      } finally {
        hold.release();
        hold.remove();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs or restores its build before its test where a command names test alone, and a crate of another shape runs its test alone",
    async () => {
      const workspace = FixtureWorkspace.create("binary-tests");
      try {
        const first = await nx(workspace, ["run", "app:test"]);
        expect(first.status).toBe(0);
        // app's test waits for the build of every crate whose executables
        // its whole-workspace cargo test replaces, which share one command.
        expect(calls(workspace)).toEqual([buildCall, ...testCalls]);

        const second = await nx(workspace, ["run", "app:test"]);
        expect(second.status).toBe(0);
        expect(restored(second.output, "app:build")).toBe(true);
        expect(restored(second.output, "app:test")).toBe(true);
        expect(calls(workspace)).toEqual([]);
        expect(lockfileCalls(workspace)).toHaveLength(1);

        // showcase has a binary and an example only: its test waits for the
        // same builds, which Nx restores.
        const other = await nx(workspace, ["run", "showcase:test"]);
        expect(other.status).toBe(0);
        expect(restored(other.output, "app:build")).toBe(true);
        expect(calls(workspace)).toEqual(testCalls);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, { build: string; test: string; lockfile: string }]>([
    ["", { build: "build", test: "test", lockfile: "lockfile" }],
    [
      ", also under the names that targetNames gives",
      { build: "compile", test: "verify", lockfile: "digests" },
    ],
  ])(
    "fails its test before cargo runs where a project.json takes away the dependency on build and the run holds build, and runs it where the run does not%s",
    async (_case, names) => {
      const workspace = FixtureWorkspace.create("binary-tests", {
        "rust/crates/app/project.json": JSON.stringify({
          targets: {
            [names.test]: { dependsOn: [{ projects: ["directory:rust"], target: names.lockfile }] },
          },
        }),
        ...(names.build === "build" ? {} : { "nx.json": pluginOptions({ targetNames: names }) }),
      });
      try {
        const both = await nx(workspace, ["run-many", "-t", names.build, names.test, "-p", "app"]);

        expect(both.status).toBe(1);
        expect(both.output).toContain(
          `app:${names.test}: cargo test replaces the executables that app:${names.build} declares as its outputs, because the crate has a binary and an integration test or a bench that cargo test builds, and this run holds app:${names.build} without the dependency of app:${names.test} on it that @convesoft/nx-rust infers.`,
        );
        expect(both.output).toContain(
          `Make sure that no configuration replaces the dependsOn of app:${names.test}: run \`nx show target app:${names.test} --json\` and look under \`sourceMap\` for the file and entry, and keep the plugin's entries with "...", as in "dependsOn": ["...", "^codegen"].`,
        );
        expect(calls(workspace)).toEqual([buildCall]);

        // Without app's build in the run, nothing can overlap.
        const alone = await nx(workspace, ["run", `app:${names.test}`]);
        expect(alone.status).toBe(0);
        expect(calls(workspace)).toEqual(testCalls);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // A continuous task that keeps running until the command ends, like a
  // server that the tests talk to.
  const helper = (dependsOn: string[]) => ({
    executor: "nx:run-commands",
    options: { command: 'node -e "setInterval(() => {}, 1000)"' },
    continuous: true,
    dependsOn,
  });
  const lockfileTask = { projects: ["directory:rust"], target: "lockfile" };

  it(
    "runs its test where the dependency on build goes through a continuous task that waits for build, because Nx starts that task only once build has ended",
    async () => {
      const workspace = FixtureWorkspace.create("binary-tests", {
        "rust/crates/app/project.json": JSON.stringify({
          targets: {
            test: { dependsOn: [lockfileTask, "bridge"] },
            bridge: helper(["build"]),
          },
        }),
      });
      try {
        const run = await nx(workspace, ["run", "app:test"]);

        expect(run.status).toBe(0);
        expect(run.output).not.toContain("cargo test replaces the executables");
        expect(calls(workspace)).toEqual([buildCall, ...testCalls]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails its test before cargo runs where it depends only on a continuous task that does not wait for build, and the run holds build",
    async () => {
      const workspace = FixtureWorkspace.create("binary-tests", {
        "rust/crates/app/project.json": JSON.stringify({
          targets: {
            test: { dependsOn: [lockfileTask, "bridge"] },
            bridge: helper([]),
          },
        }),
      });
      try {
        const run = await nx(workspace, ["run-many", "-t", "build", "test", "-p", "app"]);

        expect(run.status).toBe(1);
        expect(run.output).toContain(
          "app:test: cargo test replaces the executables that app:build declares as its outputs",
        );
        expect(calls(workspace)).toEqual([buildCall]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails its test before cargo runs where build is itself continuous, so that test depends on it only as a continuous dependency",
    async () => {
      // Nx records every edge into a continuous task as a continuous one, and
      // refuses to cache a continuous target.
      // test keeps only its own build, so that it starts once that build has
      // started: the builds of the other crates whose executables its
      // whole-workspace cargo test replaces would hold it back until the
      // continuous build had exited and Nx had ended the run.
      const workspace = FixtureWorkspace.create("binary-tests", {
        "rust/crates/app/project.json": JSON.stringify({
          targets: {
            build: { continuous: true, cache: false },
            test: { dependsOn: [lockfileTask, "build"] },
          },
        }),
      });
      try {
        // The run holds app:build, and reaches it only as a continuous
        // dependency, as the task graph shows without running a task.
        const graph = await taskGraph(workspace, ["run", "app:test"]);
        expect(graph.continuousDependencies["app:test"]).toContain("app:build");
        expect(graph.dependencies["app:test"]).not.toContain("app:build");

        const run = await nx(workspace, ["run", "app:test"]);

        expect(run.status).toBe(1);
        expect(run.output).toContain(
          "app:test: cargo test replaces the executables that app:build declares as its outputs",
        );
        // Once app:test has failed, Nx ends the run and stops the continuous
        // app:build, which may or may not have reached its cargo call by then.
        expect(calls(workspace).filter((call) => call.startsWith("test"))).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/**
 * A cached JS target `pack` that depends on app's build, and on its test so
 * that it runs after the test batch, with app as an implicit dependency and
 * the inputs `default` and `^default`, and writes what app's executable
 * prints to `dist/out.txt` (EVD-BATCH-FILES-ON-DISK).
 */
const pack = {
  "tools/pack/project.json": `${JSON.stringify({
    name: "pack",
    implicitDependencies: ["app"],
    targets: {
      pack: {
        command: "mkdir -p dist && ./rust/target/debug/app > dist/out.txt",
        options: { cwd: "{workspaceRoot}" },
        cache: true,
        inputs: ["default", "^default"],
        outputs: ["{workspaceRoot}/dist"],
        dependsOn: [
          { target: "build", projects: ["app"] },
          { target: "test", projects: ["app"] },
        ],
      },
    },
  })}\n`,
};

/** What `pack` wrote, or `missing`. */
function packed(workspace: FixtureWorkspace): string {
  const file = join(workspace.root, "dist", "out.txt");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "missing";
}

/** The stages left in the artifact directory, in which a test group keeps files. */
function stagesLeft(workspace: FixtureWorkspace): string[] {
  const folder = join(workspace.root, "rust", "target", ".nx-rust-stage");
  return existsSync(folder) ? readdirSync(folder) : [];
}

/** The files that a running test group keeps in its stage, relative to the stage. */
function keptFiles(workspace: FixtureWorkspace): string[] {
  return stagesLeft(workspace).flatMap((stage) => {
    const folder = join(workspace.root, "rust", "target", ".nx-rust-stage", stage);
    return readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter((name) => !name.startsWith(".") && statSync(join(folder, name)).isFile())
      .map((name) => name.split(sep).join("/"))
      .sort();
  });
}

/** The tasks that Nx lists as failed at the end of a run. */
function failedTasks(output: string): string[] {
  const list = /Failed tasks:\n\n((?:- \S+\n?)+)/.exec(output)?.[1] ?? "";
  return [...list.matchAll(/^- (\S+)$/gm)].map((match) => match[1]).sort();
}

/** The lines in which plain cargo, run in the Cargo workspace, says that it compiles a crate. */
function plainCompiles(workspace: FixtureWorkspace, ...args: string[]): string[] {
  const run = spawnSync("cargo", args, {
    cwd: join(workspace.root, "rust"),
    env: testEnvironment(),
    encoding: "utf8",
  });
  expect({ status: run.status, stderr: run.status === 0 ? "" : run.stderr }).toEqual({
    status: 0,
    stderr: "",
  });
  return run.stderr.split("\n").filter((line) => /^\s*Compiling /.test(line));
}

// VER-BATCHING, "Files that a test batch puts back" of DES-BATCH: a test
// batch puts back the executables of the command's builds when it ends, so
// that a cached task outside the plugin that depends on such a build and
// starts after the batch reads what the build stored (ADR-TEST-AFTER-BUILD,
// nxr-5hzxra).
describe("a test batch after the builds of its command", () => {
  it(
    "puts back the executable of build, which a cached task outside the plugin then reads and stores, and leaves plain cargo nothing more to compile",
    async () => {
      const workspace = FixtureWorkspace.create("binary-tests", pack);
      try {
        const run = await nx(workspace, ["run-many", "-t", "build", "test", "pack"]);
        expect({ status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
          status: 0,
          output: "",
        });
        // The integration test ran the executable of cargo test.
        expect(run.output).toMatch(/test runs_the_executable_that_cargo_test_built \.\.\. ok/);
        expect({
          app: prints(workspace),
          pack: packed(workspace),
          stages: stagesLeft(workspace),
        }).toEqual({ app: "plain", pack: "plain", stages: [] });

        // The stored pack matches the stored build of app, which Nx restores
        // with it.
        rmSync(join(workspace.root, "dist"), { recursive: true, force: true });
        rmSync(join(workspace.root, executable));
        const again = await nx(workspace, ["run", "pack:pack"]);
        expect(again.status).toBe(0);
        expect(again.output).toMatch(/nx run pack:pack\s+\[local cache\]/);
        expect(restored(again.output, "app:build")).toBe(true);
        expect({ app: prints(workspace), pack: packed(workspace) }).toEqual({
          app: "plain",
          pack: "plain",
        });

        // Plain cargo compiles nothing, and links the executable of each
        // command again, as after plain cargo build and cargo test
        // (REQ-CARGO-UNCHANGED).
        expect(plainCompiles(workspace, "test", "--workspace", "--no-run")).toEqual([]);
        expect(prints(workspace)).toBe("extra");
        expect(plainCompiles(workspace, "build", "--workspace")).toEqual([]);
        expect(prints(workspace)).toBe("plain");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // Cargo builds for the host's triple where its configuration says
  // host-tuple, into that triple's folder, which a build that names the
  // triple stores (DES-BATCH, "Files that a test batch puts back").
  it(
    "puts back the executable of a build that names the host's triple where Cargo's configuration says host-tuple",
    async () => {
      const host = /^host: (\S+)$/m.exec(
        execFileSync("rustc", ["-vV"], { encoding: "utf8" }),
      )?.[1] as string;
      const workspace = FixtureWorkspace.create("binary-tests", {
        "rust/.cargo/config.toml": '[build]\ntarget = "host-tuple"\n',
        "rust/crates/app/Cargo.toml": (manifest: string) =>
          `${manifest}\n[package.metadata.nx.targets.build.options]\ntargetTriple = "${host}"\n`,
      });
      try {
        const run = await nx(workspace, ["run-many", "-t", "build", "test", "-p", "app"]);
        expect({ status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
          status: 0,
          output: "",
        });
        expect(run.output).toMatch(/test runs_the_executable_that_cargo_test_built \.\.\. ok/);
        expect(prints(workspace, `rust/target/${host}/debug/app`)).toBe("plain");
        expect(stagesLeft(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, (workspace: FixtureWorkspace) => void, RegExp]>([
    [
      "the kept executable changed while the tests ran",
      (workspace) => appendFileSync(join(workspace.root, executable), "written in place"),
      /found that \S*rust\/target\/debug\/app, which app:build stores, was written in place or had its permissions changed while the group's cargo commands ran, so that it could not keep the file as app:build left it\./,
    ],
    [
      "the executable cannot be put back",
      (workspace) => {
        for (const stage of stagesLeft(workspace)) {
          rmSync(join(workspace.root, "rust", "target", ".nx-rust-stage", stage, "debug", "app"));
        }
      },
      /could not put back \S*rust\/target\/debug\/app, which app:build stores, from \S*\/\.nx-rust-stage\/\d+-\d+\/debug\/app: ENOENT/,
    ],
  ])(
    "fails every task of its group where %s",
    async (_case, meddle, problem) => {
      const workspace = FixtureWorkspace.create("binary-tests", pack);
      const hold = holdCargo("test");
      try {
        const run = nx(workspace, ["run-many", "-t", "build", "test", "pack"], hold.env);
        // The group, which selects the whole workspace, has kept in its stage
        // the executables of the builds whose crates its cargo test builds
        // for their tests, before its first cargo test; gated's binary needs
        // a feature that no run turns on.
        await hold.held();
        expect(keptFiles(workspace)).toEqual(["debug/app", "debug/benched", "debug/harnessless"]);
        meddle(workspace);
        hold.release();
        const { status, output } = await run;
        expect(status).toBe(1);
        expect(output).toMatch(problem);
        expect(output).toContain(
          "The cargo commands of this task's group link again the files that builds of this command store, and the plugin keeps those files in a stage of the artifact directory and puts them back when the group ends, so that tasks that depend on the builds read what Nx stored for them; where it cannot, the tasks of the group fail. Check that the artifact directory can be written to and has space, and run the command again.",
        );
        // Every test of the workspace shares the group, and every one fails
        // with the message; pack, which depends on app:test, does not run.
        const tests = readdirSync(join(workspace.root, "rust", "crates"))
          .map((name) => `${name}:test`)
          .sort();
        expect(failedTasks(output)).toEqual(tests);
        for (const test of tests) {
          expect(output).toMatch(new RegExp(`${test}: @convesoft/nx-rust ${problem.source}`));
        }
        expect(packed(workspace)).toBe("missing");
        expect(stagesLeft(workspace)).toEqual([]);
        // Nx stored no result for app:test, with NX_CACHE_FAILURES unset: it
        // runs again.
        workspace.cargo.clear();
        const again = await nx(workspace, ["run", "app:test"]);
        expect(again.status).toBe(0);
        expect(restored(again.output, "app:test")).toBe(false);
      } finally {
        hold.release();
        hold.remove();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
