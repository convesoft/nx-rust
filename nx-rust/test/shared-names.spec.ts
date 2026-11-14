import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CargoCall,
  type Env,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  inFixture,
  LocalRegistry,
  linesWith,
  runNx,
  sortedCalls,
  taskCalls,
  testEnvironment,
} from "./harness";

// Checks the part of VER-CARGO-UNCHANGED about a member whose package name
// another package of the resolve shares (DES-INVOCATION,
// EVD-CARGO-PACKAGE-SPECS): in shared-names, `good` depends on
// third_party/good, a path package named `good` with another version, and
// `kit`, in the folder crates/toolkit, gets a dependency on a registry
// package `kit` of its own version where a test needs one. Plain cargo
// cannot select either member by its name, nor `kit` by `kit@0.1.0`.

const rust = (args: string[]): CargoCall => ({ cwd: "rust", args });

/** Runs plain cargo in the workspace root of the copy, without the wrapper. */
function plainCargo(workspace: FixtureWorkspace, args: string[], env: Env = {}) {
  return spawnSync("cargo", args, {
    cwd: join(workspace.root, "rust"),
    env: testEnvironment(env),
    encoding: "utf8",
  });
}

/** The arguments of the logged calls whose subcommand is `subcommand`, with absolute paths. */
function absoluteCalls(workspace: FixtureWorkspace, subcommand: string): string[][] {
  return workspace.cargo
    .calls()
    .filter((call) => call.args[0] === subcommand)
    .map((call) => call.args);
}

/** The commands of a crate's targets, selecting it by `spec` and, in `cargo fmt`, by `name`. */
function crateCommands(spec: string, name: string, targets: string[]): CargoCall[] {
  const commands: Record<string, string[]> = {
    build: ["build", "-p", spec],
    check: ["check", "--all-targets", "-p", spec],
    lint: ["clippy", "--all-targets", "-p", spec],
    test: ["test", "-p", spec],
    bench: ["bench", "-p", spec],
    run: ["run", "-p", spec],
    "fmt-check": ["fmt", "--check", "-p", name],
  };
  return sortedCalls(targets.map((target) => rust(commands[target])));
}

describe("a crate whose package name another package of the resolve shares", () => {
  it(
    "runs every target where a path dependency outside the workspace has the name, selecting the crate by its package ID specification",
    () =>
      inFixture("shared-names", undefined, async (workspace) => {
        // Plain cargo cannot tell which `good` the name means.
        const plain = plainCargo(workspace, ["check", "--offline", "-p", "good"]);
        expect(plain.status).not.toBe(0);
        expect(plain.stderr).toContain("specification `good` is ambiguous");

        const targets = ["build", "check", "lint", "test", "bench", "run", "fmt-check"];
        const result = await runNx(workspace, ["run-many", "-t", ...targets, "-p", "good"]);

        expect({ status: result.status, output: result.output }).toEqual({
          status: 0,
          output: expect.any(String),
        });
        // What the binary and the bench printed: the versions of both crates.
        expect(linesWith(result.output, "(1, 2)")).toHaveLength(2);
        expect(sortedCalls(taskCalls(workspace))).toEqual(
          crateCommands("path+file://{workspaceRoot}/rust/crates/good#0.1.0", "good", targets),
        );
        // The specification names the crate's folder by its absolute path.
        expect(absoluteCalls(workspace, "test")).toEqual([
          ["test", "-p", `path+file://${workspace.root}/rust/crates/good#0.1.0`],
        ]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "runs every target where a registry package has the name and the version, with the crate's name before the version where its folder has another name",
    async () => {
      const registry = LocalRegistry.create([
        { name: "kit", version: "0.1.0", source: "pub fn version() -> u32 {\n    3\n}\n" },
      ]);
      try {
        await inFixture(
          "shared-names",
          {
            "rust/crates/toolkit/Cargo.toml": (manifest) =>
              `${manifest}\n[dependencies]\npublished = { package = "kit", version = "0.1.0" }\n`,
          },
          async (workspace) => {
            const env: Env = { CARGO_HOME: registry.cargoHome };
            // Plain cargo cannot tell which `kit` the name and version mean.
            const plain = plainCargo(workspace, ["check", "-p", "kit@0.1.0"], env);
            expect(plain.status).not.toBe(0);
            expect(plain.stderr).toContain("specification `kit@0.1.0` is ambiguous");

            const targets = ["build", "check", "lint", "test", "fmt-check"];
            const result = await runNx(workspace, ["run-many", "-t", ...targets, "-p", "kit"], env);

            expect({ status: result.status, output: result.output }).toEqual({
              status: 0,
              output: expect.any(String),
            });
            expect(sortedCalls(taskCalls(workspace))).toEqual(
              crateCommands(
                "path+file://{workspaceRoot}/rust/crates/toolkit#kit@0.1.0",
                "kit",
                targets,
              ),
            );
          },
        );
      } finally {
        registry.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives two checkouts in different folders the same task hashes, although their commands name different folders",
    async () => {
      const first = FixtureWorkspace.create("shared-names");
      const second = FixtureWorkspace.create("shared-names");
      try {
        expect(first.root).not.toBe(second.root);
        const targets = ["build", "check", "lint", "test", "fmt-check"];
        for (const workspace of [first, second]) {
          const run = await runNx(workspace, ["run-many", "-t", ...targets, "-p", "good"]);
          expect({ status: run.status, output: run.output }).toEqual({
            status: 0,
            output: expect.any(String),
          });
        }
        expect([first, second].map((workspace) => absoluteCalls(workspace, "test"))).toEqual([
          [["test", "-p", `path+file://${first.root}/rust/crates/good#0.1.0`]],
          [["test", "-p", `path+file://${second.root}/rust/crates/good#0.1.0`]],
        ]);

        const tasks = targets.map((target) => `good:${target}`);
        const [one, two] = [await first.hashTasks(tasks), await second.hashTasks(tasks)];
        for (const task of tasks) {
          expect({ task, hash: one[task].value }).toEqual({ task, hash: two[task].value });
        }
      } finally {
        first.remove();
        second.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails a task before its command where cargo cannot list the members with the task's environment",
    () =>
      inFixture(
        "shared-names",
        { ".gitignore": (text) => `${text ?? ""}.env\n` },
        async (workspace) => {
          const home = join(workspace.root, "..", "broken-home");
          mkdirSync(home);
          writeFileSync(join(home, "config.toml"), "[build\n");
          writeFileSync(join(workspace.root, "rust/crates/good/.env"), `CARGO_HOME=${home}\n`);
          const run = await runNx(workspace, ["run", "good:check"]);

          expect({ status: run.status, output: run.output }).toEqual({
            status: 1,
            output: expect.stringContaining(
              "good:check: `cargo metadata` could not list the members of the Cargo workspace for this task, so @convesoft/nx-rust cannot name the crate good to cargo: cargo exited with status 101.",
            ),
          });
          expect(run.output).toContain("could not load Cargo configuration");
          expect(run.output).toContain(
            "The task does not run, so that Nx stores no result for it. Correct what cargo reports, such as a manifest or a configuration file that it cannot read, and run the task again.",
          );
          expect(taskCalls(workspace)).toEqual([]);
        },
      ),
    HARNESS_TIMEOUT,
  );
});
