import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CargoPackage } from "../src/cargo/metadata";
import { configuredRunner, runnerVariable } from "../src/cargo/configured-runner";
import {
  commandEnd,
  type OutputCrate,
  type OutputScope,
  readTestStep,
} from "../src/executors/cargo-output";
import { readRecords } from "../src/executors/group-run";
import { groupSelection } from "../src/executors/groups";
import type { PreparedTask } from "../src/executors/task";
import {
  readDoctestStep,
  readTestBinariesStep,
  readTestsBuildStep,
  type RunnerRecords,
} from "../src/executors/test-steps";
import { pluginPackage, testEnvironment } from "./harness";

// The parts of VER-BATCHING ("The runner and the check") and VER-TESTING
// (a runner the user configured) that need no Nx: the selecting runner
// started directly, the check of the test binaries' step against cargo's
// messages and the record, the doctest step's list, the detection of a
// configured runner and the groups of one crate for a non-host triple.

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "nx-rust-test-steps-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const runner = () => join(pluginPackage(), "src", "executors", "test-runner.js");

/** Starts the compiled runner directly, as cargo would, and returns its record. */
function startRunner(env: NodeJS.ProcessEnv, args: string[]) {
  const record = mkdtempSync(join(folder, "record-"));
  const run = spawnSync(process.execPath, [runner(), ...args], {
    env: { PATH: process.env.PATH, NX_RUST_TEST_RECORD: record, ...env },
    encoding: "utf8",
  });
  return { run, record: readRecords(record), folder: record };
}

/** A program that writes its environment as JSON to a file and exits with a status. */
function probe(status = 0): string {
  const file = join(folder, "probe.cjs");
  writeFileSync(
    file,
    `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(join(folder, "env.json"))}, JSON.stringify(process.env));\nprocess.exit(${status});\n`,
    { mode: 0o755 },
  );
  return file;
}

