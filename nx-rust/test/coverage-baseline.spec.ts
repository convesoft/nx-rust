import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  baselineStatusArguments,
  collectArguments,
  collectionChoice,
  collectionLockFile,
  collectionNextestArguments,
  removeBeforeCollection,
  takeCollectionLock,
  takeoverMarkerFile,
} from "../src/executors/baseline";
import { contextRecordFile, readContextRecord } from "../src/executors/baseline-context";
import {
  affectedReport,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  HiddenCargoAffected,
  initGitRepository,
  loadFixtureGraph,
  runNx,
  StubCargoAffected,
  taskOutput,
  testEnvironment,
  writeBaseline,
  writeBaselineContext,
} from "./harness";

// The coverage baseline target (REQ-BASELINE, DES-BASELINE; VER-TESTING's
// last paragraph, VER-TARGETS and VER-CONFIGURATION for the target, its name
// and its options): which collection it runs, the order in which it removes
// and writes the database and the context record, and its messages for
// missing tools. A stand-in replays cargo-affected, so that these checks need
// cargo-nextest and no coverage; affected-coverage.spec.ts runs the real
// cargo-affected through the target.

const head = "0123456789abcdef0123456789abcdef01234567";

describe("the collection's commands", () => {
  it("collects the whole workspace without stopping at a failure, with the test runs' cargo arguments", () => {
    const args = collectionNextestArguments(
      { features: ["extra", "more"], noDefaultFeatures: true, profile: "ci" },
      { locked: true, workspaceUnification: false },
    );
    expect(args).toEqual([
      "--workspace",
      "--no-fail-fast",
      "--features",
      "extra,more",
      "--no-default-features",
      "--cargo-profile",
      "ci",
      "--locked",
    ]);
    expect(collectArguments(false, args)).toEqual(["affected", "collect", "--", ...args]);
    expect(collectArguments(true, ["--workspace"])).toEqual([
      "affected",
      "collect",
      "--diff",
      "--",
      "--workspace",
    ]);
    expect(
      baselineStatusArguments("/r.json", ["--workspace", "--no-fail-fast", "--all-features"]),
    ).toEqual([
      "affected",
      "status",
      "--report-json",
      "/r.json",
      "--",
      "--workspace",
      "--all-features",
    ]);
    expect(
      collectionNextestArguments(
        { allFeatures: true },
        { locked: false, workspaceUnification: true },
      ),
    ).toEqual([
      "--workspace",
      "--no-fail-fast",
      "--all-features",
      "--config",
      'resolver.feature-unification="workspace"',
      "-Zfeature-unification",
    ]);
  });
});

