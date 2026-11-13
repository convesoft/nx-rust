import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type Env,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  inFixture,
  linesWith,
  runNx,
  sortedCalls,
  taskCalls,
  testEnvironment,
  withTargetDefaults,
} from "./harness";

// VER-UNKNOWN-OPTIONS, as far as one cargo call per task can show it: real Nx
// runs in the crate-shapes fixture, whose tasks run cargo through the logging
// wrapper of the harness. The targets are not cached yet (nxr-fy4t4k) and not
// batched yet (milestone 0.2), so the parts about cache hits and groups wait
// for those.

const cargoExecutor = "@convesoft/nx-rust:cargo";

/** The line for an option that the executor does not know, typed on the command line. */
const fromCommandLine = (task: string, option: string) =>
  `${task}: ignoring option \`${option}\`, passed on the command line.`;

/** The line for positional words typed on the command line. */
const wordsFromCommandLine = (task: string, words: string[]) =>
  `${task}: ignoring the positional arguments ${JSON.stringify(words)} (option \`_\`), passed on the command line.`;

/** The line for a declared option that the target does not take, typed on the command line. */
const notTakenFromCommandLine = (task: string, option: string) =>
  `${task}: ignoring option \`${option}\`, which this target does not take, passed on the command line.`;

/** The line for an option that the executor does not know, from the workspace's configuration. */
const fromConfiguration = (task: string, option: string, executor = "cargo") =>
  `${task}: ignoring option \`${option}\`, which the ${executor} executor does not know. It comes from the workspace's configuration: run \`nx show target ${task} --json\` and look under \`sourceMap\` for the file and entry. If it is a \`targetDefaults\` entry in nx.json, add a \`filter\` to it or add an empty entry keyed by "@convesoft/nx-rust:${executor}".`;

/** Every line that names `option` for `task`. */
const linesFor = (output: string, task: string, option: string) =>
  linesWith(output, `${task}: ignoring option \`${option}\``);

const rust = (args: string[]) => ({ cwd: "rust", args });

const passWithNoTests = { test: { options: { passWithNoTests: true } } };

