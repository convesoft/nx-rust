import { readFileSync } from "node:fs";
import type { CargoPackage } from "../src/cargo/metadata";
import type { OutputCrate, OutputScope } from "../src/executors/cargo-output";
import {
  cargoArguments,
  cargoSteps,
  maxFiltersetBytes,
  nextestFiltersets,
  nextestListArguments,
  workspaceUnificationFlags,
  withToolConfiguration,
} from "../src/executors/command";
import {
  binaryPackage,
  type JunitReport,
  type ListedTests,
  nextestEnd,
  parseJunit,
  parseNextestList,
  suiteKind,
  readJunitReport,
  readNextestStep,
  removeToolConfiguration,
  writeToolConfiguration,
} from "../src/executors/nextest";
import { toolchainCommand } from "../src/graph/inputs";

// The parts of VER-TESTING and VER-BATCHING about the nextest runner that need
// no nextest: the commands of its steps, the reading of the JUnit report and
// of nextest's end, and the attribution of its output. nextest-runs.spec.ts
// runs the real tool.

const member = (name: string): CargoPackage =>
  ({
    name,
    id: `path+file:///w/crates/${name}#${name}@0.1.0`,
    manifest_path: `/w/crates/${name}/Cargo.toml`,
    targets: [
      { name, kind: ["lib"], crate_types: ["lib"], src_path: `/w/crates/${name}/src/lib.rs` },
    ],
  }) as unknown as CargoPackage;

const members = ["a", "b", "c"].map(member);
const scope: OutputScope = { members, root: "/w" };
const crate = (name: string): OutputCrate => {
  const pkg = members.find((entry) => entry.name === name) as CargoPackage;
  return { task: `${name}:test`, name, spec: pkg.id, package: pkg, selection: {} };
};
const group = [crate("a"), crate("b")];

type Result = "pass" | "fail" | "flaky" | "skipped";

/** A JUnit report as nextest 0.9.152 writes it, with the given suites. */
function junit(suites: Record<string, Record<string, Result>>): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites name="nextest-run" tests="0" failures="0" errors="0">',
    ...Object.entries(suites).flatMap(([suite, cases]) => [
      `    <testsuite name="${suite}" tests="${Object.keys(cases).length}">`,
      ...Object.entries(cases).map(([name, result]) =>
        result === "pass"
          ? `        <testcase name="${name}" classname="${suite}" time="0.001"/>`
          : result === "flaky"
            ? `        <testcase name="${name}" classname="${suite}"><flakyFailure message="m">first try</flakyFailure></testcase>`
            : result === "skipped"
              ? `        <testcase name="${name}" classname="${suite}"><skipped message="Skipped: test filtered out"/></testcase>`
              : `        <testcase name="${name}" classname="${suite}">\n            <failure message="thread &apos;t&apos; panicked" type="test failure with exit code 101">boom &lt;/testcase&gt;&lt;failure&gt;</failure>\n            <system-out>&lt;testcase name="forged"/&gt;</system-out>\n        </testcase>`,
      ),
      "    </testsuite>",
    ]),
    "</testsuites>",
    "",
  ].join("\n");
}

/** nextest's list of the tests that a run was to run, by binary ID. */
const listed = (suites: Record<string, string[]>): ListedTests => ({
  tests: Object.entries(suites).flatMap(([binary, names]) =>
    names.map((name) => ({ package: binaryPackage(binary), binary, name })),
  ),
});

const report = (suites: Record<string, Record<string, Result>>): JunitReport => {
  const cases = parseJunit(junit(suites));
  if (typeof cases === "string") {
    throw new Error(cases);
  }
  return { cases };
};

