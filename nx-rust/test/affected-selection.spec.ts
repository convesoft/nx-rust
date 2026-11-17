import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  affectedStatusArguments,
  collectionsProblem,
  type CrateSelection,
  diffRelativeVariables,
  filtersetEscape,
  gitChangedFiles,
  gitIgnored,
  parseRawDiff,
  readAffectedReport,
  selectionFiltersets,
  usableCollections,
  type WideningContext,
  type WideningMember,
  widenSelection,
} from "../src/executors/affected";
import { unreportedFiles } from "../src/executors/affected-run";
import {
  type BaselineContext,
  contextDifferences,
  contextRuntimeCommands,
  contextVariables,
  environmentContext,
  readContextRecord,
  runtimeContext,
  writeContextRecord,
} from "../src/executors/baseline-context";
import { selectionLine } from "../src/executors/group-run";
import {
  hashedModeProblem,
  printedTestMode,
  recordSubset,
  testModeRecordFolder,
} from "../src/executors/test-mode";
import { commitAll, gitIn, initGitRepository, writeBaseline } from "./harness";

// The rules of steps 1 to 3 of DES-TEST-RUN and the guard of DES-TEST-MODE
// between hashing and the run, as functions of their inputs: the reports are
// ones that cargo-affected 0.4.1 wrote (data/cargo-affected-reports.json, from
// the experiments of nxr-tabkjx), git runs in throwaway repositories, and no
// other tool is needed.

