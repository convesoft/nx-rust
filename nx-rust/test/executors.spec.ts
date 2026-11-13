import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CargoCall,
  FileChanges,
  FixtureName,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  lockfileCalls,
  taskCalls,
  testEnvironment,
  withoutColours,
} from "./harness";

// Checks what the plugin's executors run, with a real cargo and real Nx task
// runs: the commands of VER-TARGETS, and the parts of VER-CARGO-UNCHANGED
// about where cargo starts, locked mode and the crates that fmt touches, as
// far as one cargo call per task can show them. The cargo wrapper of the
// harness logs each call with its folder and arguments.

type Env = Record<string, string | undefined>;

/** Runs Nx in the workspace with static output, its colours removed. */
async function nx(
  workspace: FixtureWorkspace,
  args: string[],
  env: Env = {},
): Promise<{ status: number | null; output: string }> {
  const { status, output } = await workspace.nx([...args, "--output-style=static"], env);
  return { status, output: withoutColours(output) };
}

/** Calls in a stable order, for runs whose tasks run in parallel. */
function sorted(calls: CargoCall[]): CargoCall[] {
  return [...calls].sort((a, b) =>
    `${a.cwd} ${a.args.join(" ")}`.localeCompare(`${b.cwd} ${b.args.join(" ")}`),
  );
}

/** Creates a fixture workspace, hands it to `test` and removes it afterwards. */
async function inFixture(
  fixture: FixtureName,
  files: FileChanges | undefined,
  test: (workspace: FixtureWorkspace) => Promise<void>,
): Promise<void> {
  const workspace = FixtureWorkspace.create(fixture, files);
  try {
    await test(workspace);
  } finally {
    workspace.remove();
  }
}

/** Sets the options of the plugin's entry in a fixture copy's `nx.json`. */
function pluginOptions(options: object): (nxJson: string) => string {
  return (nxJson) => {
    const config = JSON.parse(nxJson);
    config.plugins = config.plugins.map((entry: string | { plugin: string }) => ({
      ...(typeof entry === "string" ? { plugin: entry } : entry),
      options,
    }));
    return JSON.stringify(config);
  };
}

