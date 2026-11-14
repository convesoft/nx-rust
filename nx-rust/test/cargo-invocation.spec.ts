import { spawnSync } from "node:child_process";
import {
  batchRunsVerbosely,
  commandBlock,
  shellWord,
  taskRunsVerbosely,
} from "../src/executors/cargo-invocation";

// The lines that a verbose run prints for a task's cargo command
// (DES-INVOCATION, "Printing the command"; VER-CARGO-UNCHANGED).
// verbose-command.spec.ts runs them through Nx and by hand.

/** Words of every kind that a command, its folder or a variable can hold. */
const words = [
  "test",
  "--all-targets",
  "--features",
  "a,b",
  "path+file:///home/me/repo/rust/crates/good#0.1.0",
  "path+file:///home/me/sp%20ace/rust/crates/folder-x#renamed@0.1.0",
  "/home/me/a folder/rust",
  "",
  "it's",
  `"double" 'single'`,
  "$HOME",
  "$(id)",
  "`id`",
  "*.rs",
  "~",
  "~/x",
  "=x",
  "a=b",
  "!x",
  "{a,b}",
  "a;b|c&d>e<f",
  "back\\slash",
  "tab\there",
  "line\nbreak",
  "#comment",
  "x^y",
  "ünïcode",
];

/**
 * The shells that a user may paste the lines into, of those installed: a
 * POSIX `sh`, bash, and zsh with `extendedglob`, where `#` and `^` are glob
 * operators.
 */
const shells = [
  ["sh", "sh", ""],
  ["bash", "bash", ""],
  ["zsh with extendedglob", "zsh", "setopt extendedglob\n"],
].filter(([, shell]) => spawnSync(shell, ["-c", "true"]).status === 0);

describe("shellWord", () => {
  it.each(shells)("gives words that %s reads back as they are", (_name, shell, setup) => {
    const script = `${setup}printf '%s\\0' ${words.map(shellWord).join(" ")}`;
    const run = spawnSync(shell, ["-c", script], { encoding: "utf8" });

    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: "" });
    expect(run.stdout.split("\0").slice(0, -1)).toEqual(words);
  });

  it("leaves flags, plain paths and %20 bare, and quotes a specification for its #", () => {
    expect(
      [
        "--all-targets",
        "a,b",
        "/home/me/repo/rust",
        "a=b",
        "path+file:///home/me/sp%20ace/rust/crates/good#0.1.0",
        "/home/me/a folder",
        "",
        "it's",
        "=x",
      ].map(shellWord),
    ).toEqual([
      "--all-targets",
      "a,b",
      "/home/me/repo/rust",
      "a=b",
      "'path+file:///home/me/sp%20ace/rust/crates/good#0.1.0'",
      "'/home/me/a folder'",
      "''",
      `'it'\\''s'`,
      "'=x'",
    ]);
  });
});

describe("commandBlock", () => {
  it("names the task, then gives the folder and the command as shell lines", () => {
    expect(
      commandBlock("good:test", {
        cwd: "/home/me/a folder/rust",
        args: ["test", "-p", "path+file:///home/me/a%20folder/rust/crates/good#0.1.0"],
      }),
    ).toBe(
      [
        "good:test: @convesoft/nx-rust runs cargo as these lines do in a POSIX shell:",
        "  cd '/home/me/a folder/rust'",
        "  cargo test -p 'path+file:///home/me/a%20folder/rust/crates/good#0.1.0'",
        "",
      ].join("\n"),
    );
  });

  it("puts the variables that the plugin sets before cargo, and runs as given in a shell", () => {
    const block = commandBlock("good:build", {
      cwd: "/tmp",
      args: ["--version"],
      env: { NX_RUST_PROBE: "a b#c", OTHER_PROBE: "" },
    });

    expect(block.split("\n")[2]).toBe(`  NX_RUST_PROBE='a b#c' OTHER_PROBE='' cargo --version`);
    // The assignments apply to the command: a stand-in cargo shows them.
    const lines = block.split("\n").slice(1, 3).join("\n");
    const run = spawnSync(
      "/bin/sh",
      [
        "-c",
        `cargo() { printf '%s|%s|%s' "$NX_RUST_PROBE" "\${OTHER_PROBE-unset}" "$1"; }\n${lines}`,
      ],
      { encoding: "utf8" },
    );
    expect(run.stdout).toBe("a b#c||--version");
  });

  it("rejects a variable name that a shell cannot assign", () => {
    expect(() => commandBlock("good:build", { cwd: "/", args: [], env: { "A-B": "1" } })).toThrow(
      'The variable name "A-B" cannot be set in a POSIX shell.',
    );
  });
});

describe("taskRunsVerbosely", () => {
  // The context decides; verbose-command.spec.ts runs the case where a
  // crate's .env gives the task another NX_VERBOSE_LOGGING than the run's.
  it.each<[string, boolean | undefined, boolean]>([
    ["a task of a verbose run", true, true],
    ["a task of another run", false, false],
    ["a context without the field", undefined, false],
  ])("%s", (_case, isVerbose, verbose) => {
    expect(taskRunsVerbosely({ isVerbose } as never)).toBe(verbose);
  });
});

describe("batchRunsVerbosely", () => {
  // A batch implementation's context always has isVerbose: false.
  it.each<[string, string | undefined, boolean]>([
    ["a batch of a verbose run", "true", true],
    ["a batch of another run", "false", false],
    ["a batch without the variable", undefined, false],
    ["a variable that is not true", "1", false],
  ])("%s", (_case, variable, verbose) => {
    expect(batchRunsVerbosely({ NX_VERBOSE_LOGGING: variable })).toBe(verbose);
  });
});
