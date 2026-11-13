import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { FixtureWorkspace, HARNESS_TIMEOUT, testEnvironment, withoutColours } from "./harness";

// Checks with real Nx runs of the plugin's executor what the caching of
// nxr-fy4t4k stores and restores: the parts of VER-CARGO-UNCHANGED about
// cache entries and restores, the missing-toolchain case of VER-CACHE-KEYS,
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

/** The cargo calls of tasks, as `<args>`: every logged call but graph creation's. */
function taskCalls(workspace: FixtureWorkspace): string[] {
  return workspace
    .cargoCalls()
    .filter((call) => call.args[0] !== "metadata")
    .map((call) => call.args.join(" "))
    .sort();
}

/** How Nx marks a task that it restored from the cache, with or without copying outputs. */
const hit = String.raw`\[(local cache|existing outputs match the cache, left as is)\]`;

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
        expect(taskCalls(workspace)).toEqual(["build -p cli"]);
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
        expect(taskCalls(workspace)).toEqual([
          "check --all-targets -p cli",
          "check --all-targets -p cli",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, string, (root: string) => Record<string, string>, string]>([
    [
      "two workspaces share one artifact directory",
      "scaffold:fmt-check",
      () => ({}),
      "shares Cargo's artifact directory target with",
    ],
    [
      "the artifact directory lies outside the repository",
      "app:fmt-check",
      (root) => ({ CARGO_TARGET_DIR: join(root, "..", "target-outside") }),
      "outside the repository, where Nx cannot store files",
    ],
  ])(
    "repeats the warning of graph creation in the output of a task, and init prints it, where %s (VER-SETUP)",
    async (_case, task, env, warning) => {
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
          'The targetDefaults entry "build" in nx.json changes targets that nx-rust infers:\n  - It turns on caching for "build", which nx-rust leaves uncached: Nx could restore a result where running the task would give another one. In ',
        );
        expect(result.output).toContain("cli (rust/crates/cli/Cargo.toml)");
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
    "fails a cached build or doc whose triple CARGO_BUILD_TARGET chooses, and caches it with the targetTriple option",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes");
      try {
        const env = { CARGO_BUILD_TARGET: hostTriple() };
        for (const task of ["cli:build", "rust:doc"]) {
          const failed = await nx(workspace, ["run", task], env);
          expect(failed.status).toBe(1);
          expect(failed.output).toContain(
            `${task}: CARGO_BUILD_TARGET is "${hostTriple()}", and @convesoft/nx-rust cannot cache`,
          );
          expect(failed.output).toContain(`--targetTriple=${hostTriple()}`);
        }
        expect(taskCalls(workspace)).toEqual([]);
        // Other targets run as before.
        expect((await nx(workspace, ["run", "cli:check"], env)).status).toBe(0);

        const option = ["run", "cli:build", `--targetTriple=${hostTriple()}`];
        expect((await nx(workspace, option, env)).status).toBe(0);
        const artifact = join(workspace.root, "rust/target", hostTriple(), "debug/cli");
        rmSync(artifact);
        const restored = await nx(workspace, option, env);
        expect(restored.output).toMatch(new RegExp(hit));
        expect(existsSync(artifact)).toBe(true);
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

  it(
    "runs build every time where Cargo's configuration chooses the triple",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes", {
        "rust/.cargo/config.toml": `[build]\ntarget = "${hostTriple()}"\n`,
      });
      try {
        expect((await nx(workspace, ["run", "cli:build"])).status).toBe(0);
        const second = await nx(workspace, ["run", "cli:build"]);
        expect(second.status).toBe(0);
        expect(second.output).not.toMatch(new RegExp(hit));
        expect(second.output).toContain("sets build.target");
        expect(taskCalls(workspace)).toEqual(["build -p cli", "build -p cli"]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/** The triple that the installed toolchain builds for by default. */
function hostTriple(): string {
  const { stdout } = spawnSync("rustc", ["-vV"], { env: testEnvironment(), encoding: "utf8" });
  const host = /^host: (.+)$/m.exec(stdout)?.[1];
  if (host === undefined) {
    throw new Error(`rustc -vV named no host triple:\n${stdout}`);
  }
  return host;
}
