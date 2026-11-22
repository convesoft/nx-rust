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
  });

  it("names the packages of a cargo test that selects its crates with -p, and gives both causes where a crate did not compile as well", () => {
    const output = [
      "error: could not compile `b` (lib test) due to 1 previous error",
      "error: `a` (lib) generated 1 warning",
      "error: warnings are denied by `build.warnings` configuration",
    ].join("\n");
    const [a] = readTestStepWithWarnings(
      output,
      commandEnd(101, null),
      group,
      () => '/w/.cargo/config.toml sets build.warnings = "deny"',
    );
    expect(a.passed).toBe(false);
    expect(a.message).toBe(
      'a:test: the tests of a were not run: cargo test stopped before running any test, because `b` did not compile, and because cargo reported warnings in `a`, and warnings are denied: /w/.cargo/config.toml sets build.warnings = "deny". The tests of every crate of this cargo command were not run. Fix the crate that does not compile and the warnings and run the tasks again.',
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
          { CARGO_BUILD_WARNINGS: "deny" },
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
        expect(
          taskOutput(configured.output, "b:test").includes(
            `because cargo reported warnings in \`a\`, and warnings are denied: ${join(workspace.root, "rust", ".cargo", "config.toml")} sets build.warnings = "deny".`,
          ),
        ).toBe(honours);
      } finally {
        workspace.remove();
      }
    },
    2 * HARNESS_TIMEOUT,
  );
});
