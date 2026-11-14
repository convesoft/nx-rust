import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  pluginWorkers,
  runNx,
  taskCalls as harnessTaskCalls,
  testEnvironment,
} from "./harness";

// Checks with real Nx runs of the plugin's executor the parts of
// VER-CARGO-UNCHANGED about a cached build or doc whose folders move after
// Nx has declared its outputs: an artifact directory that a Cargo
// configuration file outside the repository moves under the Nx daemon
// (nxr-3tf0pz), one that a dotenv file that Nx loads only for the task moves
// (nxr-phcg8v, EVD-NX-24-MOVED-ARTIFACT-DIRS), and a targetTriple option whose
// folder cargo names otherwise (nxr-qdedbc). caching-runs.spec.ts checks the
// same for the triples that Cargo's configuration picks.

/** How Nx marks a task that it restored from the cache, with or without copying outputs. */
const hit = String.raw`\[(local cache|existing outputs match the cache, left as is)\]`;

/** The arguments of the cargo calls of tasks that build, without `cargo metadata`, sorted. */
function taskCalls(workspace: FixtureWorkspace): string[] {
  return harnessTaskCalls(workspace)
    .map((call) => call.args.join(" "))
    .sort();
}

/** Every file below `path`, or the file itself, with its content, by path relative to it. */
function contents(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  if (statSync(path).isFile()) {
    return { ".": readFileSync(path).toString("base64") };
  }
  const files: Record<string, string> = {};
  for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = join(entry.parentPath, entry.name);
      files[relative(path, file)] = readFileSync(file).toString("base64");
    }
  }
  return files;
}

function hostTriple(): string {
  const { stdout } = spawnSync("rustc", ["-vV"], { env: testEnvironment(), encoding: "utf8" });
  const host = /^host: (.+)$/m.exec(stdout)?.[1];
  if (host === undefined) {
    throw new Error(`rustc -vV named no host triple:\n${stdout}`);
  }
  return host;
}

/** A change that appends `lines` to a file. */
const appended =
  (lines: string) =>
  (text: string | undefined): string =>
    `${text ?? ""}${lines}`;

/** The source of crate-shapes' cli, printing `version` before its answer. */
const cliPrinting = (version: string) =>
  `fn main() {\n    println!("${version} {}", core_lib::answer());\n}\n`;

/**
 * Runs `cli:build` and `rust:doc`, deletes the binary and the doc folder
 * that they wrote in `directory`, relative to the repository, runs them
 * again, and expects Nx to restore exactly what the first run wrote there,
 * without cargo.
 */
async function expectRestored(
  workspace: FixtureWorkspace,
  env: Record<string, string>,
  directory: string,
): Promise<void> {
  const tasks = ["run-many", "-t", "build", "doc", "-p", "cli", "rust"];
  const first = await runNx(workspace, tasks, env);
  expect({ status: first.status, output: first.output }).toEqual({
    status: 0,
    output: expect.any(String),
  });
  const paths = [
    join(workspace.root, directory, "debug/cli"),
    join(workspace.root, directory, "doc"),
  ];
  const written = paths.map((path) => ({ path, files: contents(path) }));
  for (const { path, files } of written) {
    expect({ path, files: Object.keys(files).length > 0 }).toEqual({ path, files: true });
    rmSync(path, { recursive: true });
  }
  const calls = taskCalls(workspace).length;
  const second = await runNx(workspace, tasks, env);

  expect(second.status).toBe(0);
  for (const task of ["cli:build", "rust:doc"]) {
    expect(second.output).toMatch(new RegExp(`nx run ${task}\\s+${hit}`));
  }
  expect(taskCalls(workspace)).toHaveLength(calls);
  expect(paths.map((path) => ({ path, files: contents(path) }))).toEqual(written);
}

/** The end of the messages that stop a task before cargo builds. */
const notRun = "The task does not run, so that Nx stores no result for it.";