describe("the selecting runner, started directly", () => {
  it("records its start before anything else, runs a package of the list with cargo's environment less its own variables, and records the end", () => {
    const program = probe(0);
    const {
      run,
      record,
      folder: recordFolder,
    } = startRunner(
      {
        CARGO_PKG_NAME: "a",
        NX_RUST_TEST_PACKAGES: ":a:b:",
        SHELLOPTS: "braceexpand:hashall",
        BASHOPTS: "checkwinsize",
        "odd-name": "kept",
      },
      [program, "--exact"],
    );
    expect(run.status).toBe(0);
    expect(record).toEqual({
      records: [
        {
          file: expect.any(String),
          start: { package: "a", program },
          after: [{ end: { status: 0 } }],
        },
      ],
    });
    void recordFolder;
    const seen = JSON.parse(readFileSync(join(folder, "env.json"), "utf8"));
    expect(seen.SHELLOPTS).toBe("braceexpand:hashall");
    expect(seen.BASHOPTS).toBe("checkwinsize");
    expect(seen["odd-name"]).toBe("kept");
    expect(seen.NX_RUST_TEST_PACKAGES).toBeUndefined();
    expect(seen.NX_RUST_TEST_RECORD).toBeUndefined();
  });

  it("records the program's status, or the signal that ended it, and ends the same way", () => {
    const failing = startRunner({ CARGO_PKG_NAME: "a", NX_RUST_TEST_PACKAGES: ":a:" }, [
      probe(101),
    ]);
    expect(failing.run.status).toBe(101);
    expect(failing.record).toMatchObject({ records: [{ after: [{ end: { status: 101 } }] }] });
    const killer = join(folder, "killer.sh");
    writeFileSync(killer, "#!/bin/sh\nkill -SEGV $$\n", { mode: 0o755 });
    const killed = startRunner({ CARGO_PKG_NAME: "a", NX_RUST_TEST_PACKAGES: ":a:" }, [killer]);
    expect(killed.run.signal).toBe("SIGSEGV");
    expect(killed.record).toMatchObject({ records: [{ after: [{ end: { signal: "SIGSEGV" } }] }] });
  });

  it("skips a package that is not in the list, and fails closed with 125 on a missing or malformed list, a missing or empty package name and where it cannot record", () => {
    const program = probe(0);
    const skipped = startRunner({ CARGO_PKG_NAME: "c", NX_RUST_TEST_PACKAGES: ":a:b:" }, [program]);
    expect(skipped.run.status).toBe(0);
    expect(skipped.record).toMatchObject({ records: [{ after: [{ skip: true }] }] });
    for (const env of [
      { CARGO_PKG_NAME: "a" },
      { CARGO_PKG_NAME: "a", NX_RUST_TEST_PACKAGES: "a,b" },
      { CARGO_PKG_NAME: "a", NX_RUST_TEST_PACKAGES: "::" },
      { NX_RUST_TEST_PACKAGES: ":a:" },
      { CARGO_PKG_NAME: "", NX_RUST_TEST_PACKAGES: ":a:" },
    ]) {
      rmSync(join(folder, "env.json"), { force: true });
      const refused = startRunner(env, [program]);
      expect({ env, status: refused.run.status }).toEqual({ env, status: 125 });
      expect(refused.record).toMatchObject({
        records: [{ after: [{ error: expect.any(String) }] }],
      });
      expect(() => readFileSync(join(folder, "env.json"))).toThrow(/ENOENT/);
    }
    // A record folder that exists and cannot be written.
    const locked = join(folder, "locked");
    mkdirSync(locked, { mode: 0o500 });
    const unrecorded = spawnSync(process.execPath, [runner(), program], {
      env: {
        PATH: process.env.PATH,
        CARGO_PKG_NAME: "a",
        NX_RUST_TEST_PACKAGES: ":a:",
        NX_RUST_TEST_RECORD: locked,
      },
      encoding: "utf8",
    });
    expect(unrecorded.status).toBe(125);
    expect(unrecorded.stderr).toMatch(/could not record the start/);
    expect(() => readFileSync(join(folder, "env.json"))).toThrow(/ENOENT/);
    // A missing folder, as for a command that a verbose run printed and that
    // runs by hand once the plugin has removed it, is created.
    const missing = join(folder, "missing", "record");
    const created = spawnSync(process.execPath, [runner(), program], {
      env: {
        PATH: process.env.PATH,
        CARGO_PKG_NAME: "a",
        NX_RUST_TEST_PACKAGES: ":a:",
        NX_RUST_TEST_RECORD: missing,
      },
      encoding: "utf8",
    });
    expect(created.status).toBe(0);
    expect(readRecords(missing)).toMatchObject({ records: [{ after: [{ end: { status: 0 } }] }] });
  });
});

// The test binaries' step, against synthetic messages and records.
const member = (name: string): CargoPackage => ({
  id: `path+file:///w/crates/${name}#0.1.0`,
  name,
  version: "0.1.0",
  manifest_path: `/w/crates/${name}/Cargo.toml`,
  dependencies: [],
  targets: [{ name, kind: ["lib"], test: true }],
  metadata: null,
});
const scope: OutputScope = { members: ["a", "b", "c"].map(member), root: "/w" };
const crate = (name: string): OutputCrate => ({
  task: `${name}:test`,
  name,
  spec: member(name).id,
  package: member(name),
  selection: {},
});
const artifact = (name: string, executable: string) =>
  JSON.stringify({
    reason: "compiler-artifact",
    package_id: member(name).id,
    target: { name, kind: ["lib"] },
    profile: { test: true },
    executable,
  });
const finished = (success: boolean) => JSON.stringify({ reason: "build-finished", success });
const started = (pkg: string, program: string, ...after: object[]) => ({
  file: `${pkg}-${program}`,
  start: { package: pkg, program },
  after: after as never[],
});
const setup = { command: ["node", "runner.js"], packages: ":a:b:" };

function check(lines: string[], record: RunnerRecords, code = 0) {
  return readTestBinariesStep(
    lines.join("\n"),
    commandEnd(code, null),
    [crate("a"), crate("b")],
    scope,
    record,
    setup,
  ).map((outcome) => outcome.passed);
}

