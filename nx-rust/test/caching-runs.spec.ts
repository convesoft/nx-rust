import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  CompilerLinks,
  FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  packageSpec,
  pinnedToolchain,
  pinnedToolchainAvailable,
  pluginWorkers,
  programVersion,
  taskCalls as harnessTaskCalls,
  testEnvironment,
  toolchainProgram,
  withoutColours,
} from "./harness";

// Checks with real Nx runs of the plugin's executor what the caching of
// nxr-fy4t4k stores and restores: the parts of VER-CARGO-UNCHANGED about
// cache entries and restores, the missing-toolchain case of VER-CACHE-KEYS
// and its runs with a compiler that a setting names,
// and the cases of VER-TARGET-DEFAULT-GUARD where the artifact directory
// lies outside the repository. caching.spec.ts checks the declared inputs
// and outputs, cache-keys.spec.ts the keys, target-defaults.spec.ts the
// other cases of the report.

/** Runs Nx in the workspace with static output, its colours removed. */
async function nx(
  workspace: FixtureWorkspace,
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ status: number | null; output: string }> {
  const { status, output } = await workspace.nx([...args, "--output-style=static"], env);
  return { status, output: withoutColours(output) };
}

/** The cargo calls of tasks other than the lockfile task, as `<args>`, sorted. */
function taskCalls(workspace: FixtureWorkspace): string[] {
  return harnessTaskCalls(workspace)
    .map((call) => call.args.join(" "))
    .sort();
}

/** How Nx marks a task that it restored from the cache, with or without copying outputs. */
const hit = String.raw`\[(local cache|existing outputs match the cache, left as is)\]`;

/**
 * A triple other than the host's that a test may build for where its
 * target is installed; CI installs only the host's.
 */
const secondTriple = "x86_64-unknown-linux-musl";

/** Every file below `folder` with its modification time, by path relative to it. */
function modificationTimes(folder: string): Record<string, number> {
  const times: Record<string, number> = {};
  if (!existsSync(folder)) {
    return times;
  }
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      times[relative(folder, path)] = statSync(path).mtimeMs;
    }
  }
  return times;
}

