import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { diffRelativeVariables } from "../src/executors/affected";
import { baselineCommits } from "../src/executors/test-mode";
import {
  cargoAffectedFolder,
  commitAll,
  type FileChanges,
  FixtureWorkspace,
  gitIn,
  HARNESS_TIMEOUT,
  initGitRepository,
  llvmTools,
  runNx,
  taskOutput,
  testEnvironment,
  writeBaselineContext,
} from "./harness";

// The parts of VER-TESTING that need real coverage: cargo-affected collects a
// baseline of the affected-tests fixture, and the plugin selects and widens
// against it (DES-TEST-RUN, steps 1 to 4; ADR-AFFECTED-TESTS-WIDENING). These
// runs need cargo-affected, llvm-cov and llvm-profdata (the llvm-tools
// component) and cargo-nextest; where one is missing they are skipped. The
// collections run at -j 4 with four test threads on a fixture of five small
// crates.

function nextestInstalled(): boolean {
  return (
    spawnSync("cargo", ["nextest", "--version"], { env: testEnvironment(), stdio: "ignore" })
      .status === 0
  );
}

const affectedFolder = cargoAffectedFolder();
const llvm = llvmTools();
const llvmFolder = "folder" in llvm ? llvm.folder : undefined;
const missing = [
  ...(affectedFolder === undefined
    ? [
        "cargo-affected is not installed (on PATH, in the Cargo home or in NX_RUST_TEST_CARGO_AFFECTED)",
      ]
    : []),
  ...("problem" in llvm ? [llvm.problem] : []),
  ...(nextestInstalled() ? [] : ["cargo-nextest is not installed"]),
];
if (missing.length > 0) {
  it.todo(
    `affected runs against real coverage are skipped, because ${missing.join("; ")}; the plugin installs none of these tools`,
  );
}
const describeReal = missing.length === 0 ? describe : describe.skip;

/** The environment of a collection and of an Nx command, with the real tools on `PATH`. */
function realEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const base = testEnvironment({ CARGO_BUILD_JOBS: "4", NEXTEST_TEST_THREADS: "4", ...extra });
  return {
    ...base,
    PATH: [affectedFolder, llvmFolder, base.PATH].filter(Boolean).join(delimiter),
  };
}

/** A copy of `affected-tests` in a git repository, with a baseline that cargo-affected collected. */
class CollectedFixture {
  readonly workspace: FixtureWorkspace;
  readonly rust: string;
  readonly head: string;

  /**
   * @param layout `subfolder` keeps the Cargo workspace in `rust/`, below the
   *   top of the git repository; `top` moves it to the repository root.
   */
  constructor(
    readonly layout: "subfolder" | "top" = "subfolder",
    files: FileChanges = {},
  ) {
    this.workspace = FixtureWorkspace.create("affected-tests", files);
    if (layout === "top") {
      const from = join(this.workspace.root, "rust");
      for (const entry of readdirSync(from)) {
        renameSync(join(from, entry), join(this.workspace.root, entry));
      }
      rmSync(from, { recursive: true });
      this.edit("crates/app/Cargo.toml", (text) => text.replace("../../../shared", "../../shared"));
      this.edit("crates/app/tests/data.rs", (text) =>
        text.replace("../../../shared", "../../shared"),
      );
    }
    this.rust = layout === "top" ? this.workspace.root : join(this.workspace.root, "rust");
    execFileSync("cargo", ["metadata", "--format-version", "1", "--offline"], {
      cwd: this.rust,
      env: testEnvironment(),
      stdio: "ignore",
    });
    this.head = initGitRepository(this.workspace.root);
  }

  /** A path of the fixture's Cargo workspace, relative to the repository root. */
  path(inWorkspace: string): string {
    return this.layout === "top" ? inWorkspace : `rust/${inWorkspace}`;
  }

  /** The folder of the git repository. */
  get top(): string {
    return this.workspace.root;
  }