const reports = JSON.parse(
  readFileSync(join(__dirname, "data", "cargo-affected-reports.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

describe("reading cargo-affected's report", () => {
  it("reads the selection, the changed files and the collections of a real report", () => {
    const read = readAffectedReport({ code: 0 }, JSON.stringify(reports["hit-exact"]), "");
    expect(read).toEqual({
      report: {
        collectShas: [{ sha: "4d7f4fe350914a22a12c549f135a0742db1885b7", relation: "equal" }],
        changedFiles: [
          { path: "core/src/lib.rs", trackedByCoverage: true },
          { path: "Cargo.lock", trackedByCoverage: false },
        ],
        selected: [
          { binary: "app", name: "tests::q" },
          { binary: "app::it", name: "it_triple" },
          { binary: "core-x", name: "tests::d" },
          { binary: "core-x", name: "tests::t" },
        ],
      },
    });
    const divergent = readAffectedReport(
      { code: 0 },
      JSON.stringify(reports["hit-with-divergence"]),
      "",
    );
    expect("report" in divergent && usableCollections(divergent.report)).toEqual([
      "4d7f4fe350914a22a12c549f135a0742db1885b7",
    ]);
  });

  it("refuses a report unless cargo-affected exited with 0 and the report has schema 1, a hit and a list of tests", () => {
    const report = reports["hit-exact"];
    const problem = (exit: { code: number | null; failure?: string }, value: unknown) =>
      (
        readAffectedReport(
          exit,
          value === undefined ? undefined : JSON.stringify(value),
          "error: could not compile `app`\n",
        ) as { problem?: string }
      ).problem;

    expect(problem({ code: 1 }, report)).toBe(
      "cargo affected status exited with status 1 (error: could not compile `app`)",
    );
    expect(problem({ code: null, failure: "spawn cargo ENOENT" }, report)).toBe(
      "cargo affected status could not run: spawn cargo ENOENT",
    );
    expect(problem({ code: 0 }, undefined)).toBe("cargo affected status wrote no report");
    expect(problem({ code: 0 }, { ...report, schema_version: 2 })).toBe(
      "cargo-affected's report has the schema_version 2, and this version of @convesoft/nx-rust reads only 1",
    );
    for (const status of [
      "miss-no-coverage",
      "miss-no-reachable-sha",
      "forced-all",
      "something-new",
    ]) {
      expect(
        problem({ code: 0 }, { ...report, cache: { ...(report.cache as object), status } }),
      ).toBe(`cargo-affected cannot select with the baseline: its cache status is ${status}`);
    }
    expect(
      problem(
        { code: 0 },
        {
          ...report,
          cache: {
            ...(report.cache as object),
            status: "miss-fingerprint",
            stored_fingerprints: [
              { differing_labels: ["manifest:crates/globset/Cargo.toml", "RUSTFLAGS"] },
            ],
          },
        },
      ),
    ).toBe(
      "cargo-affected cannot select with the baseline: its cache status is miss-fingerprint, which differs from the baseline's in manifest:crates/globset/Cargo.toml and RUSTFLAGS",
    );
    expect(
      problem(
        { code: 0 },
        { ...report, selection: { ...(report.selection as object), selected_tests: null } },
      ),
    ).toBe("cargo-affected's report holds no list of selected tests");
  });

  it("asks status with the arguments of the nextest run and git's diff.relative after the variables already set", () => {
    expect(
      affectedStatusArguments(
        [
          "nextest",
          "run",
          "--workspace",
          "--no-fail-fast",
          "--no-tests=pass",
          "-E",
          "package(=a)",
          "--features",
          "x",
          "--locked",
        ],
        "/tmp/report.json",
      ),
    ).toEqual([
      "affected",
      "status",
      "--report-json",
      "/tmp/report.json",
      "--report-detail",
      "full",
      "--",
      "--workspace",
      "-E",
      "package(=a)",
      "--features",
      "x",
      "--locked",
    ]);
    expect(diffRelativeVariables({})).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "diff.relative",
      GIT_CONFIG_VALUE_0: "true",
    });
    expect(diffRelativeVariables({ GIT_CONFIG_COUNT: "2" })).toEqual({
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_2: "diff.relative",
      GIT_CONFIG_VALUE_2: "true",
    });
  });

  it("counts a report that rests on a collection the baseline did not hold as changed meanwhile", () => {
    const report = {
      collectShas: [{ sha: "a".repeat(40), relation: "equal" }],
      changedFiles: [],
      selected: [],
    };
    expect(collectionsProblem(report, ["a".repeat(40)])).toBeUndefined();
    expect(collectionsProblem(report, ["b".repeat(40)])).toContain(
      `rests on the collection ${"a".repeat(40)}, which the baseline did not hold when the task started`,
    );
  });

  it("needs every changed file of the workspace folder in the report, apart from .profraw files", () => {
    const report = {
      collectShas: [],
      changedFiles: [{ path: "crates/a/src/lib.rs", trackedByCoverage: true }],
      selected: [],
    };
    expect(
      unreportedFiles(
        report,
        [
          "rust/crates/a/src/lib.rs",
          "rust/default_1.profraw",
          "README.md",
          "rust/crates/a/data.txt",
        ],
        "rust",
      ),
    ).toEqual(["crates/a/data.txt"]);
  });
});

describe("widening the selection (step 2)", () => {
  const member = (name: string, extra: Partial<WideningMember> = {}): WideningMember => ({
    name,
    folder: `rust/crates/${name}`,
    procMacro: false,
    buildScript: [],
    hasBinary: false,
    dependsOn: [],
    ...extra,
  });
  const members = [
    member("core", { buildScript: ["rust/crates/core/build.rs"] }),
    member("gen", { buildScript: ["rust/crates/gen/build/main.rs", "rust/crates/gen/build"] }),
    member("pm", { procMacro: true }),
    member("app", { dependsOn: ["core", "pm"] }),
    member("cli", { hasBinary: true, dependsOn: ["core"] }),
    member("user", { dependsOn: ["cli"] }),
  ];
  // Which crates' test inputs hold a file: its crate and the crates that
  // depend on it, as `^` gives them.
  const dependents: Record<string, string[]> = {
    core: ["core", "app", "cli", "user"],
    gen: ["gen"],
    pm: ["pm", "app"],
    app: ["app"],
    cli: ["cli", "user"],
    user: ["user"],
  };
  const context = (overrides: Partial<WideningContext> = {}): WideningContext => ({
    workspaceFolder: "rust",
    members,
    crates: ["core", "gen", "pm", "app", "cli", "user"].map((name) => ({ name, optedOut: false })),
    owners(path) {
      if (path === "rust/rust-toolchain.toml") {
        return ["core", "gen", "pm", "app", "cli", "user"];
      }
      if (path === "shared/schema.sql") {
        return ["app"];
      }
      const crate = /^rust\/crates\/([^/]+)\//.exec(path)?.[1];
      return crate === undefined ? [] : (dependents[crate] ?? []);
    },
    holdsFileBelow: () => false,
    declared: (path) => path === "rust/crates/app/src/schema.rs",
    ...overrides,
  });
  const report = (
    changed: { path: string; tracked: boolean }[],
    selected: [string, string][] = [],
  ) => ({
    collectShas: [],
    changedFiles: changed.map(({ path, tracked }) => ({ path, trackedByCoverage: tracked })),
    selected: selected.map(([binary, name]) => ({ binary, name })),
  });
  /** What each crate runs, as `all`, its tests, or `integration` and its tests. */
  const summary = (result: ReturnType<typeof widenSelection>) =>
    result.kind === "full"
      ? result.reason
      : Object.fromEntries(
          [...result.crates].map(([name, selection]) => [
            name,
            selection.kind === "all"
              ? "all"
              : [
                  ...(selection.integration === undefined ? [] : ["integration"]),
                  ...[...selection.tests].flatMap(([binary, tests]) =>
                    [...tests].map((test) => `${binary} ${test}`),
                  ),
                ],
          ]),
        );

  it("narrows a Rust file with coverage rows to the selected tests of the group's crates", () => {
    const result = widenSelection(
      report(
        [{ path: "crates/core/src/util.rs", tracked: true }],
        [
          ["core", "tests::a"],
          ["app::it", "uses_core"],
          ["elsewhere", "tests::b"],
        ],
      ),
      ["rust/crates/core/src/util.rs"],
      context(),
    );
    expect(summary(result)).toEqual({
      core: ["core tests::a"],
      app: ["app::it uses_core"],
      cli: ["integration"],
      user: "all",
    });
  });

  it("widens build scripts, proc-macro source, declared files, non-Rust files, files without rows and files outside the workspace folder", () => {
    const widen = (path: string, tracked = true) =>
      summary(
        widenSelection(
          report(path.startsWith("rust/") ? [{ path: path.slice(5), tracked }] : []),
          [path],
          context(),
        ),
      );
    expect(widen("rust/crates/core/build.rs")).toEqual({
      core: "all",
      app: "all",
      cli: "all",
      user: "all",
    });
    expect(widen("rust/crates/gen/build/helpers.rs")).toEqual({ gen: "all" });
    expect(widen("rust/crates/pm/src/lib.rs")).toEqual({ pm: "all", app: "all" });
    expect(widen("rust/crates/app/src/schema.rs")).toEqual({ app: "all" });
    expect(widen("rust/crates/app/tests/data.json")).toEqual({ app: "all" });
    expect(widen("rust/crates/app/src/new.rs", false)).toEqual({ app: "all" });
    expect(widen("shared/schema.sql")).toEqual({ app: "all" });
    expect(widen("rust/rust-toolchain.toml")).toEqual({
      core: "all",
      gen: "all",
      pm: "all",
      app: "all",
      cli: "all",
      user: "all",
    });
    // A file that is an input of no crate adds nothing.
    expect(widen("docs/notes.md")).toEqual({});
  });

  it("runs the full suite for a file that the plugin cannot place", () => {
    expect(
      widenSelection(report([]), ["rust/crates/app/old.txt"], context({ owners: () => undefined })),
    ).toEqual({
      kind: "full",
      reason:
        "@convesoft/nx-rust cannot tell which crates' test inputs hold the changed file rust/crates/app/old.txt",
    });
  });

  it("runs the integration tests of a binary's crate and every test of its dependents, also by a declared input", () => {
    const result = widenSelection(
      report([{ path: "crates/cli/src/main.rs", tracked: true }], [["cli::bin/cli", "tests::x"]]),
      ["rust/crates/cli/src/main.rs"],
      context({
        holdsFileBelow: (crate, folder) => crate === "app" && folder === "rust/crates/cli",
      }),
    );
    expect(summary(result)).toEqual({
      cli: ["integration", "cli::bin/cli tests::x"],
      user: "all",
      app: "all",
    });
  });

  it("runs every test of a crate that opts out, and keeps only the group's crates", () => {
    const result = widenSelection(
      report([{ path: "crates/core/src/util.rs", tracked: true }], [["core", "tests::a"]]),
      ["rust/crates/core/src/util.rs"],
      context({
        crates: [
          { name: "core", optedOut: false },
          { name: "pm", optedOut: true },
        ],
      }),
    );
    expect(summary(result)).toEqual({ pm: "all", core: ["core tests::a"] });
  });
});

describe("the selection's -E arguments (step 3)", () => {
  const some = (tests: Record<string, string[]>, integration?: string): CrateSelection => ({
    kind: "some",
    tests: new Map(Object.entries(tests).map(([binary, names]) => [binary, new Set(names)])),
    ...(integration === undefined ? {} : { integration }),
  });

  it("intersects each part with its crates and escapes what the equality matcher needs escaped", () => {
    expect(filtersetEscape("a\\b/c)d,e")).toBe("a\\\\b\\/c\\)d\\,e");
    expect(
      selectionFiltersets(
        new Map<string, CrateSelection>([
          ["rg", some({ "rg::bin/rg": ["t(1)", "t,2"] })],
          ["cli", some({}, "its binary changed")],
          ["old", { kind: "all", reasons: ["opted out"] }],
        ]),
      ),
    ).toEqual([
      "-E",
      "(package(=cli) | package(=old) | package(=rg)) & ((package(=cli) & kind(test)) | (package(=old)) | (binary_id(=rg::bin\\/rg) & (test(=t(1\\)) | test(=t\\,2))))",
    ]);
    expect(selectionFiltersets(new Map([["a", some({})]]))).toEqual([]);
  });

  it("keeps each argument within 64 KiB and names whole binaries above 512 KiB", () => {
    const names = (count: number) =>
      Array.from({ length: count }, (_, index) => `module::a_test_with_a_long_name_${index}`);
    const large = selectionFiltersets(new Map([["a", some({ a: names(3000) })]]));
    const args = large.filter((_, index) => index % 2 === 1);
    expect(args.length).toBeGreaterThan(1);
    expect(args.every((arg) => Buffer.byteLength(arg) <= 64 * 1024)).toBe(true);
    expect(args.join("").match(/test\(=/g)).toHaveLength(3000);

    const huge = selectionFiltersets(
      new Map([["a", some({ a: names(20000), "a::it": names(2) })]]),
    );
    expect(huge).toEqual(["-E", "(package(=a)) & ((binary_id(=a)) | (binary_id(=a::it)))"]);
  });

  it("says what a crate runs and why", () => {
    expect(selectionLine("a:test", "a", undefined, "abc")).toContain(
      "a:test: no test of a is selected: the coverage baseline abc shows no test of a that runs the changed code",
    );
    expect(selectionLine("a:test", "a", some({ a: ["x", "y"] }, "its binary changed"), "abc")).toBe(
      "a:test: runs a subset of its tests for this change: 2 tests of a that cargo-affected selected against the coverage baseline abc, and every integration test of a, because its binary changed. This result stands for affected mode only, never for the full suite.",
    );
  });
});

describe("the record of a baseline's context", () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "nx-rust-context-"));
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  const context = (overrides: Partial<BaselineContext> = {}): BaselineContext => ({
    version: 2,
    cargo: {
      features: [],
      allFeatures: false,
      noDefaultFeatures: false,
      profile: null,
      target: null,
    },
    triple: "host x86_64-unknown-linux-gnu",
    env: { RUSTFLAGS: null },
    runtime: {},
    ...overrides,
  });

  it("is missing until a collection writes it, and reads back what was written", () => {
    expect(readContextRecord(folder)).toEqual({
      problem:
        "the baseline has no record of the context it was collected in (target/affected/nx-rust-context.json), which the collection target writes after a successful collection",
    });
    writeContextRecord(folder, context());
    expect(readContextRecord(folder)).toEqual({ context: context() });
    writeFileSync(join(folder, "target", "affected", "nx-rust-context.json"), '{"version":2}');
    expect(readContextRecord(folder)).toHaveProperty("problem");
    // A record of the first form holds no runtime inputs.
    writeFileSync(
      join(folder, "target", "affected", "nx-rust-context.json"),
      JSON.stringify({ ...context(), version: 1, runtime: undefined }),
    );
    expect(readContextRecord(folder)).toEqual({
      problem:
        "the record of the baseline's context, target/affected/nx-rust-context.json, is of the form of version 1, which holds no runtime inputs; collect the baseline again",
    });
  });

  it("compares the output of every runtime input but the test mode's, as Nx runs them", () => {
    const data = join(folder, "data.txt");
    writeFileSync(data, "good\n");
    const testMode = `{ '/usr/bin/node' '/plugin/src/executors/print-test-mode.js' 'rust' 2>/dev/null || od -An -N16 -tx1 /dev/urandom; }; true`;
    const commands = contextRuntimeCommands([`cat ${data}`, testMode, `cat ${data}`]);
    expect(commands).toEqual([`cat ${data}`]);
    const collected = runtimeContext(commands, folder, process.env);
    expect(collected).toEqual({
      runtime: { [`cat ${data}`]: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    const record = context({ runtime: (collected as { runtime: Record<string, string> }).runtime });
    // The same output: no difference, so the group selects.
    const same = runtimeContext(commands, folder, process.env) as {
      runtime: Record<string, string>;
    };
    expect(contextDifferences(record, context({ runtime: same.runtime }))).toEqual([]);
    // Another output, or a command that the record does not hold, differs.
    writeFileSync(data, "bad\n");
    const changed = runtimeContext(commands, folder, process.env) as {
      runtime: Record<string, string>;
    };
    expect(contextDifferences(record, context({ runtime: changed.runtime }))).toEqual([
      `the output of the runtime input \`cat ${data}\``,
    ]);
    expect(
      contextDifferences(context(), context({ runtime: { "echo new": "b".repeat(64) } })),
    ).toEqual(["the output of the runtime input `echo new`"]);
    // A command that fails cannot be compared.
    expect(runtimeContext(["exit 3"], folder, process.env)).toEqual({
      problem:
        "the runtime input `exit 3` exited with status 3, so the plugin cannot compare it with the baseline's",
    });
  });

  it("names each option and variable that differs, an unset variable being a value of its own", () => {
    const env = environmentContext(
      contextVariables(["APP_MODE", "NX_RUST_RUN_ID"], {
        APP_MODE: "a",
        NEXTEST_RETRIES: "2",
        CARGO_TARGET_DIR: "/t",
      }),
      {
        APP_MODE: "a",
        NEXTEST_RETRIES: "2",
        CARGO_TARGET_DIR: "/t",
      },
    );
    expect(Object.keys(env)).toEqual(["APP_MODE", "NEXTEST_RETRIES"]);
    expect(Object.values(env).every((value) => /^[0-9a-f]{64}$/.test(value ?? ""))).toBe(true);
    const collected = context({ cargo: { ...context().cargo, features: ["extra"] }, env });
    expect(contextDifferences(collected, collected)).toEqual([]);
    expect(
      contextDifferences(
        collected,
        context({
          triple: "host aarch64-apple-darwin",
          env: { APP_MODE: null },
        }),
      ),
    ).toEqual([
      "--features (extra at the collection, none now)",
      "the target triple (host x86_64-unknown-linux-gnu at the collection, host aarch64-apple-darwin now)",
      "the variables APP_MODE and NEXTEST_RETRIES",
    ]);
    // A variable that the group hashes and the record does not hold differs.
    expect(contextDifferences(context({ env: {} }), context({ env: { APP_MODE: null } }))).toEqual([
      "the variable APP_MODE",
    ]);
  });
});

describe("the changed files as git names them", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-rust-git-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  it("unites the changes against every collection with the untracked files, both paths of a rename and deletions", () => {
    write("rust/a.rs", "a\n");
    write("rust/b.txt", "b\n");
    write("rust/c.rs", "c\n");
    write(".gitignore", "ignored/\n");
    const older = initGitRepository(root);
    write("rust/a.rs", "a2\n");
    const newer = commitAll(root, "a later commit");
    gitIn(root, ["mv", "rust/b.txt", "rust/b2.txt"]);
    rmSync(join(root, "rust/c.rs"));
    write("rust/new.rs", "untracked\n");
    write("ignored/file.txt", "ignored\n");

    const changed = gitChangedFiles(join(root, "rust"), root, [older, newer], process.env);
    expect(changed).toEqual({
      top: expect.any(String),
      files: ["rust/a.rs", "rust/b.txt", "rust/b2.txt", "rust/c.rs", "rust/new.rs"],
    });
    // Against the newer collection alone, the earlier commit is not seen.
    expect(
      (gitChangedFiles(join(root, "rust"), root, [newer], process.env) as { files: string[] })
        .files,
    ).not.toContain("rust/a.rs");
    // Nx's workspace may lie below the top of the git repository.
    expect(
      (
        gitChangedFiles(join(root, "rust"), join(root, "rust"), [older], process.env) as {
          files: string[];
        }
      ).files,
    ).toContain("a.rs");
    expect(gitIgnored(root, ["ignored/file.txt", "rust/a.rs"], process.env)).toEqual([
      "ignored/file.txt",
    ]);
  });

  it("reads a submodule from git's raw output", () => {
    expect(
      parseRawDiff(":160000 160000 abc def M\0vendor/sub\0:100644 100644 abc def M\0a.rs\0"),
    ).toEqual([
      { path: "vendor/sub", submodule: true },
      { path: "a.rs", submodule: false },
    ]);
  });
});

describe("the test mode between hashing and the run", () => {
  let root: string;
  const commitA = "a".repeat(40);
  const commitB = "b".repeat(40);
  const env = { NX_RUST_TEST_MODE: "affected", NX_RUST_COMMAND_ID: "cmd1-1234" };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-rust-hashed-"));
    mkdirSync(join(root, "rust"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("lets a task select only where every hash of the command printed the mode that the executor reads", () => {
    writeBaseline(join(root, "rust"), [commitA]);
    expect(printedTestMode(env, root, "rust")).toBe(`affected:${commitA}`);
    expect(hashedModeProblem(env, root, "rust", `affected:${commitA}`)).toBeUndefined();
  });

  it("refuses a selection where the baseline appeared after hashing", () => {
    expect(printedTestMode(env, root, "rust")).toBe("full");
    writeBaseline(join(root, "rust"), [commitA]);
    expect(hashedModeProblem(env, root, "rust", `affected:${commitA}`)).toBe(
      `the tasks of this workspace in this nx command were hashed in different test modes: Nx hashed one with full, while the baseline now gives affected:${commitA} to this task, as where the tasks' environments ask for different modes or a collection created or changed the baseline after hashing, and a subset must not be stored under a key that may say otherwise`,
    );
  });

  it("refuses a selection where the baseline changed after hashing", () => {
    writeBaseline(join(root, "rust"), [commitA]);
    printedTestMode(env, root, "rust");
    rmSync(join(root, "rust", "target"), { recursive: true });
    writeBaseline(join(root, "rust"), [commitB]);
    expect(hashedModeProblem(env, root, "rust", `affected:${commitB}`)).toContain(
      `Nx hashed one with affected:${commitA}, while the baseline now gives affected:${commitB} to this task`,
    );
  });

  it("refuses a selection without the plugin's command id or without a recorded hash", () => {
    writeBaseline(join(root, "rust"), [commitA]);
    expect(
      hashedModeProblem({ NX_RUST_TEST_MODE: "affected" }, root, "rust", `affected:${commitA}`),
    ).toContain("this run has no command id from the preTasksExecution hook");
    expect(hashedModeProblem(env, root, "rust", `affected:${commitA}`)).toContain(
      "the mode command recorded no test mode for this nx command",
    );
    printedTestMode(env, root, "rust");
    printedTestMode(env, root, "rust");
    expect(hashedModeProblem(env, root, "rust", `affected:${commitA}`)).toBeUndefined();
    // Another command's record does not count.
    expect(
      hashedModeProblem(
        { ...env, NX_RUST_COMMAND_ID: "cmd2-1" },
        root,
        "rust",
        `affected:${commitA}`,
      ),
    ).toContain("recorded no test mode");
  });

  it("lets no other task's evaluation stand in for a task that Nx hashed in mode full", () => {
    // The review's sequence: in one command, crate A is hashed in mode full,
    // as its dotenv file asks, and crate B in mode affected; then A's file
    // asks for affected before the batch rebuilds A's environment. B's
    // evaluation must not satisfy A's check.
    writeBaseline(join(root, "rust"), [commitA]);
    const asA = { ...env, NX_RUST_TEST_MODE: "full" };
    expect(printedTestMode(asA, root, "rust")).toBe("full");
    expect(printedTestMode(env, root, "rust")).toBe(`affected:${commitA}`);
    const problem = hashedModeProblem(env, root, "rust", `affected:${commitA}`);
    expect(problem).toContain(
      `the tasks of this workspace in this nx command were hashed in different test modes: Nx hashed one with full, while the baseline now gives affected:${commitA} to this task`,
    );
    // So does a value that is never restored.
    rmSync(testModeRecordFolder(root, "rust", "cmd1-1234"), { recursive: true });
    recordSubset(env, root, "rust", `affected:${commitB}`);
    printedTestMode(env, root, "rust");
    expect(hashedModeProblem(env, root, "rust", `affected:${commitA}`)).toContain(
      "Nx hashed one with that is never restored",
    );
  });

  it("prints a value that is never restored where the command ran a subset in another mode, as for a task that Nx hashes again after its run", () => {
    writeBaseline(join(root, "rust"), [commitA]);
    expect(recordSubset(env, root, "rust", `affected:${commitA}`)).toBe(true);
    expect(printedTestMode(env, root, "rust")).toBe(`affected:${commitA}`);
    expect(printedTestMode({ ...env, NX_RUST_TEST_MODE: "full" }, root, "rust")).toMatch(
      /^unrestorable [0-9a-f]{32}$/,
    );
    rmSync(join(root, "rust", "target"), { recursive: true });
    const after = printedTestMode(env, root, "rust");
    expect(after).toMatch(/^unrestorable /);
    expect(printedTestMode(env, root, "rust")).not.toBe(after);
    // Without a command id, nothing is recorded and the text is printed.
    expect(printedTestMode({ NX_RUST_TEST_MODE: "full" }, root, "rust")).toBe("full");
  });

  it("prints a value that is never restored where it cannot add to the record", () => {
    writeBaseline(join(root, "rust"), [commitA]);
    const folder = testModeRecordFolder(root, "rust", "cmd1-1234");
    mkdirSync(join(folder, ".."), { recursive: true });
    writeFileSync(folder, "a file where the folder should be");
    expect(printedTestMode(env, root, "rust")).toMatch(/^unrestorable /);
    expect(recordSubset(env, root, "rust", `affected:${commitA}`)).toBe(false);
  });
});
