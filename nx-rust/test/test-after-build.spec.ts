import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
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
          ["run-many", "-t", "build", "test", "-p", "app", ...flags],
          hold.env,
        );
        await hold.held();
        // While the cargo call of app:build waits, no cargo test starts. Without
        // the dependency, Nx's per-task scheduling (--batch=false) starts
        // app:test before the first poll of held(), well within the hold; this
        // batched run does not start it early either way (nxr-7v04ge).
        const early = await within(1000, () =>
          calls(workspace).some((call) => call.startsWith("test")),
        );
        hold.release();
        const { status, output } = await run;

        expect(early).toBe(false);
        expect(status).toBe(0);
        expect(calls(workspace)).toEqual([buildCall, ...testCalls]);
        expect(output).toMatch(/test runs_the_executable_that_cargo_test_built \.\.\. ok/);
        // The artifact directory holds what cargo test wrote last, as plain
        // cargo build and then cargo test leave it (VER-CARGO-UNCHANGED).
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