  /** Collects coverage at `HEAD` as the collection target does, and writes its record. */
  async collect(args: string[] = []): Promise<void> {
    const env = realEnv();
    const run = spawnSync(
      "cargo",
      ["affected", "collect", ...args, "--", "--workspace", "--no-fail-fast"],
      { cwd: this.rust, env: { ...env, ...diffRelativeVariables(env) }, encoding: "utf8" },
    );
    if (run.status !== 0) {
      throw new Error(`cargo affected collect failed:\n${run.stdout}${run.stderr}`);
    }
    await writeBaselineContext(
      this.workspace,
      this.rust,
      this.workspace.cargo.environment(realEnv()),
    );
  }

  write(path: string, text: string): void {
    const file = join(this.workspace.root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }

  edit(path: string, change: (text: string) => string): void {
    const file = join(this.workspace.root, path);
    writeFileSync(file, change(readFileSync(file, "utf8")));
  }

  /** Puts the files back at `HEAD`, keeping ignored files such as the baseline. */
  reset(): void {
    gitIn(this.top, ["reset", "-q", "--hard", "HEAD"]);
    gitIn(this.top, ["clean", "-q", "-fd"]);
  }

  /** Runs the tests of every crate and returns, per crate, its count and its lines. */
  async run(env: NodeJS.ProcessEnv = this.workspace.cargo.environment(realEnv())) {
    const crates = ["basics", "macros", "app", "runner", "consumer"];
    const run = await runNx(
      this.workspace,
      ["run-many", "-t", "test", "-p", crates.join(","), "--skip-nx-cache"],
      env,
    );
    if (run.status !== 0) {
      throw new Error(`The affected run failed:\n${run.output}`);
    }
    if (process.env.NX_RUST_TEST_DEBUG_AFFECTED) {
      console.log(
        run.output
          .split("\n")
          .filter((line) => /:test: (runs|no test)/.test(line))
          .join("\n"),
      );
    }
    const counts = Object.fromEntries(
      crates.map((crate) => {
        const output = taskOutput(run.output, `${crate}:test`);
        const ran = new RegExp(`${crate}:test: nextest ran (\\d+|no) tests? of ${crate}`).exec(
          output,
        );
        const none = output.includes(`${crate}:test: no test of ${crate} is selected`);
        return [
          crate,
          ran === null ? (none ? 0 : "not run") : ran[1] === "no" ? 0 : Number(ran[1]),
        ];
      }),
    );
    return { counts, output: run.output };
  }

  remove(): void {
    this.workspace.remove();
  }
}

/** Every crate's count of tests in the full suite. */
const fullSuite = { basics: 2, macros: 1, app: 4, runner: 2, consumer: 1 };

describeReal("affected runs against a baseline that cargo-affected collected", () => {
  let fixture: CollectedFixture;

  beforeAll(async () => {
    fixture = new CollectedFixture();
    await fixture.collect();
  }, HARNESS_TIMEOUT * 3);

  afterAll(() => fixture?.remove());

  afterEach(() => fixture.reset());

  it("reads the commit of the baseline that cargo-affected wrote, and writes nothing beside it", () => {
    const folder = join(fixture.rust, "target", "affected");
    const before = readdirSync(folder)
      .sort()
      .map((name) => `${name}:${statSync(join(folder, name)).mtimeMs}`);
    expect(baselineCommits(fixture.rust)).toEqual({ commits: [fixture.head] });
    expect(
      readdirSync(folder)
        .sort()
        .map((name) => `${name}:${statSync(join(folder, name)).mtimeMs}`),
    ).toEqual(before);
  });

  it(
    "runs only the tests that cover a changed function, in a workspace below the top of its git repository",
    async () => {
      fixture.edit("rust/crates/basics/src/math.rs", (text) => text.replace("x * 3", "x + x + x"));
      const { counts, output } = await fixture.run();

      // runner's integration tests and consumer's tests can start runner's
      // binary, which links basics.
      expect(counts).toEqual({ basics: 1, macros: 0, app: 0, runner: 1, consumer: 1 });
      expect(taskOutput(output, "basics:test")).toContain(
        "basics:test: runs a subset of its tests for this change: 1 test of basics",
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "widens a build script, proc-macro source, a declared file outside the workspace folder and a file that a test reads",
    async () => {
      fixture.edit("rust/crates/basics/build.rs", (text) => `${text}// changed\n`);
      expect((await fixture.run()).counts).toEqual({ ...fullSuite, macros: 0 });
      fixture.reset();

      fixture.edit("rust/crates/macros/src/lib.rs", (text) =>
        text.replace("    42\n", "    40 + 2\n"),
      );
      expect((await fixture.run()).counts).toEqual({
        ...fullSuite,
        basics: 0,
        runner: 0,
        consumer: 0,
      });
      fixture.reset();

      fixture.write("shared/data.txt", "ok\n\n");
      expect((await fixture.run()).counts).toEqual({
        basics: 0,
        macros: 0,
        app: 4,
        runner: 0,
        consumer: 0,
      });
      fixture.reset();

      fixture.write("rust/crates/app/tests/expected.txt", "ok \n");
      expect((await fixture.run()).counts).toEqual({
        basics: 0,
        macros: 0,
        app: 4,
        runner: 0,
        consumer: 0,
      });
      fixture.reset();

      // A file that is an input of no crate adds nothing.
      fixture.write("notes/README.md", "notes\n");
      expect((await fixture.run()).counts).toEqual({
        basics: 0,
        macros: 0,
        app: 0,
        runner: 0,
        consumer: 0,
      });
      fixture.reset();

      // Cargo configuration runs every test of the group.
      fixture.write("rust/.cargo/config.toml", '[env]\nAFFECTED_FIXTURE = "1"\n');
      expect((await fixture.run()).counts).toEqual(fullSuite);
    },
    HARNESS_TIMEOUT * 4,
  );

  it(
    "runs the integration tests of a binary's crate and all tests of its dependents after a change that only the binary calls",
    async () => {
      fixture.edit("rust/crates/basics/src/math.rs", (text) =>
        text.replace("x * 4", "x + x + x + x"),
      );
      const { counts, output } = await fixture.run();

      // Coverage holds no row of quadruple: cargo-affected selects every test
      // that ran the file, and the plugin adds runner's integration tests and
      // consumer's tests.
      expect(counts).toEqual({ basics: 2, macros: 0, app: 1, runner: 1, consumer: 1 });
      expect(taskOutput(output, "runner:test")).toContain("every integration test of runner");
      expect(taskOutput(output, "consumer:test")).toContain("runs all tests of consumer");
    },
    HARNESS_TIMEOUT,
  );

  it(
    "sees both paths of a rename, a deleted file and an untracked file",
    async () => {
      gitIn(fixture.top, ["mv", "rust/crates/app/tests/data.rs", "rust/crates/app/tests/files.rs"]);
      const renamed = await fixture.run();
      expect(renamed.counts).toEqual({
        basics: 0,
        macros: 0,
        app: fullSuite.app,
        runner: 0,
        consumer: 0,
      });
      fixture.reset();

      rmSync(join(fixture.rust, "crates/app/tests/expected.txt"));
      fixture.edit("rust/crates/app/tests/data.rs", (text) =>
        text.replace(/#\[test\]\nfn expected_text[\s\S]*?\n}\n/, ""),
      );
      const deleted = await fixture.run();
      expect(deleted.counts).toEqual({ basics: 0, macros: 0, app: 3, runner: 0, consumer: 0 });
      fixture.reset();

      fixture.write("rust/crates/basics/notes.txt", "untracked\n");
      const untracked = await fixture.run();
      expect(untracked.counts).toEqual({ ...fullSuite, macros: 0 });
    },
    HARNESS_TIMEOUT * 3,
  );

  it(
    "runs the full suite for a changed submodule and for a declared input that git ignores",
    async () => {
      const sub = join(fixture.workspace.root, "..", "submodule-source");
      mkdirSync(sub, { recursive: true });
      initGitRepository(sub);
      gitIn(fixture.top, [
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "-q",
        sub,
        "vendor/sub",
      ]);
      commitAll(fixture.top, "add a submodule");
      writeFileSync(join(sub, "file.txt"), "changed\n");
      commitAll(sub, "change");
      gitIn(join(fixture.top, "vendor/sub"), [
        "-c",
        "protocol.file.allow=always",
        "pull",
        "-q",
        "origin",
        "main",
      ]);
      const submodule = await fixture.run();
      expect(submodule.output).toContain(
        "runs the full suite, because git cannot name the changed files: the submodule vendor/sub changed",
      );
      gitIn(fixture.top, ["reset", "-q", "--hard", fixture.head]);
      rmSync(join(fixture.top, "vendor"), { recursive: true, force: true });
      rmSync(join(fixture.top, ".git", "modules"), { recursive: true, force: true });
      rmSync(sub, { recursive: true, force: true });

      fixture.edit("rust/crates/app/Cargo.toml", (text) =>
        text.replace(
          'fileInputs = ["../../../shared/data.txt"]',
          'fileInputs = ["../../../shared/data.txt", "generated.txt"]',
        ),
      );
      fixture.write("rust/crates/app/.gitignore", "generated.txt\n");
      fixture.write("rust/crates/app/generated.txt", "ignored\n");
      commitAll(fixture.top, "declare an ignored file");
      const ignored = await fixture.run();
      expect(ignored.output).toContain(
        "rust/crates/app/generated.txt, an input of the group's tests",
      );
      expect(ignored.counts).toEqual(fullSuite);
      gitIn(fixture.top, ["reset", "-q", "--hard", fixture.head]);
    },
    HARNESS_TIMEOUT * 3,
  );
});

describeReal("affected runs against more than one collection", () => {
  it(
    "counts a change committed after an older collection while a newer one equals HEAD",
    async () => {
      const fixture = new CollectedFixture();
      try {
        await fixture.collect();
        fixture.edit("rust/crates/basics/src/math.rs", (text) =>
          text.replace("x * 3", "x + x + x"),
        );
        commitAll(fixture.top, "change triple");
        fixture.edit("rust/crates/app/src/lib.rs", (text) => `${text}\n// changed\n`);
        commitAll(fixture.top, "change app");
        // A collection at HEAD of the tests that the last commit affects keeps
        // the older rows of every other test.
        await fixture.collect(["--diff"]);
        const { counts } = await fixture.run();
        expect(counts.basics).toBeGreaterThanOrEqual(1);
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT * 4,
  );

  it(
    "selects the same tests where the workspace is the top of its git repository",
    async () => {
      const fixture = new CollectedFixture("top");
      try {
        await fixture.collect();
        fixture.edit(fixture.path("crates/basics/src/math.rs"), (text) =>
          text.replace("x * 3", "x + x + x"),
        );
        expect((await fixture.run()).counts).toEqual({
          basics: 1,
          macros: 0,
          app: 0,
          runner: 1,
          consumer: 1,
        });
      } finally {
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );
});

describeReal("affected runs and a runtime input that git cannot see", () => {
  it(
    "runs the full suite, which fails, where a declared runtime input prints another output than at the collection",
    async () => {
      // basics declares a runtime input that reads a file outside the
      // repository, and a test of basics reads the same file (the review's
      // finding 2).
      const fixture = new CollectedFixture("subfolder", {
        "rust/crates/basics/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx]\nruntimeInputs = ["cat ../outside-data.txt"]\n`,
        "rust/crates/basics/tests/external.rs": [
          "#[test]",
          "fn external_data() {",
          '    let file = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../../outside-data.txt");',
          '    assert_eq!(std::fs::read_to_string(file).unwrap().trim(), "good");',
          "}",
          "",
        ].join("\n"),
      });
      const outside = join(fixture.workspace.root, "..", "outside-data.txt");
      try {
        writeFileSync(outside, "good\n");
        await fixture.collect();
        writeFileSync(outside, "bad\n");
        const env = fixture.workspace.cargo.environment(realEnv());
        const affected = await runNx(
          fixture.workspace,
          ["run", "basics:test", "--skip-nx-cache"],
          env,
        );
        expect(affected.status).toBe(1);
        expect(affected.output).toContain("basics:test: runs the full suite, because the baseline");
        expect(affected.output).toContain(
          "the output of the runtime input `cat ../outside-data.txt` differs",
        );
        expect(affected.output).toMatch(/FAIL .*basics::external external_data/);
        const full = await runNx(fixture.workspace, ["run", "basics:test", "--skip-nx-cache"], {
          ...env,
          NX_RUST_TEST_MODE: "full",
        });
        expect(full.status).toBe(1);
      } finally {
        rmSync(outside, { force: true });
        fixture.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );
});