describe("a cached build or doc whose artifact directory moves after graph creation", () => {
  // The Nx daemon keeps its graph until a file that it watches changes, so a
  // change to a Cargo configuration file outside the repository leaves
  // outputs that name the old directory. The folders lie inside the ignored
  // rust/target, so that deleting them wakes no watcher of the daemon.
  it.each<[string, (cargoHome: string, root: string) => string, string | undefined]>([
    [
      "the Cargo home's configuration names another folder",
      (cargoHome) => join(cargoHome, "config.toml"),
      "rust/target/b",
    ],
    [
      "a configuration above the repository names another folder",
      (_cargoHome, root) => join(root, "..", ".cargo", "config.toml"),
      "rust/target/b",
    ],
    [
      "the setting is removed from the Cargo home's configuration",
      (cargoHome) => join(cargoHome, "config.toml"),
      undefined,
    ],
  ])(
    "with the Nx daemon, fails a cached build and doc before cargo builds and restores nothing when %s after graph creation, and caches them in the new folder once the graph is created afresh",
    async (_case, file, changed) => {
      const workspace = FixtureWorkspace.create("crate-shapes");
      const cargoHome = join(workspace.root, "..", "cargo-home");
      const config = file(cargoHome, workspace.root);
      const env = { ...pluginWorkers, NX_DAEMON: "true", CARGO_HOME: cargoHome };
      const targetDir = (folder: string) =>
        `[build]\ntarget-dir = "${join(workspace.root, folder)}"\n`;
      try {
        mkdirSync(dirname(config), { recursive: true });
        writeFileSync(config, targetDir("rust/target/a"));
        const first = await runNx(
          workspace,
          ["run-many", "-t", "build", "doc", "-p", "cli", "rust"],
          env,
        );
        expect({ status: first.status, output: first.output }).toEqual({
          status: 0,
          output: expect.any(String),
        });
        expect(existsSync(join(workspace.root, "rust/target/a/debug/cli"))).toBe(true);
        expect(existsSync(join(workspace.root, "rust/target/a/doc"))).toBe(true);
        if (changed === undefined) {
          rmSync(config);
        } else {
          writeFileSync(config, targetDir(changed));
        }
        rmSync(join(workspace.root, "rust/target/a"), { recursive: true });
        const calls = taskCalls(workspace).length;

        for (const [task, target] of [
          ["cli:build", "build"],
          ["rust:doc", "doc"],
        ]) {
          const stale = await runNx(workspace, ["run", task], env);
          expect({ task, status: stale.status }).toEqual({ task, status: 1 });
          expect(stale.output).not.toMatch(new RegExp(hit));
          expect(stale.output).toContain(
            `${task}: Cargo's configuration has changed since Nx created the project graph: cargo now puts the artifacts of this run in ${changed ?? "rust/target"}, while the outputs of the cached ${target} name the artifact directory rust/target/a.`,
          );
          expect(stale.output).toContain(
            `${notRun} Run \`nx reset\`, or stop the daemon with \`nx daemon --stop\`, and run the task again.`,
          );
        }
        // Nothing came back into the old folder, and cargo built nothing.
        expect(existsSync(join(workspace.root, "rust/target/a"))).toBe(false);
        expect(taskCalls(workspace)).toHaveLength(calls);

        // A graph created afresh names the new folder, and the results are
        // stored and restored there.
        await workspace.nx(["daemon", "--stop"], env);
        await expectRestored(workspace, env, changed ?? "rust/target");
      } finally {
        await workspace.nx(["daemon", "--stop"], env);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  // The four steps of EVD-NX-24-MOVED-ARTIFACT-DIRS, where Nx stored the older
  // binary at the declared path under the new source's key and restored it.
  it(
    "fails a cached build before cargo builds while a dotenv file of the task moves the artifact directory, so that Nx never restores a binary that another source built",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        ".gitignore": appended(".env\n/rust/out/\n"),
        "rust/crates/cli/src/main.rs": cliPrinting("v1"),
      });
      const binary = join(workspace.root, "rust/target/debug/cli");
      const runs = () => spawnSync(binary, [], { encoding: "utf8" }).stdout;
      try {
        // 1. Without the dotenv file, the build is stored.
        const first = await runNx(workspace, ["run", "cli:build"]);
        expect({ status: first.status, output: first.output }).toEqual({
          status: 0,
          output: expect.any(String),
        });
        expect(runs()).toMatch(/^v1 /);

        // 2. A dotenv file that Nx loads only for the task sends cargo
        // elsewhere: the key changes, and the task fails before cargo builds.
        writeFileSync(join(workspace.root, "rust/crates/cli/.env"), "CARGO_TARGET_DIR=out\n");
        const moved = await runNx(workspace, ["run", "cli:build"]);
        expect(moved.status).toBe(1);
        expect(moved.output).not.toMatch(new RegExp(hit));
        expect(moved.output).toContain(
          `cli:build: cargo puts the artifacts of this run of the cached build in rust/out, but its outputs name the artifact directory rust/target: CARGO_TARGET_DIR is "out" in the task's environment and was unset when Nx created the graph.`,
        );
        expect(moved.output).toContain(
          `${notRun} Set the variable in the environment of the nx command or in the repository's root .env file, or set the folder as build.target-dir in a .cargo/config.toml of the workspace instead.`,
        );

        // 3. A new source under the dotenv file fails as well.
        writeFileSync(join(workspace.root, "rust/crates/cli/src/main.rs"), cliPrinting("v2"));
        expect((await runNx(workspace, ["run", "cli:build"])).status).toBe(1);
        expect(taskCalls(workspace)).toEqual(["build -p cli"]);
        expect(existsSync(join(workspace.root, "rust/out"))).toBe(false);

        // 4. Without the dotenv file and the folders, nothing of v1 is restored.
        rmSync(join(workspace.root, "rust/crates/cli/.env"));
        rmSync(join(workspace.root, "rust/target"), { recursive: true });
        const last = await runNx(workspace, ["run", "cli:build"]);
        expect(last.status).toBe(0);
        expect(last.output).not.toMatch(new RegExp(hit));
        expect(runs()).toMatch(/^v2 /);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, string, (root: string) => string, string, string]>([
    [
      "CARGO_TARGET_DIR in the crate's .env",
      "rust/crates/cli/.env",
      () => "CARGO_TARGET_DIR=out\n",
      "cli:build",
      'CARGO_TARGET_DIR is "out"',
    ],
    [
      "CARGO_BUILD_TARGET_DIR in a root .env.build",
      ".env.build",
      () => "CARGO_BUILD_TARGET_DIR=out\n",
      "cli:build",
      'CARGO_BUILD_TARGET_DIR is "out"',
    ],
    [
      "CARGO_TARGET_DIR in a .env of a configuration that the run selects",
      "rust/crates/cli/.env.fast",
      () => "CARGO_TARGET_DIR=out\n",
      "cli:build:fast",
      'CARGO_TARGET_DIR is "out"',
    ],
    [
      "CARGO_TARGET_DIR in the workspace folder's .env",
      "rust/.env",
      () => "CARGO_TARGET_DIR=out\n",
      "rust:doc",
      'CARGO_TARGET_DIR is "out"',
    ],
    [
      "CARGO_HOME, whose configuration names another folder, in a root .env.doc",
      ".env.doc",
      (root) => `CARGO_HOME=${join(root, "..", "other-home")}\n`,
      "rust:doc",
      "CARGO_HOME is ",
    ],
  ])(
    "fails before cargo builds where %s moves the artifact directory, naming both folders",
    async (_case, dotenv, content, task, variable) => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        ".gitignore": appended(".env*\n/rust/out/\n"),
        "rust/crates/cli/Cargo.toml": appended(
          '\n[package.metadata.nx.targets.build.configurations.fast]\nprofile = "release"\n',
        ),
      });
      try {
        mkdirSync(join(workspace.root, "..", "other-home"));
        writeFileSync(
          join(workspace.root, "..", "other-home", "config.toml"),
          `[build]\ntarget-dir = "${join(workspace.root, "rust/out")}"\n`,
        );
        writeFileSync(join(workspace.root, dotenv), content(workspace.root));
        const [project, target] = task.split(":");
        const run = await runNx(workspace, ["run", task]);

        expect({ status: run.status, output: run.output }).toEqual({
          status: 1,
          output: expect.stringContaining(
            `${project}:${target}: cargo puts the artifacts of this run of the cached ${target} in rust/out, but its outputs name the artifact directory rust/target: ${variable}`,
          ),
        });
        expect(run.output).toContain(
          "A variable that only a dotenv file of the task sets, such as a .env file in the crate's or the workspace's folder or a root .env.build, .env.doc or .env.<configuration>, is unknown when Nx creates the graph.",
        );
        expect(run.output).toContain(
          `${notRun} Set the variable in the environment of the nx command or in the repository's root .env file, or set the folder as build.target-dir in a .cargo/config.toml of the workspace instead.`,
        );
        expect(taskCalls(workspace)).toEqual([]);
        expect(existsSync(join(workspace.root, "rust/out"))).toBe(false);

        // Positive control: without the file, cargo runs and is logged.
        rmSync(join(workspace.root, dotenv));
        expect((await runNx(workspace, ["run", task])).status).toBe(0);
        expect(taskCalls(workspace)).toHaveLength(1);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "caches build and doc in the folder that the repository's root .env names, which graph creation sees",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        ".env": "CARGO_TARGET_DIR=out\n",
        ".gitignore": appended("/rust/out/\n"),
      });
      try {
        await expectRestored(workspace, {}, "rust/out");
        expect(existsSync(join(workspace.root, "rust/target"))).toBe(false);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("a cached build or doc whose targetTriple option cargo names another folder for", () => {
  it.each(["cli:build", "rust:doc"])(
    "fails %s before cargo runs for host-tuple, naming the host's triple, which then builds",
    async (task) => {
      const workspace = FixtureWorkspace.create("crate-shapes");
      const host = hostTriple();
      const target = task.split(":")[1];
      try {
        const run = await runNx(workspace, ["run", task, "--targetTriple=host-tuple"]);

        expect({ status: run.status, output: run.output }).toEqual({
          status: 1,
          output: expect.stringContaining(
            `${task}: the targetTriple option of this run of the cached ${target} is "host-tuple", and @convesoft/nx-rust cannot name the folder that cargo writes to for this value: cargo replaces it with the host's triple. ${notRun} Pass the host's triple itself in place of host-tuple: --targetTriple=${host}.`,
          ),
        });
        expect(taskCalls(workspace)).toEqual([]);

        const named = await runNx(workspace, ["run", task, `--targetTriple=${host}`]);
        expect(named.status).toBe(0);
        expect(taskCalls(workspace)).toHaveLength(1);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a cached build before cargo runs for a target specification file, and runs it where the target is uncached",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes");
      try {
        const run = await runNx(workspace, [
          "run",
          "cli:build",
          "--targetTriple=specs/custom.json",
        ]);

        expect({ status: run.status, output: run.output }).toEqual({
          status: 1,
          output: expect.stringContaining(
            `cli:build: the targetTriple option of this run of the cached build is "specs/custom.json", and @convesoft/nx-rust cannot name the folder that cargo writes to for this value: it names a target specification file. ${notRun} Build with a built-in triple, or run the target uncached: set cache = false in [package.metadata.nx.targets.build] of the crate's Cargo.toml, or in the target's configuration in a project.json.`,
          ),
        });
        expect(taskCalls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }

      // Where the target is uncached, the executor leaves the value to cargo.
      const uncached = FixtureWorkspace.create("crate-shapes", {
        "rust/crates/cli/Cargo.toml": appended(
          "\n[package.metadata.nx.targets.build]\ncache = false\n",
        ),
      });
      try {
        const run = await runNx(uncached, ["run", "cli:build", "--targetTriple=host-tuple"]);
        expect({ status: run.status, output: run.output }).toEqual({
          status: 0,
          output: expect.any(String),
        });
        expect(taskCalls(uncached)).toEqual(["build -p cli --target host-tuple"]);
      } finally {
        uncached.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