describe("the check of the test binaries' step", () => {
  const good = (): RunnerRecords => ({
    records: [
      started("a", "/w/t/a-1", { end: { status: 0 } }),
      started("b", "/w/t/b-1", { end: { status: 0 } }),
      started("c", "/w/t/c-1", { skip: true }),
    ],
  });
  const messages = [
    artifact("a", "/w/t/a-1"),
    artifact("b", "/w/t/b-1"),
    artifact("c", "/w/t/c-1"),
    finished(true),
  ];

  it("passes a crate whose every test executable has one record of its package that ends with 0", () => {
    expect(check(messages, good())).toEqual([true, true]);
  });

  it("fails a crate whose executable has no record, two records, a record of another package, no end, another status, a signal, or a skip", () => {
    const variants: [string, RunnerRecords][] = [
      ["no record", { records: [started("b", "/w/t/b-1", { end: { status: 0 } })] }],
      [
        "two records",
        {
          records: [
            ...(good() as { records: never[] }).records,
            started("a", "/w/t/a-1", { end: { status: 0 } }),
          ],
        },
      ],
      [
        "another package",
        {
          records: [
            started("x", "/w/t/a-1", { end: { status: 0 } }),
            started("b", "/w/t/b-1", { end: { status: 0 } }),
          ],
        },
      ],
      [
        "no end",
        { records: [started("a", "/w/t/a-1"), started("b", "/w/t/b-1", { end: { status: 0 } })] },
      ],
      [
        "status 101",
        {
          records: [
            started("a", "/w/t/a-1", { end: { status: 101 } }),
            started("b", "/w/t/b-1", { end: { status: 0 } }),
          ],
        },
      ],
      [
        "a signal",
        {
          records: [
            started("a", "/w/t/a-1", { end: { signal: "SIGSEGV" } }),
            started("b", "/w/t/b-1", { end: { status: 0 } }),
          ],
        },
      ],
      [
        "a skip",
        {
          records: [
            started("a", "/w/t/a-1", { skip: true }),
            started("b", "/w/t/b-1", { end: { status: 0 } }),
          ],
        },
      ],
    ];
    for (const [name, record] of variants) {
      expect({ name, passed: check(messages, record, 101) }).toEqual({
        name,
        passed: [false, true],
      });
      // Also where cargo exited with 0.
      expect({ name, passed: check(messages, record, 0) }).toEqual({ name, passed: [false, true] });
    }
  });

  it("fails every crate on an error entry, a missing build-finished, one that reports a failure among others, an executable of no member, an unreadable folder and an unexplained failure of cargo", () => {
    const errored = good() as { records: ReturnType<typeof started>[] };
    errored.records.push(started("", "/w/t/z-1", { error: "CARGO_PKG_NAME is missing or empty" }));
    expect(check(messages, errored)).toEqual([false, false]);
    expect(check(messages.slice(0, -1), good())).toEqual([false, false]);
    expect(check([finished(true), ...messages, finished(false)], good())).toEqual([false, false]);
    const stranger = JSON.stringify({
      reason: "compiler-artifact",
      package_id: "registry+https://github.com/rust-lang/crates.io-index#other@1.0.0",
      profile: { test: true },
      executable: "/w/t/other-1",
    });
    expect(check([stranger, ...messages], good())).toEqual([false, false]);
    expect(check(messages, { unreadable: "EACCES" })).toEqual([false, false]);
    expect(check(messages, good(), 101)).toEqual([false, false]);
    expect(check(messages, good(), 3)).toEqual([false, false]);
  });

  it("counts an artifact message after build-finished and one after text on its line, so that a forged line can add an expectation and never remove one", () => {
    const forged = [
      finished(true),
      ...messages.slice(0, 2),
      `noise${artifact("a", "/w/t/a-2")}`,
      ...messages.slice(2),
    ];
    expect(check(forged, good())).toEqual([false, true]);
    expect(check([...messages, '{"reason":"compiler-artifact", cut'], good())).toEqual([
      false,
      false,
    ]);
  });
});