describe("the choice between collect --diff and a full collection", () => {
  const ok = { code: 0 };
  const report = (options: Parameters<typeof affectedReport>[0]) =>
    JSON.stringify(affectedReport(options));

  it("re-collects with --diff where the report shows usable data within the threshold", () => {
    expect(
      collectionChoice(
        ok,
        report({ collect: [{ sha: head }], changed: [], selected: [] }),
        "",
        100,
      ),
    ).toEqual({ kind: "diff", reason: "the baseline holds usable data of HEAD" });
    const behind = report({
      status: "hit-with-divergence",
      collect: [
        { sha: head, relation: "reachable", commitsAhead: 3 },
        { sha: "a".repeat(40), relation: "reachable", commitsAhead: 5 },
        { sha: "b".repeat(40), relation: "missing" },
      ],
      changed: [],
      selected: [],
    });
    expect(collectionChoice(ok, behind, "", 5).kind).toBe("diff");
    expect(collectionChoice(ok, behind, "", 4)).toEqual({
      kind: "full",
      reason:
        "the oldest collection of the baseline is 5 commits behind HEAD, more than fullCollectThreshold (4)",
    });
    expect(collectionChoice(ok, behind, "", 0).kind).toBe("full");
  });

  it("collects everything where the report shows no usable data or cannot be read", () => {
    const choice = (
      exit: Parameters<typeof collectionChoice>[0],
      text: string | undefined,
      stderr = "",
    ) => collectionChoice(exit, text, stderr, 100);
    expect(
      choice(ok, report({ status: "miss-no-coverage", collect: [], changed: [], selected: null })),
    ).toEqual({
      kind: "full",
      reason: "the report shows no usable data: its cache status is miss-no-coverage",
    });
    expect(
      choice(
        ok,
        report({
          status: "miss-fingerprint",
          collect: [],
          changed: [],
          selected: null,
          differingLabels: ["Cargo.lock", "RUSTFLAGS"],
        }),
      ).reason,
    ).toBe(
      "the report shows no usable data: its cache status is miss-fingerprint, which differs from the stored one in Cargo.lock, RUSTFLAGS",
    );
    expect(
      choice(
        ok,
        report({
          status: "miss-no-reachable-sha",
          collect: [{ sha: head, relation: "missing" }],
          changed: [],
          selected: null,
        }),
      ).kind,
    ).toBe("full");
    expect(
      choice(
        ok,
        report({ collect: [{ sha: head, relation: "missing" }], changed: [], selected: [] }),
      ).reason,
    ).toBe("the report shows no usable data: HEAD reaches no collection of the baseline");
    expect(
      choice(
        ok,
        report({
          status: "hit-with-divergence",
          collect: [{ sha: head, relation: "reachable" }],
          changed: [],
          selected: [],
        }),
      ).reason,
    ).toBe("cargo-affected's report names a collection without the commits since it");
    expect(choice({ code: 1 }, undefined, "error: could not compile `basics`\n").reason).toBe(
      "cargo affected status exited with status 1 (error: could not compile `basics`)",
    );
    expect(choice({ code: null, failure: "spawn cargo ENOENT" }, undefined).reason).toBe(
      "cargo affected status could not run (spawn cargo ENOENT)",
    );
    expect(choice(ok, undefined).reason).toBe("cargo affected status wrote no report");
    expect(choice(ok, "{").reason).toBe("cargo-affected's report is no JSON");
    expect(choice(ok, JSON.stringify({ schema_version: 2 })).reason).toBe(
      "cargo-affected's report has the schema_version 2, and this version of @convesoft/nx-rust reads only 1",
    );
  });
});

describe("the files that a collection replaces", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-rust-baseline-files-"));
    for (const file of [
      "coverage.db",
      "coverage.db-wal",
      "coverage.db-shm",
      "nx-rust-context.json",
      "build/debug/marker",
      "profraw-1/x.profraw",
    ]) {
      mkdirSync(join(root, "target", "affected", file, ".."), { recursive: true });
      writeFileSync(join(root, "target", "affected", file), "x");
    }
    mkdirSync(join(root, "target", "debug"), { recursive: true });
    writeFileSync(join(root, "target", "debug", "app"), "x");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const left = () =>
    [
      "target/affected/coverage.db",
      "target/affected/coverage.db-wal",
      "target/affected/coverage.db-shm",
      "target/affected/nx-rust-context.json",
      "target/affected/build/debug/marker",
      "target/affected/profraw-1/x.profraw",
      "target/debug/app",
    ].filter((file) => existsSync(join(root, file)));

  it("removes only the record before collect --diff", () => {
    removeBeforeCollection(root, false);
    expect(left()).toEqual([
      "target/affected/coverage.db",
      "target/affected/coverage.db-wal",
      "target/affected/coverage.db-shm",
      "target/affected/build/debug/marker",
      "target/affected/profraw-1/x.profraw",
      "target/debug/app",
    ]);
  });

  it("removes the record and the database with its -wal and -shm files before a full collection, and nothing else", () => {
    removeBeforeCollection(root, true);
    expect(left()).toEqual([
      "target/affected/build/debug/marker",
      "target/affected/profraw-1/x.profraw",
      "target/debug/app",
    ]);
  });
});