describe("a run with the plugin's executor", () => {
  it(
    "stores the cached targets, restores their final artifacts and nothing of the build directory, and runs the uncached ones every time",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "rust/crates/core/Cargo.toml": (manifest) =>
          `${manifest}\n[lib]\ncrate-type = ["cdylib", "staticlib", "rlib"]\n`,
      });
      try {
        // A build directory outside the repository, as the guide recommends,
        // beside the copy, so that removing the workspace removes it too.
        const buildDirectory = join(workspace.root, "..", "build-dir");
        mkdirSync(join(workspace.root, "rust", ".cargo"));
        writeFileSync(
          join(workspace.root, "rust", ".cargo", "config.toml"),
          `[build]\nbuild-dir = "${buildDirectory}"\n`,
        );
        const crateTasks = ["build", "check", "lint", "test", "fmt-check", "fmt"];
        const run = async () => {
          workspace.cargo.clear();
          const crates = await nx(workspace, [
            "run-many",
            "-t",
            ...crateTasks,
            "-p",
            "cli",
            "core-lib",
          ]);
          const doc = await nx(workspace, ["run", "rust:doc"]);
          expect({ status: crates.status, output: crates.output }).toEqual({
            status: 0,
            output: expect.any(String),
          });
          expect({ status: doc.status, output: doc.output }).toEqual({
            status: 0,
            output: expect.any(String),
          });
          return `${crates.output}\n${doc.output}`;
        };

        await run();
        const artifacts = [
          "rust/target/debug/cli",
          "rust/target/debug/libcore_lib.so",
          "rust/target/debug/libcore_lib.a",
          "rust/target/doc/cli/index.html",
        ];
        for (const artifact of artifacts) {
          expect({ artifact, exists: existsSync(join(workspace.root, artifact)) }).toEqual({
            artifact,
            exists: true,
          });
        }
        const before = modificationTimes(buildDirectory);
        expect(Object.keys(before).length).toBeGreaterThan(0);
        rmSync(join(workspace.root, "rust/target/debug/cli"));
        rmSync(join(workspace.root, "rust/target/debug/libcore_lib.so"));
        rmSync(join(workspace.root, "rust/target/debug/libcore_lib.a"));
        rmSync(join(workspace.root, "rust/target/doc"), { recursive: true });

        const output = await run();

        // Only the uncached fmt ran cargo again.
        expect(taskCalls(workspace)).toEqual(["fmt -p cli", "fmt -p core-lib"]);
        for (const task of ["cli:build", "core-lib:test", "cli:lint", "rust:doc"]) {
          expect(output).toMatch(new RegExp(`nx run ${task}\\s+${hit}`));
        }
        expect(output).not.toMatch(new RegExp(`nx run cli:fmt\\s+${hit}`));
        for (const artifact of artifacts) {
          expect({ artifact, exists: existsSync(join(workspace.root, artifact)) }).toEqual({
            artifact,
            exists: true,
          });
        }
        // Restoring wrote nothing into the build directory.
        expect(modificationTimes(buildDirectory)).toEqual(before);
        // No cache entry holds a file that only Cargo consumes.
        const cached = Object.keys(modificationTimes(join(workspace.root, ".nx", "cache")));
        expect(cached.filter((path) => /\.(rlib|rmeta|d)$|(^|\/)deps\//.test(path))).toEqual([]);
        expect(cached.some((path) => path.endsWith("rust/target/debug/cli"))).toBe(true);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );

  it(
    "restores a cached target that a targetDefaults entry also caches, without the executor's guard",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "nx.json": (text) =>
          JSON.stringify({ ...JSON.parse(text), targetDefaults: { build: { cache: true } } }),
      });
      try {
        const first = await nx(workspace, ["run", "cli:build"]);
        const second = await nx(workspace, ["run", "cli:build"]);

        expect(first.status).toBe(0);
        expect(second.status).toBe(0);
        expect(second.output).toMatch(new RegExp(hit));
        expect(second.output).not.toContain('sets "cache": true');
        expect(taskCalls(workspace)).toEqual([
          `build -p ${packageSpec(workspace.root, "rust", "cli")}`,
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs a cached task again while the toolchain it uses is missing, also when Nx caches failures (VER-CACHE-KEYS)",
    async () => {
      // The toolchain comes from a .env that Git ignores, so that only it changes.
      const workspace = FixtureWorkspace.create("crate-shapes", {
        ".gitignore": (text) => `${text ?? ""}.env\n`,
      });
      try {
        const env = { NX_CACHE_FAILURES: "true" };
        // Positive control: with the toolchain installed, the second run is restored.
        await nx(workspace, ["run", "cli:check"], env);
        const restored = await nx(workspace, ["run", "cli:check"], env);
        expect(restored.status).toBe(0);
        expect(restored.output).toMatch(new RegExp(hit));

        // A toolchain that rustup cannot have; the harness sets RUSTUP_AUTO_INSTALL=0.
        writeFileSync(
          join(workspace.root, "rust/crates/cli/.env"),
          "RUSTUP_TOOLCHAIN=nx-rust-missing-toolchain\n",
        );
        workspace.cargo.clear();
        const first = await nx(workspace, ["run", "cli:check"], env);
        const second = await nx(workspace, ["run", "cli:check"], env);

        expect(first.status).toBe(1);
        expect(second.status).toBe(1);
        expect(second.output).not.toMatch(new RegExp(hit));
        // Each run's first cargo call, which asks for the crate's package ID
        // specification before its command (DES-INVOCATION), meets the
        // missing toolchain with the task's environment, as the command would.
        expect(second.output).toContain(
          "cli:check: `cargo metadata` could not list the members of the Cargo workspace for this task",
        );
        expect(second.output).toContain("nx-rust-missing-toolchain");
        const memberReport = {
          cwd: "rust",
          args: ["metadata", "--format-version", "1", "--no-deps"],
        };
        expect(
          workspace
            .cargoCalls()
            .filter((call) => call.args.join(" ") === memberReport.args.join(" ")),
        ).toEqual([memberReport, memberReport]);
        expect(taskCalls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, string, (root: string) => Record<string, string>, string, string]>([
    [
      "two workspaces share one artifact directory",
      "scaffold:fmt-check",
      () => ({}),
      "shares Cargo's artifact directory target with",
      "To cache it, give each workspace an artifact directory of its own with build.target-dir in its .cargo/config.toml.",
    ],
    [
      "the artifact directory lies outside the repository",
      "app:fmt-check",
      (root) => ({ CARGO_TARGET_DIR: join(root, "..", "target-outside") }),
      "outside the repository, where Nx cannot store files",
      "To cache them, set build.target-dir in a .cargo/config.toml of the workspace to a folder inside the repository, or unset CARGO_TARGET_DIR.",
    ],
  ])(
    "repeats the warning of graph creation in the output of a task, and init prints it, where %s (VER-SETUP)",
    async (_case, task, env, warning, remedy) => {
      const workspace = FixtureWorkspace.create("two-workspaces", {
        ".cargo/config.toml": (text) =>
          task === "scaffold:fmt-check" ? '[build]\ntarget-dir = "target"\n' : (text ?? "# none\n"),
      });
      try {
        const result = await nx(workspace, ["run", task], env(workspace.root));
        expect(result.status).toBe(0);
        // The task's own output starts after its header; graph creation prints before it.
        const taskOutput = result.output.slice(result.output.indexOf(`> nx run ${task}`));
        expect(taskOutput).toContain(warning);
        expect(taskOutput).toContain(remedy);

        workspace.reset({
          "nx.json": "{}\n",
          ".cargo/config.toml":
            task === "scaffold:fmt-check" ? '[build]\ntarget-dir = "target"\n' : "# none\n",
        });
        const init = await nx(workspace, ["g", "@convesoft/nx-rust:init"], env(workspace.root));
        expect(init.status).toBe(0);
        expect(init.output).toContain(warning);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation for a targetDefaults entry that caches a target where the plugin leaves it uncached in that project (VER-TARGET-DEFAULT-GUARD)",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "nx.json": (text) =>
          JSON.stringify({ ...JSON.parse(text), targetDefaults: { build: { cache: true } } }),
      });
      try {
        const env = { CARGO_TARGET_DIR: join(workspace.root, "..", "target-outside") };
        const result = await nx(workspace, ["run", "cli:build"], env);

        expect(result.status).toBe(1);
        expect(result.output).toContain(
          'The targetDefaults entry "build" in nx.json changes targets that nx-rust infers:',
        );
        expect(result.output).toContain(
          'It turns on caching for "build", which nx-rust leaves uncached',
        );
        expect(result.output).toContain("cli (rust/crates/cli/Cargo.toml)");
        expect(result.output).toContain('"@convesoft/nx-rust:cargo": {}');
        expect(taskCalls(workspace)).toEqual([]);
        // Where the plugin caches build, the same entry fails nothing.
        expect((await nx(workspace, ["run", "cli:build"])).status).toBe(0);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a task whose project.json caches a target where the plugin leaves it uncached in that project, before cargo runs",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "rust/crates/cli/project.json": JSON.stringify({ targets: { build: { cache: true } } }),
      });
      try {
        const env = { CARGO_TARGET_DIR: join(workspace.root, "..", "target-outside") };
        const result = await nx(workspace, ["run", "cli:build"], env);

        expect(result.status).toBe(1);
        expect(result.output).toContain(
          'cli:build: the configuration of this target sets "cache": true, but @convesoft/nx-rust leaves `build` uncached in this project, because its workspace\'s artifact directory lies outside the repository',
        );
        expect(result.output).toContain(
          "The setting comes from the workspace's configuration: run `nx show target cli:build --json` and look under `sourceMap` for the file and entry.",
        );
        expect(taskCalls(workspace)).toEqual([]);
        // Where the plugin caches build, the same file fails nothing.
        expect((await nx(workspace, ["run", "cli:build"])).status).toBe(0);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "caches build and doc where CARGO_BUILD_TARGET in the nx command's environment picks the triple, and restores what the run wrote",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes");
      try {
        const env = { CARGO_BUILD_TARGET: hostTriple() };
        await expectRestored(workspace, env, [hostTriple()]);
        expect(taskCalls(workspace)).toEqual([
          `build -p ${packageSpec(workspace.root, "rust", "cli")}`,
          "doc --no-deps --workspace",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a cached build or doc whose triple only a dotenv file of the task picks before cargo runs, and caches it with the targetTriple option",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "rust/crates/cli/.env": `CARGO_BUILD_TARGET=${hostTriple()}\n`,
        ".env.doc": `CARGO_BUILD_TARGET=${hostTriple()}\n`,
      });
      try {
        for (const task of ["cli:build", "rust:doc"]) {
          const failed = await nx(workspace, ["run", task]);
          const target = task.split(":")[1];
          expect(failed.status).toBe(1);
          expect(failed.output).toContain(
            `${task}: cargo builds this run of the cached ${target} for the triple ${hostTriple()}, as CARGO_BUILD_TARGET picks, but its outputs name the artifact directory itself, for no triple, as Cargo's configuration and the environment picked them when Nx created the graph.`,
          );
          expect(failed.output).toContain(
            `Set it in the environment of the nx command or in the repository's root .env file, or give the triple as the targetTriple option, --targetTriple=${hostTriple()}.`,
          );
        }
        expect(taskCalls(workspace)).toEqual([]);
        // Other targets run as before.
        expect((await nx(workspace, ["run", "cli:check"])).status).toBe(0);

        const option = ["run", "cli:build", `--targetTriple=${hostTriple()}`];
        expect((await nx(workspace, option)).status).toBe(0);
        const artifact = join(workspace.root, "rust/target", hostTriple(), "debug/cli");
        const built = contents(artifact);
        rmSync(artifact);
        const restored = await nx(workspace, option);
        expect(restored.output).toMatch(new RegExp(hit));
        expect(contents(artifact)).toEqual(built);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a cached build whose dotenv file picks a triple whose folder the plugin cannot name before cargo runs, saying to give the triple as the targetTriple option",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "rust/crates/cli/.env": "CARGO_BUILD_TARGET=host-tuple\n",
      });
      try {
        const failed = await nx(workspace, ["run", "cli:build"]);

        expect(failed.status).toBe(1);
        expect(failed.output).toContain(
          'cli:build: CARGO_BUILD_TARGET picks the target triple "host-tuple", whose folder @convesoft/nx-rust cannot name',
        );
        expect(failed.output).toContain(
          "and this run of the cached build names no triple in the targetTriple option. Give the triple as the targetTriple option instead.",
        );
        expect(taskCalls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "rejects the profiles dev, test and bench on build and doc, naming what to use instead",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes");
      try {
        for (const [task, profile, instead] of [
          ["cli:build", "dev", "Build with no profile"],
          ["cli:build", "test", "Build with no profile"],
          ["cli:build", "bench", "Build with the profile release"],
          ["rust:doc", "bench", "Build with the profile release"],
        ]) {
          const result = await nx(workspace, ["run", task, `--profile=${profile}`]);
          expect({ task, profile, status: result.status }).toEqual({ task, profile, status: 1 });
          expect(result.output).toContain(
            `${task}: the profile ${profile} puts cargo's artifacts in the folder of another profile`,
          );
          expect(result.output).toContain(instead);
        }
        expect(taskCalls(workspace)).toEqual([]);
        expect((await nx(workspace, ["run", "cli:build", "--profile=release"])).status).toBe(0);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // A list that names the triple twice names its folder once: graph creation
  // reads each triple once (target-triples.spec.ts), and the outputs name
  // the folder once (caching.spec.ts).
  it(
    "caches build and doc where Cargo's configuration picks the triple as a string, and restores what the run wrote",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "rust/.cargo/config.toml": `[build]\ntarget = "${hostTriple()}"\n`,
      });
      try {
        await expectRestored(workspace, {}, [hostTriple()]);
        expect(taskCalls(workspace)).toEqual([
          `build -p ${packageSpec(workspace.root, "rust", "cli")}`,
          "doc --no-deps --workspace",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  if (secondTripleInstalled()) {
    it(
      "caches build and doc in the folder of each triple of a list in Cargo's configuration, and restores what the run wrote",
      async () => {
        const workspace = FixtureWorkspace.create("crate-shapes", {
          "rust/.cargo/config.toml": `[build]\ntarget = ["${hostTriple()}", "${secondTriple}"]\n`,
        });
        try {
          await expectRestored(workspace, {}, [hostTriple(), secondTriple]);
          expect(taskCalls(workspace)).toEqual([
            `build -p ${packageSpec(workspace.root, "rust", "cli")}`,
            "doc --no-deps --workspace",
          ]);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  }

  it.each([
    [
      "only a configuration that the run does not select names a triple",
      (triple: string) =>
        `\n[package.metadata.nx.targets.build.configurations.explicit]\ntargetTriple = "${triple}"\n`,
    ],
    [
      "a configuration clears the triple that the options name",
      (triple: string) =>
        `\n[package.metadata.nx.targets.build.options]\ntargetTriple = "${triple}"\n[package.metadata.nx.targets.build.configurations.plain]\ntargetTriple = ""\n`,
    ],
  ])(
    "caches build where Cargo's configuration picks the triple and %s, and restores the artifact",
    async (_case, table) => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "rust/.cargo/config.toml": `[build]\ntarget = "${hostTriple()}"\n`,
        "rust/crates/cli/Cargo.toml": (manifest) => `${manifest}${table(hostTriple())}`,
      });
      try {
        expect((await nx(workspace, ["run", "cli:build"])).status).toBe(0);
        const artifact = join(workspace.root, "rust/target", hostTriple(), "debug/cli");
        const built = contents(artifact);
        rmSync(artifact);
        const second = await nx(workspace, ["run", "cli:build"]);

        expect(second.status).toBe(0);
        expect(second.output).toMatch(new RegExp(hit));
        expect(contents(artifact)).toEqual(built);
        expect(taskCalls(workspace)).toHaveLength(1);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs build every time where Cargo's configuration picks a triple whose folder the plugin cannot name, and fails a task that a project.json caches",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "rust/.cargo/config.toml": '[build]\ntarget = "host-tuple"\n',
      });
      try {
        expect((await nx(workspace, ["run", "cli:build"])).status).toBe(0);
        const second = await nx(workspace, ["run", "cli:build"]);
        expect(second.status).toBe(0);
        expect(second.output).not.toMatch(new RegExp(hit));
        expect(second.output).toContain(
          'build.target in rust/.cargo/config.toml picks the target triple "host-tuple"',
        );
        expect(taskCalls(workspace)).toEqual([
          `build -p ${packageSpec(workspace.root, "rust", "cli")}`,
          `build -p ${packageSpec(workspace.root, "rust", "cli")}`,
        ]);

        // A project.json that caches build anyway fails the task before
        // cargo runs, saying why and what to do instead.
        writeFileSync(
          join(workspace.root, "rust/crates/cli/project.json"),
          JSON.stringify({ targets: { build: { cache: true } } }),
        );
        const cached = await nx(workspace, ["run", "cli:build"]);
        expect(cached.status).toBe(1);
        expect(cached.output).toContain(
          'leaves `build` uncached in this project, because build.target in rust/.cargo/config.toml picks the target triple "host-tuple"',
        );
        expect(cached.output).toContain("give the triple as the targetTriple option instead");
        expect(taskCalls(workspace)).toHaveLength(2);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "caches build with the triple in the target's options where Cargo's configuration picks one that the plugin cannot name, restores the artifact, and fails a run that clears the triple before cargo runs",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "rust/.cargo/config.toml": '[build]\ntarget = "host-tuple"\n',
        "rust/crates/cli/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx.targets.build.options]\ntargetTriple = "${hostTriple()}"\n`,
        // A configuration that the plugin cannot see when it creates the graph.
        "rust/crates/cli/project.json": JSON.stringify({
          targets: { build: { configurations: { plain: { targetTriple: "" } } } },
        }),
      });
      try {
        expect((await nx(workspace, ["run", "cli:build"])).status).toBe(0);
        const artifact = join(workspace.root, "rust/target", hostTriple(), "debug/cli");
        const built = contents(artifact);
        rmSync(artifact);
        const restored = await nx(workspace, ["run", "cli:build"]);

        expect(restored.status).toBe(0);
        expect(restored.output).toMatch(new RegExp(hit));
        expect(contents(artifact)).toEqual(built);

        const cleared = await nx(workspace, ["run", "cli:build", "--configuration=plain"]);

        expect(cleared.status).toBe(1);
        expect(cleared.output).toContain(
          `cli:build: build.target in rust/.cargo/config.toml picks the target triple "host-tuple", whose folder @convesoft/nx-rust cannot name: cargo replaces it with the host's triple, and this run of the cached build names no triple in the targetTriple option.`,
        );
        expect(cleared.output).toContain(
          "Run it with the triple that the target's options give, and remove what clears the option for this run",
        );
        expect(taskCalls(workspace)).toHaveLength(1);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // The Nx daemon keeps its graph until a file that it watches changes, so
  // a change to a Cargo configuration file outside the repository leaves
  // outputs that name the old triple's folder; the triple input changes the
  // key, and the executor stops the task before cargo runs.
  it.each<[string, (cargoHome: string, root: string) => string, string | undefined]>([
    [
      "the Cargo home's configuration picks another triple",
      (cargoHome) => join(cargoHome, "config.toml"),
      secondTriple,
    ],
    [
      "a configuration above the repository picks another triple",
      (_cargoHome, root) => join(root, "..", ".cargo", "config.toml"),
      secondTriple,
    ],
    [
      "the setting is removed from the Cargo home's configuration",
      (cargoHome) => join(cargoHome, "config.toml"),
      undefined,
    ],
  ])(
    "with the Nx daemon, fails a cached build and doc before cargo runs and restores nothing when %s after graph creation, and caches them again once the graph is created afresh",
    async (_case, file, changed) => {
      const workspace = FixtureWorkspace.create("crate-shapes");
      const cargoHome = join(workspace.root, "..", "cargo-home");
      const config = file(cargoHome, workspace.root);
      const env = { ...pluginWorkers, NX_DAEMON: "true", CARGO_HOME: cargoHome };
      try {
        mkdirSync(dirname(config), { recursive: true });
        writeFileSync(config, `[build]\ntarget = "${hostTriple()}"\n`);
        const first = await nx(
          workspace,
          ["run-many", "-t", "build", "doc", "-p", "cli", "rust"],
          env,
        );
        expect({ status: first.status, output: first.output }).toEqual({
          status: 0,
          output: expect.any(String),
        });
        expect(existsSync(join(workspace.root, "rust/target", hostTriple(), "debug/cli"))).toBe(
          true,
        );
        if (changed === undefined) {
          rmSync(config);
        } else {
          writeFileSync(config, `[build]\ntarget = "${changed}"\n`);
        }
        rmSync(join(workspace.root, "rust/target"), { recursive: true });
        const calls = taskCalls(workspace).length;

        for (const task of ["cli:build", "rust:doc"]) {
          const stale = await nx(workspace, ["run", task], env);
          expect({ task, status: stale.status }).toEqual({ task, status: 1 });
          expect(stale.output).not.toMatch(new RegExp(hit));
          expect(stale.output).toContain(
            `${task}: Cargo's configuration has changed since Nx created the project graph:`,
          );
          expect(stale.output).toContain(
            "Run `nx reset`, or stop the daemon with `nx daemon --stop`, and run the task again.",
          );
        }
        // Nothing of the old triple came back, and cargo did not run.
        expect(existsSync(join(workspace.root, "rust/target"))).toBe(false);
        expect(taskCalls(workspace)).toHaveLength(calls);

        // A graph created afresh names the new folders, and the result is
        // stored and restored there.
        if (changed === undefined || secondTripleInstalled()) {
          await workspace.nx(["daemon", "--stop"], env);
          await expectRestored(workspace, env, [changed ?? "."]);
        }
      } finally {
        await workspace.nx(["daemon", "--stop"], env);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // Where the plugin entry of cli does not receive the root manifest, its
  // first report starts in rust/crates/cli, while the task runs cargo in
  // rust/ (nxr-xrfd50).
  it.each<[string, FileChanges, Record<string, string>, string]>([
    [
      "a member's Cargo configuration sets",
      { "rust/crates/cli/.cargo/config.toml": '[build]\ntarget-dir = "member-target"\n' },
      {},
      "rust/target",
    ],
    [
      "a relative CARGO_TARGET_DIR gives",
      {},
      { CARGO_TARGET_DIR: "env-target" },
      "rust/env-target",
    ],
  ])(
    "restores a binary where cargo writes it, where %s another artifact directory in the first folder that the crate's plugin entry reads",
    async (_case, files, env, directory) => {
      const workspace = FixtureWorkspace.create("crate-shapes", files, {
        // The root manifest goes to a second entry, which gives the
        // workspace its lockfile task, so that build stays cached.
        "nx.json": (text) => {
          const config = JSON.parse(text);
          const [first] = config.plugins;
          const plugin = typeof first === "string" ? first : first.plugin;
          return JSON.stringify({
            ...config,
            plugins: [
              { plugin, exclude: ["rust/Cargo.toml"] },
              { plugin, include: ["rust/Cargo.toml"] },
            ],
          });
        },
      });
      try {
        const binary = join(workspace.root, directory, "debug", "cli");
        const built = await nx(workspace, ["run", "cli:build"], env);
        expect({ status: built.status, output: built.output }).toEqual({
          status: 0,
          output: expect.any(String),
        });
        expect(existsSync(binary)).toBe(true);
        rmSync(binary);

        const restored = await nx(workspace, ["run", "cli:build"], env);

        expect(restored.status).toBe(0);
        expect(restored.output).toMatch(new RegExp(`nx run cli:build\\s+${hit}`));
        expect(existsSync(binary)).toBe(true);
        expect(taskCalls(workspace)).toEqual([
          `build -p ${packageSpec(workspace.root, "rust", "cli")}`,
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "restores a binary where cargo writes it, where the artifact directory is spelled through a symbolic link and .. (nxr-5gzr0n)",
    async () => {
      // tools/link leads to deep/child, so that cargo writes the files of
      // tools to deep/target, not to tools/target, which the path that
      // cargo reports, tools/link/../target, gives as text.
      const workspace = FixtureWorkspace.create("two-workspaces", {
        ".cargo/config.toml": '[build]\ntarget-dir = "deep/target"\n',
        "tools/.cargo/config.toml": '[build]\ntarget-dir = "link/../target"\n',
      });
      try {
        mkdirSync(join(workspace.root, "deep", "child"), { recursive: true });
        symlinkSync("../deep/child", join(workspace.root, "tools", "link"));
        const binary = join(workspace.root, "deep", "target", "debug", "tools");
        const built = await nx(workspace, ["run", "tools:build"]);
        expect({ status: built.status, output: built.output }).toEqual({
          status: 0,
          output: expect.any(String),
        });
        expect(existsSync(binary)).toBe(true);
        rmSync(binary);

        const restored = await nx(workspace, ["run", "tools:build"]);

        expect(restored.status).toBe(0);
        expect(restored.output).toMatch(new RegExp(`nx run tools:build\\s+${hit}`));
        expect(existsSync(binary)).toBe(true);
        expect(existsSync(join(workspace.root, "tools", "target"))).toBe(false);
        expect(taskCalls(workspace)).toEqual([
          `build -p ${packageSpec(workspace.root, "tools", "tools")}`,
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/** The triple that the installed toolchain builds for by default. */
function secondTripleInstalled(): boolean {
  const { stdout } = spawnSync("rustup", ["target", "list", "--installed"], {
    env: testEnvironment(),
    encoding: "utf8",
  });
  return (
    hostTriple() === "x86_64-unknown-linux-gnu" && (stdout ?? "").split("\n").includes(secondTriple)
  );
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

/**
 * Runs `cli:build` and `rust:doc` in the folders of `triples`, deletes the
 * binary and the doc folders, runs them again, and expects Nx to restore
 * exactly what the first run wrote there, without cargo.
 */
async function expectRestored(
  workspace: FixtureWorkspace,
  env: Record<string, string>,
  triples: string[],
): Promise<void> {
  const tasks = ["run-many", "-t", "build", "doc", "-p", "cli", "rust"];
  const first = await nx(workspace, tasks, env);
  expect({ status: first.status, output: first.output }).toEqual({
    status: 0,
    output: expect.any(String),
  });
  const paths = triples.flatMap((triple) => [
    join(workspace.root, "rust/target", triple, "debug/cli"),
    join(workspace.root, "rust/target", triple, "doc"),
  ]);
  const written = paths.map((path) => ({ path, files: contents(path) }));
  for (const { path, files } of written) {
    expect({ path, files: Object.keys(files).length > 0 }).toEqual({ path, files: true });
    rmSync(path, { recursive: true });
  }
  const calls = taskCalls(workspace).length;
  const second = await nx(workspace, tasks, env);

  expect(second.status).toBe(0);
  for (const task of ["cli:build", "rust:doc"]) {
    expect(second.output).toMatch(new RegExp(`nx run ${task}\\s+${hit}`));
  }
  expect(taskCalls(workspace)).toHaveLength(calls);
  expect(paths.map((path) => ({ path, files: contents(path) }))).toEqual(written);
}

function hostTriple(): string {
  const { stdout } = spawnSync("rustc", ["-vV"], { env: testEnvironment(), encoding: "utf8" });
  const host = /^host: (.+)$/m.exec(stdout)?.[1];
  if (host === undefined) {
    throw new Error(`rustc -vV named no host triple:\n${stdout}`);
  }
  return host;
}

// The two wrong restores of EVD-CARGO-COMPILER-SELECTION, in real runs:
// the compiler behind the path that RUSTC names replaced, and build.rustc
// set in the Cargo home. They need a second installed toolchain, which CI
// installs; elsewhere they skip where rustup lacks 1.91.0.
(pinnedToolchainAvailable() ? describe : describe.skip)(
  "a run with a compiler that a setting names",
  () => {
    /** `tools` in two-workspaces, changed to print the version of the compiler that built it. */
    const reportingCompiler: FileChanges = {
      "tools/build.rs": [
        "use std::process::Command;",
        "",
        "fn main() {",
        '    let rustc = std::env::var("RUSTC").unwrap();',
        '    let version = Command::new(rustc).arg("-V").output().unwrap().stdout;',
        "    let version = String::from_utf8(version).unwrap();",
        '    println!("cargo:rustc-env=BUILT_BY={}", version.trim());',
        "}",
        "",
      ].join("\n"),
      "tools/src/main.rs": 'fn main() {\n    println!("{}", env!("BUILT_BY"));\n}\n',
    };
    const binary = (workspace: FixtureWorkspace) =>
      join(workspace.root, "tools", "target", "debug", "tools");
    const builtBy = (workspace: FixtureWorkspace) =>
      spawnSync(binary(workspace), { encoding: "utf8" }).stdout.trim();

    /**
     * Runs `tools:build`, applies `change` and deletes the binary, runs the
     * task again and expects it to have been built anew, not restored, by
     * the compiler that `expected` names, and by `old` the first time.
     * The caller checks that both runs called cargo.
     */
    async function expectBuiltAgain(
      workspace: FixtureWorkspace,
      env: Record<string, string>,
      change: () => void,
      old: string,
      expected: () => string,
    ): Promise<void> {
      const first = await nx(workspace, ["run", "tools:build"], env);
      expect({ status: first.status, output: first.output }).toEqual({
        status: 0,
        output: expect.any(String),
      });
      expect(builtBy(workspace)).toBe(old);
      change();
      rmSync(binary(workspace));

      const second = await nx(workspace, ["run", "tools:build"], env);

      expect({ status: second.status, output: second.output }).toEqual({
        status: 0,
        output: expect.not.stringMatching(new RegExp(`nx run tools:build\\s+${hit}`)),
      });
      expect(builtBy(workspace)).toBe(expected());
    }

    it(
      "builds with the new compiler, and restores nothing, after the compiler at the path that RUSTC names is replaced",
      async () => {
        const links = CompilerLinks.create(pinnedToolchain);
        const workspace = FixtureWorkspace.create("two-workspaces", reportingCompiler);
        try {
          const old = programVersion(links.rustc);
          await expectBuiltAgain(
            workspace,
            { RUSTC: links.rustc },
            () => links.point(),
            old,
            () => programVersion(links.rustc),
          );
          expect(programVersion(links.rustc)).not.toBe(old);
          expect(taskCalls(workspace)).toEqual([
            `build -p ${packageSpec(workspace.root, "tools", "tools")}`,
            `build -p ${packageSpec(workspace.root, "tools", "tools")}`,
          ]);
        } finally {
          workspace.remove();
          links.remove();
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "builds with the compiler that build.rustc in the Cargo home names once it is set, and restores nothing, without the daemon",
      async () => {
        const cargoHome = mkdtempSync(join(tmpdir(), "nx-rust-cargo-home-"));
        const workspace = FixtureWorkspace.create("two-workspaces", reportingCompiler);
        try {
          const pinned = toolchainProgram("rustc", pinnedToolchain);
          await expectBuiltAgain(
            workspace,
            { CARGO_HOME: cargoHome },
            () =>
              writeFileSync(
                join(cargoHome, "config.toml"),
                `[build]\nrustc = ${JSON.stringify(pinned)}\n`,
              ),
            programVersion(toolchainProgram("rustc")),
            () => programVersion(pinned),
          );
          expect(taskCalls(workspace)).toEqual([
            `build -p ${packageSpec(workspace.root, "tools", "tools")}`,
            `build -p ${packageSpec(workspace.root, "tools", "tools")}`,
          ]);
        } finally {
          workspace.remove();
          rmSync(cargoHome, { recursive: true, force: true });
        }
      },
      HARNESS_TIMEOUT,
    );
  },
);