describe("the doctest step", () => {
  const read = (output: string, code: number, members = scope) =>
    readDoctestStep(output, commandEnd(code, null), [crate("a"), crate("b")], members).map(
      (outcome) => ({ passed: outcome.passed, message: outcome.message ?? "" }),
    );

  it("decides by the last list only where cargo fails and the list ends its output, and warns for a crate outside the group", () => {
    const blocks =
      "   Doc-tests a\ntest a ... ok\n   Doc-tests b\ntest b ... FAILED\n   Doc-tests c\ntest c ... FAILED\n";
    const outcomes = read(
      `${blocks}error: 2 targets failed:\n    \`-p b --doc\`\n    \`-p c --doc\``,
      101,
    );
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([true, false]);
    expect(outcomes[0].message).toMatch(/warning: the doctests of `c` failed/);
    // A list that a doctest printed, before cargo's own, changes nothing.
    const printed = `error: 1 target failed:\n    \`-p a --doc\`\n${blocks}error: 1 target failed:\n    \`-p c --doc\``;
    expect(read(printed, 101).map((outcome) => outcome.passed)).toEqual([true, true]);
    // A list that does not end the output, or no list, fails every task.
    expect(
      read(`${blocks}error: 1 target failed:\n    \`-p c --doc\`\nmore`, 101).map((o) => o.passed),
    ).toEqual([false, false]);
    expect(read(blocks, 101).map((outcome) => outcome.passed)).toEqual([false, false]);
    // A list where cargo succeeded is not read.
    expect(read(`error: 1 target failed:\n    \`-p a --doc\``, 0).map((o) => o.passed)).toEqual([
      true,
      true,
    ]);
    // An entry without -p names the only member.
    const single: OutputScope = { members: [member("a")], root: "/w" };
    expect(
      readDoctestStep(
        "error: 1 target failed:\n    `--doc`",
        commandEnd(101, null),
        [crate("a")],
        single,
      ).map((o) => o.passed),
    ).toEqual([false]);
  });
});

describe("a runner the user configured for the host", () => {
  const host = "x86_64-unknown-linux-gnu";
  const workspace = () => {
    const root = join(folder, "repo", "rust");
    mkdirSync(join(root, ".cargo"), { recursive: true });
    return root;
  };
  const home = () => join(folder, "cargo-home");

  it("is found in the variable, under the host's table, under any cfg table, through include and in the Cargo home, and where a file cannot be parsed", () => {
    const root = workspace();
    const env = { CARGO_HOME: home() };
    expect(configuredRunner(root, env, host)).toBeUndefined();
    expect(configuredRunner(root, { ...env, [runnerVariable(host)]: "" }, host)).toEqual({
      source: "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER",
      detail: "is set",
    });
    const cases: [string, string][] = [
      [`[target.${host}]\nrunner = "valgrind"\n`, `[target.${host}]`],
      [`[target.'cfg(unix)']\nrunner = ["sh"]\n`, "[target.'cfg(unix)']"],
      [`[target.'cfg(windows)']\nrunner = "wine"\n`, "[target.'cfg(windows)']"],
    ];
    for (const [text, table] of cases) {
      writeFileSync(join(root, ".cargo", "config.toml"), text);
      expect(configuredRunner(root, env, host)?.detail).toBe(`sets runner under ${table}`);
    }
    writeFileSync(
      join(root, ".cargo", "config.toml"),
      `[target.wasm32-unknown-unknown]\nrunner = "x"\n`,
    );
    expect(configuredRunner(root, env, host)).toBeUndefined();
    writeFileSync(join(root, ".cargo", "config.toml"), `include = ["extra.toml"]\n`);
    writeFileSync(join(root, ".cargo", "extra.toml"), `[target.${host}]\nrunner = "r"\n`);
    expect(configuredRunner(root, env, host)?.source).toBe(join(root, ".cargo", "extra.toml"));
    writeFileSync(join(root, ".cargo", "config.toml"), "");
    mkdirSync(home(), { recursive: true });
    writeFileSync(join(home(), "config.toml"), `[target.${host}]\nrunner = "r"\n`);
    expect(configuredRunner(root, env, host)?.source).toBe(join(home(), "config.toml"));
    rmSync(join(home(), "config.toml"));
    writeFileSync(join(root, ".cargo", "config"), "not = toml = at all");
    expect(configuredRunner(root, env, host)?.detail).toMatch(/cannot be read or parsed/);
  });

  it("makes the test tasks of a group run one crate per command, saying why, while a non-host triple does so for every compiling target", () => {
    const root = workspace();
    const task = (
      target: PreparedTask["target"],
      options: PreparedTask["options"] = {},
    ): PreparedTask => ({
      task: `a:${target}`,
      target,
      options,
      binaryArguments: [],
      warnings: [],
      locked: false,
      workspaceRoot: "rust",
      cwd: root,
      crate: "a",
      env: { ...testEnvironment(), CARGO_HOME: home(), CARGO_BUILD_TARGET: undefined },
    });
    expect(groupSelection(task("test"), () => host)).toEqual({ kind: "workspace", host });
    expect(groupSelection(task("check"), () => host)).toEqual({ kind: "workspace" });
    expect(groupSelection(task("check", { targetTriple: host }), () => host)).toEqual({
      kind: "workspace",
    });
    expect(
      groupSelection(task("build", { targetTriple: "wasm32-unknown-unknown" }), () => host),
    ).toEqual({ kind: "alone" });
    expect(groupSelection(task("check", { targetTriple: "x" }), () => undefined)).toEqual({
      kind: "alone",
    });
    expect(groupSelection(task("fmt-check"), () => host)).toEqual({ kind: "crates" });
    writeFileSync(join(root, ".cargo", "config.toml"), `[target.'cfg(unix)']\nrunner = ["sh"]\n`);
    const alone = groupSelection(task("test"), () => host);
    expect(alone).toEqual({
      kind: "alone",
      note: expect.stringContaining(
        `because a runner for the host ${host} is or may be configured: ${join(root, ".cargo", "config.toml")} sets runner under [target.'cfg(unix)']`,
      ),
    });
    expect(groupSelection(task("check"), () => host)).toEqual({ kind: "workspace" });
  });
});