/** Replaces the content of a file in the workspace. */
function write(workspace: FixtureWorkspace, path: string, content: object | string): void {
  const file = join(workspace.root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** Sets `targetDefaults` in the workspace's `nx.json`. */
function setTargetDefaults(workspace: FixtureWorkspace, defaults: object): void {
  const file = join(workspace.root, "nx.json");
  writeFileSync(file, withTargetDefaults(defaults)(readFileSync(file, "utf8")));
}

/** The triple that the installed toolchain builds for by default. */
function hostTriple(): string {
  const { stdout } = spawnSync("rustc", ["-vV"], { env: testEnvironment(), encoding: "utf8" });
  const host = /^host: (.+)$/m.exec(stdout)?.[1];
  if (host === undefined) {
    throw new Error(`rustc -vV named no host triple:\n${stdout}`);
  }
  return host;
}

describe("an option that the executor does not know", () => {
  it(
    "is left out of every Rust task's command, with a line per option that says where it came from",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        const command = ["run-many", "-t", "test", "build", "-p", "core-lib", "cli"];
        expect((await runNx(workspace, command)).status).toBe(0);
        const plain = sortedCalls(taskCalls(workspace));
        expect(plain).toEqual(
          sortedCalls(
            ["core-lib", "cli"].flatMap((crate) => [
              rust(["test", "-p", crate]),
              rust(["build", "-p", crate]),
            ]),
          ),
        );

        setTargetDefaults(workspace, passWithNoTests);
        for (const extra of [[], ["--batch=false"]]) {
          workspace.cargo.clear();
          const result = await runNx(workspace, [...command, "--coverage", ...extra]);

          expect(result.status).toBe(0);
          expect(sortedCalls(taskCalls(workspace))).toEqual(plain);
          for (const crate of ["core-lib", "cli"]) {
            expect(linesFor(result.output, `${crate}:test`, "passWithNoTests")).toEqual([
              fromConfiguration(`${crate}:test`, "passWithNoTests"),
            ]);
            expect(linesFor(result.output, `${crate}:test`, "coverage")).toEqual([
              fromCommandLine(`${crate}:test`, "coverage"),
            ]);
            expect(linesWith(result.output, `${crate}:build: ignoring`)).toEqual([
              fromCommandLine(`${crate}:build`, "coverage"),
            ]);
          }
        }
      }),
    HARNESS_TIMEOUT,
  );

  it.each<[string, object]>([
    ["an empty entry keyed by the executor", { ...passWithNoTests, [cargoExecutor]: {} }],
    [
      "a filter that excludes the crates",
      { test: [{ filter: { executor: "nx:run-commands" }, options: { passWithNoTests: true } }] },
    ],
  ])(
    "reaches no Rust task once %s narrows the entry",
    (_case, defaults) =>
      inFixture("crate-shapes", { "nx.json": withTargetDefaults(defaults) }, async (workspace) => {
        const result = await runNx(workspace, ["run", "core-lib:test", "--coverage"]);

        expect(result.status).toBe(0);
        expect(linesWith(result.output, "ignoring")).toEqual([
          fromCommandLine("core-lib:test", "coverage"),
        ]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "names the workspace's configuration for an option from every source but the command line",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        const projectJson = "rust/crates/core/project.json";
        const configured = fromConfiguration("core-lib:test", "passWithNoTests");
        const cases: [string, () => void, string[]][] = [
          [
            "an entry keyed by the executor",
            () =>
              setTargetDefaults(workspace, {
                [cargoExecutor]: { options: { passWithNoTests: true } },
              }),
            ["run", "core-lib:test"],
          ],
          [
            "a project.json beside the entry",
            () => {
              setTargetDefaults(workspace, passWithNoTests);
              write(workspace, projectJson, {
                targets: { test: { options: { passWithNoTests: false } } },
              });
            },
            ["run", "core-lib:test"],
          ],
          [
            "a project.json beside the entry and an empty entry keyed by the executor",
            () => setTargetDefaults(workspace, { ...passWithNoTests, [cargoExecutor]: {} }),
            ["run", "core-lib:test"],
          ],
          [
            "a project.json beside an entry that a filter keeps from the crates",
            () =>
              setTargetDefaults(workspace, {
                test: [
                  { filter: { executor: "nx:run-commands" }, options: { passWithNoTests: true } },
                ],
              }),
            ["run", "core-lib:test"],
          ],
          [
            "the entry's configuration under -c ci, while the project.json sets the option",
            () =>
              setTargetDefaults(workspace, {
                test: { configurations: { ci: { passWithNoTests: true } } },
              }),
            ["run", "core-lib:test", "-c", "ci"],
          ],
        ];
        for (const [source, arrange, args] of cases) {
          arrange();
          const result = await runNx(workspace, args);

          expect({ source, status: result.status }).toEqual({ source, status: 0 });
          expect({ source, lines: linesWith(result.output, "ignoring") }).toEqual({
            source,
            lines: [configured],
          });
        }
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "names the workspace's configuration for an option from a crate's package.json",
    () =>
      inFixture(
        "crate-shapes",
        {
          // The package manager's workspaces list the crate's folder, so Nx
          // reads the package.json there.
          "package.json": JSON.stringify({
            name: "mixed",
            private: true,
            workspaces: ["rust/crates/core"],
          }),
          "rust/crates/core/package.json": JSON.stringify({
            name: "core-lib",
            nx: { targets: { test: { options: { passWithNoTests: true } } } },
          }),
        },
        async (workspace) => {
          const result = await runNx(workspace, ["run", "core-lib:test"]);

          expect(result.status).toBe(0);
          expect(linesWith(result.output, "ignoring")).toEqual([
            fromConfiguration("core-lib:test", "passWithNoTests"),
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "names the workspace's configuration on each run task for an entry keyed run",
    () =>
      inFixture(
        "crate-shapes",
        { "nx.json": withTargetDefaults({ run: { options: { watch: true } } }) },
        async (workspace) => {
          const result = await runNx(workspace, ["run-many", "-t", "run"]);

          expect(result.status).toBe(0);
          expect(linesWith(result.output, "ignoring").sort()).toEqual([
            fromConfiguration("cli:run", "watch", "run"),
            fromConfiguration("server:run", "watch", "run"),
          ]);
          expect(sortedCalls(taskCalls(workspace))).toEqual([
            rust(["run", "-p", "cli"]),
            rust(["run", "-p", "server"]),
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );
});

describe("an option passed on the command line", () => {
  // test depends on build, as each case's dependsOn entry says.
  const dependsOnBuild = (entry: object) => ({
    "rust/crates/core/project.json": JSON.stringify({
      targets: { test: { dependsOn: [{ target: "build", ...entry }] } },
    }),
  });

  it.each<[string, Env]>([
    ["without the daemon", {}],
    ["with the daemon", { NX_DAEMON: "true" }],
    ["without plugin isolation", { NX_ISOLATE_PLUGINS: "false" }],
    [
      "with the daemon and without plugin isolation",
      { NX_DAEMON: "true", NX_ISOLATE_PLUGINS: "false" },
    ],
  ])(
    "is said to be, also after -- and as positional words, %s",
    (_case, env) =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        try {
          const runs: [string[], string[]][] = [
            [
              ["run", "core-lib:test", "--coverage"],
              [fromCommandLine("core-lib:test", "coverage")],
            ],
            [
              ["run", "core-lib:test", "--", "--coverage"],
              [fromCommandLine("core-lib:test", "coverage")],
            ],
            [
              ["run-many", "-t", "check", "-p", "core-lib", "--ci"],
              [fromCommandLine("core-lib:check", "ci")],
            ],
            [
              ["run", "core-lib:test", "--", "3000", "serve"],
              [wordsFromCommandLine("core-lib:test", ["3000", "serve"])],
            ],
          ];
          for (const [args, lines] of runs) {
            const result = await runNx(workspace, args, env);

            expect({ args, status: result.status }).toEqual({ args, status: 0 });
            expect({ args, lines: linesWith(result.output, "ignoring") }).toEqual({ args, lines });
          }
          expect(taskCalls(workspace)).toEqual([
            rust(["test", "-p", "core-lib"]),
            rust(["test", "-p", "core-lib"]),
            rust(["check", "--all-targets", "-p", "core-lib"]),
            rust(["test", "-p", "core-lib"]),
          ]);
          // The daemon ran the hook where it was on.
          expect(workspace.daemonLog() !== "").toBe(env.NX_DAEMON === "true");
        } finally {
          if (env.NX_DAEMON === "true") {
            await workspace.nx(["daemon", "--stop"], env);
          }
        }
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "is said to be on a dependency that params: forward reaches, and only there",
    () =>
      inFixture("crate-shapes", dependsOnBuild({ params: "forward" }), async (workspace) => {
        const result = await runNx(workspace, ["run", "core-lib:test", "--coverage"]);

        expect(result.status).toBe(0);
        expect(linesWith(result.output, "ignoring").sort()).toEqual([
          fromCommandLine("core-lib:build", "coverage"),
          fromCommandLine("core-lib:test", "coverage"),
        ]);

        workspace.reset(dependsOnBuild({}));
        const ignored = await runNx(workspace, ["run", "core-lib:test", "--coverage"]);
        expect(ignored.status).toBe(0);
        expect(linesWith(ignored.output, "ignoring")).toEqual([
          fromCommandLine("core-lib:test", "coverage"),
        ]);
        expect(taskCalls(workspace)).toEqual([
          rust(["build", "-p", "core-lib"]),
          rust(["test", "-p", "core-lib"]),
        ]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "is not said to be for an option that options: forward hands a dependency",
    () =>
      inFixture(
        "crate-shapes",
        {
          ...dependsOnBuild({ options: "forward" }),
          "nx.json": withTargetDefaults(passWithNoTests),
        },
        async (workspace) => {
          const result = await runNx(workspace, ["run", "core-lib:test"]);

          expect(result.status).toBe(0);
          expect(linesWith(result.output, "ignoring").sort()).toEqual([
            fromConfiguration("core-lib:build", "passWithNoTests"),
            fromConfiguration("core-lib:test", "passWithNoTests"),
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "keeps the configured value of an option named after a second --, which Nx hands over as a word",
    () =>
      inFixture(
        "crate-shapes",
        {
          "rust/crates/core/project.json": JSON.stringify({
            targets: { test: { options: { coverage: "configured" } } },
          }),
        },
        async (workspace) => {
          const result = await runNx(workspace, ["run", "core-lib:test", "--", "--", "--coverage"]);

          expect(result.status).toBe(0);
          expect(linesWith(result.output, "ignoring").sort()).toEqual([
            fromConfiguration("core-lib:test", "coverage"),
            wordsFromCommandLine("core-lib:test", ["--coverage"]),
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "is said to be in nx affected",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        const git = (...args: string[]) =>
          spawnSync(
            "git",
            [
              "-c",
              "user.name=nx-rust",
              "-c",
              "user.email=test@example.invalid",
              "-c",
              "commit.gpgsign=false",
              ...args,
            ],
            { cwd: workspace.root, encoding: "utf8" },
          );
        write(workspace, ".gitignore", "node_modules/\n.nx/\ntarget/\n");
        expect(git("init", "--quiet").status).toBe(0);
        expect(git("add", "--all").status).toBe(0);
        expect(git("commit", "--quiet", "--message", "The fixture").status).toBe(0);
        write(workspace, "rust/crates/internal/src/lib.rs", "pub fn changed() {}\n");

        const result = await runNx(workspace, [
          "affected",
          "-t",
          "check",
          "--base=HEAD",
          "--coverage",
        ]);

        expect(result.status).toBe(0);
        expect(linesWith(result.output, "ignoring")).toEqual([
          fromCommandLine("internal:check", "coverage"),
        ]);
        expect(taskCalls(workspace)).toEqual([rust(["check", "--all-targets", "-p", "internal"])]);
      }),
    HARNESS_TIMEOUT,
  );
});

describe("an option that the target does not take", () => {
  it(
    "is left out of the command with a line that says so",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        const triple = await runNx(workspace, [
          "run",
          "core-lib:test",
          `--targetTriple=${hostTriple()}`,
        ]);
        const allTargets = await runNx(workspace, ["run", "core-lib:build", "--allTargets"]);

        expect(triple.status).toBe(0);
        expect(linesWith(triple.output, "ignoring")).toEqual([
          notTakenFromCommandLine("core-lib:test", "targetTriple"),
        ]);
        expect(allTargets.status).toBe(0);
        expect(linesWith(allTargets.output, "ignoring")).toEqual([
          notTakenFromCommandLine("core-lib:build", "allTargets"),
        ]);
        expect(taskCalls(workspace)).toEqual([
          rust(["test", "-p", "core-lib"]),
          rust(["build", "-p", "core-lib"]),
        ]);
      }),
    HARNESS_TIMEOUT,
  );
});

describe("an option of a target that another executor starts in code", () => {
  // A stand-in for an executor that starts `build` through devkit's
  // runExecutor with its own context and an option that the cargo executor
  // does not know, for one task or for each task of a batch.
  const devkit = require.resolve("@nx/devkit");
  const callerPackage: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "probe-caller",
      version: "0.0.0",
      executors: "./executors.json",
    }),
    "executors.json": JSON.stringify({
      executors: {
        call: {
          implementation: "./call.cjs",
          batchImplementation: "./call.cjs#batch",
          schema: "./schema.json",
          description: "Starts build through runExecutor",
        },
      },
    }),
    "schema.json": JSON.stringify({ version: 2, type: "object", properties: {} }),
    "call.cjs": [
      `const { runExecutor } = require(${JSON.stringify(devkit)});`,
      "async function start(project, context) {",
      '  for await (const result of await runExecutor({ project, target: "build" }, { fromCode: true }, context)) {',
      "    if (!result.success) return false;",
      "  }",
      "  return true;",
      "}",
      "module.exports = async (_options, context) => ({ success: await start(context.projectName, context) });",
      "module.exports.batch = async (taskGraph, _inputs, _overrides, context) => {",
      '  console.log("the caller runs in a batch");',
      "  const results = {};",
      "  for (const task of Object.values(taskGraph.tasks)) {",
      "    results[task.id] = { success: await start(task.target.project, context) };",
      "  }",
      "  return results;",
      "};",
    ].join("\n"),
  };

  it.each<[string, object[]]>([
    ['params: "forward"', [{ target: "build", params: "forward" }]],
    ['params: "ignore"', [{ target: "build" }]],
    ["no dependency", []],
  ])(
    "is ignored with a line and fails no task when the caller has %s, alone and in a batch",
    (_case, dependsOn) =>
      inFixture(
        "crate-shapes",
        {
          "rust/crates/core/project.json": JSON.stringify({
            targets: { call: { executor: "probe-caller:call", dependsOn } },
          }),
        },
        async (workspace) => {
          for (const [file, content] of Object.entries(callerPackage)) {
            write(workspace, `node_modules/probe-caller/${file}`, content);
          }
          for (const batch of [false, true]) {
            const result = await runNx(workspace, [
              "run",
              "core-lib:call",
              ...(batch ? ["--batch"] : []),
            ]);

            expect({ batch, status: result.status }).toEqual({ batch, status: 0 });
            expect(result.output.includes("the caller runs in a batch")).toBe(batch);
            expect({ batch, lines: linesFor(result.output, "core-lib:build", "fromCode") }).toEqual(
              {
                batch,
                lines: [expect.any(String)],
              },
            );
          }
          // The started build runs cargo as an inferred task does.
          const builds = taskCalls(workspace).filter((call) => call.args[0] === "build");
          expect(builds.length).toBe(dependsOn.length === 0 ? 2 : 4);
          for (const call of builds) {
            expect(call).toEqual(rust(["build", "-p", "core-lib"]));
          }
        },
      ),
    HARNESS_TIMEOUT,
  );
});

describe("a command whose arguments are too long to record", () => {
  it(
    "still runs its tasks, whose lines then name the workspace's configuration",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        // 150 kB of arguments, more than Linux lets one environment variable hold.
        const names = ["first", "second", "third"];
        const long = names.map((name) => `--${name}=${"x".repeat(50_000)}`);
        const result = await runNx(workspace, ["run", "core-lib:check", ...long]);

        expect(result.status).toBe(0);
        expect(taskCalls(workspace)).toEqual([rust(["check", "--all-targets", "-p", "core-lib"])]);
        expect(linesWith(result.output, "ignoring")).toEqual(
          names.map((name) => fromConfiguration("core-lib:check", name)),
        );
      }),
    HARNESS_TIMEOUT,
  );
});