/** nextest's output of a run in which `b`'s test `t::bad` failed. */
const output = [
  "   Compiling a v0.1.0 (/w/crates/a)",
  "   Compiling b v0.1.0 (/w/crates/b)",
  "    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.10s",
  "────────────",
  " Nextest run ID 0 with nextest profile: default",
  "    Starting 3 tests across 3 binaries (1 test skipped via profile.default.default-filter)",
  "        PASS [   0.002s] (1/3) a t::ok",
  "        FAIL [   0.002s] (2/3) b t::bad",
  "  stdout ───",
  "",
  "    running 1 test",
  "    b's own output",
  "",
  "        PASS [   0.002s] (3/3) a::it works",
  "────────────",
  "     Summary [   0.002s] 3 tests run: 2 passed, 1 failed, 1 skipped",
  "        FAIL [   0.002s] (2/3) b t::bad",
  "error: test run failed",
].join("\n");

describe("the commands of the nextest runner", () => {
  const options = { features: ["x"], profile: "ci", allFeatures: false };
  const specs = group.map((entry) => ({ name: entry.name, spec: entry.spec }));

  it("runs the whole workspace with the filterset of the group's packages, and the doctests of the whole workspace, with the Cargo profile for each", () => {
    expect(
      cargoSteps(
        { target: "test", crates: specs, locked: true, workspace: true, testRunner: "nextest" },
        options,
      ),
    ).toEqual([
      {
        kind: "nextest",
        args: [
          "nextest",
          "run",
          "--workspace",
          "--no-fail-fast",
          "--no-tests=pass",
          "-E",
          "package(=a) | package(=b)",
          "--features",
          "x",
          "--cargo-profile",
          "ci",
          "--locked",
        ],
        listArgs: [
          "nextest",
          "list",
          "--message-format",
          "json",
          "--workspace",
          "-E",
          "package(=a) | package(=b)",
          "--features",
          "x",
          "--cargo-profile",
          "ci",
          "--locked",
        ],
      },
      {
        kind: "doctests",
        args: [
          "test",
          "--workspace",
          "--doc",
          "--no-fail-fast",
          "--features",
          "x",
          "--profile",
          "ci",
          "--locked",
        ],
      },
    ]);
  });

  it("runs a group of one crate with the plain commands of that crate, which pass no --no-fail-fast", () => {
    const [one] = specs;
    expect(
      cargoSteps({ target: "test", crates: [one], locked: false, testRunner: "nextest" }, options),
    ).toEqual([
      {
        kind: "command",
        args: [
          "nextest",
          "run",
          "--no-tests=pass",
          "-p",
          one.spec,
          "--features",
          "x",
          "--cargo-profile",
          "ci",
        ],
      },
      {
        kind: "doctests",
        args: ["test", "-p", one.spec, "--doc", "--features", "x", "--profile", "ci"],
      },
    ]);
    // The command a task compares its group by is the runner's.
    expect(
      cargoArguments({ target: "test", crates: [one], locked: false, testRunner: "nextest" }, {}),
    ).toEqual(["nextest", "run", "--no-tests=pass", "-p", one.spec]);
    expect(cargoArguments({ target: "test", crates: [one], locked: false }, {})).toEqual([
      "test",
      "-p",
      one.spec,
    ]);
  });

  it("passes the flags of the cargo strategy to the nextest run, its list and the doctests, as to every command that compiles", () => {
    const steps = cargoSteps(
      {
        target: "test",
        crates: specs,
        locked: false,
        testRunner: "nextest",
        workspaceUnification: true,
      },
      {},
    );
    expect(steps.map((step) => step.kind)).toEqual(["nextest", "doctests"]);
    for (const args of [steps[0].args, steps[0].listArgs ?? [], steps[1].args]) {
      expect(args.slice(-3)).toEqual([...workspaceUnificationFlags]);
      expect(args.filter((arg) => arg === "-p")).toHaveLength(2);
    }
  });

  it("passes neither --profile nor --ignore-default-filter to nextest, and adds the tool configuration after `nextest run`", () => {
    const [step] = cargoSteps(
      { target: "test", crates: specs, locked: false, workspace: true, testRunner: "nextest" },
      {},
    );
    expect(step.args).not.toContain("--profile");
    expect(step.args).not.toContain("--ignore-default-filter");
    expect(withToolConfiguration(step.args, "/tmp/x/nextest.toml").slice(0, 4)).toEqual([
      "nextest",
      "run",
      "--tool-config-file",
      "nx-rust:/tmp/x/nextest.toml",
    ]);
  });

  it("splits the filterset into arguments of at most 64 KiB, which nextest unites", () => {
    const names = Array.from({ length: 6000 }, (_, index) => `crate-number-${index}`);
    const args = nextestFiltersets(names);
    const filtersets = args.filter((_, index) => index % 2 === 1);
    expect(args.filter((_, index) => index % 2 === 0).every((flag) => flag === "-E")).toBe(true);
    expect(filtersets.length).toBeGreaterThan(1);
    expect(filtersets.every((part) => Buffer.byteLength(part) <= maxFiltersetBytes)).toBe(true);
    expect(filtersets.join(" | ")).toBe(names.map((name) => `package(=${name})`).join(" | "));
  });

  it("puts the NEXTEST_ variables into the toolchain command of a test that nextest runs only", () => {
    expect(toolchainCommand(".", undefined, true, true)).toContain(
      "name !~ /^(CARGO_(PROFILE|TARGET)_|NEXTEST_)/",
    );
    expect(toolchainCommand(".", undefined, true)).not.toContain("NEXTEST_");
  });
});

