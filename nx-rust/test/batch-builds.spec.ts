import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unreportedProblems } from "../src/executors/batch";
import {
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  holdCargo,
  runNx,
  taskCalls,
  testEnvironment,
  testHost,
  withoutColours,
  workspaceArgs,
} from "./harness";

// VER-BATCHING, "Files that a batch stores" and "Staged builds" of
// DES-BATCH: groups of the build batch whose commands differ, such as
// through a crate's .env, run in one batch process, and no group writes
// another task's files, because a build of the whole workspace builds in a
// stage of its own and moves only its own crates' files out of it
// (ADR-STAGED-BUILDS). With a real cargo, the real Nx batch runner and
// copies of the workspace-tests fixture. The case in static style with
// --skip-nx-cache is in workspace-build.spec.ts.

/** Binary crates, each printing whether its feature extra and the cfg nx_rust_flag are on. */
function binaries(...names: string[]): FileChanges {
  return Object.fromEntries(
    names.flatMap((name) => [
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
}

/**
 * pb's .env gives its build other RUSTFLAGS, so that its group builds the
 * whole workspace with another environment than pa's group.
 */
const otherFlags: FileChanges = { "rust/crates/pb/.env": "RUSTFLAGS=--cfg nx_rust_flag\n" };

/** What `name`'s executable in the artifact directory prints. */
function prints(workspace: FixtureWorkspace, name: string): string {
  return spawnSync(join(workspace.root, "rust", "target", "debug", name), {
    encoding: "utf8",
  }).stdout.trim();
}

/** Restores each crate's build alone, after removing its executable, and returns what it prints. */
async function restored(
  workspace: FixtureWorkspace,
  names: readonly string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of names) {
    rmSync(join(workspace.root, "rust", "target", "debug", name), { force: true });
    const again = await runNx(workspace, ["run", `${name}:build`]);
    result[name] =
      again.status === 0 && /\[local cache\]/.test(again.output)
        ? prints(workspace, name)
        : `not restored (status ${again.status})`;
  }
  return result;
}

/** The plugin's line for each cargo build that a group starts, in order. */
function buildLines(output: string): string[] {
  return output.match(/@convesoft\/nx-rust: cargo build for [\w, ]+ \(step 1 of 1\)/g) ?? [];
}

/** What the folder of stages in the artifact directory holds. */
function stagesLeft(workspace: FixtureWorkspace): string[] {
  const folder = join(workspace.root, "rust", "target", ".nx-rust-stage");
  return existsSync(folder) ? readdirSync(folder) : [];
}

describe("builds of one batch whose commands differ", () => {
  it.each<{ style: string; args: string[]; env?: Record<string, string> }>([
    { style: "static", args: ["--output-style=static"] },
    { style: "stream", args: ["--output-style=stream"] },
    { style: "stream-without-prefixes", args: ["--output-style=stream-without-prefixes"] },
    // GitHub Actions' grouping, under which Nx prints a batch process's
    // output when the process ends, once for each of them.
    {
      style: "static under GitHub Actions' grouping",
      args: ["--output-style=static"],
      env: { GITHUB_ACTIONS: "true" },
    },
  ])(
    "run once each, in one batch process, and are stored as their own command builds them, in the $style style",
    async ({ args, env }) => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
      );
      try {
        const run = await workspace.nx(["run-many", "-t", "build", "-p", "pa", "pb", ...args], env);
        const output = withoutColours(run.output);
        expect({ status: run.status, output: run.status === 0 ? "" : output }).toEqual({
          status: 0,
          output: "",
        });
        expect(output).toMatch(/Successfully ran target build for 2 projects/);
        // One batch as Nx announces it.
        expect(
          output.match(/Running 2 tasks with @convesoft\/nx-rust:cargo-outputs/g),
        ).toHaveLength(1);
        expect(buildLines(output)).toEqual([
          "@convesoft/nx-rust: cargo build for pa (step 1 of 1)",
          "@convesoft/nx-rust: cargo build for pb (step 1 of 1)",
        ]);
        expect(taskCalls(workspace).map((call) => call.args)).toEqual([
          workspaceArgs("build"),
          workspaceArgs("build"),
        ]);
        expect(stagesLeft(workspace)).toEqual([]);
        expect(await restored(workspace, ["pa", "pb"])).toEqual({ pa: "plain", pb: "plain flag" });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // The same batch under Nx's terminal UI, in a terminal through util-linux's
  // script, which macOS lacks (RISK-TERMINAL-ENVIRONMENT-MACOS). The terminal
  // UI shows only its list of tasks until a key opens a pane, so the cargo
  // lines that the batch writes under it (batchLiveOutput, DES-BATCH) do not
  // reach the screen; the unit test of batchLiveOutput in
  // workspace-build.spec.ts checks that choice.
  (process.platform === "linux" ? describe : describe.skip)("under the terminal UI", () => {
    it(
      "run once each, in one batch process, and are stored as their own command builds them",
      async () => {
        const workspace = FixtureWorkspace.create(
          "workspace-tests",
          binaries("pa", "pb"),
          otherFlags,
          {
            // No analytics prompt in a terminal.
            "nx.json": (nxJson) =>
              `${JSON.stringify({ ...JSON.parse(nxJson ?? "{}"), analytics: false }, null, 2)}\n`,
          },
        );
        try {
          const run = await workspace.nxInTerminal(
            ["run-many", "-t", "build", "-p", "pa", "pb", "--tui", "--tui-auto-exit"],
            {},
            undefined,
            { columns: 120, rows: 35 },
          );
          const output = withoutColours(run.output);
          expect({
            status: run.status,
            output: run.status === 0 ? "" : output,
            terminalUi: run.terminalUi,
          }).toEqual({ status: 0, output: "", terminalUi: true });
          // The summary that Nx prints once the terminal UI has closed.
          expect(output).toMatch(/Successfully ran target build for 2 projects/);
          // One batch process ran both groups: each stage is named after the
          // process id of the process that builds in it.
          const stageProcesses = workspace.cargo
            .calls()
            .flatMap((call) => call.args.join(" ").match(/\.nx-rust-stage\/(\d+)-\d+/)?.[1] ?? []);
          expect({
            builds: stageProcesses.length,
            processes: new Set(stageProcesses).size,
          }).toEqual({ builds: 2, processes: 1 });
          expect(taskCalls(workspace).map((call) => call.args)).toEqual([
            workspaceArgs("build"),
            workspaceArgs("build"),
          ]);
          expect(stagesLeft(workspace)).toEqual([]);
          expect(await restored(workspace, ["pa", "pb"])).toEqual({
            pa: "plain",
            pb: "plain flag",
          });
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });

  it(
    "run the tasks that depend on them in the same batch process",
    async () => {
      // pc depends on pb, and a target default adds the edge ^build to build,
      // so that pc's build is in the batch and waits for pb's. pc's group
      // has pa's environment, and pb's group the flag; each builds the whole
      // workspace in a stage of its own, one after another.
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb", "pc"),
        otherFlags,
        {
          "rust/crates/pc/Cargo.toml": (manifest) =>
            `${manifest}\n[dependencies]\npb = { path = "../pb" }\n`,
          "rust/crates/pb/src/lib.rs": "pub fn pb() {}\n",
          "nx.json": (nxJson) => {
            const config = JSON.parse(nxJson ?? "{}");
            return `${JSON.stringify({ ...config, targetDefaults: { ...config.targetDefaults, build: { dependsOn: ["...", "^build"] } } }, null, 2)}\n`;
          },
        },
      );
      try {
        const run = await runNx(workspace, ["run-many", "-t", "build", "-p", "pa", "pb", "pc"]);
        expect({ status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
          status: 0,
          output: "",
        });
        expect(buildLines(run.output)).toEqual([
          "@convesoft/nx-rust: cargo build for pa (step 1 of 1)",
          "@convesoft/nx-rust: cargo build for pb (step 1 of 1)",
          "@convesoft/nx-rust: cargo build for pc (step 1 of 1)",
        ]);
        expect(taskCalls(workspace).map((call) => call.args)).toEqual(
          Array(3).fill(workspaceArgs("build")),
        );
        expect(
          run.output.match(/Running 3 tasks with @convesoft\/nx-rust:cargo-outputs/g),
        ).toHaveLength(1);
        expect(await restored(workspace, ["pa", "pb", "pc"])).toEqual({
          pa: "plain",
          pb: "plain flag",
          pc: "plain",
        });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave each build's own files to a discrete task outside the batch that depends on both",
    async () => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
        {
          // A JS task, uncached, that waits for both builds and runs their
          // executables.
          "tools/show/project.json": `${JSON.stringify({
            name: "show",
            targets: {
              show: {
                command: "./rust/target/debug/pa && ./rust/target/debug/pb",
                options: { cwd: "{workspaceRoot}" },
                dependsOn: [{ target: "build", projects: ["pa", "pb"] }],
              },
            },
          })}\n`,
        },
      );
      try {
        const run = await runNx(workspace, ["run", "show:show"]);
        expect({ status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
          status: 0,
          output: "",
        });
        // pb's build of the whole workspace, with the flag, built in a stage
        // and moved only pb's executable, so that the JS task runs pa as its
        // own build left it.
        expect(run.output).toMatch(/> nx run show:show[\s\S]*\nplain\nplain flag\n/);
        expect(await restored(workspace, ["pa", "pb"])).toEqual({ pa: "plain", pb: "plain flag" });

        // The test batch, of the other executor, starts after both builds.
        workspace.cargo.clear();
        const tests = await runNx(workspace, [
          "run-many",
          "-t",
          "build",
          "test",
          "-p",
          "pa",
          "pb",
          "--skip-nx-cache",
        ]);
        expect(tests.status).toBe(0);
        const subcommands = taskCalls(workspace).map((call) => call.args[0]);
        expect(subcommands.slice(0, 2)).toEqual(["build", "build"]);
        expect(subcommands.length).toBeGreaterThan(2);
        expect(subcommands.slice(2).every((subcommand) => subcommand === "test")).toBe(true);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // Nx tells a batch nothing of --nx-bail (EVD-STAGED-BUILDS), so that a
  // group of the same batch process still runs and is stored after another
  // group failed, as the groups of a batch always did (DES-BATCH).
  it.each<{ name: string; args: string[]; notRun: string[]; builds: number; pb: string }>([
    {
      name: "run after the group before them failed",
      args: [],
      notRun: [],
      builds: 2,
      pb: "plain flag",
    },
    {
      name: "run under --nx-bail as well, in the same batch process",
      args: ["--nx-bail"],
      notRun: [],
      builds: 2,
      pb: "plain flag",
    },
  ])(
    "$name",
    async ({ args, notRun, builds, pb }) => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
        {
          "rust/crates/pa/src/main.rs": 'compile_error!("pa is broken");\n\nfn main() {}\n',
        },
      );
      try {
        const run = await runNx(workspace, ["run-many", "-t", "build", "-p", "pa", "pb", ...args]);
        expect(run.status).toBe(1);
        expect(run.output).toMatch(/Failed tasks:\s+- pa:build\n/);
        const listed = /Tasks not run because[^\n]*\n((?:\s*- \S+\n)+)/.exec(run.output);
        expect(listed?.[1].match(/\S+:\S+/g) ?? []).toEqual(notRun);
        expect(taskCalls(workspace)).toHaveLength(builds);
        expect(await restored(workspace, ["pb"])).toEqual({ pb });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/**
 * A cached JS target `pack` that depends on the `build` of `crate`, and of `others`,
 * with the crate as an implicit dependency and the inputs `default` and
 * `^default`, and writes what the crate's executable prints to
 * `dist/out.txt`.
 */
function pack(crate: string, ...others: string[]): FileChanges {
  return {
    "tools/pack/project.json": `${JSON.stringify({
      name: "pack",
      implicitDependencies: [crate],
      targets: {
        pack: {
          command: `mkdir -p dist && ./rust/target/debug/${crate} > dist/out.txt`,
          options: { cwd: "{workspaceRoot}" },
          cache: true,
          inputs: ["default", "^default"],
          outputs: ["{workspaceRoot}/dist"],
          dependsOn: [{ target: "build", projects: [crate, ...others] }],
        },
      },
    })}\n`,
  };
}

/** What `pack` wrote, or `missing`. */
function packed(workspace: FixtureWorkspace): string {
  const file = join(workspace.root, "dist", "out.txt");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "missing";
}

// VER-BATCHING, "Staged builds" of DES-BATCH: a later build of the whole
// workspace never replaces on disk the files of a build that ran or was
// restored before it, so that a task outside the batch that depends on
// such a build reads, and stores what it makes of, that build's files
// (nxr-yfh7zh; the reviewer's reproductions in EVD-STAGED-BUILDS).
describe("the files of the command's builds on disk", () => {
  it.each<{ name: string; before: string[][] }>([
    { name: "a build of an earlier wave", before: [] },
    { name: "a build that Nx restored before the batch", before: [["run", "pa:build"]] },
  ])(
    "are those of $name, which a cached task outside the batch reads and stores",
    async ({ before }) => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
        pack("pa"),
      );
      try {
        for (const args of before) {
          expect((await runNx(workspace, args)).status).toBe(0);
        }
        workspace.cargo.clear();
        const run = await runNx(workspace, [
          "run-many",
          "-t",
          "build",
          "pack",
          "-p",
          "pa",
          "pb",
          "pack",
          "--parallel=3",
        ]);
        expect({ status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
          status: 0,
          output: "",
        });
        // pb's group built the whole workspace, in a stage.
        expect(taskCalls(workspace).map((call) => call.args)).toEqual(
          Array(before.length === 0 ? 2 : 1).fill(workspaceArgs("build")),
        );
        expect({
          pa: prints(workspace, "pa"),
          pb: prints(workspace, "pb"),
          pack: packed(workspace),
          stages: stagesLeft(workspace),
        }).toEqual({ pa: "plain", pb: "plain flag", pack: "plain", stages: [] });

        // The stored pack matches the stored build of pa.
        rmSync(join(workspace.root, "dist"), { recursive: true, force: true });
        const again = await runNx(workspace, ["run", "pack:pack"]);
        expect(again.status).toBe(0);
        expect(again.output).toMatch(/nx run pack:pack\s+\[local cache\]/);
        expect({ pa: prints(workspace, "pa"), pack: packed(workspace) }).toEqual({
          pa: "plain",
          pack: "plain",
        });

        // Plain cargo reuses what the staged builds compiled: with pb's
        // flags, as the last build of the whole workspace had them, it
        // compiles nothing, and links pa again (REQ-CARGO-UNCHANGED). Cargo
        // 1.91 keeps one variant of a unit, so the other flags would compile
        // again there, as after plain cargo builds of both variants.
        const cargo = spawnSync("cargo", ["build", "--workspace"], {
          cwd: join(workspace.root, "rust"),
          env: testEnvironment({ RUSTFLAGS: "--cfg nx_rust_flag" }),
          encoding: "utf8",
        });
        expect({ status: cargo.status, compiling: /Compiling/.test(cargo.stderr) }).toEqual({
          status: 0,
          compiling: false,
        });
        expect(prints(workspace, "pa")).toBe("plain flag");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

// The reviewer's reproductions of nxr-yfh7zh at d0971e5 (EVD-STAGED-BUILDS),
// each of which stored or read the other build's file before builds were
// staged.
describe("the reviewer's reproductions", () => {
  it(
    "leave pa's own file in place while pb's whole-workspace build has run and its task has not ended",
    async () => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
      );
      // Holds pb's cargo build, the one with the flag, once cargo has ended
      // and before the call exits: what a task that runs meanwhile reads,
      // such as a continuous task or one that waited for something else.
      const hold = holdCargo("build", {
        after: true,
        when: { name: "RUSTFLAGS", value: "--cfg nx_rust_flag" },
      });
      try {
        const run = runNx(workspace, ["run-many", "-t", "build", "-p", "pa", "pb"], hold.env);
        await hold.held();
        const meanwhile = prints(workspace, "pa");
        hold.release();
        const ended = await run;
        expect({ status: ended.status, output: ended.status === 0 ? "" : ended.output }).toEqual({
          status: 0,
          output: "",
        });
        expect({ meanwhile, after: prints(workspace, "pa") }).toEqual({
          meanwhile: "plain",
          after: "plain",
        });
      } finally {
        hold.release();
        hold.remove();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "store pa's own file for a task that depends on a build whose output is declared as a glob",
    async () => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
        pack("pa"),
        {
          "rust/crates/pa/project.json": `${JSON.stringify({
            targets: { build: { outputs: ["{workspaceRoot}/rust/target/debug/p[a]"] } },
          })}\n`,
        },
      );
      try {
        const run = await runNx(workspace, [
          "run-many",
          "-t",
          "build",
          "pack",
          "-p",
          "pa",
          "pb",
          "pack",
          "--parallel=3",
        ]);
        expect(run.status).toBe(0);
        expect({ pa: prints(workspace, "pa"), pack: packed(workspace) }).toEqual({
          pa: "plain",
          pack: "plain",
        });
        expect(await restored(workspace, ["pa"])).toEqual({ pa: "plain" });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "store pa's own file for a task that depends on a build that declares no outputs (nxr-j55xdy)",
    async () => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
        pack("pa"),
        {
          "rust/crates/pa/project.json": `${JSON.stringify({
            targets: { build: { outputs: [] } },
          })}\n`,
        },
      );
      try {
        const run = await runNx(workspace, [
          "run-many",
          "-t",
          "build",
          "pack",
          "-p",
          "pa",
          "pb",
          "pack",
          "--parallel=3",
        ]);
        expect(run.status).toBe(0);
        expect({ pa: prints(workspace, "pa"), pack: packed(workspace) }).toEqual({
          pa: "plain",
          pack: "plain",
        });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "build pb again where its key reads pa's output and pa changed, instead of restoring it under an early key (nxr-f04xen)",
    async () => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
        {
          "rust/crates/pa/src/main.rs": 'fn main() {\n    println!("{}", env!("DEMO_VALUE"));\n}\n',
          "rust/crates/pa/project.json": `${JSON.stringify({
            targets: { build: { inputs: ["...", { env: "DEMO_VALUE" }] } },
          })}\n`,
          "rust/crates/pb/project.json": `${JSON.stringify({
            targets: {
              build: {
                dependsOn: ["...", { projects: ["pa"], target: "build" }],
                inputs: ["...", { dependentTasksOutputFiles: "**/pa" }],
              },
            },
          })}\n`,
          "rust/crates/pb/src/main.rs": 'fn main() {\n    println!("{}", env!("FROM_PA"));\n}\n',
          "rust/crates/pb/build.rs": [
            "use std::process::Command;",
            "",
            "fn main() {",
            '    println!("cargo:rerun-if-changed=build.rs");',
            '    println!("cargo:rerun-if-changed=../../target/debug/pa");',
            '    println!("cargo:rerun-if-env-changed=DEMO_VALUE");',
            '    let output = Command::new("../../target/debug/pa")',
            "        .output()",
            "        .ok()",
            "        .filter(|run| run.status.success())",
            "        .map(|run| String::from_utf8(run.stdout).unwrap())",
            '        .unwrap_or_else(|| "missing".into());',
            '    println!("cargo:rustc-env=FROM_PA={}", output.trim());',
            "}",
            "",
          ].join("\n"),
        },
      );
      try {
        const results: Record<string, string>[] = [];
        // The third run, unchanged, restores both under the keys of the new
        // value.
        const bytes: string[] = [];
        for (const value of ["old", "new", "new"]) {
          for (const name of ["pa", "pb"]) {
            rmSync(join(workspace.root, "rust", "target", "debug", name), { force: true });
          }
          const run = await runNx(workspace, ["run-many", "-t", "build", "-p", "pa", "pb"], {
            DEMO_VALUE: value,
          });
          expect({ status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
            status: 0,
            output: "",
          });
          results.push({
            pa: prints(workspace, "pa"),
            pb: prints(workspace, "pb"),
            restored: ["pa", "pb"]
              .filter((name) =>
                new RegExp(`nx run ${name}:build\\s+\\[local cache\\]`).test(run.output),
              )
              .join(" "),
          });
          bytes.push(
            readFileSync(join(workspace.root, "rust", "target", "debug", "pb")).toString("base64"),
          );
        }
        // Nx restored pb with the bytes that the second run built.
        expect(bytes[2] === bytes[1]).toBe(true);
        expect(results).toEqual([
          { pa: "old", pb: "old", restored: "" },
          { pa: "new", pb: "new", restored: "" },
          { pa: "new", pb: "new", restored: "pa pb" },
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each<string>(["--parallel=1", "--parallel=3"])(
    "leave pa's own file to a task that runs after pb's build, and store each build's own, with batching off and %s (nxr-fpc72j)",
    async (parallel) => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
        pack("pa", "pb"),
      );
      try {
        const run = await runNx(workspace, [
          "run-many",
          "-t",
          "build",
          "pack",
          "-p",
          "pa",
          "pb",
          "pack",
          "--batch=false",
          parallel,
        ]);
        expect({ status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
          status: 0,
          output: "",
        });
        expect(taskCalls(workspace).map((call) => call.args)).toEqual([
          workspaceArgs("build"),
          workspaceArgs("build"),
        ]);
        expect({
          pa: prints(workspace, "pa"),
          pb: prints(workspace, "pb"),
          pack: packed(workspace),
          stages: stagesLeft(workspace),
        }).toEqual({ pa: "plain", pb: "plain flag", pack: "plain", stages: [] });
        // Each build stored its own file, also where Nx ran them at once.
        expect(await restored(workspace, ["pa", "pb"])).toEqual({ pa: "plain", pb: "plain flag" });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fail two builds of one crate into one folder before cargo runs, and run the others",
    async () => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
      );
      try {
        const shown = await workspace.nx(["show", "project", "pa", "--json"]);
        expect(shown.status).toBe(0);
        const build = JSON.parse(shown.output.slice(shown.output.indexOf("{"))).targets.build;
        writeFileSync(
          join(workspace.root, "rust", "crates", "pa", "project.json"),
          `${JSON.stringify({
            targets: {
              "build-alt": { ...build, dependsOn: [...(build.dependsOn ?? []), "build"] },
            },
          })}\n`,
        );
        writeFileSync(
          join(workspace.root, "rust", "crates", "pa", ".env.build-alt"),
          "RUSTFLAGS=--cfg nx_rust_flag\n",
        );
        workspace.cargo.clear();
        const run = await runNx(workspace, [
          "run-many",
          "-t",
          "build",
          "build-alt",
          "-p",
          "pa",
          "pb",
        ]);
        expect(run.status).toBe(1);
        for (const task of ["pa:build", "pa:build-alt"]) {
          expect(run.output).toMatch(
            new RegExp(
              `${task}: pa:build(-alt)? of this command builds the same crate into the same folder of its artifact directory, rust/target/debug,`,
            ),
          );
        }
        // pb's build runs, alone in its command.
        expect(taskCalls(workspace).map((call) => call.args)).toEqual([workspaceArgs("build")]);
        expect(prints(workspace, "pb")).toBe("plain flag");

        // With batching off, pa:build runs first and refuses, and
        // pa:build-alt, which depends on it, does not run.
        workspace.cargo.clear();
        const alone = await runNx(workspace, [
          "run-many",
          "-t",
          "build",
          "build-alt",
          "-p",
          "pa",
          "--batch=false",
        ]);
        expect(alone.status).toBe(1);
        expect(alone.output).toMatch(
          /pa:build: pa:build-alt of this command builds the same crate into the same folder of its artifact directory, rust\/target\/debug,/,
        );
        expect(taskCalls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  /** Writes a copy of pa's build target under the name build-alt, with `options` laid over its own. */
  async function buildAlt(
    workspace: FixtureWorkspace,
    options: Record<string, unknown> = {},
  ): Promise<void> {
    const shown = await workspace.nx(["show", "project", "pa", "--json"]);
    expect(shown.status).toBe(0);
    const build = JSON.parse(shown.output.slice(shown.output.indexOf("{"))).targets.build;
    writeFileSync(
      join(workspace.root, "rust", "crates", "pa", "project.json"),
      `${JSON.stringify({
        targets: { "build-alt": { ...build, options: { ...build.options, ...options } } },
      })}\n`,
    );
  }

  it(
    "fail a build that names the host triple beside one that build.target in Cargo's configuration gives it",
    async () => {
      const host = testHost();
      const workspace = FixtureWorkspace.create("workspace-tests", binaries("pa", "pb"), {
        "rust/.cargo/config.toml": `[build]\ntarget = "${host}"\n`,
      });
      try {
        await buildAlt(workspace, { targetTriple: host });
        workspace.cargo.clear();
        const run = await runNx(workspace, ["run-many", "-t", "build", "build-alt", "-p", "pa"]);
        expect(run.status).toBe(1);
        for (const task of ["pa:build", "pa:build-alt"]) {
          expect(run.output).toContain(
            `${task}: pa:build${task === "pa:build" ? "-alt" : ""} of this command builds the same crate into the same folder of its artifact directory, rust/target/${host}/debug,`,
          );
        }
        expect(taskCalls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fail a build that runs beside a build of its crate into its folder that Nx restores, and restore that one",
    async () => {
      // Where Nx restores every such task, none runs and none fails
      // (DES-BATCH, "Files that a batch stores"); where one runs, the restored
      // peer is still in the command's task graph.
      const workspace = FixtureWorkspace.create("workspace-tests", binaries("pa", "pb"));
      try {
        await buildAlt(workspace, { allFeatures: true });
        expect((await runNx(workspace, ["run", "pa:build-alt"])).status).toBe(0);
        workspace.cargo.clear();
        const run = await runNx(workspace, ["run-many", "-t", "build", "build-alt", "-p", "pa"]);
        expect(run.status).toBe(1);
        expect(run.output).toMatch(/nx run pa:build-alt\s+\[local cache\]/);
        expect(run.output).toContain(
          "pa:build: pa:build-alt of this command builds the same crate into the same folder of its artifact directory, rust/target/debug,",
        );
        expect(taskCalls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("unreportedProblems", () => {
  const ids = ["a:build", "b:build", "c:build"];

  it("lets a batch end that reported every task", () => {
    expect(unreportedProblems(ids, new Set(ids))).toEqual(new Map());
  });

  it("fails every task that the batch did not report, which Nx would start again", () => {
    const problems = unreportedProblems(ids, new Set(["a:build"]));
    expect([...problems.keys()]).toEqual(["b:build", "c:build"]);
    expect(problems.get("b:build")).toMatch(/without a result for this task/);
  });
});
