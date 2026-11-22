import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { CargoPackage } from "../src/cargo/metadata";
import { commandEnd, type OutputCrate, type OutputScope } from "../src/executors/cargo-output";
import { readTestStepWithWarnings } from "../src/executors/denied-warnings";
import { nextestEnd, readNextestStep } from "../src/executors/nextest";
import { readTestsBuildStep } from "../src/executors/test-steps";
import {
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  runNx,
  taskOutput,
  testEnvironment,
} from "./harness";

// The test steps of VER-BATCHING ("Denied warnings") where cargo applies
// build.warnings itself (DES-TEST-RUN, "Denied warnings in a test step"):
// every test task of a step that denied warnings stop fails, and its message
// names the packages with warnings, as cargo's own lines name them, and what
// denies warnings. Cargo honours the setting from 1.97 on, and CI also runs
// on 1.91, where every task passes as plain cargo does. cargo-nextest is not
// needed: the reading of a nextest build that failed is checked from the
// lines that cargo prints under json-render-diagnostics, as nextest builds
// (EVD-CARGO-TARGET-COMMANDS, "build.warnings in the test steps").

const member = (name: string): CargoPackage =>
  ({
    name,
    id: `path+file:///w/crates/${name}#${name}@0.1.0`,
    manifest_path: `/w/crates/${name}/Cargo.toml`,
    targets: [
      { name, kind: ["lib"], crate_types: ["lib"], src_path: `/w/crates/${name}/src/lib.rs` },
    ],
  }) as unknown as CargoPackage;

const members = ["a", "b", "d"].map(member);
const scope: OutputScope = { members, root: "/w" };
const crate = (name: string): OutputCrate => {
  const pkg = members.find((entry) => entry.name === name) as CargoPackage;
  return { task: `${name}:test`, name, spec: pkg.id, package: pkg, selection: {} };
};
const group = [crate("a"), crate("b")];

// What cargo 1.100.0 printed for `cargo test --workspace --no-run` with
// CARGO_BUILD_WARNINGS=deny and an unused variable in d.
const deniedInD = [
  "   Compiling d v0.1.0 (/w/crates/d)",
  "warning: unused variable: `unused`",
  " --> crates/d/src/lib.rs:1:23",
  "  |",
  "1 | pub fn warned() { let unused = 1; }",
  "  |                       ^^^^^^ help: if this is intentional, prefix it with an underscore: `_unused`",
  "",
  "   Compiling a v0.1.0 (/w/crates/a)",
  "error: `d` (lib) generated 1 warning (run `cargo fix --lib -p d` to apply 1 suggestion)",
  "error: warnings are denied by `build.warnings` configuration",
  "warning: build failed, waiting for other jobs to finish...",
  "error: `d` (lib test) generated 1 warning (1 duplicate)",
  "error: warnings are denied by `build.warnings` configuration",
].join("\n");

const variable = () => "CARGO_BUILD_WARNINGS is deny";
const outsideD =
  "`d`, which is outside the selection of this run (under workspace-build, cargo test compiles the tests and libraries of every crate of the workspace)";

