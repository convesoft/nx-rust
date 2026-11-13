import type { ProjectConfiguration } from "@nx/devkit";
import { spawnSync } from "node:child_process";
import { cargoMetadataOf } from "../src/graph/collisions";
import {
  Env,
  expectCacheKeys,
  FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  inFixture,
  pluginWorkers,
  runNx,
  testEnvironment,
  withoutColours,
} from "./harness";

// Checks the paragraph of VER-SETUP about Cargo's build and artifact
// directories inside the repository that Nx does not ignore
// (DES-DIAGNOSTICS): the warning when the graph is created, its absence where
// an ignore file or a folder that Nx always ignores leaves the directory out,
// its repetition at the start of a task, its place among the other warnings
// that a project records, and that recording it changes no cache key.
// init.spec.ts checks that `init` prints it.

/** The warning about `directory`, Cargo's directory in `role` for `workspaces`. */
function directoryWarning(directory: string, role: string, workspaces: string): string {
  return [
    `nx-rust: ${directory}, Cargo's ${role} of ${workspaces}, lies inside the repository, and no .gitignore or .nxignore leaves it out of the files that Nx reads.`,
    "Nx then hashes every file that Cargo writes there, counts those inside a project's folder among the project's files, so that a build can change the cache keys of its tasks, and hands nx-rust the Cargo.toml files that `cargo package` leaves there.",
    `Add the line /${directory}/ to the .gitignore at the repository root.`,
  ].join("\n");
}

/** The warning about `rust/target` in `subfolder-workspace`. */
const rustTarget = directoryWarning(
  "rust/target",
  "build and artifact directory",
  "the Cargo workspace in rust",
);

/** No ignore file in the repository covers `target`. */
const unignored: FileChanges = { ".gitignore": null };

/** What `nx show projects` prints in a copy of `subfolder-workspace` with `files`, with the daemon off. */
async function showProjects(...files: FileChanges[]): Promise<string> {
  const workspace = FixtureWorkspace.create("subfolder-workspace", ...files);
  try {
    const { status, output } = await workspace.nx(["show", "projects"]);
    expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
    return withoutColours(output);
  } finally {
    workspace.remove();
  }
}

/** How often `text` occurs in `output`. */
function occurrences(output: string, text: string): number {
  return output.split(text).length - 1;
}

/** The host's target triple, as the toolchain of the tests reports it. */
function hostTriple(): string {
  const { stdout } = spawnSync("rustc", ["-vV"], { env: testEnvironment(), encoding: "utf8" });
  const host = /^host: (.+)$/m.exec(stdout)?.[1];
  if (host === undefined) {
    throw new Error(`rustc -vV names no host:\n${stdout}`);
  }
  return host;
}

/** The warnings that a project records in its metadata, if any. */
function projectWarnings(project: ProjectConfiguration): string[] | undefined {
  return cargoMetadataOf(project)?.warnings;
}

