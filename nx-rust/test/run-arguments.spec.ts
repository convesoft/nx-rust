import {
  type CargoCall,
  type Env,
  type FileChanges,
  HARNESS_TIMEOUT,
  inFixture,
  linesWith,
  runNx,
  sortedCalls,
  taskCalls,
} from "./harness";

// The run cases of VER-TARGETS and VER-UNKNOWN-OPTIONS: what the binary of a
// `run` task gets from the `args` option and from the arguments after `--`.
// Real Nx runs in the crate-shapes fixture, whose binaries here print the
// arguments they get, and whose cargo calls the wrapper of the harness logs.

/** A `main` that prints the binary's name and its arguments, as Rust's Debug writes a list of strings. */
const printArguments = (name: string) =>
  [
    "fn main() {",
    "    let args: Vec<String> = std::env::args().skip(1).collect();",
    `    println!("${name} got {:?}", args);`,
    "}",
    "",
  ].join("\n");

const binaries: FileChanges = {
  "rust/crates/cli/src/main.rs": printArguments("cli"),
  "rust/crates/server/src/main.rs": printArguments("server"),
  "rust/crates/server/src/bin/migrate.rs": printArguments("migrate"),
};

/** What `binary` printed that it got, as a list of words, or undefined where it printed nothing. */
function received(output: string, binary: string): string[] | undefined {
  const line = output.split("\n").find((text) => text.startsWith(`${binary} got [`));
  return line === undefined ? undefined : JSON.parse(line.slice(`${binary} got `.length));
}

const run = (crate: string, ...rest: string[]): CargoCall => ({
  cwd: "rust",
  args: ["run", "-p", crate, ...rest],
});

