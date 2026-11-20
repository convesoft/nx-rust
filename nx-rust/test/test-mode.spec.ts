import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
  askedTestMode,
  baselineCommits,
  nxDetectsCI,
  testMode,
  testModeText,
} from "../src/executors/test-mode";
import { testModeCommand } from "../src/graph/inputs";
import {
  addCoverage,
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  loadsCompiledPlugin,
  openBaseline,
  pluginPackage,
  runNx,
  StubCargoAffected,
  taskCalls,
  taskOutput,
  testEnvironment,
  writeBaseline,
} from "./harness";

/** What a script input prints where its script cannot run or fails: the line that says so and a random value. */
const failedOutput =
  /^\n@convesoft\/nx-rust: this runtime input failed\n(( [0-9a-f]{2}){16}|[0-9a-f]{32})\n$/;

// The parts of VER-TESTING and VER-CACHE-KEYS that the test mode decides
// (DES-TEST-MODE, REQ-TEST-MODE-KEY): the rule that the mode command and the
// executor share, the reading of cargo-affected's database, the command as
// Nx runs it, and the executor's check of NX_RUST_TEST_MODE. cache-keys.spec.ts
// holds the matrix rows for the mode and the baseline. Nothing here needs
// cargo-affected: the databases are written with the schema of
// cargo-affected 0.4.1 (src/db.rs), and the runs through Nx that need
// cargo-nextest skip without it.

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const shaC = "0123456789abcdef0123456789abcdef01234567";

/** The folder's files with their size, modification time, inode and a digest of their bytes. */
function folderState(folder: string): string[] {
  return readdirSync(folder)
    .sort()
    .map((name) => {
      const file = join(folder, name);
      const stat = statSync(file);
      const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
      return `${name} ${stat.size} ${stat.mtimeMs} ${stat.ino} ${digest}`;
    });
}

/** The folder's file names. */
function fileNames(folder: string): string[] {
  return readdirSync(folder).sort();
}

/**
 * A baseline as a CI cache restores it after it was saved while a
 * collection's connection was open: `coverage.db` with its `-wal` file, and
 * with the `-shm` file where `shm` says so, in `target/affected` of
 * `workspaceRoot`; the coverage for `commit` lies in the `-wal` file only.
 */
function restoredWithWal(workspaceRoot: string, scratch: string, commit: string, shm: boolean) {
  const writer = openBaseline(scratch);
  try {
    writer.exec("PRAGMA wal_autocheckpoint=0;");
    addCoverage(writer, [commit]);
    const from = join(scratch, "target", "affected");
    const to = join(workspaceRoot, "target", "affected");
    mkdirSync(to, { recursive: true });
    for (const name of ["coverage.db", "coverage.db-wal", ...(shm ? ["coverage.db-shm"] : [])]) {
      copyFileSync(join(from, name), join(to, name));
    }
  } finally {
    writer.close();
  }
}