describe("the collection lock", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-rust-baseline-lock-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("is taken once, refused while a running process holds it, and taken over from a process that ended", () => {
    const lock = takeCollectionLock(root);
    expect("release" in lock).toBe(true);
    expect(takeCollectionLock(root, process.pid + 1)).toEqual({ holder: process.pid });
    if ("release" in lock) {
      lock.release();
    }
    expect(existsSync(join(root, collectionLockFile))).toBe(false);

    // A process that has ended: a child that ran and exited.
    const ended = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    });
    writeFileSync(join(root, collectionLockFile), `${ended.stdout}\n`);
    const taken = takeCollectionLock(root);
    expect("release" in taken).toBe(true);
    expect(readFileSync(join(root, collectionLockFile), "utf8").trim()).toBe(String(process.pid));
    expect(existsSync(join(root, takeoverMarkerFile))).toBe(false);
  });

  // Two contenders read the same stale lock; one takes it over while the
  // other waits between its reading and its takeover, in either order.
  it.each([
    ["the second contender takes over first", process.pid, process.ppid],
    ["the first contender takes over first", process.ppid, process.pid],
  ])("lets exactly one of two contenders take over a stale lock: %s", (_name, outer, inner) => {
    const ended = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    });
    mkdirSync(join(root, collectionLockFile, ".."), { recursive: true });
    writeFileSync(join(root, collectionLockFile), `${ended.stdout}\n`);
    let innerResult: ReturnType<typeof takeCollectionLock> | undefined;
    const outerResult = takeCollectionLock(root, outer, {
      afterStaleRead: () => {
        innerResult = takeCollectionLock(root, inner);
      },
    });
    const holders = [
      ["outer", outer, outerResult],
      ["inner", inner, innerResult],
    ].filter(([, , result]) => result !== undefined && "release" in (result as object));
    expect(holders.map(([who]) => who)).toEqual(["inner"]);
    expect(outerResult).toEqual({ holder: inner });
    expect(readFileSync(join(root, collectionLockFile), "utf8").trim()).toBe(String(inner));
    expect(existsSync(join(root, takeoverMarkerFile))).toBe(false);
  });

  it("refuses, naming both files, where a takeover marker is there beside a stale lock", () => {
    const ended = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    });
    mkdirSync(join(root, collectionLockFile, ".."), { recursive: true });
    writeFileSync(join(root, collectionLockFile), `${ended.stdout}\n`);
    writeFileSync(join(root, takeoverMarkerFile), `${ended.stdout}\n`);
    const refused = takeCollectionLock(root);
    expect(refused).toEqual({
      problem: expect.stringContaining(
        "target/affected/nx-rust-collect.lock of a collection that ended, or one was stopped while it did and left target/affected/nx-rust-collect.lock.takeover",
      ),
    });
    expect(readFileSync(join(root, collectionLockFile), "utf8").trim()).toBe(ended.stdout);
  });

  it("takes the lock where a takeover marker is there beside no lock, and leaves the marker", () => {
    // As a taker that was killed between removing the stale lock and
    // creating its own leaves it.
    const ended = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    });
    mkdirSync(join(root, collectionLockFile, ".."), { recursive: true });
    writeFileSync(join(root, takeoverMarkerFile), `${ended.stdout}\n`);
    const taken = takeCollectionLock(root);
    expect("release" in taken).toBe(true);
    expect(readFileSync(join(root, collectionLockFile), "utf8").trim()).toBe(String(process.pid));
    expect(readFileSync(join(root, takeoverMarkerFile), "utf8").trim()).toBe(ended.stdout);
  });
});