describe("the binary of a run task", () => {
  it.each<[string, Env]>([
    ["without the daemon", {}],
    ["with the daemon", { NX_DAEMON: "true" }],
  ])(
    "gets the arguments after -- and the words of args, and no option, %s",
    (_case, env) =>
      inFixture("crate-shapes", binaries, async (workspace) => {
        try {
          const cases: [string[], CargoCall, string, string[]][] = [
            [
              ["run", "cli:run", "--", "--port", "3000"],
              run("cli", "--", "--port", "3000"),
              "cli",
              ["--port", "3000"],
            ],
            [
              ["run", "cli:run", "--args=--port 3000"],
              run("cli", "--", "--port", "3000"),
              "cli",
              ["--port", "3000"],
            ],
            [
              ["run", "server:run", "--bin", "migrate", "--args=--port 3000"],
              run("server", "--bin", "migrate", "--", "--port", "3000"),
              "migrate",
              ["--port", "3000"],
            ],
            // Nx drops the flags before -- that it does not know itself.
            [
              ["run", "server:run", "--bin", "migrate", "--", "--port", "3000"],
              run("server", "--", "--port", "3000"),
              "server",
              ["--port", "3000"],
            ],
            [
              ["run", "cli:run", "--args=SHOULD_NOT_REACH_BINARY", "--", "--port", "3000"],
              run("cli", "--", "--port", "3000"),
              "cli",
              ["--port", "3000"],
            ],
            [
              ["run", "cli:run", "--args=--profile"],
              run("cli", "--", "--profile"),
              "cli",
              ["--profile"],
            ],
            // Taken as arguments, not as run's own option.
            [
              ["run", "server:run", "--", "--bin", "migrate"],
              run("server", "--", "--bin", "migrate"),
              "server",
              ["--bin", "migrate"],
            ],
          ];
          for (const [args, call, binary, words] of cases) {
            workspace.cargo.clear();
            const result = await runNx(workspace, args, env);

            expect({ args, status: result.status }).toEqual({ args, status: 0 });
            expect({ args, calls: taskCalls(workspace) }).toEqual({ args, calls: [call] });
            expect({ args, words: received(result.output, binary) }).toEqual({ args, words });
            expect({ args, lines: linesWith(result.output, "ignoring") }).toEqual({
              args,
              lines: [],
            });
          }

          // Nx checks an argument after -- that has the name of one of run's
          // options as that option.
          workspace.cargo.clear();
          const profile = await runNx(workspace, ["run", "cli:run", "--", "--profile"], env);
          expect(profile.status).toBe(1);
          expect(profile.output).toContain("Property 'profile' does not match the schema");
          expect(taskCalls(workspace)).toEqual([]);
          expect(workspace.daemonLog() !== "").toBe(env.NX_DAEMON === "true");
        } finally {
          if (env.NX_DAEMON === "true") {
            await workspace.nx(["daemon", "--stop"], env);
          }
        }
      }),
    HARNESS_TIMEOUT,
  );

  it.each<[string, Env, object]>([
    ["without the daemon", {}, {}],
    ["with the daemon", { NX_DAEMON: "true" }, {}],
    ["without the daemon, as a continuous task", {}, { continuous: true }],
    ["with the daemon, as a continuous task", { NX_DAEMON: "true" }, { continuous: true }],
  ])(
    "of a dependency that dependsOn reaches without params: forward gets none of them, %s",
    (_case, env, server) =>
      inFixture(
        "crate-shapes",
        {
          ...binaries,
          // A continuous dependency serves until Nx stops it, once cli is done.
          ...("continuous" in server
            ? {
                "rust/crates/server/src/main.rs": [
                  "fn main() {",
                  "    let args: Vec<String> = std::env::args().skip(1).collect();",
                  '    println!("server got {:?}", args);',
                  "    std::thread::sleep(std::time::Duration::from_secs(60));",
                  "}",
                  "",
                ].join("\n"),
              }
            : {}),
          "rust/crates/server/project.json": JSON.stringify({ targets: { run: server } }),
          "rust/crates/cli/project.json": JSON.stringify({
            targets: { run: { dependsOn: [{ projects: ["server"], target: "run" }] } },
          }),
        },
        async (workspace) => {
          try {
            const result = await runNx(workspace, ["run", "cli:run", "--", "--port", "3000"], env);

            expect(result.status).toBe(0);
            expect(sortedCalls(taskCalls(workspace))).toEqual([
              run("cli", "--", "--port", "3000"),
              run("server"),
            ]);
            expect(received(result.output, "cli")).toEqual(["--port", "3000"]);
            expect(linesWith(result.output, "ignoring")).toEqual([]);
          } finally {
            if (env.NX_DAEMON === "true") {
              await workspace.nx(["daemon", "--stop"], env);
            }
          }
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "gets no argument from an option that run does not know, which gets a line",
    () =>
      inFixture("crate-shapes", binaries, async (workspace) => {
        const result = await runNx(workspace, ["run", "cli:run", "--coverage"]);

        expect(result.status).toBe(0);
        expect(taskCalls(workspace)).toEqual([run("cli")]);
        expect(received(result.output, "cli")).toEqual([]);
        expect(linesWith(result.output, "ignoring")).toEqual([
          "cli:run: ignoring option `coverage`, passed on the command line.",
        ]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "gets the words of args split as a shell splits them, with nothing expanded",
    () =>
      inFixture("crate-shapes", binaries, async (workspace) => {
        const cases: [string[], string[]][] = [
          [
            ["server:run", "--bin", "server", "--args=--port 3000 --log a,b"],
            ["--port", "3000", "--log", "a,b"],
          ],
          [
            ["cli:run", "--args=a '' b"],
            ["a", "", "b"],
          ],
          [
            ["cli:run", '--args=a\\ b "c d" e'],
            ["a b", "c d", "e"],
          ],
          [
            ["cli:run", "--args=a | b; c > d && e"],
            ["a", "|", "b;", "c", ">", "d", "&&", "e"],
          ],
          [
            ["cli:run", "--args=$HOME \"$PATH\" *.rs #x '\\n'"],
            ["$HOME", "$PATH", "*.rs", "#x", "\\n"],
          ],
          [["cli:run", "--args= 3000"], ["3000"]],
          [["cli:run", "--", "3000"], ["3000"]],
        ];
        for (const [args, words] of cases) {
          workspace.cargo.clear();
          const result = await runNx(workspace, ["run", ...args]);

          const binary = args.includes("server") ? "server" : "cli";
          expect({ args, status: result.status }).toEqual({ args, status: 0 });
          expect({ args, words: received(result.output, binary) }).toEqual({ args, words });
          const crate = binary === "server" ? "server" : "cli";
          expect({ args, calls: taskCalls(workspace) }).toEqual({
            args,
            calls: [
              run(crate, ...(args.includes("--bin") ? ["--bin", "server"] : []), "--", ...words),
            ],
          });
        }
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "gets the words of args set on the target first, then the arguments after --",
    () =>
      inFixture(
        "crate-shapes",
        {
          ...binaries,
          "rust/crates/cli/project.json": JSON.stringify({
            targets: { run: { options: { args: "--name 'a b'" } } },
          }),
        },
        async (workspace) => {
          const result = await runNx(workspace, ["run", "cli:run", "--", "--verbose"]);

          expect(result.status).toBe(0);
          expect(received(result.output, "cli")).toEqual(["--name", "a b", "--verbose"]);
          expect(taskCalls(workspace)).toEqual([run("cli", "--", "--name", "a b", "--verbose")]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it.each<[string, string, string]>([
    ["an unterminated quote", "--args='open", "has a quote that is not closed"],
    ["a backslash at the end", "--args=a\\", "ends in a backslash"],
  ])(
    "does not start when args has %s, and the task says why",
    (_case, option, problem) =>
      inFixture("crate-shapes", binaries, async (workspace) => {
        const result = await runNx(workspace, ["run", "cli:run", option]);

        expect(result.status).toBe(1);
        expect(result.output).toContain(
          `cli:run: the value of the \`args\` option, ${JSON.stringify(option.slice("--args=".length))}, ${problem}`,
        );
        expect(taskCalls(workspace)).toEqual([]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "does not start when args looks like a number, which Nx rejects",
    () =>
      inFixture("crate-shapes", binaries, async (workspace) => {
        const result = await runNx(workspace, ["run", "cli:run", "--args=3000"]);

        expect(result.status).toBe(1);
        expect(result.output).toContain("Property 'args' does not match the schema");
        expect(taskCalls(workspace)).toEqual([]);
      }),
    HARNESS_TIMEOUT,
  );
});

describe("settings from a crate's own targets tables", () => {
  it(
    "give run its args and make it continuous, and an option that a target does not take gets a line",
    () =>
      inFixture(
        "crate-shapes",
        {
          ...binaries,
          // server serves until Nx stops it, once cli is done.
          "rust/crates/server/src/main.rs": [
            "fn main() {",
            "    let args: Vec<String> = std::env::args().skip(1).collect();",
            '    println!("server got {:?}", args);',
            "    std::thread::sleep(std::time::Duration::from_secs(60));",
            "}",
            "",
          ].join("\n"),
          "rust/crates/server/Cargo.toml": (manifest) =>
            `${manifest}
[package.metadata.nx.targets.run]
continuous = true
`,
          "rust/crates/cli/Cargo.toml": (manifest) =>
            `${manifest}
[package.metadata.nx.targets.run]
dependsOn = [{ projects = ["server"], target = "run" }]

[package.metadata.nx.targets.run.options]
args = "--name 'a b'"

[package.metadata.nx.targets.build.options]
allTargets = true
`,
        },
        async (workspace) => {
          const graph = await workspace.graph();
          expect(graph.projects.server.targets.run.continuous).toBe(true);
          expect(graph.projects.cli.targets.run.options).toEqual(
            expect.objectContaining({ args: "--name 'a b'" }),
          );

          const ran = await runNx(workspace, ["run", "cli:run", "--", "--verbose"]);
          expect(ran.status).toBe(0);
          expect(received(ran.output, "cli")).toEqual(["--name", "a b", "--verbose"]);
          expect(sortedCalls(taskCalls(workspace))).toEqual([
            run("cli", "--", "--name", "a b", "--verbose"),
            run("server"),
          ]);
          expect(linesWith(ran.output, "ignoring")).toEqual([]);

          // Graph creation accepts the option until nxr-95kg91 rejects it
          // there; the task leaves it out and says where it came from.
          workspace.cargo.clear();
          const built = await runNx(workspace, ["run", "cli:build"]);
          expect(built.status).toBe(0);
          expect(taskCalls(workspace)).toEqual([{ cwd: "rust", args: ["build", "-p", "cli"] }]);
          expect(linesWith(built.output, "ignoring")).toEqual([
            'cli:build: ignoring option `allTargets`, which this target does not take. It comes from the workspace\'s configuration: run `nx show target cli:build --json` and look under `sourceMap` for the file and entry. If it is a `targetDefaults` entry in nx.json, add a `filter` to it or add an empty entry keyed by "@convesoft/nx-rust:cargo".',
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );
});