describe("the test mode rule", () => {
  it("detects CI as the installed Nx does", () => {
    const nx = require(
      join(dirname(require.resolve("nx/package.json")), "dist/src/utils/is-ci.js"),
    ) as { isCI(): boolean };
    const cases: NodeJS.ProcessEnv[] = [
      {},
      { CI: "true" },
      { CI: "1" },
      { CI: "false" },
      { CI: "" },
      { CI: "false", GITHUB_ACTIONS: "true" },
      { GITHUB_ACTIONS: "true" },
      { GITHUB_ACTIONS: "1" },
      { TF_BUILD: "true" },
      { BUILDKITE: "true" },
      { CIRCLECI: "true" },
      { CIRRUS_CI: "true" },
      { TRAVIS: "true" },
      { "bamboo.buildKey": "x" },
      { bamboo_buildKey: "x" },
      { CODEBUILD_BUILD_ID: "x" },
      { GITLAB_CI: "true" },
      { HEROKU_TEST_RUN_ID: "x" },
      { BUILD_ID: "1" },
      { BUILD_NUMBER: "1" },
      { BUILD_BUILDID: "1" },
      { TEAMCITY_VERSION: "1" },
      { JENKINS_URL: "http://jenkins" },
      { HUDSON_URL: "http://hudson" },
      { GITLAB_CI: "" },
    ];
    const saved = process.env;
    try {
      for (const env of cases) {
        process.env = env;
        expect([env, nxDetectsCI(env)]).toEqual([env, Boolean(nx.isCI())]);
      }
    } finally {
      process.env = saved;
    }
  });

  it("asks for affected on a developer's machine and full in CI without the variable, and for the variable's mode in both", () => {
    expect(askedTestMode({})).toMatchObject({ kind: "affected" });
    expect(askedTestMode({ CI: "false" })).toMatchObject({ kind: "affected" });
    expect(askedTestMode({ CI: "true" })).toMatchObject({ kind: "full" });
    expect(askedTestMode({ GITLAB_CI: "true" })).toMatchObject({ kind: "full" });
    for (const ci of [{}, { CI: "true" }]) {
      expect(askedTestMode({ ...ci, NX_RUST_TEST_MODE: "full" })).toMatchObject({ kind: "full" });
      expect(askedTestMode({ ...ci, NX_RUST_TEST_MODE: "affected" })).toMatchObject({
        kind: "affected",
      });
    }
    for (const value of ["", "Full", "AFFECTED", "none", " full"]) {
      expect(askedTestMode({ NX_RUST_TEST_MODE: value })).toEqual({ kind: "invalid", value });
    }
  });

  it("prints full, affected with the baseline's commits, or the invalid value", () => {
    expect(testModeText({ kind: "full", reason: "" })).toBe("full");
    expect(testModeText({ kind: "affected", commits: [shaA, shaB], reason: "" })).toBe(
      `affected:${shaA},${shaB}`,
    );
    expect(testModeText({ kind: "invalid", value: 'x"y' })).toBe(
      'invalid NX_RUST_TEST_MODE="x\\"y"',
    );
  });
});

