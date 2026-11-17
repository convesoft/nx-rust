import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  affectedReport,
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  HiddenCargoAffected,
  initGitRepository,
  runNx,
  StubCargoAffected,
  taskCalls,
  taskOutput,
  testEnvironment,
  writeBaseline,
  writeBaselineContext,
} from "./harness";

// The parts of VER-TESTING that the plugin decides with a report of
// cargo-affected in hand (DES-TEST-RUN, steps 1 to 4) and the diagnostics of
// DES-DIAGNOSTICS for affectedTests: a stand-in replays a report of the schema
// that cargo-affected 0.4.1 writes, so that these runs need cargo-nextest and
// no coverage. affected-coverage.spec.ts runs the real cargo-affected.

/** Whether cargo finds `cargo nextest` with the tests' environment. */
function nextestInstalled(): boolean {
  return (
    spawnSync("cargo", ["nextest", "--version"], { env: testEnvironment(), stdio: "ignore" })
      .status === 0
  );
}

const withNextest = nextestInstalled();
if (!withNextest) {
  it.todo(
    "affected runs through Nx: cargo-nextest is not installed where cargo looks for it (PATH or the Cargo home), so these checks are skipped; install it as https://nexte.st/docs/installation/ describes to run them",
  );
}
const describeWithNextest = withNextest ? describe : describe.skip;

/** A copy of `affected-tests` in a git repository, with a stand-in cargo-affected. */
class AffectedFixture {
  readonly workspace: FixtureWorkspace;
  readonly stub = new StubCargoAffected();
  readonly rust: string;
  readonly head: string;

  constructor(...files: FileChanges[]) {
    this.workspace = FixtureWorkspace.create("affected-tests", ...files);
    this.rust = join(this.workspace.root, "rust");
    // Cargo.lock as cargo leaves it for the crates of `files`, before the commit.
    execFileSync("cargo", ["metadata", "--format-version", "1", "--offline"], {
      cwd: this.rust,
      env: testEnvironment(),
      stdio: "ignore",
    });
    this.head = initGitRepository(this.workspace.root);
  }

  /** The environment of an Nx command, with the stand-in on `PATH`. */
  env(extra: Record<string, string | undefined> = {}, status = 0): NodeJS.ProcessEnv {
    const base = testEnvironment(extra);
    return this.workspace.cargo.environment({
      ...base,
      ...this.stub.env(status),
      PATH: [this.stub.folder, base.PATH].filter(Boolean).join(delimiter),
    });
  }

  /** A baseline at `HEAD`, with the record of a collection in the environment `env`. */
  async baseline(
    env: NodeJS.ProcessEnv = this.env(),
    options: Parameters<typeof writeBaselineContext>[3] = {},
  ): Promise<void> {
    writeBaseline(this.rust, [this.head]);
    return writeBaselineContext(this.workspace, this.rust, env, options);
  }

  edit(path: string, change: (text: string) => string): void {
    const file = join(this.workspace.root, path);
    writeFileSync(file, change(readFileSync(file, "utf8")));
  }

  /** A report at `HEAD` that names `changed` and selects `selected`. */
  report(
    changed: { path: string; tracked: boolean }[],
    selected: { binary: string; test: string }[],
  ): void {
    this.stub.writeReport(affectedReport({ collect: [{ sha: this.head }], changed, selected }));
  }

  async run(args: string[], env: NodeJS.ProcessEnv = this.env()) {
    this.workspace.cargo.clear();
    return runNx(this.workspace, [...args, "--skip-nx-cache"], env);
  }

  /** The cargo commands of the test tasks, without the build of `runner`. */
  testCalls(): string[][] {
    return taskCalls(this.workspace)
      .map((call) => call.args)
      .filter((args) => args[0] !== "build");
  }

  remove(): void {
    this.stub.remove();
    this.workspace.remove();
  }
}

const basicsChange = (text: string) => text.replace("x * 2", "x + x");

