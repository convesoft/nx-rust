import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { FixtureWorkspace, HARNESS_TIMEOUT, withoutColours } from "./harness";

// Checks with real Nx runs of the plugin's executor what the caching of
// nxr-fy4t4k stores and restores: the parts of VER-CARGO-UNCHANGED about
// cache entries and restores, and the missing-toolchain case of
// VER-CACHE-KEYS. caching.spec.ts checks the declared inputs and outputs,
// cache-keys.spec.ts the keys.

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
});