describe("the coverage baseline target in the graph", () => {
  it(
    "exists on the workspace project of a workspace with affectedTests, uncached and with the threshold, and nowhere else",
    async () => {
      const graph = await loadFixtureGraph("affected-tests");
      const target = graph.projects.rust.targets?.["coverage-baseline"];
      expect(target).toMatchObject({
        executor: "@convesoft/nx-rust:lockfile",
        cache: false,
        options: { fullCollectThreshold: 100 },
        configurations: { "all-features": { allFeatures: true } },
      });
      expect(target?.dependsOn ?? []).toEqual([]);
      for (const crate of ["basics", "macros", "app", "runner", "consumer"]) {
        expect(Object.keys(graph.projects[crate].targets ?? {})).not.toContain("coverage-baseline");
      }

      const without = await loadFixtureGraph("affected-tests", {
        files: {
          "rust/Cargo.toml": (text) => text.replace("affectedTests = true\n", ""),
        },
      });
      expect(Object.keys(without.projects.rust.targets ?? {})).not.toContain("coverage-baseline");
    },
    HARNESS_TIMEOUT,
  );

  it(
    "takes a name of targetNames, and two targets of one name fail graph creation",
    async () => {
      const nxJson = (names: Record<string, string>) =>
        JSON.stringify({
          plugins: [{ plugin: "@convesoft/nx-rust", options: { targetNames: names } }],
        });
      const renamed = await loadFixtureGraph("affected-tests", {
        files: { "nx.json": nxJson({ "coverage-baseline": "baseline" }) },
      });
      expect(renamed.projects.rust.targets?.baseline?.executor).toBe("@convesoft/nx-rust:lockfile");
      const failed = loadFixtureGraph("affected-tests", {
        files: { "nx.json": nxJson({ "coverage-baseline": "doc" }) },
      });
      await expect(failed).rejects.toThrow(GraphCreationError);
      await expect(failed).rejects.toThrow(
        /the project "rust" \(rust\/Cargo\.toml\): `doc` and `coverage-baseline` would both be called "doc"/,
      );
    },
    HARNESS_TIMEOUT,
  );
});

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
    "the coverage baseline target through Nx: cargo-nextest is not installed where cargo looks for it (PATH or the Cargo home), so these checks are skipped; install it as https://nexte.st/docs/installation/ describes to run them",
  );
}
const describeWithNextest = withNextest ? describe : describe.skip;

/**
 * A copy of `affected-tests` in a git repository, with a stand-in
 * cargo-affected and stand-ins of llvm-cov and llvm-profdata on `PATH`, so
 * that the target finds every tool whatever the machine has.
 */
class BaselineFixture {
  readonly workspace: FixtureWorkspace;
  readonly stub = new StubCargoAffected();
  readonly rust: string;
  readonly head: string;
  /** A database with coverage of `HEAD`, which the stand-in's collect writes. */
  readonly collectedDb: string;

  constructor() {
    this.workspace = FixtureWorkspace.create("affected-tests");
    this.rust = join(this.workspace.root, "rust");
    execFileSync("cargo", ["metadata", "--format-version", "1", "--offline"], {
      cwd: this.rust,
      env: testEnvironment(),
      stdio: "ignore",
    });
    this.head = initGitRepository(this.workspace.root);
    for (const tool of ["llvm-cov", "llvm-profdata"]) {
      writeFileSync(join(this.stub.folder, tool), "#!/bin/sh\nexit 0\n");
      chmodSync(join(this.stub.folder, tool), 0o755);
    }
    const template = join(this.stub.folder, "template");
    writeBaseline(template, [this.head]);
    this.collectedDb = join(template, "target", "affected", "coverage.db");
  }

  /** The environment of an Nx command, with the stand-ins on `PATH`. */
  env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    const base = testEnvironment(extra);
    return this.workspace.cargo.environment({
      ...base,
      ...this.stub.env(),
      NX_RUST_STUB_COLLECT_DB: this.collectedDb,
      ...Object.fromEntries(
        Object.entries(extra).filter(([name]) => name.startsWith("NX_RUST_STUB_")),
      ),
      PATH: [this.stub.folder, base.PATH].filter(Boolean).join(delimiter),
    });
  }

  /** The baseline and record of an earlier collection at `HEAD`, in the environment `env`. */
  async earlierBaseline(
    env: NodeJS.ProcessEnv = this.env(),
    options: Parameters<typeof writeBaselineContext>[3] = {},
  ): Promise<void> {
    writeBaseline(this.rust, [this.head]);
    await writeBaselineContext(this.workspace, this.rust, env, options);
  }

  /** Has the next `status` give a report on `HEAD` with this cache status. */
  report(status = "hit-exact", commitsAhead?: number): void {
    this.stub.writeReport(
      affectedReport({
        status,
        collect: status.startsWith("miss")
          ? []
          : [
              commitsAhead === undefined
                ? { sha: this.head }
                : { sha: this.head, relation: "reachable", commitsAhead },
            ],
        changed: [],
        selected: status.startsWith("miss") ? null : [],
      }),
    );
  }

  async collect(args: string[] = [], env: NodeJS.ProcessEnv = this.env()) {
    return runNx(this.workspace, ["run", "rust:coverage-baseline", ...args], env);
  }

  record() {
    return readContextRecord(this.rust);
  }

  exists(file: string): boolean {
    return existsSync(join(this.rust, file));
  }

  remove(): void {
    this.stub.remove();
    this.workspace.remove();
  }
}