describeWithNextest("affected runs with a report in hand", () => {
  it(
    "runs the selected tests in one nextest run, says what each task runs, and passes a crate with none selected",
    async () => {
      const fixture = new AffectedFixture();
      try {
        await fixture.baseline();
        fixture.edit("rust/crates/basics/src/math.rs", basicsChange);
        fixture.report(
          [{ path: "crates/basics/src/math.rs", tracked: true }],
          [
            { binary: "basics", test: "tests::double_works" },
            { binary: "app", test: "tests::six_works" },
            // Tests of crates outside the group do not count.
            { binary: "runner", test: "tests::name_works" },
          ],
        );
        const run = await fixture.run([
          "run-many",
          "-t",
          "test",
          "-p",
          "basics,app,macros,consumer",
        ]);

        expect(run.status).toBe(0);
        const basics = taskOutput(run.output, "basics:test");
        expect(basics).toContain(
          `basics:test: runs a subset of its tests for this change: 1 test of basics that cargo-affected selected against the coverage baseline ${fixture.head}. This result stands for affected mode only, never for the full suite.`,
        );
        expect(basics).toContain("basics:test: nextest ran 1 test of basics");
        expect(taskOutput(run.output, "app:test")).toContain("app:test: nextest ran 1 test of app");
        const macros = taskOutput(run.output, "macros:test");
        expect(macros).toContain("macros:test: no test of macros is selected");
        expect(macros).toContain(
          "macros:test: nextest ran no test of macros: none of its tests was selected",
        );
        // consumer depends on runner, whose binary calls the changed library.
        expect(taskOutput(run.output, "consumer:test")).toContain(
          "consumer:test: runs all tests of consumer, because rust/crates/basics/src/math.rs changed, which is an input of runner, whose binary its tests can start.",
        );
        // One cargo-affected status, one nextest run and one doctest run for
        // the group, each with the same package selection.
        const calls = fixture.testCalls();
        expect(calls.map((args) => args.slice(0, 2))).toEqual([
          ["affected", "status"],
          ["nextest", "run"],
          ["test", "--workspace"],
        ]);
        const [status, nextest] = calls;
        expect(status.slice(2, 7)).toEqual([
          "--report-json",
          expect.any(String),
          "--report-detail",
          "full",
          "--",
        ]);
        expect(status).toContain("--workspace");
        expect(nextest.filter((arg) => arg === "-E")).toHaveLength(1);
        expect(nextest[nextest.indexOf("-E") + 1]).toBe(
          "(package(=app) | package(=basics) | package(=consumer)) & ((binary_id(=app) & (test(=tests::six_works))) | (binary_id(=basics) & (test(=tests::double_works))) | (package(=consumer)))",
        );
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leaves out the nextest run where no test is selected, and still runs the doctests",
    async () => {
      const fixture = new AffectedFixture();
      try {
        await fixture.baseline();
        fixture.report([], []);
        const run = await fixture.run(["run-many", "-t", "test", "-p", "basics,app"]);

        expect(run.status).toBe(0);
        expect(taskOutput(run.output, "basics:test")).toContain(
          "basics:test: no test of basics is selected",
        );
        expect(fixture.testCalls().map((args) => args.slice(0, 2))).toEqual([
          ["affected", "status"],
          ["test", "--workspace"],
        ]);
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs the full suite, and says why, where the baseline's context or the report does not fit",
    async () => {
      const fixture = new AffectedFixture({
        "rust/Cargo.toml": (manifest) => `${manifest}envInputs = ["APP_MODE"]\n`,
      });
      try {
        fixture.edit("rust/crates/basics/src/math.rs", basicsChange);
        fixture.report(
          [{ path: "crates/basics/src/math.rs", tracked: true }],
          [{ binary: "basics", test: "tests::double_works" }],
        );
        /** Runs basics:test and returns its output, which has to show the full suite. */
        const full = async (env: NodeJS.ProcessEnv, args: string[] = []) => {
          const run = await fixture.run(["run", "basics:test", ...args], env);
          expect(run.status).toBe(0);
          expect(run.output).toContain("basics:test: nextest ran 2 tests of basics");
          return run.output;
        };

        // No record of the context.
        writeBaseline(fixture.rust, [fixture.head]);
        expect(await full(fixture.env({ APP_MODE: "a" }))).toContain(
          "basics:test: runs the full suite, because the baseline has no record of the context it was collected in (target/affected/nx-rust-context.json), which the collection target writes after a successful collection.",
        );
        // A baseline collected with a feature, or another value of an
        // envInputs variable.
        await writeBaselineContext(
          fixture.workspace,
          fixture.rust,
          fixture.env({ APP_MODE: "a" }),
          {
            cargo: { features: ["extra"] },
            declared: ["APP_MODE"],
          },
        );
        expect(await full(fixture.env({ APP_MODE: "a" }))).toContain(
          `basics:test: runs the full suite, because the baseline ${fixture.head} was collected in another context: --features (extra at the collection, none now) differs.`,
        );
        await writeBaselineContext(
          fixture.workspace,
          fixture.rust,
          fixture.env({ APP_MODE: "a" }),
          {
            declared: ["APP_MODE"],
          },
        );
        expect(await full(fixture.env({ APP_MODE: "b" }))).toContain(
          `basics:test: runs the full suite, because the baseline ${fixture.head} was collected in another context: the variable APP_MODE differs.`,
        );
        // cargo-affected refuses, fails, or leaves out a changed file.
        const env = fixture.env({ APP_MODE: "a" });
        fixture.stub.writeReport(
          affectedReport({
            status: "miss-fingerprint",
            collect: [{ sha: fixture.head }],
            changed: [],
            selected: null,
            differingLabels: ["RUSTFLAGS"],
          }),
        );
        expect(await full(env)).toContain(
          "basics:test: runs the full suite, because cargo-affected cannot select with the baseline: its cache status is miss-fingerprint, which differs from the baseline's in RUSTFLAGS.",
        );
        expect(await full(fixture.env({ APP_MODE: "a" }, 1))).toContain(
          "basics:test: runs the full suite, because cargo affected status exited with status 1 (stub cargo-affected).",
        );
        fixture.report([], [{ binary: "basics", test: "tests::double_works" }]);
        expect(await full(env)).toContain(
          "basics:test: runs the full suite, because git names the changed file crates/basics/src/math.rs, which cargo-affected's report does not list.",
        );
        // In a batch, every task of the group says so.
        const batch = await fixture.run(["run-many", "-t", "test", "-p", "basics,app"], env);
        expect(batch.status).toBe(0);
        expect(taskOutput(batch.output, "app:test")).toContain(
          "app:test: runs the full suite, because git names the changed file",
        );
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs all tests of a crate that opts out, and the full suite with --affectedTests=false",
    async () => {
      const fixture = new AffectedFixture({
        "rust/crates/app/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx.targets.test.options]\naffectedTests = false\n`,
      });
      try {
        await fixture.baseline();
        fixture.edit("rust/crates/basics/src/math.rs", basicsChange);
        fixture.report(
          [{ path: "crates/basics/src/math.rs", tracked: true }],
          [{ binary: "basics", test: "tests::double_works" }],
        );
        const run = await fixture.run(["run-many", "-t", "test", "-p", "basics,app"]);

        expect(run.status).toBe(0);
        expect(taskOutput(run.output, "app:test")).toContain(
          "app:test: runs the full suite, because its option affectedTests is false",
        );
        expect(taskOutput(run.output, "app:test")).toContain(
          "app:test: nextest ran 4 tests of app",
        );
        expect(taskOutput(run.output, "basics:test")).toContain(
          "basics:test: nextest ran 1 test of basics",
        );

        const all = await fixture.run(["run", "basics:test", "--affectedTests=false"]);
        expect(all.status).toBe(0);
        expect(all.output).toContain(
          "basics:test: runs the full suite, because its option affectedTests is false",
        );
        expect(all.output).toContain("basics:test: nextest ran 2 tests of basics");
        expect(fixture.testCalls().some((args) => args[0] === "affected")).toBe(false);
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "keeps a test that the repository's default filter leaves out from running",
    async () => {
      const fixture = new AffectedFixture({
        "rust/.config/nextest.toml":
          '[profile.default]\ndefault-filter = "not test(=tests::triple_works)"\n',
      });
      try {
        await fixture.baseline();
        fixture.edit("rust/crates/basics/src/math.rs", basicsChange);
        fixture.report(
          [{ path: "crates/basics/src/math.rs", tracked: true }],
          [
            { binary: "basics", test: "tests::double_works" },
            { binary: "basics", test: "tests::triple_works" },
          ],
        );
        const run = await fixture.run(["run", "basics:test"]);

        expect(run.status).toBe(0);
        expect(run.output).toContain("basics:test: nextest ran 1 test of basics");
        expect(run.output).toContain("PASS");
        expect(run.output).not.toMatch(/PASS .*triple_works/);
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs every selected test where the selection's filterset exceeds 128 KiB",
    async () => {
      // 1,400 tests whose names give a filterset of about 150 KiB.
      const names = Array.from(
        { length: 1400 },
        (_, index) =>
          `selected_test_with_a_long_name_that_makes_the_filterset_grow_past_its_limit_${index}`,
      );
      const fixture = new AffectedFixture({
        "rust/crates/many/Cargo.toml":
          '[package]\nname = "many"\nversion = "0.1.0"\nedition = "2021"\n',
        "rust/crates/many/src/lib.rs": `#[cfg(test)]\nmod tests {\n${names.map((name) => `    #[test]\n    fn ${name}() {}\n`).join("")}}\n`,
      });
      try {
        await fixture.baseline();
        fixture.edit("rust/crates/many/src/lib.rs", (text) => `// changed\n${text}`);
        fixture.report(
          [{ path: "crates/many/src/lib.rs", tracked: true }],
          names.map((name) => ({ binary: "many", test: `tests::${name}` })),
        );
        const run = await fixture.run(["run", "many:test"]);

        expect(run.status).toBe(0);
        expect(run.output).toContain("many:test: nextest ran 1400 tests of many");
        const nextest = fixture.testCalls().find((args) => args[0] === "nextest") ?? [];
        const filters = nextest.filter((_, index) => nextest[index - 1] === "-E");
        expect(filters.length).toBeGreaterThan(1);
        expect(filters.reduce((sum, arg) => sum + Buffer.byteLength(arg), 0)).toBeGreaterThan(
          128 * 1024,
        );
        expect(filters.every((arg) => Buffer.byteLength(arg) <= 64 * 1024)).toBe(true);
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );
});

describeWithNextest("affectedTests and its tools", () => {
  it(
    "fails a test task given --affectedTests=true in a workspace without the setting before cargo runs, alone and in a batch",
    async () => {
      const fixture = new AffectedFixture({
        "rust/Cargo.toml": (manifest) => manifest.replace("affectedTests = true\n", ""),
      });
      try {
        const message =
          'basics:test: this run sets "affectedTests" to true, as --affectedTests=true on the command line does, but the Cargo workspace in rust/Cargo.toml does not use the selection of affected tests, so the option can only turn it off. Remove it, or turn selection on with affectedTests = true under [workspace.metadata.nx] in rust/Cargo.toml.';
        const alone = await fixture.run([
          "run",
          "basics:test",
          "--affectedTests=true",
          "--batch=false",
        ]);
        expect(alone.status).toBe(1);
        expect(alone.output).toContain(message);
        expect(fixture.testCalls()).toEqual([]);

        const batch = await fixture.run([
          "run-many",
          "-t",
          "test",
          "-p",
          "basics,app",
          "--affectedTests=true",
          "--batch",
        ]);
        expect(batch.status).toBe(1);
        expect(taskOutput(batch.output, "basics:test")).toContain(message);
        expect(taskOutput(batch.output, "app:test")).toContain(
          'app:test: this run sets "affectedTests" to true',
        );
        expect(fixture.testCalls()).toEqual([]);
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "warns where cargo-affected is missing in mode full, and fails before cargo runs where it is missing in mode affected",
    async () => {
      const fixture = new AffectedFixture();
      const hidden = new HiddenCargoAffected();
      try {
        await fixture.baseline();
        const env = (mode: string) =>
          hidden.env(
            fixture.workspace.cargo.environment(testEnvironment({ NX_RUST_TEST_MODE: mode })),
          );
        const full = await fixture.run(["run", "basics:test"], env("full"));
        expect(full.status).toBe(0);
        expect(full.output).toContain(
          "basics:test: warning: cargo-affected is not installed, which the selection of affected tests in this workspace needs in test mode affected; this run is in test mode full and runs the full suite without it.",
        );
        expect(full.output).toContain("basics:test: nextest ran 2 tests of basics");

        const affected = await fixture.run(["run", "basics:test"], env("affected"));
        expect(affected.status).toBe(1);
        expect(affected.output).toContain(
          `basics:test: cargo-affected is not installed, but the selection of affected tests of the test target of basics, whose Cargo workspace in rust turns it on (affectedTests), in test mode affected:${fixture.head} needs it. Install it as https://github.com/max-sixty/cargo-affected describes.`,
        );
        expect(fixture.testCalls()).toEqual([]);
      } finally {
        hidden.remove();
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/** Sets the options of the plugin's entry in the copy's `nx.json`. */
function withPluginOptions(options: object): FileChanges {
  return {
    "nx.json": (nxJson) => {
      const config = JSON.parse(nxJson ?? "{}");
      const [first] = config.plugins;
      const plugin = typeof first === "string" ? first : first.plugin;
      return JSON.stringify({ ...config, plugins: [{ plugin, options }] });
    },
  };
}

describeWithNextest("the fixes of the review of nxr-tabkjx", () => {
  it(
    "runs the full suite where the tasks of one command were hashed in different modes, so that a full-mode key holds only a full result",
    async () => {
      // basics asks for mode full through its dotenv file and app for mode
      // affected: app's check sees basics' evaluation (the review's finding 1).
      const fixture = new AffectedFixture({
        "rust/crates/basics/.env.test": "NX_RUST_TEST_MODE=full\n",
      });
      try {
        await fixture.baseline();
        fixture.edit("rust/crates/basics/src/math.rs", basicsChange);
        fixture.report(
          [{ path: "crates/basics/src/math.rs", tracked: true }],
          [{ binary: "app", test: "tests::six_works" }],
        );
        const mixed = await runNx(
          fixture.workspace,
          ["run-many", "-t", "test", "-p", "basics,app"],
          fixture.env(),
        );
        expect(mixed.status).toBe(0);
        expect(taskOutput(mixed.output, "basics:test")).toContain(
          'basics:test: runs the full suite in test mode full, because NX_RUST_TEST_MODE is "full".',
        );
        expect(taskOutput(mixed.output, "app:test")).toContain(
          "app:test: runs the full suite, because the tasks of this workspace in this nx command were hashed in different test modes: Nx hashed one with full",
        );
        expect(taskOutput(mixed.output, "app:test")).toContain(
          "app:test: nextest ran 4 tests of app",
        );

        // A later command in mode full restores basics' full result.
        fixture.workspace.cargo.clear();
        const later = await runNx(
          fixture.workspace,
          ["run", "basics:test"],
          fixture.env({ NX_RUST_TEST_MODE: "full" }),
        );
        expect(later.status).toBe(0);
        expect(later.output).toContain("basics:test: nextest ran 2 tests of basics");
        expect(fixture.testCalls()).toEqual([]);
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs the full suite where the output of a declared runtime input differs from the collection's, and selects where it is the same",
    async () => {
      const fixture = new AffectedFixture({
        "rust/crates/basics/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx]\nruntimeInputs = ["cat ../outside-data.txt"]\n`,
      });
      const outside = join(fixture.workspace.root, "..", "outside-data.txt");
      try {
        writeFileSync(outside, "good\n");
        await fixture.baseline();
        fixture.edit("rust/crates/basics/src/math.rs", basicsChange);
        fixture.report(
          [{ path: "crates/basics/src/math.rs", tracked: true }],
          [{ binary: "basics", test: "tests::double_works" }],
        );
        const same = await fixture.run(["run", "basics:test"]);
        expect(same.status).toBe(0);
        expect(same.output).toContain("basics:test: nextest ran 1 test of basics");

        writeFileSync(outside, "bad\n");
        const changed = await fixture.run(["run", "basics:test"]);
        expect(changed.status).toBe(0);
        expect(changed.output).toContain(
          `basics:test: runs the full suite, because the baseline ${fixture.head} was collected in another context: the output of the runtime input \`cat ../outside-data.txt\` differs.`,
        );
        expect(changed.output).toContain("basics:test: nextest ran 2 tests of basics");
      } finally {
        rmSync(outside, { force: true });
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "selects under a test target that targetNames renames, and runs the full suite without a baseline",
    async () => {
      const fixture = new AffectedFixture(
        withPluginOptions({ targetNames: { test: "unit-test" } }),
      );
      try {
        await fixture.baseline(fixture.env(), {
          tasks: ["basics", "macros", "app", "runner", "consumer"].map(
            (crate) => `${crate}:unit-test`,
          ),
        });
        fixture.report([], []);
        const selected = await fixture.run(["run", "macros:unit-test"]);
        expect(selected.status).toBe(0);
        expect(selected.output).toContain("macros:unit-test: no test of macros is selected");

        rmSync(join(fixture.rust, "target", "affected", "coverage.db"));
        const without = await fixture.run(["run", "macros:unit-test"]);
        expect(without.status).toBe(0);
        expect(without.output).toContain(
          "macros:unit-test: runs the full suite in test mode full, because NX_RUST_TEST_MODE is not set and Nx detects no CI, but there is no coverage baseline",
        );
        expect(without.output).toContain("macros:unit-test: nextest ran 1 test of macros");
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs the full suite, and fails no command, where the record of the test mode cannot be written",
    async () => {
      const fixture = new AffectedFixture();
      const records = join(fixture.workspace.root, ".nx", "workspace-data", "nx-rust", "test-mode");
      try {
        await fixture.baseline();
        unwritableRecords(records);
        const run = await fixture.run(["run", "basics:test"]);
        expect(run.status).toBe(0);
        expect(run.output).toContain(
          "basics:test: runs the full suite, because the mode command recorded no test mode for this nx command",
        );
      } finally {
        chmodSync(records, 0o755);
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/**
 * Leaves a record of a stopped command more than a day old in `records` and
 * makes that folder read-only, so that neither the cleanup nor the mode
 * command can write there (the review's finding 4).
 */
function unwritableRecords(records: string): void {
  const old = join(records, "stopped-command-1", "rust");
  mkdirSync(old, { recursive: true });
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  utimesSync(join(records, "stopped-command-1"), twoDaysAgo, twoDaysAgo);
  chmodSync(records, 0o555);
}

describe("a stale record of the test mode that cannot be removed", () => {
  it(
    "fails no command of a workspace without affectedTests",
    async () => {
      const workspace = FixtureWorkspace.create("affected-tests", {
        "rust/Cargo.toml": (manifest) => manifest.replace("affectedTests = true\n", ""),
      });
      const records = join(workspace.root, ".nx", "workspace-data", "nx-rust", "test-mode");
      try {
        unwritableRecords(records);
        const run = await runNx(
          workspace,
          ["run", "macros:check", "--skip-nx-cache"],
          workspace.cargo.environment(testEnvironment()),
        );
        expect(run.status).toBe(0);
        expect(run.output).not.toContain("EACCES");
      } finally {
        chmodSync(records, 0o755);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