/** Sets `targetDefaults` in a fixture copy's `nx.json`. */
function targetDefaults(defaults: object): (nxJson: string) => string {
  return (nxJson) => JSON.stringify({ ...JSON.parse(nxJson), targetDefaults: defaults });
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

const rust = (args: string[]): CargoCall => ({ cwd: "rust", args });

describe("the cargo executor", () => {
  it(
    "runs each crate target's command in the workspace root, with the crate's package name",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        const result = await nx(workspace, [
          "run-many",
          "-t",
          "build",
          "check",
          "lint",
          "test",
          "fmt-check",
          "fmt",
          "bench",
          "-p",
          "perf",
          "core-lib",
        ]);

        expect(result).toEqual({ status: 0, output: expect.any(String) });
        const calls = taskCalls(workspace);
        expect(sorted(calls)).toEqual(
          sorted([
            ...["core-lib", "perf"].flatMap((crate) => [
              rust(["build", "-p", crate]),
              rust(["check", "--all-targets", "-p", crate]),
              rust(["clippy", "--all-targets", "-p", crate]),
              rust(["test", "-p", crate]),
              rust(["fmt", "--check", "-p", crate]),
              rust(["fmt", "-p", crate]),
            ]),
            // Only perf has a bench target.
            rust(["bench", "-p", "perf"]),
          ]),
        );
        // No flag that turns warnings into errors.
        expect(calls.flatMap((call) => call.args).filter((arg) => /^-D|warn/.test(arg))).toEqual(
          [],
        );
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "addresses a crate by its package name where the project has another name",
    () =>
      // engine's project.json names the project rust-engine.
      inFixture("mixed-folders", undefined, async (workspace) => {
        const result = await nx(workspace, ["run", "rust-engine:build"]);

        expect(result.status).toBe(0);
        expect(taskCalls(workspace)).toEqual([
          { cwd: "libs/rust", args: ["build", "-p", "engine"] },
        ]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "runs the command of the default name under the name that targetNames gives",
    () =>
      inFixture(
        "crate-shapes",
        { "nx.json": pluginOptions({ targetNames: { lint: "clippy", build: "lint" } }) },
        async (workspace) => {
          expect((await nx(workspace, ["run", "core-lib:clippy"])).status).toBe(0);
          expect((await nx(workspace, ["run", "core-lib:lint"])).status).toBe(0);

          expect(taskCalls(workspace)).toEqual([
            rust(["clippy", "--all-targets", "-p", "core-lib"]),
            rust(["build", "-p", "core-lib"]),
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "passes the flags that the options ask for, on the targets that take them",
    () =>
      inFixture(
        "crate-shapes",
        {
          "rust/crates/core/Cargo.toml": (manifest) => `${manifest}\n[features]\nextra = []\n`,
          // Switches --all-targets off for lint, as a crate's metadata will.
          "rust/crates/core/project.json": JSON.stringify({
            targets: { lint: { options: { allTargets: false } } },
          }),
        },
        async (workspace) => {
          const triple = hostTriple();
          const everyOption = [
            "--features=extra",
            "--allFeatures",
            "--noDefaultFeatures",
            "--profile=release",
            `--targetTriple=${triple}`,
            "--allTargets",
            "--noDeps",
            "--bin=migrate",
          ];
          const runs = [
            ["run", "core-lib:build", ...everyOption],
            ["run", "core-lib:check", "--allTargets=false"],
            ["run", "core-lib:lint"],
            ["run", "core-lib:test", ...everyOption],
            ["run", "core-lib:fmt", ...everyOption],
            ["run", "rust:doc", "--noDeps=false"],
            ["run", "rust:doc", "--features=core-lib/extra", "--profile=release"],
            ["run", "server:run", "--bin=migrate"],
          ];
          for (const args of runs) {
            const result = await nx(workspace, args);
            expect({ args, ...result }).toEqual({ args, status: 0, output: expect.any(String) });
          }

          const flags = [
            "--features",
            "extra",
            "--all-features",
            "--no-default-features",
            "--profile",
            "release",
          ];
          expect(taskCalls(workspace)).toEqual([
            rust(["build", "-p", "core-lib", ...flags, "--target", triple]),
            rust(["check", "-p", "core-lib"]),
            rust(["clippy", "-p", "core-lib"]),
            // test runs on the host triple only.
            rust(["test", "-p", "core-lib", ...flags]),
            rust(["fmt", "-p", "core-lib"]),
            rust(["doc", "--workspace"]),
            rust([
              "doc",
              "--no-deps",
              "--workspace",
              "--features",
              "core-lib/extra",
              "--profile",
              "release",
            ]),
            rust(["run", "-p", "server", "--bin", "migrate"]),
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "leaves an option that its schema does not declare out of the command",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        const result = await nx(workspace, ["run", "core-lib:check", "--release", "--jobs=1"]);

        expect(result.status).toBe(0);
        expect(taskCalls(workspace)).toEqual([rust(["check", "--all-targets", "-p", "core-lib"])]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "runs the workspace project's targets in the workspace root",
    () =>
      inFixture("crate-shapes", { "rust/deny.toml": "" }, async (workspace) => {
        expect((await nx(workspace, ["run", "rust:doc"])).status).toBe(0);
        expect((await nx(workspace, ["run", "rust:update"])).status).toBe(0);
        // cargo-audit and cargo-deny are not installed here or in CI, so
        // cargo fails, and so do the tasks.
        const audit = await nx(workspace, ["run", "rust:audit"]);
        const deny = await nx(workspace, ["run", "rust:deny"]);

        expect(taskCalls(workspace)).toEqual([
          rust(["doc", "--no-deps", "--workspace"]),
          rust(["update"]),
          rust(["audit"]),
          rust(["deny", "check"]),
        ]);
        expect(audit.status).toBe(1);
        expect(audit.output).toContain("no such command: `audit`");
        expect(deny.status).toBe(1);
        expect(deny.output).toContain("no such command: `deny`");
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "runs a binary of each crate in a cargo call of its own",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        const result = await nx(workspace, ["run-many", "-t", "run"]);

        expect(result.status).toBe(0);
        expect(sorted(taskCalls(workspace))).toEqual([
          rust(["run", "-p", "cli"]),
          rust(["run", "-p", "server"]),
        ]);
        // What the binaries printed: core_lib::answer() and server::port().
        expect(result.output).toMatch(/^42$/m);
        expect(result.output).toMatch(/^3042$/m);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "lets a task that depends on run start only after the binary has exited",
    () =>
      inFixture(
        "crate-shapes",
        {
          // The binary waits, then leaves a file in the folder cargo runs it
          // in, the workspace root, just before it exits.
          "rust/crates/cli/src/main.rs": [
            "fn main() {",
            "    std::thread::sleep(std::time::Duration::from_millis(1500));",
            '    std::fs::write("cli-exited", "").unwrap();',
            '    println!("{}", core_lib::answer());',
            "}",
            "",
          ].join("\n"),
          "web/project.json": JSON.stringify({
            name: "web",
            targets: {
              after: {
                command: "test -f rust/cli-exited && echo the binary had exited",
                dependsOn: [{ projects: ["cli"], target: "run" }],
              },
            },
          }),
        },
        async (workspace) => {
          const result = await nx(workspace, ["run", "web:after"]);

          expect(result.status).toBe(0);
          expect(result.output).toMatch(/^42$/m);
          expect(result.output).toContain("the binary had exited");
          expect(taskCalls(workspace)).toEqual([rust(["run", "-p", "cli"])]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "starts cargo in the workspace root, where a toolchain file in a member does not apply",
    () =>
      inFixture(
        "crate-shapes",
        {
          // A toolchain that no rustup has; the tests never install one.
          "rust/crates/core/rust-toolchain.toml":
            '[toolchain]\nchannel = "nx-rust-no-such-toolchain"\n',
        },
        async (workspace) => {
          const result = await nx(workspace, ["run", "core-lib:build"]);

          expect(result.status).toBe(0);
          expect(taskCalls(workspace)).toEqual([rust(["build", "-p", "core-lib"])]);
          // The file applies to a cargo started in the crate's folder.
          const inCrate = spawnSync("cargo", ["build"], {
            cwd: join(workspace.root, "rust/crates/core"),
            env: testEnvironment(),
            encoding: "utf8",
          });
          expect(inCrate.status).not.toBe(0);
          expect(inCrate.stderr).toContain("nx-rust-no-such-toolchain");
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "gives cargo the environment of the task, without RUSTUP_AUTO_INSTALL",
    () =>
      // crate-shapes pins no toolchain, so nothing could be installed.
      inFixture("crate-shapes", undefined, async (workspace) => {
        const result = await nx(workspace, ["run", "core-lib:check"], {
          RUSTUP_AUTO_INSTALL: undefined,
        });

        expect(result.status).toBe(0);
        expect(workspace.cargo.callsWithEnv(workspace.root)).toEqual([
          // Graph creation sets the variable for its own cargo only.
          expect.objectContaining({
            args: expect.arrayContaining(["metadata"]),
            env: { RUSTUP_AUTO_INSTALL: "0" },
          }),
          {
            cwd: "rust",
            args: ["check", "--all-targets", "-p", "core-lib"],
            env: { RUSTUP_AUTO_INSTALL: null },
          },
        ]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "passes cargo's output and exit status on to Nx",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        const passed = await nx(workspace, ["run-many", "-t", "build", "-p", "core-lib"]);
        expect(passed.status).toBe(0);
        expect(passed.output).toContain("Compiling core-lib v0.1.0");

        writeFileSync(
          join(workspace.root, "rust/crates/core/src/lib.rs"),
          'pub fn answer() -> u32 {\n    "not a number"\n}\n',
        );
        // Static output prints each task's output once it has finished.
        const failed = await nx(workspace, ["run-many", "-t", "build", "-p", "core-lib"]);
        expect(failed.status).toBe(1);
        expect(failed.output).toContain("error[E0308]: mismatched types");
        expect(failed.output).toContain("Failed tasks:");

        writeFileSync(
          join(workspace.root, "rust/crates/core/src/lib.rs"),
          "pub fn answer()->u32{42}\n",
        );
        const unformatted = await nx(workspace, ["run", "core-lib:fmt-check"]);
        expect(unformatted.status).toBe(1);
        expect(unformatted.output).toContain("Diff in");
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "runs every task again on the next run, uncached",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        const tasks = ["fmt", "bench", "run", "update"];
        for (let run = 0; run < 2; run++) {
          const result = await nx(workspace, [
            "run-many",
            "-t",
            ...tasks,
            "-p",
            "perf",
            "cli",
            "rust",
          ]);
          expect(result.status).toBe(0);
        }

        const calls = taskCalls(workspace).map((call) => call.args.join(" "));
        for (const call of ["fmt -p perf", "fmt -p cli", "bench -p perf", "run -p cli", "update"]) {
          expect({ call, count: calls.filter((logged) => logged === call).length }).toEqual({
            call,
            count: 2,
          });
        }
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "fails a target that is not inferred and runs no cargo",
    () =>
      inFixture(
        "crate-shapes",
        {
          "rust/crates/core/project.json": JSON.stringify({
            targets: { extra: { executor: "@convesoft/nx-rust:cargo" } },
          }),
        },
        async (workspace) => {
          const result = await nx(workspace, ["run", "core-lib:extra"]);

          expect(result.status).toBe(1);
          expect(result.output).toContain(
            "core-lib:extra: @convesoft/nx-rust:cargo runs only the targets that @convesoft/nx-rust infers",
          );
          expect(taskCalls(workspace)).toEqual([]);
        },
      ),
    HARNESS_TIMEOUT,
  );
});

// A `targetDefaults` entry that caches a target that the plugin leaves
// uncached already fails graph creation (DES-TARGET-DEFAULT-GUARD,
// target-defaults.spec.ts). The executor's check is the second line, for a
// configuration that the graph does not blame on a target default, such as a
// project.json in the crate's folder.
describe("a target that the plugin leaves uncached and the configuration caches", () => {
  /** A project.json in a crate's folder that turns on caching for one of its targets. */
  function cachedIn(folder: string, target: string): FileChanges {
    return {
      [`rust/crates/${folder}/project.json`]: JSON.stringify({
        targets: { [target]: { cache: true } },
      }),
    };
  }

  it.each<[string, FileChanges, string, string]>([
    ["fmt", cachedIn("core", "fmt"), "core-lib:fmt", "rewrites the crate's files"],
    ["bench", cachedIn("perf", "bench"), "perf:bench", "benchmark timings differ between runs"],
    ["run, of the run executor", cachedIn("cli", "run"), "cli:run", "runs a binary"],
  ])(
    "fails without running cargo, so that no result is stored, when a project.json caches %s",
    (_target, files, task, reason) =>
      inFixture("crate-shapes", files, async (workspace) => {
        const executor = task === "cli:run" ? "@convesoft/nx-rust:run" : "@convesoft/nx-rust:cargo";
        for (let run = 0; run < 2; run++) {
          const result = await nx(workspace, ["run", task]);

          expect(result.status).toBe(1);
          expect(result.output).toContain(
            `${task}: the configuration of this target sets "cache": true, but @convesoft/nx-rust leaves \`${task.split(":")[1]}\` uncached in this project, because`,
          );
          expect(result.output).toContain(reason);
          expect(result.output).toContain(`run \`nx show target ${task} --json\``);
          expect(result.output).toContain(`add an empty entry keyed by "${executor}"`);
          // Nothing was restored either.
          expect(result.output).not.toContain("[local cache]");
        }
        expect(taskCalls(workspace)).toEqual([]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "is what keeps Nx from restoring it: Nx restores a JS target that its project.json caches",
    () =>
      inFixture(
        "crate-shapes",
        {
          "web/project.json": JSON.stringify({
            name: "web",
            targets: { build: { command: "echo web build ran", cache: true } },
          }),
        },
        async (workspace) => {
          const first = await nx(workspace, ["run", "web:build"]);
          const second = await nx(workspace, ["run", "web:build"]);

          expect(first.status).toBe(0);
          expect(first.output).not.toContain("[local cache]");
          expect(second.status).toBe(0);
          expect(second.output).toContain("[local cache]");
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "runs again once an empty entry keyed by the executor takes the target out",
    () =>
      inFixture(
        "crate-shapes",
        {
          "nx.json": targetDefaults({
            fmt: { cache: true },
            "@convesoft/nx-rust:cargo": {},
          }),
        },
        async (workspace) => {
          expect((await nx(workspace, ["run", "core-lib:fmt"])).status).toBe(0);
          expect((await nx(workspace, ["run", "core-lib:fmt"])).status).toBe(0);

          expect(taskCalls(workspace)).toEqual([
            rust(["fmt", "-p", "core-lib"]),
            rust(["fmt", "-p", "core-lib"]),
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );
});

describe("locked mode", () => {
  const targets = ["build", "check", "lint", "test", "fmt-check", "fmt", "bench", "run"];
  const workspaceTargets = ["doc", "update", "audit", "deny"];

  // Every target of perf, cli and the workspace project, with cargo-deny configured.
  async function runAll(workspace: FixtureWorkspace, env: Env): Promise<string[]> {
    workspace.cargo.clear();
    const result = await nx(
      workspace,
      ["run-many", "-t", ...targets, ...workspaceTargets, "-p", "perf", "cli", "rust"],
      env,
    );
    // audit and deny fail: the tools are not installed.
    expect(result.output).toContain("Failed tasks:");
    expect(result.output).toContain("- rust:audit");
    expect(result.output).toContain("- rust:deny");
    expect(result.output.match(/^[ \t]*- \S+:\S+$/gm)).toHaveLength(2);
    return [...taskCalls(workspace), ...lockfileCalls(workspace)]
      .map((call) => {
        expect(call.cwd).toBe("rust");
        return call.args.join(" ");
      })
      .sort();
  }

  const unlocked = [
    "audit",
    "bench -p perf",
    "build -p cli",
    "build -p perf",
    "check --all-targets -p cli",
    "check --all-targets -p perf",
    "clippy --all-targets -p cli",
    "clippy --all-targets -p perf",
    "deny check",
    "doc --no-deps --workspace",
    "fmt --check -p cli",
    "fmt --check -p perf",
    "fmt -p cli",
    "fmt -p perf",
    "run -p cli",
    "test -p cli",
    "test -p perf",
    "update",
    // The lockfile task, once in the run.
    "update --workspace",
  ];
  const locked = [
    "audit",
    "bench -p perf --locked",
    "build -p cli --locked",
    "build -p perf --locked",
    "check --all-targets -p cli --locked",
    "check --all-targets -p perf --locked",
    "clippy --all-targets -p cli --locked",
    "clippy --all-targets -p perf --locked",
    "deny --locked check",
    "doc --no-deps --workspace --locked",
    "fmt --check -p cli",
    "fmt --check -p perf",
    "fmt -p cli",
    "fmt -p perf",
    "run -p cli --locked",
    "test -p cli --locked",
    "test -p perf --locked",
    "update",
    "update --workspace --locked",
  ];

  it.each<[string, object, Env, string[]]>([
    ["by default", {}, {}, unlocked],
    ["with the locked option", { locked: true }, {}, locked],
    ["with NX_RUST_LOCKED=true", {}, { NX_RUST_LOCKED: "true" }, locked],
    [
      "with NX_RUST_LOCKED=false over the option",
      { locked: true },
      { NX_RUST_LOCKED: "false" },
      unlocked,
    ],
    ["with an empty NX_RUST_LOCKED", { locked: true }, { NX_RUST_LOCKED: "" }, locked],
  ])(
    "passes --locked as it says %s",
    (_case, options, env, expected) =>
      inFixture(
        "crate-shapes",
        { "nx.json": pluginOptions(options), "rust/deny.toml": "" },
        async (workspace) => {
          expect(await runAll(workspace, env)).toEqual(expected);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "fails a task when NX_RUST_LOCKED is neither true nor false",
    () =>
      inFixture("crate-shapes", undefined, async (workspace) => {
        const result = await nx(workspace, ["run", "core-lib:build"], { NX_RUST_LOCKED: "1" });

        expect(result.status).toBe(1);
        expect(result.output).toContain(
          'NX_RUST_LOCKED is "1", but it has to be true or false. Unset it to use the "locked" option of the @convesoft/nx-rust entry in nx.json.',
        );
        expect(taskCalls(workspace)).toEqual([]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation when the locked option is neither true nor false",
    () =>
      inFixture(
        "crate-shapes",
        { "nx.json": pluginOptions({ locked: "yes" }) },
        async (workspace) => {
          await expect(workspace.graph()).rejects.toThrow(
            '"locked" in the options of the @convesoft/nx-rust entry in nx.json is "yes", but it has to be true or false.',
          );
        },
      ),
    HARNESS_TIMEOUT,
  );

  // internal gets a path dependency on core-lib, which Cargo.lock does not list yet.
  const newDependency: FileChanges = {
    "rust/crates/internal/Cargo.toml": (manifest) =>
      `${manifest}\n[dependencies]\ncore-lib = { path = "../core" }\n`,
  };
  const lockfile = (workspace: FixtureWorkspace) =>
    readFileSync(join(workspace.root, "rust/Cargo.lock"), "utf8");

  it(
    "lets a task update Cargo.lock as plain cargo does",
    () =>
      inFixture("crate-shapes", newDependency, async (workspace) => {
        const before = lockfile(workspace);
        expect((await nx(workspace, ["run", "internal:check"])).status).toBe(0);
        const afterTask = lockfile(workspace);

        writeFileSync(join(workspace.root, "rust/Cargo.lock"), before);
        const plain = spawnSync("cargo", ["check", "--all-targets", "-p", "internal"], {
          cwd: join(workspace.root, "rust"),
          env: testEnvironment(),
          encoding: "utf8",
        });
        expect(plain.status).toBe(0);

        expect(afterTask).not.toEqual(before);
        expect(afterTask).toEqual(lockfile(workspace));
      }),
    HARNESS_TIMEOUT,
  );

  it.each<[string, object, Env]>([
    ["the locked option", { locked: true }, {}],
    ["NX_RUST_LOCKED=true", {}, { NX_RUST_LOCKED: "true" }],
  ])(
    "fails such a task with %s and leaves Cargo.lock as it is, while update updates it",
    (_case, options, env) =>
      inFixture(
        "crate-shapes",
        { ...newDependency, "nx.json": pluginOptions(options) },
        async (workspace) => {
          const before = lockfile(workspace);
          const check = await nx(workspace, ["run", "internal:check"], env);
          expect(check.status).toBe(1);
          expect(check.output).toContain("because --locked was passed to prevent this");
          expect(lockfile(workspace)).toEqual(before);

          // fmt reads no lockfile, and passes.
          expect((await nx(workspace, ["run", "internal:fmt-check"], env)).status).toBe(0);
          expect(lockfile(workspace)).toEqual(before);

          expect((await nx(workspace, ["run", "rust:update"], env)).status).toBe(0);
          expect(lockfile(workspace)).not.toEqual(before);
          expect((await nx(workspace, ["run", "internal:check"], env)).status).toBe(0);
        },
      ),
    HARNESS_TIMEOUT,
  );
});

describe("fmt", () => {
  it(
    "formats the crates that have projects and no other crate",
    () =>
      // lib depends by path on vendor/parser, outside the workspace, which
      // the plugin's entry excludes; it excludes the member app as well.
      inFixture(
        "vendored-crate",
        {
          "nx.json": (nxJson) => {
            const config = JSON.parse(nxJson);
            config.plugins[0].exclude.push("rust/crates/app/**");
            return JSON.stringify(config);
          },
        },
        async (workspace) => {
          const sources = [
            "rust/crates/app/src/lib.rs",
            "rust/crates/lib/src/lib.rs",
            "vendor/parser/src/lib.rs",
            "vendor/lexer/src/lib.rs",
          ];
          // The same code, badly formatted.
          for (const source of sources) {
            const file = join(workspace.root, source);
            writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\n\n\n"));
          }
          const before = workspace.files();

          const result = await nx(workspace, ["run-many", "-t", "fmt"]);

          expect(result.status).toBe(0);
          expect(taskCalls(workspace)).toEqual([rust(["fmt", "-p", "lib"])]);
          const after = workspace.files();
          const changed = Object.keys(after).filter((path) => after[path] !== before[path]);
          expect(changed).toEqual(["rust/crates/lib/src/lib.rs"]);
        },
      ),
    HARNESS_TIMEOUT,
  );
});

describe("a mixed repository", () => {
  it(
    "runs a JS lint target and clippy in one nx run-many -t lint",
    () =>
      inFixture(
        "subfolder-workspace",
        {
          "web/project.json": JSON.stringify({
            name: "web",
            targets: { lint: { command: "echo web lint ran" } },
          }),
        },
        async (workspace) => {
          const result = await nx(workspace, ["run-many", "-t", "lint"]);

          expect(result.status).toBe(0);
          expect(result.output).toContain("web lint ran");
          expect(sorted(taskCalls(workspace))).toEqual(
            ["api", "codegen", "model", "testkit"].map((crate) =>
              rust(["clippy", "--all-targets", "-p", crate]),
            ),
          );
        },
      ),
    HARNESS_TIMEOUT,
  );
});