describeWithNextest("the coverage baseline target with a stand-in for cargo-affected", () => {
  let fixture: BaselineFixture;

  beforeEach(() => {
    fixture = new BaselineFixture();
  });

  afterEach(() => fixture.remove());

  it(
    "collects everything into an empty database where there is no record, without asking status, with git's diff.relative, and writes the record of the test tasks' context",
    async () => {
      fixture.report("miss-no-coverage");
      const run = await fixture.collect();
      expect(run.status).toBe(0);
      expect(run.output).toContain(
        "rust:coverage-baseline: collects the coverage of every test into an empty database with cargo affected collect, because the baseline has no record of the context of its last collection, as on the first run or after a collection that failed or was stopped, so the coverage it holds cannot be kept.",
      );
      expect(fixture.stub.calls().map((args) => args.slice(0, 2))).toEqual([
        ["affected", "collect"],
      ]);
      const [collection] = fixture.stub.collections();
      expect(collection.args).toEqual([
        "affected",
        "collect",
        "--",
        "--workspace",
        "--no-fail-fast",
      ]);
      expect(collection.env).toMatchObject({
        GIT_CONFIG_KEY_0: "diff.relative",
        GIT_CONFIG_VALUE_0: "true",
      });
      expect(collection.env.CARGO_BUILD_BUILD_DIR).toBeUndefined();
      expect(collection.present).toEqual([]);
      // The record holds what the test tasks' executor compares: the same as
      // the harness computes with the plugin's functions for these tasks.
      const record = fixture.record();
      const expected = mkdtempSync(join(tmpdir(), "nx-rust-expected-record-"));
      try {
        await writeBaselineContext(fixture.workspace, expected, fixture.env());
        expect(record).toEqual(readContextRecord(expected));
      } finally {
        rmSync(expected, { recursive: true, force: true });
      }
      expect(run.output).toContain("rust/target/affected/nx-rust-context.json records the context");
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "re-collects with --diff over a usable baseline, keeping its database, and passes the target's feature options",
    async () => {
      await fixture.earlierBaseline(fixture.env(), { cargo: { features: ["extra"] } });
      fixture.report("hit-with-divergence", 2);
      const run = await fixture.collect(["--features=extra"]);
      expect(run.status).toBe(0);
      expect(run.output).toContain(
        "re-collects the coverage of the affected and new tests with cargo affected collect --diff, because the baseline holds usable data, whose oldest collection is 2 commits behind HEAD, within fullCollectThreshold (100).",
      );
      expect(fixture.stub.calls()[0]).toEqual([
        "affected",
        "status",
        "--report-json",
        expect.any(String),
        "--",
        "--workspace",
        "--features",
        "extra",
      ]);
      const [collection] = fixture.stub.collections();
      expect(collection.args).toEqual([
        "affected",
        "collect",
        "--diff",
        "--",
        "--workspace",
        "--no-fail-fast",
        "--features",
        "extra",
      ]);
      // The record was removed before, the database kept.
      expect(collection.present).toEqual(["coverage.db"]);
      const record = fixture.record();
      expect("context" in record && record.context.cargo.features).toEqual(["extra"]);
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "collects everything, from an empty database, where the oldest collection is further behind than the threshold, or where fullCollect asks for it",
    async () => {
      await fixture.earlierBaseline();
      writeFileSync(join(fixture.rust, "target/affected/coverage.db-wal"), "");
      writeFileSync(join(fixture.rust, "target/affected/coverage.db-shm"), "");
      fixture.report("hit-with-divergence", 5);
      const run = await fixture.collect(["--fullCollectThreshold=4"]);
      expect(run.status).toBe(0);
      expect(run.output).toContain(
        "because the oldest collection of the baseline is 5 commits behind HEAD, more than fullCollectThreshold (4).",
      );
      expect(fixture.stub.collections()[0]).toMatchObject({
        args: ["affected", "collect", "--", "--workspace", "--no-fail-fast"],
        present: [],
      });
      expect("context" in fixture.record()).toBe(true);

      const forced = await fixture.collect(["--fullCollect"]);
      expect(forced.status).toBe(0);
      expect(forced.output).toContain("because the option fullCollect asks for it.");
      // No status: the option decides.
      expect(fixture.stub.calls().map((args) => args[1])).toEqual(["status", "collect", "collect"]);
      expect(fixture.stub.collections()[1].present).toEqual([]);
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "collects nothing with diffOnly where a full collection would be needed, and keeps the baseline and its record",
    async () => {
      await fixture.earlierBaseline();
      const before = readFileSync(join(fixture.rust, contextRecordFile), "utf8");
      fixture.report("miss-fingerprint");
      const run = await fixture.collect(["--diffOnly"]);
      expect(run.status).toBe(0);
      expect(run.output).toContain(
        "rust:coverage-baseline: collects nothing, because the report shows no usable data: its cache status is miss-fingerprint, which needs a full collection, and the option diffOnly leaves that to a run with --fullCollect.",
      );
      expect(fixture.stub.collections()).toEqual([]);
      expect(readFileSync(join(fixture.rust, contextRecordFile), "utf8")).toBe(before);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "sets a build directory of its own only with separateBuildDir",
    async () => {
      fixture.report("miss-no-coverage");
      expect((await fixture.collect(["--separateBuildDir"])).status).toBe(0);
      expect(fixture.stub.collections()[0].env.CARGO_BUILD_BUILD_DIR).toBe(
        join(fixture.rust, "target", "affected", "build"),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs --diff only over a record equal to the collection's context, and otherwise collects everything and says why, or with diffOnly nothing",
    async () => {
      const recordFile = join(fixture.rust, contextRecordFile);
      const cases: [string, () => Promise<void>, string][] = [
        [
          "missing",
          async () => {
            writeBaseline(fixture.rust, [fixture.head]);
          },
          "because the baseline has no record of the context of its last collection, as on the first run or after a collection that failed or was stopped, so the coverage it holds cannot be kept.",
        ],
        [
          "unreadable",
          async () => {
            writeBaseline(fixture.rust, [fixture.head]);
            writeFileSync(recordFile, "{");
          },
          "because the record of the baseline's context, target/affected/nx-rust-context.json, is no JSON, so the coverage it holds cannot be kept.",
        ],
        [
          "of version 1",
          async () => {
            await fixture.earlierBaseline();
            const record = JSON.parse(readFileSync(recordFile, "utf8"));
            writeFileSync(
              recordFile,
              JSON.stringify({ ...record, version: 1, runtime: undefined }),
            );
          },
          "because the record of the baseline's context, target/affected/nx-rust-context.json, is of the form of version 1, which holds no runtime inputs, so the coverage it holds cannot be kept.",
        ],
        [
          "different",
          async () => {
            await fixture.earlierBaseline(fixture.env(), { cargo: { features: ["extra"] } });
          },
          "because the last collection ran in another context, so the coverage it holds cannot be kept: --features (extra at the collection, none now) differs.",
        ],
        [
          "holding an input that this collection has not",
          async () => {
            await fixture.earlierBaseline();
            const record = JSON.parse(readFileSync(recordFile, "utf8"));
            record.runtime["echo gone"] = "0".repeat(64);
            writeFileSync(recordFile, JSON.stringify(record));
          },
          "because the last collection ran in another context, so the coverage it holds cannot be kept: the last collection had the runtime input `echo gone` among its inputs, which this one has not.",
        ],
      ];
      fixture.report("hit-exact");
      for (const [name, prepare, reason] of cases) {
        rmSync(join(fixture.rust, "target"), { recursive: true, force: true });
        await prepare();
        const before = existsSync(recordFile) ? readFileSync(recordFile, "utf8") : undefined;
        const calls = fixture.stub.calls().length;
        const skipped = await fixture.collect(["--diffOnly"]);
        expect({ name, status: skipped.status }).toEqual({ name, status: 0 });
        expect(skipped.output).toContain(
          `rust:coverage-baseline: collects nothing, ${reason.replace(/\.$/, "")}, which needs a full collection`,
        );
        expect({
          name,
          record: existsSync(recordFile) ? readFileSync(recordFile, "utf8") : undefined,
        }).toEqual({ name, record: before });
        expect(fixture.exists("target/affected/coverage.db")).toBe(true);
        expect(fixture.stub.calls().length).toBe(calls);

        const full = await fixture.collect();
        expect({ name, status: full.status }).toEqual({ name, status: 0 });
        expect(full.output).toContain(
          `rust:coverage-baseline: collects the coverage of every test into an empty database with cargo affected collect, ${reason}`,
        );
        expect(
          fixture.stub
            .calls()
            .slice(calls)
            .map((args) => args[1]),
        ).toEqual(["collect"]);
        expect(fixture.stub.collections().at(-1)?.present).toEqual([]);
        expect("context" in fixture.record()).toBe(true);
      }

      // An equal record, which the last run wrote, lets --diff run.
      const equal = await fixture.collect();
      expect(equal.output).toContain(
        "cargo affected collect --diff, because the baseline holds usable data of HEAD.",
      );
      expect(fixture.stub.collections().at(-1)?.present).toEqual(["coverage.db"]);
    },
    HARNESS_TIMEOUT * 4,
  );

  for (const kind of ["full", "--diff"] as const) {
    it(
      `leaves no record after a ${kind} collection whose test fails, and the next affected run takes the full suite and says that the record is missing`,
      async () => {
        // The baseline and record of a collection without the feature; the
        // full collection with it, which the other record asks for, stores
        // coverage and then fails, and so does a --diff in the same context.
        await fixture.earlierBaseline();
        fixture.report("hit-exact");
        const env = fixture.env({ NX_RUST_STUB_COLLECT_STATUS: "100" });
        const run = await fixture.collect(kind === "full" ? ["--features=extra"] : [], env);
        expect(fixture.stub.collections()[0].args.includes("--diff")).toBe(kind === "--diff");
        expect(run.status).toBe(1);
        expect(run.output).toContain(
          "rust:coverage-baseline: cargo affected collect failed or was stopped, as its output above says, so the baseline has no record of its context",
        );
        expect(fixture.exists(contextRecordFile)).toBe(false);
        expect(fixture.exists("target/affected/coverage.db")).toBe(true);

        fixture.report("hit-exact");
        const tests = await runNx(
          fixture.workspace,
          ["run", "basics:test", "--skip-nx-cache"],
          fixture.env(),
        );
        expect(tests.status).toBe(0);
        expect(taskOutput(tests.output, "basics:test")).toContain(
          "basics:test: runs the full suite, because the baseline has no record of the context it was collected in",
        );
      },
      HARNESS_TIMEOUT * 2,
    );
  }

  it(
    "leaves no record after a collection that is stopped while it runs",
    async () => {
      await fixture.earlierBaseline();
      fixture.report("hit-exact");
      const pidFile = join(fixture.stub.folder, "collect.pid");
      const env = fixture.env({ NX_RUST_STUB_COLLECT_PID: pidFile });
      const running = runNx(fixture.workspace, ["run", "rust:coverage-baseline"], env);
      const started = Date.now();
      while (!existsSync(pidFile) || readFileSync(pidFile, "utf8") === "") {
        if (Date.now() - started > HARNESS_TIMEOUT / 2) {
          throw new Error("The stand-in's collect did not start");
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM");
      const run = await running;
      expect(run.status).toBe(1);
      expect(fixture.exists(contextRecordFile)).toBe(false);
      expect(fixture.exists(collectionLockFile)).toBe(false);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "does not start while another collection of the checkout runs, and leaves the record alone",
    async () => {
      await fixture.earlierBaseline();
      const before = readFileSync(join(fixture.rust, contextRecordFile), "utf8");
      // This test process stands for the running collection.
      writeFileSync(join(fixture.rust, collectionLockFile), `${process.pid}\n`);
      fixture.report("hit-exact");
      const run = await fixture.collect();
      expect(run.status).toBe(1);
      expect(run.output).toContain(
        `rust:coverage-baseline: another collection of the coverage baseline runs in this checkout (process ${process.pid})`,
      );
      expect(fixture.stub.calls()).toEqual([]);
      expect(readFileSync(join(fixture.rust, contextRecordFile), "utf8")).toBe(before);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs a test task's full suite where the record changes while the task runs, as a collection of the same commit in another context does",
    async () => {
      await fixture.earlierBaseline();
      fixture.report("hit-exact");
      const tests = await runNx(
        fixture.workspace,
        ["run", "basics:test", "--skip-nx-cache"],
        fixture.env({ NX_RUST_STUB_STATUS_CHANGES_RECORD: "1" }),
      );
      expect(tests.status).toBe(0);
      expect(taskOutput(tests.output, "basics:test")).toContain(
        "basics:test: runs the full suite, because the record of the baseline's context changed while the task ran",
      );
    },
    HARNESS_TIMEOUT,
  );
});

describeWithNextest("the coverage baseline target without its tools", () => {
  let fixture: BaselineFixture;

  beforeEach(() => {
    fixture = new BaselineFixture();
  });

  afterEach(() => fixture.remove());

  it(
    "fails with a message that names cargo-affected, and what to do, where it is missing",
    async () => {
      const hidden = new HiddenCargoAffected();
      try {
        const env = hidden.env(fixture.env());
        const run = await fixture.collect([], env);
        expect(run.status).toBe(1);
        expect(run.output).toContain(
          "rust:coverage-baseline: cargo-affected is not installed, but the coverage-baseline target of the Cargo workspace in rust needs it. Install it as https://github.com/max-sixty/cargo-affected describes.",
        );
      } finally {
        hidden.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails with a message that names cargo-nextest where it is missing",
    async () => {
      const hidden = new HiddenCargoAffected(["cargo-nextest"]);
      try {
        const run = await fixture.collect([], hidden.env(fixture.env()));
        expect(run.status).toBe(1);
        expect(run.output).toContain(
          "rust:coverage-baseline: cargo-nextest is not installed, but the coverage collection of the coverage-baseline target of the Cargo workspace in rust needs it. Install it as https://nexte.st/docs/installation/ describes.",
        );
        expect(fixture.stub.calls()).toEqual([]);
      } finally {
        hidden.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails with a message that names the llvm-tools component where llvm-cov and llvm-profdata are missing",
    async () => {
      // A rustc that names an empty sysroot, and a PATH without the tools.
      const folder = mkdtempSync(join(tmpdir(), "nx-rust-no-llvm-"));
      try {
        const real = execFileSync("sh", ["-c", "command -v rustc"], {
          env: testEnvironment(),
          encoding: "utf8",
        }).trim();
        mkdirSync(join(folder, "sysroot"));
        writeFileSync(
          join(folder, "rustc"),
          `#!/bin/sh\nif [ "$1" = "--print" ] && [ "$2" = "sysroot" ]; then echo ${folder}/sysroot; exit 0; fi\nexec ${real} "$@"\n`,
        );
        chmodSync(join(folder, "rustc"), 0o755);
        rmSync(join(fixture.stub.folder, "llvm-cov"));
        rmSync(join(fixture.stub.folder, "llvm-profdata"));
        const env = fixture.env();
        const path = (env.PATH ?? "")
          .split(delimiter)
          .filter(
            (entry) =>
              !existsSync(join(entry, "llvm-cov")) && !existsSync(join(entry, "llvm-profdata")),
          );
        const run = await fixture.collect([], { ...env, PATH: [folder, ...path].join(delimiter) });
        expect(run.status).toBe(1);
        expect(run.output).toContain(
          "rust:coverage-baseline: The llvm-tools component (llvm-cov and llvm-profdata) is not installed, but the coverage collection of the coverage-baseline target of the Cargo workspace in rust needs it. Install it with `rustup component add llvm-tools`",
        );
        expect(fixture.stub.calls()).toEqual([]);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    },
    HARNESS_TIMEOUT,
  );
});