describe("reading the coverage baseline", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-rust-test-mode-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("gives the commits of every fingerprint, sorted and once each, and changes no file", () => {
    const connection = openBaseline(root);
    addCoverage(connection, [shaB, shaA, shaB], "fp1");
    addCoverage(connection, [shaC, shaA], "fp2");
    connection.close();
    const folder = join(root, "target", "affected");
    const before = folderState(folder);
    const bytes = readFileSync(join(folder, "coverage.db"));
    expect(baselineCommits(root)).toEqual({ commits: [shaC, shaA, shaB] });
    expect(folderState(folder)).toEqual(before);
    expect(readFileSync(join(folder, "coverage.db")).equals(bytes)).toBe(true);
    expect(testMode({ NX_RUST_TEST_MODE: "affected" }, root)).toMatchObject({
      kind: "affected",
      commits: [shaC, shaA, shaB],
    });
  });

  it.each([
    ["with its -shm file", true],
    ["without a -shm file", false],
  ])(
    "gives no commits for a baseline restored with its -wal file %s, and creates or changes no file",
    (_, shm) => {
      restoredWithWal(root, join(root, "scratch"), shaA, shm);
      const folder = join(root, "target", "affected");
      const before = folderState(folder);
      expect(baselineCommits(root)).toEqual({
        problem:
          "the coverage baseline in target/affected/coverage.db has a -wal file beside it, as while a collection runs or after one was interrupted",
      });
      expect(testMode({ NX_RUST_TEST_MODE: "affected" }, root)).toMatchObject({ kind: "full" });
      expect(folderState(folder)).toEqual(before);
      expect(existsSync(join(folder, "coverage.db-shm"))).toBe(shm);
    },
  );

  describe("while another process changes the baseline between the first look and the open", () => {
    const folder = () => join(root, "target", "affected");

    it("gives the commits where nothing happens in between, and changes no file", () => {
      writeBaseline(root, [shaA]);
      const before = folderState(folder());
      const step = jest.fn();
      expect(baselineCommits(root, { beforeOpen: step })).toEqual({ commits: [shaA] });
      expect(step).toHaveBeenCalledTimes(1);
      expect(folderState(folder())).toEqual(before);
    });

    it("gives no commits where a collection opens the database in between, and creates or changes no file", () => {
      writeBaseline(root, [shaA]);
      let writer: ReturnType<typeof openBaseline> | undefined;
      let during: string[] = [];
      try {
        const read = baselineCommits(root, {
          beforeOpen: () => {
            writer = openBaseline(root);
            writer.exec("PRAGMA wal_autocheckpoint=0;");
            addCoverage(writer, [shaB]);
            during = folderState(folder());
          },
        });
        expect(read).toEqual({ problem: expect.stringMatching(/has a -wal file beside it/) });
        expect(during.map((entry) => entry.split(" ")[0])).toEqual([
          "coverage.db",
          "coverage.db-shm",
          "coverage.db-wal",
        ]);
        // Everything as the collection left it: the reader wrote nothing.
        expect(folderState(folder())).toEqual(during);
      } finally {
        writer?.close();
      }
    });

    it("gives no commits where a collection is open at the first look, and leaves no -wal or -shm file once it closes", () => {
      const writer = openBaseline(root);
      const step = jest.fn();
      let read;
      let before: string[];
      try {
        writer.exec("PRAGMA wal_autocheckpoint=0;");
        addCoverage(writer, [shaA]);
        before = folderState(folder());
        read = baselineCommits(root, { beforeOpen: step });
        expect(folderState(folder())).toEqual(before);
      } finally {
        writer.close();
      }
      expect(read).toEqual({ problem: expect.stringMatching(/has a -wal file beside it/) });
      expect(step).not.toHaveBeenCalled();
      // The collection's close removed its -wal and -shm files, and the
      // reader left none behind.
      expect(fileNames(folder())).toEqual(["coverage.db"]);
      expect(baselineCommits(root)).toEqual({ commits: [shaA] });
    });

    it("gives no commits where the database is replaced in between, and changes no file", () => {
      writeBaseline(root, [shaA]);
      const other = join(root, "other");
      writeBaseline(other, [shaB]);
      let during: string[] = [];
      const read = baselineCommits(root, {
        beforeOpen: () => {
          renameSync(join(other, "target/affected/coverage.db"), join(folder(), "coverage.db"));
          during = folderState(folder());
        },
      });
      expect(read).toEqual({ problem: expect.stringMatching(/changed while it was read/) });
      expect(folderState(folder())).toEqual(during);
    });
  });

  it("gives no commits, with the reason, where there is no baseline or it cannot be read", () => {
    const problem = () => {
      const read = baselineCommits(root);
      expect(read).not.toHaveProperty("commits");
      return (read as { problem: string }).problem;
    };
    expect(problem()).toMatch(/there is no coverage baseline: target\/affected\/coverage\.db/);

    // A database without coverage.
    writeBaseline(root, []);
    expect(problem()).toMatch(/holds no coverage/);

    // A commit that is no object name.
    writeBaseline(root, ["HEAD,other"]);
    expect(problem()).toMatch(/no hexadecimal object name/);

    // Another schema, as an older cargo-affected's without collect_sha.
    const file = join(root, "target/affected/coverage.db");
    rmSync(file);
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE test_files (test_name TEXT, source_file TEXT, env_fingerprint TEXT)");
    old.close();
    expect(problem()).toMatch(/could not be read/);

    // A file that is no database.
    writeFileSync(file, "not a database\n".repeat(100));
    expect(problem()).toMatch(/could not be read/);

    // A folder in its place.
    rmSync(file);
    mkdirSync(file);
    expect(problem()).toMatch(/there is no coverage baseline/);
  });

  it("is full, with the reason, where affected is asked without a usable baseline", () => {
    expect(testMode({ NX_RUST_TEST_MODE: "affected" }, root)).toEqual({
      kind: "full",
      reason:
        'NX_RUST_TEST_MODE is "affected", but there is no coverage baseline: target/affected/coverage.db does not exist',
    });
    writeBaseline(root, [shaA]);
    expect(testMode({ NX_RUST_TEST_MODE: "full" }, root)).toEqual({
      kind: "full",
      reason: 'NX_RUST_TEST_MODE is "full"',
    });
    expect(testMode({ CI: "true" }, root)).toMatchObject({ kind: "full" });
    expect(testMode({}, root)).toMatchObject({ kind: "affected", commits: [shaA] });
  });
});

const describeCompiled = loadsCompiledPlugin() ? describe : describe.skip;

