import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failedInputWarnings } from "../src/executors/runtime-input-check";
import { testModeCommand, toolchainCommand, variablesEnd } from "../src/graph/inputs";
import { failedInputLine, scriptInputCommand, unrepeatableValue } from "../src/graph/script-input";
import {
  findExecutable,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  loadsCompiledPlugin,
  pluginPackage,
  testEnvironment,
} from "./harness";

// The failure branch of the plugin's script inputs and the executor's
// warning about it, and the variables of the toolchain command
// (DES-INPUTS, "Failing runtime inputs" and "Variables"; nxr-aqgka5).
// cache-keys.spec.ts checks the keys that Nx's own hasher computes from them.

/** A value that never repeats, as `od` prints it or as the shell's own fallback does. */
const randomValue = "(( [0-9a-f]{2}){16}|[0-9a-f]{32})";

/** What a script input prints where its script cannot run or fails: the line that says so on a line of its own, and a random value. */
const failedOutput = new RegExp(
  `^\\n@convesoft/nx-rust: this runtime input failed\\n${randomValue}\\n$`,
);

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nx-rust-runtime-inputs-"));
  mkdirSync(join(root, "repo/rust"), { recursive: true });
  writeFileSync(
    join(root, "ok.js"),
    'process.stdout.write(`ok ${process.argv[2]}\\n`); process.stderr.write("a warning\\n");\n',
  );
  writeFileSync(join(root, "throws.js"), 'throw new Error("the script broke");\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Runs `command` in the repository root as Nx runs a runtime input, with `env`. */
function evaluate(command: string, env: Record<string, string | undefined> = {}) {
  return spawnSync("sh", ["-c", command], {
    cwd: join(root, "repo"),
    env: testEnvironment(env),
    encoding: "utf8",
  });
}

describe("a runtime input that runs a script of the plugin", () => {
  it("prints what the script prints and nothing of its standard error where it succeeds", () => {
    const run = evaluate(scriptInputCommand(join(root, "ok.js"), "rust"));
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("ok rust\n");
    expect(run.stderr).toBe("");
  });

  it("prints the line of a failure and a new random value, with status 0, where the script fails or cannot run", () => {
    for (const script of [join(root, "throws.js"), join(root, "missing.js")]) {
      const first = evaluate(scriptInputCommand(script, "rust"));
      expect(first.status).toBe(0);
      expect(first.stdout).toMatch(failedOutput);
      expect(first.stderr).toBe("");
      expect(evaluate(scriptInputCommand(script, "rust")).stdout).not.toBe(first.stdout);
    }
  });

  it("sends the script's standard error where NX_RUST_INPUT_ERRORS names", () => {
    const run = evaluate(scriptInputCommand(join(root, "throws.js"), "rust"), {
      NX_RUST_INPUT_ERRORS: "2",
    });
    expect(run.stdout).toMatch(failedOutput);
    expect(run.stderr).toContain("the script broke");
  });
});

describe("the value that never repeats", () => {
  it("comes from the shell alone where od is missing, and writes nothing to standard error", () => {
    const values = [1, 2, 3].map(() =>
      spawnSync("/bin/sh", ["-c", unrepeatableValue], {
        env: { PATH: join(root, "no-tools") },
        encoding: "utf8",
      }),
    );
    for (const run of values) {
      expect(run.stdout).toMatch(/^[0-9a-f]{32}\n$/);
      expect(run.stderr).toBe("");
    }
    expect(new Set(values.map((run) => run.stdout)).size).toBe(3);
  });
});

describe("the warning of the executor about a failing runtime input", () => {
  const env = () => testEnvironment();

  it("names the command and what its script wrote to standard error", () => {
    const throws = scriptInputCommand(join(root, "throws.js"), "rust");
    const missing = scriptInputCommand(join(root, "missing.js"), "rust");
    const warnings = failedInputWarnings(
      "api:build",
      ["default", { runtime: throws }, { env: "CC" }, { runtime: missing }],
      join(root, "repo"),
      env(),
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^api:build: a runtime input that @convesoft\/nx-rust gives/);
    expect(warnings[0]).toContain(`\n  ${throws}\n`);
    expect(warnings[0]).toContain("the script broke");
    expect(warnings[1]).toContain(`\n  ${missing}\n`);
    expect(warnings[1]).toContain("Cannot find module");
  });

  it("gives none where the script succeeds, and runs no command without the line of a failure", () => {
    const marker = join(root, "ran");
    expect(
      failedInputWarnings(
        "api:build",
        [
          { runtime: scriptInputCommand(join(root, "ok.js"), "rust") },
          { runtime: `touch '${marker}'` },
          { runtime: toolchainCommand("rust") },
        ],
        join(root, "repo"),
        env(),
      ),
    ).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  it("sees the line of a failure after output without a final line break", () => {
    writeFileSync(join(root, "partial.js"), 'process.stdout.write("half"); process.exit(1);\n');
    const command = scriptInputCommand(join(root, "partial.js"), "rust");
    expect(evaluate(command).stdout).toMatch(
      new RegExp(`^half\\n@convesoft/nx-rust: this runtime input failed\\n${randomValue}\\n$`),
    );
    const [warning] = failedInputWarnings(
      "api:build",
      [{ runtime: command }],
      join(root, "repo"),
      env(),
    );
    expect(warning).toContain("failed when the executor ran it for this task");
    expect(warning).toContain("If it failed the same way when Nx computed the task's cache key");
  });

  it("names the line that the commands print", () => {
    expect(scriptInputCommand("/a.js", ".")).toContain(`echo '${failedInputLine}'`);
  });
});

const describeCompiled = loadsCompiledPlugin() ? describe : describe.skip;

describeCompiled("the warning of the executor about the mode command", () => {
  const env = () => testEnvironment();

  it("adds nothing to the record of the test modes when it runs the mode command again", () => {
    const command = testModeCommand(
      "rust",
      join(pluginPackage(), "src/executors/print-test-mode.js"),
    );
    // The command prints the mode, so that it gives no warning.
    expect(evaluate(command).stdout).toBe("full\n");
    expect(
      failedInputWarnings("api:test", [{ runtime: command }], join(root, "repo"), {
        ...env(),
        NX_RUST_COMMAND_ID: "command-1",
      }),
    ).toEqual([]);
    expect(existsSync(join(root, "repo/.nx"))).toBe(false);
    // Nx's own evaluation, with the command id, adds to the record.
    expect(evaluate(command, { NX_RUST_COMMAND_ID: "command-1" }).stdout).toBe("full\n");
    expect(existsSync(join(root, "repo/.nx/workspace-data/nx-rust/test-mode/command-1"))).toBe(
      true,
    );
  });
});

describe("the variables of the toolchain command", () => {
  /** The lines that the toolchain command prints after the toolchain's versions. */
  function variables(env: Record<string, string | undefined>, nextest = false): string[] {
    const run = evaluate(toolchainCommand(".", undefined, false, nextest), env);
    expect(run.status).toBe(0);
    expect(run.stdout.endsWith(`\n${variablesEnd}\n`)).toBe(true);
    return run.stdout.split("\n").filter((line) => /^(CARGO_|NEXTEST_|OTHER)/.test(line));
  }

  it("holds the whole value of a variable whose value spans lines, and no other variable", () => {
    const flags = "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS";
    expect(variables({ [flags]: "--cfg=a\n--cfg=b" })).toEqual([`${flags}=--cfg=a\\n--cfg=b`]);
    expect(variables({ [flags]: "--cfg=a\\n--cfg=b" })).toEqual([`${flags}=--cfg=a\\\\n--cfg=b`]);
    expect(variables({ OTHER: "x\nCARGO_PROFILE_DEV_OPT_LEVEL=1" })).toEqual([]);
    expect(variables({ CARGO_PROFILE_DEV_DEBUG: "1\nCARGO_TARGET_DIR=out" })).toEqual([
      "CARGO_PROFILE_DEV_DEBUG=1\\nCARGO_TARGET_DIR=out",
    ]);
    expect(
      variables({ NEXTEST_PROFILE: "ci\nNEXTEST_RETRIES=2", CARGO_TARGET_DIR: "out" }, true),
    ).toEqual(["NEXTEST_PROFILE=ci\\nNEXTEST_RETRIES=2"]);
  });

  it("prints the other variables as env does, sorted bytewise, without CARGO_TARGET_DIR", () => {
    const env = {
      CARGO_PROFILE_RELEASE_LTO: "true",
      CARGO_PROFILE_DEV_OPT_LEVEL: "1",
      CARGO_TARGET_DIR: "out",
      CARGO_TARGET_DIR_X: "y",
      CARGO_PROFILE_a: "lower",
    };
    const listed = spawnSync(
      "sh",
      [
        "-c",
        "env | grep -E '^CARGO_(PROFILE|TARGET)_' | grep -v '^CARGO_TARGET_DIR=' | LC_ALL=C sort",
      ],
      { env: testEnvironment(env), encoding: "utf8" },
    ).stdout;
    expect(variables(env)).toEqual(listed.split("\n").filter((line) => line !== ""));
    expect(variables(env)).toEqual([
      "CARGO_PROFILE_DEV_OPT_LEVEL=1",
      "CARGO_PROFILE_RELEASE_LTO=true",
      "CARGO_PROFILE_a=lower",
      "CARGO_TARGET_DIR_X=y",
    ]);
  });
});

describe("keys with Nx's own hasher where a tool is missing or a script fails", () => {
  const flags = "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS";

  /**
   * A folder of links to the programs that graph creation, the harness and
   * the runtime inputs use, without those in `omit`, to stand for a `PATH`
   * that lists the tools a CI job allows.
   */
  function toolsWithout(omit: string[]): string {
    const folder = mkdtempSync(join(root, `tools-without-${omit.join("-") || "none"}-`));
    const path = process.env.PATH ?? "";
    for (const tool of [
      "sh",
      "env",
      "grep",
      "sort",
      "awk",
      "od",
      "git",
      "node",
      "cargo",
      "rustc",
      "rustdoc",
      "rustup",
    ]) {
      const found = findExecutable(tool, path);
      if (!omit.includes(tool) && found !== undefined) {
        symlinkSync(found, join(folder, tool));
      }
    }
    return folder;
  }

  it(
    "differ between two hashings of one state where awk, od or both are missing, or a script fails, and follow the variables where only od is missing",
    async () => {
      // A preload that makes the artifact folder script throw, and nothing else.
      const preload = join(root, "fail-artifact-folders.cjs");
      writeFileSync(
        preload,
        'if ((process.argv[1] ?? "").endsWith("print-artifact-folders.js")) throw new Error("the script broke");\n',
      );
      const cases: {
        name: string;
        omit: string[];
        env?: Record<string, string>;
        repeats: boolean;
      }[] = [
        { name: "nothing missing", omit: [], repeats: true },
        { name: "od missing", omit: ["od"], repeats: true },
        { name: "awk missing", omit: ["awk"], repeats: false },
        { name: "awk and od missing", omit: ["awk", "od"], repeats: false },
        {
          name: "a failing script, od missing",
          omit: ["od"],
          env: { NODE_OPTIONS: `--require=${preload}` },
          repeats: false,
        },
      ];
      const workspace = FixtureWorkspace.create("subfolder-workspace");
      try {
        const outcomes: Record<string, { repeats: boolean; follows: boolean }> = {};
        for (const { name, omit, env } of cases) {
          const base = { ...env, PATH: toolsWithout(omit) };
          const hash = async (value: string) =>
            (await workspace.hashTasks(["api:build"], { env: { ...base, [flags]: value } }))[
              "api:build"
            ].value;
          const first = await hash("--cfg=original");
          const again = await hash("--cfg=original");
          const changed = await hash("--cfg=changed");
          outcomes[name] = { repeats: first === again, follows: changed !== first };
        }
        expect(outcomes).toEqual(
          Object.fromEntries(cases.map(({ name, repeats }) => [name, { repeats, follows: true }])),
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );

  it(
    "differ after a space at the end of the last variable, which Nx would trim from the end of the output",
    async () => {
      const linker = "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER";
      const workspace = FixtureWorkspace.create("subfolder-workspace");
      try {
        const hash = async (value: string) =>
          await workspace.hashTasks(["api:build", "api:test"], { env: { [linker]: value } });
        const plain = await hash("/usr/bin/cc");
        const again = await hash("/usr/bin/cc");
        const spaced = await hash("/usr/bin/cc ");
        for (const task of ["api:build", "api:test"]) {
          expect({ task, repeats: again[task].value === plain[task].value }).toEqual({
            task,
            repeats: true,
          });
          expect({ task, differs: spaced[task].value !== plain[task].value }).toEqual({
            task,
            differs: true,
          });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