describe("the reading of a test step that denied warnings stopped", () => {
  it("names the packages of cargo's summaries, those outside the group as such, and what denies warnings, and keeps their warnings in every task's output", () => {
    const outcomes = readTestsBuildStep(deniedInD, commandEnd(101, null), group, scope, variable);
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([false, false]);
    expect(outcomes[1].message).toBe(
      `b:test: the tests of b were not run: cargo test --no-run stopped before running any test, because cargo reported warnings in ${outsideD}, and warnings are denied: CARGO_BUILD_WARNINGS is deny. The tests of every crate of this run's group were not run. Fix the warnings and run the tasks again.`,
    );
    for (const outcome of outcomes) {
      expect(outcome.output).toContain("warning: unused variable: `unused`");
    }
  });

  it("reads cargo's lines after the progress text that it writes before a carriage return", () => {
    // What cargo 1.100.0 printed with CARGO_TERM_PROGRESS_WHEN=always,
    // CARGO_TERM_PROGRESS_WIDTH=80 and CARGO_TERM_COLOR=always: the progress
    // bar and a carriage return before the next line, on the same line.
    const bar = (text: string) => `\u001b[1m\u001b[36m    Building\u001b[0m [${text}]`;
    const red = (text: string) => `\u001b[1m\u001b[91m${text}\u001b[0m`;
    const output = [
      "\u001b[1m\u001b[92m   Compiling\u001b[0m d v0.1.0 (/w/crates/d)",
      `${bar("                             ] 0/3: d, d(test)                  ")}\r\u001b[1m\u001b[33mwarning\u001b[0m\u001b[1m: unused variable: \`unused\`\u001b[0m`,
      " \u001b[1m\u001b[94m--> \u001b[0mcrates/d/src/lib.rs:14:23",
      "",
      `${red("error")}: \`d\` (lib) generated 1 warning (1 duplicate)`,
      `${red("error")}: warnings are denied by \`build.warnings\` configuration`,
      `${bar("========>                    ] 1/3: d(test)                     ")}\r${red("error")}: \`d\` (lib test) generated 1 warning (run \`cargo fix --lib -p d --tests\` to apply 1 suggestion)`,
      `${red("error")}: warnings are denied by \`build.warnings\` configuration`,
    ].join("\n");
    const outcomes = readTestsBuildStep(output, commandEnd(101, null), group, scope, variable);
    for (const outcome of outcomes) {
      expect(outcome.passed).toBe(false);
      expect(outcome.message).toContain(
        `because cargo reported warnings in ${outsideD}, and warnings are denied: CARGO_BUILD_WARNINGS is deny.`,
      );
      expect(outcome.output).toContain("unused variable: `unused`");
    }
  });

  it("leaves the text that a test prints after a carriage return to the readers that decide results, as before", () => {
    // Only cargo's progress bars are left out, and only in the lines of
    // denied warnings: a test's own progress line stays with its test.
    const output = [
      "    Starting 1 test across 1 binary",
      "        FAIL [   0.002s] (1/1) b t::bad",
      "  stdout ───",
      "",
      "    b's first output line",
      "    Download 50%\rDownload 100%",
      "    b's following output line",
      "",
      "     Summary [   0.002s] 1 test run: 0 passed, 1 failed",
    ].join("\n");
    const [a, b] = readNextestStep(output, nextestEnd(100, null), group, undefined, {
      missing: "/r.xml",
    });
    expect(a.output).not.toMatch(/b's first output line|Download 100%|b's following output line/);
    expect(b.output).toMatch(/Download 50%\rDownload 100%\n {4}b's following output line/);
  });

  it("gives every task a denied warning whose location is in a crate of the group, though cargo compiled it for another", () => {
    // d compiles a module stored in a's folder with #[path].
    const output = deniedInD.replace(
      "crates/d/src/lib.rs:1:23",
      "crates/a/src/shared_warning.rs:1:23",
    );
    const outcomes = readTestsBuildStep(output, commandEnd(101, null), group, scope, variable);
    for (const outcome of outcomes) {
      expect(outcome.output).toContain("warning: unused variable: `unused`");
      expect(outcome.message).toContain(`because cargo reported warnings in ${outsideD}`);
    }
  });

  it("reads a nextest build that failed in the same way, from the lines that cargo prints under json-render-diagnostics", () => {
    const outcomes = readNextestStep(
      deniedInD,
      nextestEnd(101, null),
      group,
      scope,
      { missing: "/r.xml" },
      undefined,
      false,
      variable,
    );
    expect(outcomes.map((outcome) => outcome.passed)).toEqual([false, false]);
    expect(outcomes[0].message).toContain(
      `cargo nextest run stopped before running any test, because cargo reported warnings in ${outsideD}, and warnings are denied: CARGO_BUILD_WARNINGS is deny.`,
    );
    expect(outcomes[0].output).toContain("warning: unused variable: `unused`");
    // A group that selects its crates with -p has no scope of the workspace.
    const [selected] = readNextestStep(
      deniedInD,
      nextestEnd(101, null),
      group,
      undefined,
      { missing: "/r.xml" },
      undefined,
      false,
      variable,
    );
    expect(selected.message).toContain(
      "because cargo reported warnings in `d`, which is outside the selection of this run (cargo compiles it for a crate that this run selects), and warnings are denied",
    );
  });

  it("names the packages of a cargo test that selects its crates with -p, and gives both causes where a build script failed as well", () => {
    // What cargo 1.100.0 printed for `cargo test -p a -p b --no-fail-fast`
    // with CARGO_BUILD_WARNINGS=deny, b's build script failing and an unused
    // variable in a.
    const output = [
      "   Compiling b v0.1.0 (/w/crates/b)",
      "   Compiling a v0.1.0 (/w/crates/a)",
      "error: failed to run custom build command for `b v0.1.0 (/w/crates/b)`",
      "",
      "Caused by:",
      "  process didn't exit successfully: `/w/target/debug/build/b/b1515faa04a45918/out/build_script_build` (exit status: 101)",
      "warning: build failed, waiting for other jobs to finish...",
      "warning: unused variable: `unused`",
      "  --> crates/a/src/lib.rs:19:23",
      "",
      "error: `a` (lib) generated 1 warning (run `cargo fix --lib -p a` to apply 1 suggestion)",
      "error: warnings are denied by `build.warnings` configuration",
      "error: `a` (lib test) generated 1 warning (1 duplicate)",
      "error: warnings are denied by `build.warnings` configuration",
    ].join("\n");
    const outcomes = readTestStepWithWarnings(
      output,
      commandEnd(101, null),
      group,
      () => '/w/.cargo/config.toml sets build.warnings = "deny"',
    );
    for (const [index, name] of ["a", "b"].entries()) {
      expect(outcomes[index].passed).toBe(false);
      expect(outcomes[index].message).toBe(
        `${name}:test: the tests of ${name} were not run: cargo test stopped before running any test, because \`b\` did not compile, and because cargo reported warnings in \`a\`, and warnings are denied: /w/.cargo/config.toml sets build.warnings = "deny". The tests of every crate of this cargo command were not run. Fix the crate that does not compile and the warnings and run the tasks again.`,
      );
    }
  });

  it("says that cargo reported further errors where an error names no crate that did not compile", () => {
    const output = [
      "error: `a` (lib) generated 1 warning",
      "error: warnings are denied by `build.warnings` configuration",
      "error: linking with `cc` failed: exit status: 1",
    ].join("\n");
    const [a] = readTestStepWithWarnings(output, commandEnd(101, null), group, variable);
    expect(a.message).toContain(
      "because cargo reported warnings in `a`, and warnings are denied: CARGO_BUILD_WARNINGS is deny, and because cargo reported further errors above. The tests of every crate of this cargo command were not run. Fix the warnings and the errors above and run the tasks again.",
    );
    const [b] = readTestsBuildStep(output, commandEnd(101, null), group, scope, variable);
    expect(b.message).toContain(
      "and because cargo reported further errors above. The tests of every crate of this run's group were not run. Fix the warnings and the errors above and run the tasks again.",
    );
  });

  it("says where nothing that the plugin reads sets the warnings to deny, and where cargo names no package, and changes nothing without cargo's denial line", () => {
    const [unknown] = readTestsBuildStep(deniedInD, commandEnd(101, null), group, scope);
    expect(unknown.message).toContain(
      "and warnings are denied by Cargo's build.warnings setting, as cargo says.",
    );
    const [unnamed] = readTestsBuildStep(
      "error: warnings are denied by `build.warnings` configuration",
      commandEnd(101, null),
      group,
      scope,
      variable,
    );
    expect(unnamed.message).toContain(
      "because warnings are denied: CARGO_BUILD_WARNINGS is deny, and cargo's output names no package with warnings; its diagnostics above show them.",
    );
    const allowed = deniedInD.replace(/^error: warnings are denied.*$/gm, "");
    const [plain] = readTestsBuildStep(allowed, commandEnd(101, null), group, scope, variable);
    expect(plain.message).toBe(
      "a:test: cargo test --no-run failed before any test ran, and its output names no crate that did not compile, so it does not show that the tests of a passed.",
    );
    expect(plain.output).not.toContain("unused variable");
  });
});

/** Appends a function with an unused variable to a crate's library. */
function warningIn(crate: string): FileChanges {
  return {
    [`rust/crates/${crate}/src/lib.rs`]: (source) =>
      `${source ?? ""}\npub fn warns_in_${crate}() {\n    let unused = 1;\n}\n`,
  };
}

/** Whether the cargo of the workspace's Cargo workspace honours `build.warnings`. */
function honoursWarnings(workspace: FixtureWorkspace): boolean {
  const run = spawnSync("cargo", ["--version"], {
    cwd: join(workspace.root, "rust"),
    env: workspace.cargo.environment(testEnvironment()),
    encoding: "utf8",
  });
  const version = /^cargo 1\.(\d+)/.exec(run.stdout ?? "");
  if (version === null) {
    throw new Error(`cargo --version printed ${JSON.stringify(run.stdout)}: ${run.stderr}`);
  }
  return Number(version[1]) >= 97;
}

describe("test under workspace-build with warnings denied, through Nx", () => {
  it(
    "fails every test task where a warning stops the build step, with a message that names the crate and what denies warnings",
    async () => {
      // d is a member that neither a nor b uses.
      const workspace = FixtureWorkspace.create("workspace-tests", warningIn("d"));
      try {
        const honours = honoursWarnings(workspace);
        const run = await runNx(
          workspace,
          ["run-many", "-t", "test", "-p", "a,b", "--skip-nx-cache"],
          {
            CARGO_BUILD_WARNINGS: "deny",
            // Cargo then writes progress text before its lines.
            CARGO_TERM_PROGRESS_WHEN: "always",
            CARGO_TERM_PROGRESS_WIDTH: "80",
            CARGO_TERM_COLOR: "always",
          },
        );
        expect(run.status).toBe(honours ? 1 : 0);
        for (const task of ["a:test", "b:test"]) {
          const output = taskOutput(run.output, task);
          expect(
            output.includes(
              `${task}: the tests of ${task[0]} were not run: cargo test --no-run stopped before running any test, because cargo reported warnings in ${outsideD}, and warnings are denied: CARGO_BUILD_WARNINGS is deny.`,
            ),
          ).toBe(honours);
          expect(output.includes("unused variable: `unused`")).toBe(honours);
        }

        // The configuration file denies a warning in a crate of the group.
        workspace.reset(warningIn("a"), {
          "rust/.cargo/config.toml": '[build]\nwarnings = "deny"\n',
        });
        const configured = await runNx(workspace, [
          "run-many",
          "-t",
          "test",
          "-p",
          "a,b",
          "--skip-nx-cache",
        ]);
        expect(configured.status).toBe(honours ? 1 : 0);
        for (const task of ["a:test", "b:test"]) {
          expect(
            taskOutput(configured.output, task).includes(
              `${task}: the tests of ${task[0]} were not run: cargo test --no-run stopped before running any test, because cargo reported warnings in \`a\`, and warnings are denied: ${join(workspace.root, "rust", ".cargo", "config.toml")} sets build.warnings = "deny".`,
            ),
          ).toBe(honours);
        }
      } finally {
        workspace.remove();
      }
    },
    2 * HARNESS_TIMEOUT,
  );
});