// Cargo colours its lines where CARGO_TERM_COLOR=always asks it to, as CI
// configurations set it: the reading matches the lines without the escape
// sequences, and each task's output keeps them.
describe("cargo's coloured lines", () => {
  const red = (text: string) => `\u001b[1m\u001b[91m${text}\u001b[0m`;
  const green = (text: string) => `\u001b[1m\u001b[92m${text}\u001b[0m`;

  it("decide the doctest step as uncoloured lines do, and stay in the task's output", () => {
    const blocks = [
      `   ${green("Doc-tests")} a`,
      "test a ... ok",
      `   ${green("Doc-tests")} c`,
      "test c ... FAILED",
    ].join("\n");
    const outcomes = readDoctestStep(
      `${blocks}\n${red("error")}: 1 target failed:\n    \`-p c --doc\``,
      commandEnd(101, null),
      [crate("a"), crate("b")],
      scope,
    );
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([true, true]);
    expect(outcomes[0].message).toMatch(/warning: the doctests of `c` failed/);
    expect(outcomes[0].output).toContain(`${green("Doc-tests")} a`);
    expect(outcomes[0].output).not.toContain("test c ... FAILED");
  });

  it("attribute the test binaries' blocks by coloured Running lines", () => {
    const outcomes = readTestBinariesStep(
      [
        artifact("a", "/w/t/a-1"),
        artifact("b", "/w/t/b-1"),
        finished(true),
        `     ${green("Running")} unittests src/lib.rs (/w/t/a-1)`,
        "test a_test ... ok",
        `     ${green("Running")} unittests src/lib.rs (/w/t/b-1)`,
        "test b_test ... ok",
      ].join("\n"),
      commandEnd(0, null),
      [crate("a"), crate("b")],
      scope,
      {
        records: [
          started("a", "/w/t/a-1", { end: { status: 0 } }),
          started("b", "/w/t/b-1", { end: { status: 0 } }),
        ],
      },
      setup,
    );
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([true, true]);
    expect(outcomes[0].output).toContain("a_test");
    expect(outcomes[0].output).not.toContain("b_test");
  });

  it("name a crate that did not compile in a coloured error of the build step", () => {
    const [outcome] = readTestsBuildStep(
      `${red("error")}: could not compile \`c\` (lib) due to 1 previous error`,
      commandEnd(101, null),
      [crate("a")],
      scope,
    );
    expect(outcome.message).toMatch(/because `c`, which is outside the selection of this run/);
  });

  it("read a coloured list of failed targets of a test command for several crates", () => {
    const outcomes = readTestStep(
      `     ${green("Running")} unittests src/lib.rs (/w/t/a-1)\ntest a ... FAILED\n${red("error")}: 1 target failed:\n    \`-p a --lib\``,
      commandEnd(101, null),
      [crate("a"), crate("b")],
    );
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([false, true]);
  });
});