describe("the tool configuration", () => {
  it("sets only junit.path of the default profile, to a file in a folder of its own", () => {
    const configuration = writeToolConfiguration();
    try {
      expect(readFileSync(configuration.file, "utf8")).toBe(
        `# Written by @convesoft/nx-rust for one cargo nextest run, which reads its results from this report.\n[profile.default.junit]\npath = ${JSON.stringify(configuration.report)}\n`,
      );
      expect(readJunitReport(configuration.report)).toEqual({ missing: configuration.report });
    } finally {
      removeToolConfiguration(configuration);
    }
  });
});

describe("nextest's JUnit report", () => {
  it("reads one test per testcase, by the binary ID of its suite, failed only by a failure or error element", () => {
    expect(
      parseJunit(junit({ a: { "t::ok": "pass", "t::flaky": "flaky" }, "b::it": { x: "fail" } })),
    ).toEqual([
      { binary: "a", name: "t::ok", failed: false, skipped: false },
      { binary: "a", name: "t::flaky", failed: false, skipped: false },
      { binary: "b::it", name: "x", failed: true, skipped: false },
    ]);
    expect(
      parseJunit(
        '<testsuites><testsuite name="a&amp;b"><testcase name="t&lt;1&gt;"><error/></testcase></testsuite></testsuites>',
      ),
    ).toEqual([{ binary: "a&b", name: "t<1>", failed: true, skipped: false }]);
  });

  it("refuses a report cut short, one with markup it does not know, and one of another shape", () => {
    const whole = junit({ a: { "t::bad": "fail" } });
    expect(parseJunit(whole.slice(0, whole.indexOf("</testcase>")))).toMatch(/ends while/);
    expect(parseJunit(whole.slice(0, whole.indexOf("<failure") + 4))).toMatch(/no element/);
    expect(parseJunit('<testsuites><testcase name="x"/></testsuites>')).toMatch(
      /a testcase lies inside testsuites/,
    );
    expect(parseJunit("")).toMatch(/no testsuites/);
    expect(parseJunit("<testsuites></testsuite>")).toMatch(/closes where testsuites is open/);
  });
});