describe("a Cargo directory inside the repository that Nx does not ignore", () => {
  it(
    "draws a warning when the graph is created, which names it and the line for .gitignore",
    async () => {
      const output = await showProjects(unignored);

      expect(occurrences(output, rustTarget)).toBe(1);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "draws one warning for the build directory and one for the artifact directory where they differ",
    async () => {
      const buildDir = { "rust/.cargo/config.toml": '[build]\nbuild-dir = "build"\n' };

      const both = await showProjects(unignored, buildDir);
      const buildOnly = await showProjects({ ".gitignore": "target/\n" }, buildDir);

      const build = directoryWarning(
        "rust/build",
        "build directory",
        "the Cargo workspace in rust",
      );
      const artifacts = directoryWarning(
        "rust/target",
        "artifact directory",
        "the Cargo workspace in rust",
      );
      expect([occurrences(both, build), occurrences(both, artifacts)]).toEqual([1, 1]);
      expect([occurrences(buildOnly, build), occurrences(buildOnly, artifacts)]).toEqual([1, 0]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "names every workspace whose directory it is",
    async () => {
      // Both workspaces of two-workspaces put their artifacts into target/.
      const shared = { "tools/.cargo/config.toml": '[build]\ntarget-dir = "../target"\n' };

      const workspace = FixtureWorkspace.create("two-workspaces", unignored, shared);
      try {
        const { status, output } = await workspace.nx(["show", "projects"]);

        expect(status).toBe(0);
        expect(
          occurrences(
            withoutColours(output),
            directoryWarning(
              "target",
              "build and artifact directory",
              "the Cargo workspaces in the repository root and tools",
            ),
          ),
        ).toBe(1);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, FileChanges]>([
    ["only .nxignore excludes it", { ".nxignore": "target/\n" }],
    ["only a .gitignore in the workspace's folder excludes it", { "rust/.gitignore": "/target\n" }],
    [
      "it lies under node_modules, which Nx always ignores",
      { "rust/.cargo/config.toml": '[build]\ntarget-dir = "../node_modules/.cache/cargo"\n' },
    ],
    [
      "it lies under .nx/cache, which Nx always ignores",
      { "rust/.cargo/config.toml": '[build]\ntarget-dir = "../.nx/cache/cargo"\n' },
    ],
  ])(
    "draws no warning where %s",
    async (_case, files) => {
      const output = await showProjects(unignored, files);

      expect(output).not.toContain("lies inside the repository");
      expect(output).toContain("api");
    },
    HARNESS_TIMEOUT,
  );

  it(
    "is recorded for every project of the workspace concerned, and for no other",
    () =>
      // The root .gitignore covers the root workspace's target/ only.
      inFixture("two-workspaces", { ".gitignore": "/target/\n" }, async (workspace) => {
        const { projects } = await workspace.graph();

        const toolsTarget = directoryWarning(
          "tools/target",
          "build and artifact directory",
          "the Cargo workspace in tools",
        );
        expect(
          Object.fromEntries(
            Object.entries(projects).map(([name, project]) => [name, projectWarnings(project)]),
          ),
        ).toEqual({
          "cargo-workspace": undefined,
          app: undefined,
          util: undefined,
          tools: [toolsTarget],
          scaffold: [toolsTarget],
        });
      }),
    HARNESS_TIMEOUT,
  );

  it.each<[string, Env, number]>([
    // Graph creation prints it in the terminal, and the task again.
    ["without the daemon", pluginWorkers, 2],
    // The daemon writes graph creation's warning to its log.
    ["with the daemon", { NX_DAEMON: "true" }, 1],
  ])(
    "is printed again at the start of a task of the workspace's projects, %s",
    (_case, env, printed) =>
      inFixture("subfolder-workspace", unignored, async (workspace) => {
        try {
          // rust:doc runs after rust:lockfile, a task of the same project,
          // which prints it as well.
          for (const [task, tasks] of [
            ["api:fmt-check", 1],
            ["rust:doc", 2],
          ] as const) {
            const { status, output } = await runNx(workspace, ["run", task], env);

            expect({ task, status }).toEqual({ task, status: 0 });
            expect({ task, printed: occurrences(output, rustTarget) }).toEqual({
              task,
              printed: printed - 1 + tasks,
            });
          }
          // Only the daemon has a log, where graph creation printed it.
          expect(occurrences(workspace.daemonLog(), rustTarget) > 0).toBe(env.NX_DAEMON === "true");
        } finally {
          if (env.NX_DAEMON === "true") {
            await workspace.nx(["daemon", "--stop"], env);
          }
        }
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "appears beside the warnings about a shared artifact directory and a configured triple, each once, when the graph is created and at the start of a task",
    () =>
      // The configuration at the root puts the artifacts of both workspaces
      // into target/, and tools/ chooses a triple.
      inFixture(
        "two-workspaces",
        {
          ...unignored,
          ".cargo/config.toml": '[build]\ntarget-dir = "target"\n',
          "tools/.cargo/config.toml": `[build]\ntarget = "${hostTriple()}"\n`,
        },
        async (workspace) => {
          const sharedTarget = directoryWarning(
            "target",
            "build and artifact directory",
            "the Cargo workspaces in the repository root and tools",
          );
          // Each line that starts a warning, named by the warning it starts.
          const warnings = (output: string) =>
            output
              .split("\n")
              .filter((line) => line.startsWith("nx-rust:"))
              .map((line) =>
                sharedTarget.startsWith(line)
                  ? "unignored target"
                  : line.startsWith("nx-rust: the Cargo workspace at the repository root shares")
                    ? "root shares target"
                    : line.startsWith("nx-rust: the Cargo workspace in tools shares")
                      ? "tools shares target"
                      : line.startsWith("nx-rust: tools/.cargo/config.toml sets build.target")
                        ? "tools sets build.target"
                        : line,
              )
              .sort();

          const shown = await runNx(workspace, ["show", "projects"]);
          const { projects } = await workspace.graph();

          expect(shown.status).toBe(0);
          expect(warnings(shown.output)).toEqual([
            "root shares target",
            "tools sets build.target",
            "tools shares target",
            "unignored target",
          ]);
          expect(warnings(projectWarnings(projects.scaffold)?.join("\n") ?? "")).toEqual([
            "tools sets build.target",
            "tools shares target",
            "unignored target",
          ]);
          expect(warnings(projectWarnings(projects.app)?.join("\n") ?? "")).toEqual([
            "root shares target",
            "unignored target",
          ]);
          const daemon = { NX_DAEMON: "true" };
          try {
            const task = await runNx(workspace, ["run", "scaffold:fmt-check"], daemon);

            expect(task.status).toBe(0);
            expect(warnings(task.output)).toEqual([
              "tools sets build.target",
              "tools shares target",
              "unignored target",
            ]);
          } finally {
            await workspace.nx(["daemon", "--stop"], daemon);
          }
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "changes no cache key when it joins a project's metadata",
    async () => {
      // Both states put Cargo's directory into cache/cargo. In the first,
      // cache/.gitignore ignores it and itself, so no file that Nx reads
      // differs between the states: only the projects' metadata does.
      const base: FileChanges = {
        "rust/.cargo/config.toml": '[build]\ntarget-dir = "../cache/cargo"\n',
      };
      const ignored: FileChanges = { "cache/.gitignore": "*\n" };
      const recorded = async (...files: FileChanges[]) => {
        const workspace = FixtureWorkspace.create("subfolder-workspace", ...files);
        try {
          const { projects } = await workspace.graph();
          return [projects.api, projects.rust].map(projectWarnings);
        } finally {
          workspace.remove();
        }
      };
      const cacheCargo = directoryWarning(
        "cache/cargo",
        "build and artifact directory",
        "the Cargo workspace in rust",
      );

      expect(await recorded(base, ignored)).toEqual([undefined, undefined]);
      expect(await recorded(base)).toEqual([[cacheCargo], [cacheCargo]]);
      await expectCacheKeys({
        change: "the warning about cache/cargo in the metadata of api and rust",
        fixture: "subfolder-workspace",
        base: { files: base },
        before: { files: ignored },
        after: {},
        keys: {
          "api:build": "must not differ",
          "api:check": "must not differ",
          "api:lint": "must not differ",
          "api:test": "must not differ",
          "api:fmt-check": "must not differ",
          "rust:doc": "must not differ",
        },
      });
    },
    HARNESS_TIMEOUT,
  );
});
