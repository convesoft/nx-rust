import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { unreportedProblems } from "../src/executors/batch";
import {
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  runNx,
  taskCalls,
  withoutColours,
  workspaceArgs,
} from "./harness";

// VER-BATCHING, "Tasks left for a following batch" of DES-BATCH: a group of
// the build batch that would write the files of a group that ran before it
// in the same batch leaves its tasks unreported, and Nx 24 runs them in a
// following batch process once it has stored the others
// (EVD-NX-24-BATCHES, "Tasks left out"). With a real cargo, the real Nx
// batch runner and copies of the workspace-tests fixture. The case in
// static style with --skip-nx-cache is in workspace-build.spec.ts.

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
 * pb's .env gives its build other RUSTFLAGS, so its group builds the whole
 * workspace into the folder of pa's group with another environment, and no
 * order helps: the batch leaves it for a following one.
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

describe("tasks that a batch leaves for a following batch", () => {
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
    "run once each and are stored as their own command builds them, in the $style style",
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
        // One batch as Nx announces it, and pb's group in a process of its own.
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
        expect(await restored(workspace, ["pa", "pb"])).toEqual({ pa: "plain", pb: "plain flag" });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave the tasks that depend on one left out for a following batch too, in as many batches as it takes",
    async () => {
      // pc depends on pb, and a target default adds the edge ^build to build,
      // so that pc's build is in the batch and waits for pb's. pc's group
      // has pa's environment, and pb's group the flag: pa runs in the first
      // batch process, pb in the second, and pc, whose command would
      // rewrite pb's files, in the third.
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
        expect(taskCalls(workspace)).toHaveLength(3);
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
    "keep the discrete tasks outside the batch that depend on one left out waiting until it has run",
    async () => {
      const workspace = FixtureWorkspace.create(
        "workspace-tests",
        binaries("pa", "pb"),
        otherFlags,
        {
          // A JS task, uncached, that waits for both builds and runs pb's
          // executable.
          "tools/show/project.json": `${JSON.stringify({
            name: "show",
            targets: {
              show: {
                command: "./rust/target/debug/pb",
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
        // pb's build, in the second wave, ran before the JS task: the
        // executable it runs has the flag. What it would read of pa is not
        // checked: pb's build of the whole workspace linked pa again on disk
        // after Nx had stored pa's, so a task outside the batch reads the
        // later build's files, a known limit that nxr-yfh7zh is to remove.
        // The builds' own entries are right.
        expect(run.output).toMatch(/> nx run show:show[\s\S]*\nplain flag\n/);
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

  // Under --nx-bail, Nx stops at the first failure and lists the task left
  // out as not run, as every task that a bail leaves out.
  it.each<{ name: string; args: string[]; notRun: string[]; builds: number; pb: string }>([
    {
      name: "run after the group before them failed",
      args: [],
      notRun: [],
      builds: 2,
      pb: "plain flag",
    },
    {
      name: "do not run under --nx-bail once the group before them failed",
      args: ["--nx-bail"],
      notRun: ["pb:build"],
      builds: 1,
      pb: "not restored (status 0)",
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

describe("unreportedProblems", () => {
  const ids = ["a:build", "b:build", "c:build"];

  it("lets a batch end that reports a task and leaves the others for a following batch", () => {
    expect(unreportedProblems(ids, new Set(["a:build"]), new Set(["b:build", "c:build"]))).toEqual(
      new Map(),
    );
    expect(unreportedProblems(ids, new Set(ids), new Set())).toEqual(new Map());
  });

  it("fails a task that the batch neither reported nor left for a following batch", () => {
    expect([...unreportedProblems(ids, new Set(["a:build"]), new Set(["b:build"])).keys()]).toEqual(
      ["c:build"],
    );
  });

  it("fails the tasks left for a following batch where the batch reports none, which Nx would start again without end", () => {
    const problems = unreportedProblems(ids, new Set(), new Set(ids));
    expect([...problems.keys()]).toEqual(ids);
    expect(problems.get("a:build")).toMatch(/without end/);
  });
});