describe("the reading of a nextest step", () => {
  it("passes the tasks whose package has no failed test in the report, by the part of the binary ID before ::", () => {
    const outcomes = readNextestStep(
      output,
      nextestEnd(100, null),
      group,
      scope,
      report({ a: { "t::ok": "pass" }, "a::it": { works: "pass" }, b: { "t::bad": "fail" } }),
      listed({ a: ["t::ok"], "a::it": ["works"], b: ["t::bad"] }),
    );
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([true, false]);
    expect(outcomes[0].message).toBe(
      "a:test: nextest ran 2 tests of a, as its JUnit report shows.",
    );
    expect(outcomes[1].message).toBe(
      "b:test: nextest ran 1 test of b, as its JUnit report shows.\nb:test: a test of b failed: b t::bad.",
    );
    // Each task holds the lines of its own tests, and nextest's lines on the run.
    expect(outcomes[0].output).toContain("(1/3) a t::ok");
    expect(outcomes[0].output).toContain("a::it works");
    expect(outcomes[0].output).not.toMatch(/b t::bad|b's own output/);
    expect(outcomes[1].output).toContain("b's own output");
    expect(outcomes[1].output).not.toMatch(/a t::ok|a::it works/);
    for (const outcome of outcomes) {
      expect(outcome.output).toContain(
        "Starting 3 tests across 3 binaries (1 test skipped via profile.default.default-filter)",
      );
      expect(outcome.output).toContain(
        "Summary [   0.002s] 3 tests run: 2 passed, 1 failed, 1 skipped",
      );
      expect(outcome.output).toContain("error: test run failed");
    }
    expect(outcomes[0].output).toContain("Compiling a v0.1.0");
    expect(outcomes[0].output).not.toContain("Compiling b v0.1.0");
  });

  it("matches nextest's lines without the escape sequences of CARGO_TERM_COLOR=always", () => {
    const coloured = output
      .replace("        PASS [", "\u001b[32;1m        PASS\u001b[0m [")
      .replace(") a t::ok", ") \u001b[35;1ma\u001b[0m \u001b[36mt::\u001b[0mok");
    const [a] = readNextestStep(
      coloured,
      nextestEnd(100, null),
      group,
      scope,
      report({ a: { "t::ok": "pass" }, b: { "t::bad": "fail" } }),
      listed({ a: ["t::ok"], b: ["t::bad"] }),
    );
    expect(a.output).toContain("\u001b[35;1ma\u001b[0m");
    expect(a.passed).toBe(true);
  });

  it("passes every task where nextest exits with 0, and shows 0 tests for a crate that ran none", () => {
    const outcomes = readNextestStep(
      "",
      nextestEnd(0, null),
      group,
      scope,
      report({ a: { x: "pass" } }),
    );
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([true, true]);
    expect(outcomes[1].message).toBe(
      "b:test: nextest ran no test of b: the crate has none, or the repository's nextest configuration skips them.",
    );
    // Without the report the status still decides, and the count is not shown.
    const [missing] = readNextestStep("", nextestEnd(0, null), group, scope, { missing: "/r.xml" });
    expect(missing.passed).toBe(true);
    expect(missing.message).toMatch(/wrote no JUnit report .* junit\.path, so the number of tests/);
  });

  it("fails every task where nextest exits with 100 and the report is missing, names junit.path and says that it cannot tell which crate's test failed", () => {
    const outcomes = readNextestStep(output, nextestEnd(100, null), group, scope, {
      missing: "/tmp/r/junit.xml",
    });
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([false, false]);
    expect(outcomes[0].message).toContain(
      "a:test: nextest exited with status 100, which it gives where a test failed or the run ended early, and wrote no JUnit report to /tmp/r/junit.xml",
    );
    expect(outcomes[0].message).toContain("sets its own junit.path");
    expect(outcomes[0].message).toContain("cannot tell which crate's test failed");
  });

  it("fails every task where it cannot read the report or the report contradicts the status", () => {
    const cases: [number, JunitReport, RegExp][] = [
      [100, { unreadable: "it ends while testsuites is open", file: "/r.xml" }, /cannot be read/],
      [
        0,
        report({ a: { x: "fail" } }),
        /exited with status 0, while its JUnit report holds a failed test/,
      ],
      [
        100,
        report({ c: { x: "fail" }, a: { y: "pass" } }),
        /tests of `c`, which is no crate of this run/,
      ],
    ];
    for (const [status, junitReport, message] of cases) {
      const outcomes = readNextestStep(output, nextestEnd(status, null), group, scope, junitReport);
      expect(outcomes.map((outcome) => outcome.passed)).toEqual([false, false]);
      expect(outcomes[0].message).toMatch(message);
    }
  });

  it("fails every task with the crates that did not compile where the build fails, and where nextest ends otherwise", () => {
    const build = [
      "   Compiling c v0.1.0 (/w/crates/c)",
      "error[E0425]: cannot find value `x` in this scope",
      " --> crates/c/src/lib.rs:1:14",
      "error: could not compile `c` (lib test) due to 1 previous error",
    ].join("\n");
    const outcomes = readNextestStep(build, nextestEnd(101, null), group, scope, {
      missing: "/r.xml",
    });
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([false, false]);
    expect(outcomes[1].message).toContain(
      "b:test: the tests of b were not run: cargo nextest run stopped before running any test, because `c`, which is outside the selection of this run",
    );
    for (const [code, signal, reason] of [
      [
        104,
        null,
        /status 104, which nextest gives where it cannot list the tests of a test binary/,
      ],
      [96, null, /status 96, which nextest gives where it cannot set up the run/],
      [3, null, /status 3, which is none of success/],
      [null, "SIGKILL", /stopped by SIGKILL/],
    ] as const) {
      const [first] = readNextestStep("", nextestEnd(code, signal), group, scope, {
        missing: "/r.xml",
      });
      expect(first.passed).toBe(false);
      expect(first.message).toMatch(reason);
    }
  });
});

describe("a run that nextest did not finish", () => {
  it("fails the task of a crate whose listed tests did not all run and pass, and passes one whose tests all did", () => {
    // A global timeout ended the run: a's test was killed, b's never ran.
    const outcomes = readNextestStep(
      output,
      nextestEnd(100, null),
      [crate("a"), crate("b"), crate("c")],
      scope,
      report({ a: { slow: "fail" }, c: { ok: "pass", filtered: "skipped" } }),
      listed({ a: ["slow"], b: ["one", "two"], c: ["ok"] }),
    );
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([false, false, true]);
    expect(outcomes[0].message).toContain("a:test: a test of a failed: a slow.");
    expect(outcomes[1].message).toContain(
      "b:test: the run was not complete: nextest did not run 2 of the 2 tests of b that it was to run, such as b one, b two.",
    );
    expect(outcomes[2].message).toBe("c:test: nextest ran 1 test of c, as its JUnit report shows.");
    // A skipped case does not count as run.
    const [skippedOnly] = readNextestStep(
      "",
      nextestEnd(100, null),
      [crate("c")],
      scope,
      report({ c: { ok: "skipped" } }),
      listed({ c: ["ok"] }),
    );
    expect(skippedOnly.passed).toBe(false);
  });

  it("fails every task without a failed test of its own where the list cannot be read", () => {
    const outcomes = readNextestStep(
      output,
      nextestEnd(100, null),
      group,
      scope,
      report({ a: { x: "pass" }, b: { y: "fail" } }),
      { unreadable: "cargo nextest list exited with status 101" },
    );
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([false, false]);
    expect(outcomes[0].message).toContain(
      "could not learn from cargo nextest list which tests of a the run was to run: cargo nextest list exited with status 101",
    );
    expect(outcomes[1].message).toContain("a test of b failed: b y.");
  });

  it("lists the tests with the run's selection and flags, and reads those that match its filters", () => {
    expect(
      nextestListArguments([
        "nextest",
        "run",
        "--workspace",
        "--no-fail-fast",
        "--no-tests=pass",
        "-E",
        "package(=a)",
        "--cargo-profile",
        "ci",
        "--locked",
      ]),
    ).toEqual([
      "nextest",
      "list",
      "--message-format",
      "json",
      "--workspace",
      "-E",
      "package(=a)",
      "--cargo-profile",
      "ci",
      "--locked",
    ]);
    const list = {
      "rust-build-meta": {},
      "test-count": 3,
      "rust-suites": {
        b: {
          "package-name": "b",
          "binary-id": "b",
          testcases: {
            "t::bad": { ignored: false, "filter-match": { status: "matches" } },
            "t::ign": { ignored: true, "filter-match": { status: "mismatch", reason: "ignored" } },
            "t::ok": {
              ignored: false,
              "filter-match": { status: "mismatch", reason: "default-filter" },
            },
          },
        },
        "b::it": { "package-name": "b", testcases: {} },
      },
    };
    expect(parseNextestList(JSON.stringify(list))).toEqual({
      tests: [{ package: "b", binary: "b", name: "t::bad" }],
    });
    expect(parseNextestList("not json")).toHaveProperty("unreadable");
    expect(parseNextestList('{"rust-suites":{"b":{"testcases":{}}}}')).toEqual({
      unreadable: "its suite b has no package-name or no testcases",
    });
    expect(
      parseNextestList('{"rust-suites":{"b":{"package-name":"b","testcases":{"t":{}}}}}'),
    ).toEqual({ unreadable: "the test b t has no filter-match that it knows" });
  });
});

describe("the suites of a report that are no test binary", () => {
  it("knows test binaries, setup scripts and stress runs, and nothing else that starts with @", () => {
    expect(suiteKind("a::bin/a")).toEqual({ kind: "binary", binary: "a::bin/a", package: "a" });
    expect(suiteKind("a::it@stress-3")).toEqual({ kind: "binary", binary: "a::it", package: "a" });
    expect(suiteKind("@setup-script:prepare")).toEqual({ kind: "setup-script", script: "prepare" });
    expect(suiteKind("@setup-script:db@stress-1")).toEqual({ kind: "setup-script", script: "db" });
    expect(suiteKind("@wrapper-script:x")).toEqual({ kind: "unknown", name: "@wrapper-script:x" });
  });

  it("decides nothing by a setup script that passed, and fails every task, naming it, where one failed", () => {
    const passing = readNextestStep(
      output,
      nextestEnd(0, null),
      group,
      scope,
      report({ "@setup-script:prepare": { prepare: "pass" }, a: { x: "pass" }, b: { y: "pass" } }),
    );
    expect(passing.map((outcome) => outcome.passed)).toEqual([true, true]);
    for (const status of [105, 100, 0]) {
      const failing = readNextestStep(
        output,
        nextestEnd(status, null),
        group,
        scope,
        report({
          "@setup-script:prepare": { prepare: "pass" },
          "@setup-script:db": { db: "fail" },
        }),
        listed({ a: ["x"] }),
      );
      expect(failing.map((outcome) => outcome.passed)).toEqual([false, false]);
      expect(failing[1].message).toBe(
        "b:test: the setup script `db` of the repository's nextest configuration failed, so nextest did not run every test of this run, and every task of the group fails. nextest's output above shows the script's.",
      );
    }
    const [noReport] = readNextestStep("", nextestEnd(105, null), group, scope, {
      missing: "/r.xml",
    });
    expect(noReport.message).toMatch(/status 105, which it gives where a setup script failed/);
  });

  it("fails every task where the report holds a suite of a kind it does not know", () => {
    const outcomes = readNextestStep(
      output,
      nextestEnd(0, null),
      group,
      scope,
      report({ "@wrapper-script:x": { x: "pass" }, a: { y: "pass" } }),
    );
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([false, false]);
    expect(outcomes[0].message).toMatch(
      /holds the suite `@wrapper-script:x`, which @convesoft\/nx-rust does not recognise as a test binary or a setup script/,
    );
  });
});