describeCompiled("the mode command", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-rust-mode-command-"));
    mkdirSync(join(root, "repo/rust"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** What the command prints in the repository root, as Nx runs it, with `env`. */
  function evaluate(env: Record<string, string | undefined>, script?: string): string {
    const command = testModeCommand(
      "rust",
      script ?? join(pluginPackage(), "src/executors/print-test-mode.js"),
    );
    const run = spawnSync("sh", ["-c", command], {
      cwd: join(root, "repo"),
      env: testEnvironment(env),
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    return run.stdout;
  }

  it("prints the mode by the rule, in CI and elsewhere", () => {
    const workspace = join(root, "repo/rust");
    expect(evaluate({})).toBe("full\n");
    expect(evaluate({ NX_RUST_TEST_MODE: "affected" })).toBe("full\n");
    writeBaseline(workspace, [shaB, shaA]);
    const affected = `affected:${shaA},${shaB}\n`;
    expect(evaluate({ CI: "false" })).toBe(affected);
    expect(evaluate({ CI: "true" })).toBe("full\n");
    expect(evaluate({ CI: undefined, GITHUB_ACTIONS: "true" })).toBe("full\n");
    for (const ci of ["false", "true"]) {
      expect(evaluate({ CI: ci, NX_RUST_TEST_MODE: "full" })).toBe("full\n");
      expect(evaluate({ CI: ci, NX_RUST_TEST_MODE: "affected" })).toBe(affected);
    }
    expect(evaluate({ NX_RUST_TEST_MODE: "sometimes" })).toBe(
      'invalid NX_RUST_TEST_MODE="sometimes"\n',
    );
  });

  it.each([
    ["with its -shm file", true],
    ["without a -shm file", false],
  ])(
    "prints full for a baseline restored with its -wal file %s, and creates or changes no file",
    (_, shm) => {
      restoredWithWal(join(root, "repo/rust"), join(root, "scratch"), shaA, shm);
      const folder = join(root, "repo/rust/target/affected");
      const before = folderState(folder);
      expect(evaluate({ NX_RUST_TEST_MODE: "affected" })).toBe("full\n");
      expect(folderState(folder)).toEqual(before);
      expect(existsSync(join(folder, "coverage.db-shm"))).toBe(shm);
    },
  );

  it("prints the commits of a closed baseline and leaves nothing behind", () => {
    writeBaseline(join(root, "repo/rust"), [shaA]);
    const folder = join(root, "repo/rust/target/affected");
    const before = folderState(folder);
    expect(evaluate({ NX_RUST_TEST_MODE: "affected" })).toBe(`affected:${shaA}\n`);
    expect(folderState(folder)).toEqual(before);
  });

  it("starts neither cargo, cargo-affected nor git", () => {
    writeBaseline(join(root, "repo/rust"), [shaA]);
    const bin = join(root, "bin");
    mkdirSync(bin);
    const log = join(root, "started.log");
    for (const program of ["cargo", "cargo-affected", "git", "rustc", "rustup", "sqlite3"]) {
      writeFileSync(join(bin, program), `#!/bin/sh\necho ${program} >> '${log}'\nexit 1\n`);
      chmodSync(join(bin, program), 0o755);
    }
    const path = `${bin}${delimiter}${testEnvironment().PATH ?? ""}`;
    expect(evaluate({ PATH: path, CI: "false" })).toBe(`affected:${shaA}\n`);
    expect(existsSync(log)).toBe(false);
  });

  it("prints a new random value each time where the script cannot run", () => {
    const missing = join(root, "missing/print-test-mode.js");
    const first = evaluate({}, missing);
    expect(first).toMatch(failedOutput);
    expect(evaluate({}, missing)).not.toBe(first);
  });
});

/** The workspace table that chooses nextest and the selection of affected tests. */
const selecting: FileChanges = {
  "rust/Cargo.toml": (manifest) =>
    `${manifest}\n[workspace.metadata.nx]\ntestRunner = "nextest"\naffectedTests = true\n`,
};

describe("NX_RUST_TEST_MODE in a run", () => {
  it(
    "fails a test task with another value before cargo runs, alone and in a batch, where the workspace selects",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", selecting);
      try {
        const env = workspace.cargo.environment(
          testEnvironment({ NX_RUST_TEST_MODE: "sometimes" }),
        );
        const message =
          'a:test: NX_RUST_TEST_MODE is "sometimes", but it can only be "full", which runs the whole suite, or "affected"';
        workspace.cargo.clear();
        const alone = await runNx(
          workspace,
          ["run", "a:test", "--batch=false", "--skip-nx-cache"],
          env,
        );
        expect(alone.status).toBe(1);
        expect(alone.output).toContain(message);
        expect(taskCalls(workspace)).toEqual([]);

        workspace.cargo.clear();
        const batch = await runNx(
          workspace,
          ["run-many", "-t", "test", "-p", "a,b", "--skip-nx-cache"],
          env,
        );
        expect(batch.status).toBe(1);
        expect(taskOutput(batch.output, "a:test")).toContain(message);
        expect(taskOutput(batch.output, "b:test")).toContain(
          'b:test: NX_RUST_TEST_MODE is "sometimes"',
        );
        expect(taskCalls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "changes nothing where the workspace does not select",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests");
      try {
        const env = workspace.cargo.environment(
          testEnvironment({ NX_RUST_TEST_MODE: "sometimes" }),
        );
        const run = await runNx(workspace, ["run", "a:test", "--batch=false"], env);
        expect(run.status).toBe(0);
        expect(run.output).not.toMatch(/test mode|NX_RUST_TEST_MODE/);
        expect(taskCalls(workspace).length).toBeGreaterThan(0);
      } finally {
        workspace.remove();
      }
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
    "test modes in runs through Nx: cargo-nextest is not installed where cargo looks for it (PATH or the Cargo home), so these checks are skipped; install it as https://nexte.st/docs/installation/ describes to run them",
  );
}
const describeWithNextest = withNextest ? describe : describe.skip;

describeWithNextest("test modes through Nx", () => {
  it(
    "says which suite runs and why, and restores a result only for the same mode and baseline",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", selecting);
      // A stand-in for cargo-affected, which a run in affected mode needs; its
      // baseline has no record of its context, so the full suite runs.
      const stub = new StubCargoAffected();
      try {
        const env = (mode?: string) => {
          const base = testEnvironment({ NX_RUST_TEST_MODE: mode });
          return workspace.cargo.environment({
            ...base,
            PATH: [stub.folder, base.PATH].filter(Boolean).join(delimiter),
          });
        };
        const rust = join(workspace.root, "rust");
        /** Runs `a:test` and says whether cargo ran, with the task's output. */
        const run = async (mode?: string) => {
          workspace.cargo.clear();
          const result = await runNx(workspace, ["run", "a:test"], env(mode));
          expect(result.status).toBe(0);
          return { ran: taskCalls(workspace).length > 0, output: result.output };
        };

        // Affected without a baseline runs the full suite under the full key.
        const fallback = await run("affected");
        expect(fallback.ran).toBe(true);
        expect(fallback.output).toContain(
          'a:test: runs the full suite in test mode full, because NX_RUST_TEST_MODE is "affected", but there is no coverage baseline: target/affected/coverage.db does not exist.',
        );
        expect(await run("full")).toMatchObject({ ran: false });

        // A result in affected mode serves neither the full mode nor another baseline.
        writeBaseline(rust, [shaA]);
        const affected = await run(undefined);
        expect(affected.ran).toBe(true);
        expect(affected.output).toContain(
          `a:test: test mode affected:${shaA}, because NX_RUST_TEST_MODE is not set and Nx detects no CI.`,
        );
        expect(affected.output).toContain(
          "a:test: runs the full suite, because the baseline has no record of the context it was collected in",
        );
        expect(await run("affected")).toMatchObject({ ran: false });
        rmSync(join(rust, "target/affected/coverage.db"));
        writeBaseline(rust, [shaB]);
        expect(await run("affected")).toMatchObject({ ran: true });
        rmSync(join(rust, "target/affected/coverage.db"));
        writeBaseline(rust, [shaA]);
        expect(await run("affected")).toMatchObject({ ran: false });

        // The full mode's result is restored for the full mode, with the
        // output of the run that stored it.
        const full = await run("full");
        expect(full.ran).toBe(false);
        expect(full.output).toContain("but there is no coverage baseline");
        workspace.cargo.clear();
        const fresh = await runNx(workspace, ["run", "a:test", "--skip-nx-cache"], env("full"));
        expect(fresh.status).toBe(0);
        expect(fresh.output).toContain(
          'a:test: runs the full suite in test mode full, because NX_RUST_TEST_MODE is "full".',
        );

        // --affectedTests=false runs the full suite under a key of its own.
        workspace.cargo.clear();
        const optedOut = await runNx(
          workspace,
          ["run", "a:test", "--affectedTests=false"],
          env("affected"),
        );
        expect(optedOut.status).toBe(0);
        expect(taskCalls(workspace).length).toBeGreaterThan(0);
        expect(optedOut.output).toContain(
          `a:test: runs the full suite, because its option affectedTests is false; the test mode is affected:${shaA}.`,
        );
      } finally {
        stub.remove();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
