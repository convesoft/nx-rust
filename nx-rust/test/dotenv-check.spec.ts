import type { ProjectGraph, Task } from "@nx/devkit";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dotenvProblem } from "../src/executors/dotenv-check";
import {
  batchTaskEnvironment,
  cargoTaskEnvironment,
  runDependentVariables,
  withoutUnloadedRootValues,
} from "../src/executors/task-env";

// The check of VER-BATCHING that a task's dotenv files give cargo the same
// values in every way of running the task (DES-BATCH, "Dotenv files"), on
// files in a temporary folder and with the dotenv and dotenv-expand of this
// repository's Nx. batch-runs.spec.ts runs it through Nx, for a task on its
// own and in a batch.

const graph = {
  nodes: {
    indep: { name: "indep", type: "lib", data: { root: "crates/indep", targets: { test: {} } } },
  },
  dependencies: {},
} as unknown as ProjectGraph;

const task = {
  id: "indep:test",
  target: { project: "indep", target: "test" },
  projectRoot: "crates/indep",
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nx-rust-dotenv-check-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** The check, with the files written and `env` beside Nx's NX_LOAD_DOT_ENV_FILES. */
function check(files: Record<string, string>, env: NodeJS.ProcessEnv = {}): string | undefined {
  write(files);
  return dotenvProblem(task, graph, root, { NX_LOAD_DOT_ENV_FILES: "true", ...env });
}

function freshCheck(
  files: Record<string, string>,
  env: NodeJS.ProcessEnv = {},
): string | undefined {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root);
  return check(files, env);
}

describe("the check of a task's dotenv files", () => {
  it("passes a task without dotenv files, and one where Nx loads none", () => {
    expect(check({})).toBeUndefined();
    expect(
      dotenvProblem(task, graph, root, { NX_LOAD_DOT_ENV_FILES: undefined, FORCE_COLOR: "1" }),
    ).toBeUndefined();
    write({ "crates/indep/.env.test": "REVIEW_COLOR=${FORCE_COLOR-unset}\n" });
    expect(dotenvProblem(task, graph, root, {})).toBeUndefined();
  });

  it("fails the reviewer's file, which reads FORCE_COLOR, and names the file, the variable and why", () => {
    expect(check({ "crates/indep/.env.test": "REVIEW_COLOR=${FORCE_COLOR-unset}\n" })).toBe(
      `crates/indep/.env.test makes Nx look up FORCE_COLOR where it expands REVIEW_COLOR, and FORCE_COLOR has a value there that depends on how the task runs: ${runDependentVariables.FORCE_COLOR}. The task would get other values alone than in a batch, or in another output style, under one cache key (\`DES-BATCH\`, "Dotenv files"). The task does not run, so that Nx stores no result for it. Remove the reference to FORCE_COLOR from REVIEW_COLOR.`,
    );
  });

  it.each(Object.keys(runDependentVariables))(
    "fails a file that reads %s, in every form of reference",
    (name) => {
      for (const form of [
        `$${name}`,
        `\${${name}}`,
        `x\${${name}:-d}`,
        `\${${name}-d}`,
        `\${${name}:+a}`,
        `\${${name}+a}`,
        `\${NX_RUST_TEST_UNSET:-$${name}}`,
      ]) {
        expect({ form, problem: freshCheck({ ".env": `VALUE=${form}\n` }) }).toEqual({
          form,
          problem: expect.stringContaining(`.env makes Nx look up ${name} where it expands VALUE`),
        });
      }
    },
  );

  it("follows referenced values, $$NAME indirection, and refuses dynamic or ambiguous $ forms", () => {
    // A value of the command's environment that holds a reference.
    expect(
      freshCheck({ ".env.test": "VALUE=${INDIRECT}\n" }, { INDIRECT: "${NX_WORKSPACE_ROOT}" }),
    ).toContain("makes Nx look up NX_WORKSPACE_ROOT where it expands VALUE");
    // A variable of another file, as dotenv puts its raw value in place.
    expect(
      freshCheck({ ".env": "VALUE=${INDIRECT}\n", "crates/indep/.env": "INDIRECT=$NX_TUI\n" }),
    ).toContain("look up NX_TUI");
    // $$NAME leaves the first $ in place and re-scans `$<value of NAME>`.
    expect(
      freshCheck({
        "crates/indep/.env.test":
          "SELECTED=FORCE_COLOR\nFORCE_COLOR=file-value\nVALUE=$$SELECTED\n",
      }),
    ).toContain("crates/indep/.env.test makes Nx look up FORCE_COLOR where it expands VALUE");
    expect(
      freshCheck(
        { "crates/indep/.env.test": "VALUE=$$SELECTED\n" },
        { SELECTED: "NX_FORKED_TASK_EXECUTOR" },
      ),
    ).toContain(
      "crates/indep/.env.test makes Nx look up NX_FORKED_TASK_EXECUTOR where it expands VALUE",
    );
    expect(
      freshCheck({
        "crates/indep/.env.test":
          'export SELECTED=FORCE_COLOR # inline\r\nFORCE_COLOR=x\r\nexport VALUE="first\r\n$$SELECTED"\r\n',
      }),
    ).toContain("crates/indep/.env.test makes Nx look up FORCE_COLOR where it expands VALUE");
    expect(freshCheck({ ".env": "SELECTED={FORCE_COLOR}\nVALUE=$$SELECTED\n" })).toContain(
      "a $$ reference that can assemble a variable name dynamically",
    );
    expect(freshCheck({ ".env": "A=B\nB=FORCE_COLOR\nVALUE=$$$A\n" })).toContain(
      "a $$ reference that can assemble a variable name dynamically",
    );
    // A name assembled from a value and the file's text is refused statically.
    expect(freshCheck({ ".env": "VALUE=${FORCE_${PART}}\n" }, { PART: "COLOR" })).toContain(
      ".env expands VALUE through a ${...} reference whose variable name is assembled dynamically",
    );
    expect(freshCheck({ ".env": "VALUE=$${NAME}\n" }, { NAME: "NX_TASK_HASH" })).toContain(
      ".env expands VALUE through a $$ reference that can assemble a variable name dynamically",
    );
    expect(
      freshCheck({ ".env": "VALUE=${DOLLAR}NX_VERBOSE_LOGGING\n" }, { DOLLAR: "$" }),
    ).toContain(".env expands VALUE (via DOLLAR) through a trailing $ that can join adjacent text");
    // Both branches of :-, -, :+ and + are walked statically, also where the
    // condition variable is set or unset.
    expect(
      freshCheck({ ".env": "SET=x\nVALUE=${SET:-$NX_FORKED_TASK_EXECUTOR}\n" }, { SET: "x" }),
    ).toContain("look up NX_FORKED_TASK_EXECUTOR where it expands VALUE");
    expect(
      freshCheck({ ".env": "SET=x\nVALUE=${UNSET_TOO:+$NX_TUI}${SET:+ok}\n" }, { SET: "x" }),
    ).toContain("look up NX_TUI where it expands VALUE");
    expect(freshCheck({ ".env": "VALUE=${SET:-$FORCE_COLOR}\n" }, { SET: "x" })).toContain(
      "look up FORCE_COLOR where it expands VALUE",
    );
  });

  it("refuses dotenv-expand's null-split, earlier-escaped replacement, unclosed-brace closure, and replace patterns", () => {
    // dotenv-expand splits operator-less braced bodies with `split(null)` -> "null".
    expect(freshCheck({ ".env": "VALUE=${NX_FORKED_TASK_EXECUTORnull}\n" })).toContain(
      ".env makes Nx look up NX_FORKED_TASK_EXECUTOR where it expands VALUE",
    );
    expect(freshCheck({ ".env": "VALUE=${Anull$FORCE_COLOR}\n" })).toContain(
      ".env makes Nx look up FORCE_COLOR where it expands VALUE",
    );
    // String.prototype.replace substitutes into an earlier escaped occurrence
    // of the matched reference template.
    expect(
      freshCheck({
        ".env": "NAME=x$NX_FORKED_TASK_\nVALUE=\\$NAMEEXECUTOR $NAME\n",
      }),
    ).toContain("an unbraced $ reference that can join adjacent text");
    expect(
      freshCheck({
        ".env": "A=x$NX_FORKED_TASK_\nB=$A\nVALUE=\\$AEXECUTOR ${B}\n",
      }),
    ).toContain("an unbraced $ reference that can join adjacent text");
    expect(freshCheck({ ".env": "VALUE=\\${A}COLOR ${A}\n" }, { A: "x$FORCE_" })).toContain(
      "an unbraced $ reference that can join adjacent text",
    );
    expect(
      freshCheck({ ".env": "VALUE=\\${A}COLOR ${B}\n" }, { A: "x$FORCE_", B: "p${A} " }),
    ).toContain("an unbraced $ reference that can join adjacent text");
    // An unclosed `${` at top level followed by a matched reference can be
    // closed by the substitution (e.g. PART="COLOR}").
    expect(freshCheck({ ".env": "VALUE=${FORCE_${PART}\n" }, { PART: "COLOR}" })).toContain(
      ".env expands VALUE through a ${...} reference whose variable name is assembled dynamically",
    );
    // Dynamic variable names, even where they would expand to ordinary names.
    expect(freshCheck({ ".env": "A=${X${Y}}\n" }, { Y: "1" })).toContain(
      ".env expands A through a ${...} reference whose variable name is assembled dynamically",
    );
    expect(freshCheck({ ".env": "B=$${Z}\n" }, { Z: "HOME", HOME: "/h" })).toContain(
      ".env expands B through a $$ reference that can assemble a variable name dynamically",
    );
    // Unclosed `${` and empty `${}` inside a referenced value or default.
    expect(freshCheck({ ".env": "VALUE=${A}\n" }, { A: "${UNCLOSED" })).toContain(
      "an unclosed ${...} reference",
    );
    expect(freshCheck({ ".env": "VALUE=${A}\n" }, { A: "${}" })).toContain(
      "a ${...} reference whose variable name is assembled dynamically",
    );
    // String.prototype.replace patterns (including after `\`, since replace
    // ignores backslashes) and trailing $ that can join text.
    expect(freshCheck({ ".env": "VALUE=${A}\n" }, { A: "$&" })).toContain(
      "a $ replacement pattern in a referenced value or default",
    );
    expect(freshCheck({ ".env": "VALUE=${A}\n" }, { A: "\\$&" })).toContain(
      "a $ replacement pattern in a referenced value or default",
    );
    expect(freshCheck({ ".env": "VALUE=${A}x\n" }, { A: "\\$'" })).toContain(
      "a $ replacement pattern in a referenced value or default",
    );
    expect(freshCheck({ ".env": "VALUE=${A}\n" }, { A: "\\$`" })).toContain(
      "a $ replacement pattern in a referenced value or default",
    );
    expect(freshCheck({ ".env": "VALUE=${A:-$&}\n" })).toContain(
      "a $ replacement pattern in a referenced value or default",
    );
    expect(freshCheck({ ".env": "VALUE=${A:-$}FORCE_COLOR\n" })).toContain(
      "a trailing $ that can join adjacent text",
    );
    expect(freshCheck({ ".env": "VALUE=${A}{FORCE_COLOR}\n" }, { A: "pa$" })).toContain(
      "a trailing $ that can join adjacent text",
    );
    // Default/alternative bodies and referenced values scanned as substituted text.
    expect(freshCheck({ ".env": "VALUE=${A:-$FORCE_}COLOR\n" })).toContain(
      "an unbraced $ reference that can join adjacent text",
    );
    expect(freshCheck({ ".env": "PASSWORD=pa$$FORCE_\nUSE=${PASSWORD}COLOR\n" })).toContain(
      "an unbraced $ reference that can join adjacent text",
    );
    expect(freshCheck({ ".env": "PASSWORD=pa$$FORCE_COLOR\nUSE=${PASSWORD}\n" })).toContain(
      "look up FORCE_COLOR",
    );
    expect(freshCheck({ ".env": "B=${A}\nC=${B}COLOR\n" }, { A: "$FORCE_" })).toContain(
      "an unbraced $ reference that can join adjacent text",
    );
  });

  it("passes forms that the installed dotenv-expand reads as plain text or safe literals", () => {
    // Any backslash immediately before `$` escapes it in dotenv-expand (`(?<!\\)`).
    expect(freshCheck({ ".env": "VALUE=\\$FORCE_COLOR\n" })).toBeUndefined();
    expect(freshCheck({ ".env": "VALUE=\\\\$FORCE_COLOR\n" })).toBeUndefined();
    expect(freshCheck({ ".env": "VALUE=\\\\\\$FORCE_COLOR\n" })).toBeUndefined();
    expect(freshCheck({ ".env": "VALUE=\\\\\\\\$FORCE_COLOR\n" })).toBeUndefined();
    expect(freshCheck({ ".env": "VALUE=\\\\${FORCE_COLOR}\n" })).toBeUndefined();
    // Non-identifier literal braced names and unknown operators (`:?`), which
    // dotenv-expand reads as one literal key (`SET:?error`, not `SET`).
    expect(
      freshCheck({ ".env": "APP.VERSION=1\nVALUE=${APP.VERSION}\n" }, { "APP.VERSION": "1" }),
    ).toBeUndefined();
    expect(freshCheck({ ".env": "1=one\nVALUE=${1}\n" }, { "1": "one" })).toBeUndefined();
    expect(freshCheck({ ".env": "VALUE=${SET:?error}\n" })).toBeUndefined();
    expect(
      freshCheck({ ".env": "VALUE=${SET:?error}\n" }, { SET: "$FORCE_COLOR" }),
    ).toBeUndefined();
    // Top-level unclosed `${` (with no matched reference after it) and `${}`.
    expect(freshCheck({ ".env": "VALUE=${UNCLOSED\n" })).toBeUndefined();
    expect(freshCheck({ ".env": "VALUE=${}\n" })).toBeUndefined();
    // Safe `pa$$word` referenced in `VALUE=${PASSWORD}` even with post-expansion
    // `env.PASSWORD = "pa$"` (nothing follows `${PASSWORD}` to join with `$`).
    expect(
      freshCheck(
        { "crates/indep/.env.test": "PASSWORD=pa$$word\nVALUE=${PASSWORD}\n" },
        { PASSWORD: "pa$", VALUE: "pa" },
      ),
    ).toBeUndefined();
    // Joining identifier text after `${PASSWORD}` is still refused.
    expect(
      freshCheck(
        { "crates/indep/.env.test": "PASSWORD=pa$$word\nUSE=${PASSWORD}COLOR\n" },
        { PASSWORD: "pa$" },
      ),
    ).toBeDefined();
    // Non-special characters after `$` / `$$` (such as `$!` or `$$!` in secrets).
    expect(
      freshCheck(
        { ".env": "VALUE=${DUMMY_TOKEN}\n" },
        { DUMMY_TOKEN: "$!SAMPLE_SECRET_DO_NOT_USE" },
      ),
    ).toBeUndefined();
    expect(freshCheck({ ".env": "PASSWORD=pa$$!DUMMY_TOKEN\n" })).toBeUndefined();
  });

  it("never prints any character from a file or environment value in any diagnostic", () => {
    const secret = "NX_RUST_SECRET_MARKER_9F3A";
    const cases: [Record<string, string>, NodeJS.ProcessEnv][] = [
      [{ ".env": `VALUE=\${${secret}_\${PART}}\n` }, { PART: secret }],
      [{ ".env": `VALUE=\${A}\n` }, { A: `\${${secret}` }],
      [{ ".env": `VALUE=$\${${secret}}\n` }, {}],
      [{ ".env": "VALUE=${DUMMY_TOKEN}\n" }, { DUMMY_TOKEN: `$&${secret}` }],
      [{ ".env": `VALUE=\${A:-$&${secret}}\n` }, {}],
      [{ ".env": "VALUE=${DUMMY_TOKEN}COLOR\n" }, { DUMMY_TOKEN: `${secret}$` }],
      [{ ".env": "VALUE=${DUMMY_TOKEN}COLOR\n" }, { DUMMY_TOKEN: `$${secret}` }],
      [{ ".env": "SELECTED=$$${secret}\nVALUE=$$SELECTED\n" }, { SELECTED: `{${secret}}` }],
      // Nested reference inside a command value reached via a non-identifier key
      // (`${1}`) must never promote a key parsed from that value into `via`.
      [{ ".env": "VALUE=${1}\n" }, { "1": `\${${secret}:-$&}` }],
      [{ ".env": "VALUE=${1}\n" }, { "1": `\${${secret}}`, [secret]: "$&" }],
      [{ ".env": `VALUE=\${FORCE_COLOR:-${secret}}\n` }, { FORCE_COLOR: secret }],
      [{ ".env": `NX_LOAD_DOT_ENV_FILES=${secret}\n` }, {}],
      [
        { ".env": "A=1\n", ".env.vault": `DOTENV_VAULT_TEST=${secret}\n` },
        { DOTENV_KEY: `dotenv://:${secret}@x/.env.vault?environment=test` },
      ],
    ];
    for (const [files, env] of cases) {
      const problem = freshCheck(files, env);
      expect(problem).toBeDefined();
      expect(problem).not.toContain(secret);
      expect(problem).not.toContain("SECRET_MARKER");
      expect(problem).not.toContain("9F3A");
    }
  });

  it("passes self-append idioms whether the variable is unset or set in the command", () => {
    const cases: [string, string, string][] = [
      ["RUSTFLAGS=${RUSTFLAGS} --cfg tokio_unstable", "RUSTFLAGS", "-Dwarnings"],
      ['RUSTFLAGS="$RUSTFLAGS -C target-cpu=native"', "RUSTFLAGS", "-Dwarnings"],
      ["PATH=${PATH}:./bin", "PATH", "/usr/bin:/bin"],
      [
        "CARGO_BUILD_RUSTFLAGS=${CARGO_BUILD_RUSTFLAGS:-} -C debuginfo=0",
        "CARGO_BUILD_RUSTFLAGS",
        "-Dwarnings",
      ],
      ['RUSTFLAGS="-C target-cpu=native $RUSTFLAGS"', "RUSTFLAGS", "-Dwarnings"],
    ];
    for (const [line, name, preset] of cases) {
      expect(freshCheck({ "crates/indep/.env.test": `${line}\n` })).toBeUndefined();
      expect(
        freshCheck({ "crates/indep/.env.test": `${line}\n` }, { [name]: preset }),
      ).toBeUndefined();
    }
  });

  it("passes files that only define such a variable, escape it, or read other variables", () => {
    expect(
      check(
        {
          ".env": "FORCE_COLOR=1\nNX_TASK_HASH=${FORCE_COLOR}\nPASSWORD=pa$$word\nREGEX=^foo$\n",
          "crates/indep/.env.test": "ESCAPED=\\$FORCE_COLOR\nHOMELY=${HOME}/x\nUSE=${PASSWORD}\n",
        },
        { HOME: "/home/someone" },
      ),
    ).toBeUndefined();
  });

  it("fails a task whose dotenv variables dotenv would read from a vault", () => {
    write({
      "crates/indep/.env.test": "A=1\n",
      "crates/indep/.env.test.vault": "DOTENV_VAULT=x\n",
    });
    expect(check({}, { DOTENV_KEY: "dotenv://:key@x/vault/.env.vault?environment=test" })).toBe(
      'DOTENV_KEY is set and crates/indep/.env.test.vault exists, so Nx reads the task\'s dotenv variables from that vault, which @convesoft/nx-rust cannot check (`DES-BATCH`, "Dotenv files"). The task does not run, so that Nx stores no result for it. Remove the vault or unset DOTENV_KEY for this command.',
    );
    expect(check({})).toBeUndefined();
    // A root vault, which Nx reads when it removes the root files' values,
    // without any plain dotenv file, and whether or not Nx loads the files.
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    write({ ".env.vault": "DOTENV_VAULT_TEST=x\n" });
    for (const loading of ["true", "false"]) {
      expect(
        dotenvProblem(task, graph, root, {
          NX_LOAD_DOT_ENV_FILES: loading,
          DOTENV_KEY: "dotenv://:key@x/vault/.env.vault?environment=test",
        }),
      ).toContain("DOTENV_KEY is set and .env.vault exists");
    }
    expect(dotenvProblem(task, graph, root, { NX_LOAD_DOT_ENV_FILES: "true" })).toBeUndefined();
  });

  it("finds no variable of the set where the real dotenv-expand gives the same values whatever they are", () => {
    // Nx's own loader, over environments that differ only in the variables
    // of the set: where the check finds none of them looked up, the values
    // of every other variable agree.
    const { loadAndExpandDotEnvFile } = require("nx/src/tasks-runner/task-env");
    const cases: [string, NodeJS.ProcessEnv][] = [
      ["A=${B}\nB=$HOME\nC=${A:-x}${D:+y}\n", { HOME: "/h", D: "" }],
      ["A=pa$$word\nB=${A}\nC=\\${FORCE_COLOR}\n", {}],
      ["FORCE_COLOR=1\nA=${UNSET:-plain}\n", {}],
      ["RUSTFLAGS=${RUSTFLAGS} --cfg tokio_unstable\n", {}],
      ["APP.VERSION=1\nA=${APP.VERSION}\nB=${SET:?error}\n", { SET: "$FORCE_COLOR" }],
      ["A=\\\\$FORCE_COLOR\nB=${UNCLOSED\nC=${}\n", {}],
    ];
    const names = Object.keys(runDependentVariables);
    for (const [content, env] of cases) {
      expect(freshCheck({ ".env": content }, env)).toBeUndefined();
      const results = [{}, Object.fromEntries(names.map((name) => [name, "$HOME-{}"]))].map(
        (unsafe) => {
          const into: NodeJS.ProcessEnv = { ...env, ...unsafe };
          loadAndExpandDotEnvFile([join(root, ".env")], into);
          return Object.fromEntries(Object.entries(into).filter(([name]) => !names.includes(name)));
        },
      );
      expect(results[1]).toEqual(results[0]);
    }
  });

  it("handles repeated references, many variables, and safe cycles without simulator bounds", () => {
    // The reviewer's file: fourteen references to a variable that the file
    // defines and the command does not set.
    const origins = Array.from({ length: 14 }, (_, port) => `http://\${HOST}:80${10 + port}`);
    expect(
      freshCheck(
        { "crates/indep/.env.test": `HOST=localhost\nORIGINS=${origins.join(",")}\n` },
        { HOST: "localhost", ORIGINS: origins.join(",").split("${HOST}").join("localhost") },
      ),
    ).toBeUndefined();
    // The reviewer's list: 257 references to a variable of the command,
    // which Nx expands to 5,653 characters.
    const long = Array.from({ length: 257 }, (_, port) => `http://\${HOST}:${8000 + port}`);
    expect(
      freshCheck(
        { "crates/indep/.env.test": `ORIGINS=${long.join(",")}\n` },
        { HOST: "localhost" },
      ),
    ).toBeUndefined();
    // Twenty variables that the files define, read plainly, ending in an unsafe
    // reference: linear walk without exponential branching.
    const many = Array.from({ length: 20 }, (_, index) => `V${index}`);
    const manyDefs = many.map((name) => `${name}=${name}-value`).join("\n");
    expect(
      freshCheck(
        {
          ".env": `${manyDefs}\nVALUE=${many.map((name) => `\${${name}}`).join(",")}$FORCE_COLOR\n`,
        },
        Object.fromEntries(many.map((name) => [name, `${name}-value`])),
      ),
    ).toContain(".env makes Nx look up FORCE_COLOR where it expands VALUE");
    // Cycles without run-dependent variables are no longer refused by the
    // static check (plain Nx already fails on non-terminating expansions before
    // the plugin runs; where the command sets the variable, both paths agree).
    expect(
      freshCheck({ "crates/indep/.env": "B=x${B}\nVALUE=${B}z\n" }, { B: "x" }),
    ).toBeUndefined();
    expect(
      freshCheck({ "crates/indep/.env": "A=${B}\nB=${A}\nVALUE=x${A}\n" }, { A: "hi" }),
    ).toBeUndefined();
    // A cycle that reaches a run-dependent variable is still refused.
    expect(freshCheck({ "crates/indep/.env": "A=${B}\nB=${A}${FORCE_COLOR}\n" })).toContain(
      "look up FORCE_COLOR",
    );
    // Long literal values without run-dependent references are no longer
    // refused by an artificial length cap.
    const huge = "y".repeat(65_536);
    expect(
      freshCheck({ "crates/indep/.env": "VALUE=${HUGE}${HUGE}z\n" }, { HUGE: huge }),
    ).toBeUndefined();
  });

  it("decides whether Nx loaded the files from the value that decided it, and fails a task whose files define it", () => {
    // The reviewer's files: the task ends with false, although Nx loaded them.
    expect(
      check(
        {
          ".env": "NX_LOAD_DOT_ENV_FILES=true\n",
          "crates/indep/.env.test":
            "NX_LOAD_DOT_ENV_FILES=false\nREVIEW_COLOR=${FORCE_COLOR-unset}\n",
        },
        { NX_LOAD_DOT_ENV_FILES: "false", REVIEW_COLOR: "unset" },
      ),
    ).toBe(
      "crates/indep/.env.test and .env define NX_LOAD_DOT_ENV_FILES, which decides in the nx process whether Nx loads the task's dotenv files at all, while the task's own environment can end with the file's value; @convesoft/nx-rust then cannot tell whether Nx loaded them, nor check them (`DES-BATCH`, \"Dotenv files\"). The task does not run, so that Nx stores no result for it. Remove the definition of NX_LOAD_DOT_ENV_FILES from crates/indep/.env.test and .env; to switch the loading of dotenv files off, set NX_LOAD_DOT_ENV_FILES=false in the environment of the nx command, in the shell or the CI settings.",
    );
    // Whatever value the file gives, and where Nx does not load the files.
    expect(
      freshCheck(
        { ".env.local": "NX_LOAD_DOT_ENV_FILES=true\n" },
        { NX_LOAD_DOT_ENV_FILES: "false" },
      ),
    ).toContain(".env.local defines NX_LOAD_DOT_ENV_FILES");
    // Defined nowhere, the task's value is the nx process's.
    expect(
      freshCheck(
        { "crates/indep/.env.test": "REVIEW_COLOR=${FORCE_COLOR-unset}\n" },
        { NX_LOAD_DOT_ENV_FILES: "false" },
      ),
    ).toBeUndefined();
  });
});

// A tripwire on the matching, splitting, escaping and replacing behaviour of
// `dotenv-expand` (`lib/main.js`) that `dotenv-check.ts` follows (DES-BATCH,
// "Dotenv files"; RISK-UPSTREAM-CHANGES). Users are not blocked at run time
// when Nx ships a newer `dotenv-expand`; this test trips in this repository
// before that Nx version counts as supported (REQ-COMPATIBILITY).
const recordedDotenvExpandSource = `'use strict'

function _resolveEscapeSequences (value) {
  return value.replace(/\\\\\\$/g, '$')
}

function expandValue (value, processEnv, runningParsed) {
  const env = { ...runningParsed, ...processEnv } // process.env wins

  const regex = /(?<!\\\\)\\\${([^{}]+)}|(?<!\\\\)\\$([A-Za-z_][A-Za-z0-9_]*)/g

  let result = value
  let match
  const seen = new Set() // self-referential checker

  while ((match = regex.exec(result)) !== null) {
    seen.add(result)

    const [template, bracedExpression, unbracedExpression] = match
    const expression = bracedExpression || unbracedExpression

    // match the operators \`:+\`, \`+\`, \`:-\`, and \`-\`
    const opRegex = /(:\\+|\\+|:-|-)/
    // find first match
    const opMatch = expression.match(opRegex)
    const splitter = opMatch ? opMatch[0] : null

    const r = expression.split(splitter)

    let defaultValue
    let value

    const key = r.shift()

    if ([':+', '+'].includes(splitter)) {
      defaultValue = env[key] ? r.join(splitter) : ''
      value = null
    } else {
      defaultValue = r.join(splitter)
      value = env[key]
    }

    if (value) {
      // self-referential check
      if (seen.has(value)) {
        result = result.replace(template, defaultValue)
      } else {
        result = result.replace(template, value)
      }
    } else {
      result = result.replace(template, defaultValue)
    }

    // if the result equaled what was in process.env and runningParsed then stop expanding
    if (result === runningParsed[key]) {
      break
    }

    regex.lastIndex = 0 // reset regex search position to re-evaluate after each replacement
  }

  return result
}

function expand (options) {
  // for use with progressive expansion
  const runningParsed = {}

  let processEnv = process.env
  if (options && options.processEnv != null) {
    processEnv = options.processEnv
  }

  // dotenv.config() ran before this so the assumption is process.env has already been set
  for (const key in options.parsed) {
    let value = options.parsed[key]

    // short-circuit scenario: process.env was already set prior to the file value
    if (processEnv[key] && processEnv[key] !== value) {
      value = processEnv[key]
    } else {
      value = expandValue(value, processEnv, runningParsed)
    }

    options.parsed[key] = _resolveEscapeSequences(value)

    // for use with progressive expansion
    runningParsed[key] = _resolveEscapeSequences(value)
  }

  for (const processKey in options.parsed) {
    processEnv[processKey] = options.parsed[processKey]
  }

  return options
}

module.exports.expand = expand
`;

describe("tripwire on Nx's installed dotenv-expand", () => {
  it("finds Nx's dotenv-expand lib/main.js unchanged from what dotenv-check.ts follows", () => {
    const nxDir = dirname(require.resolve("nx/package.json"));
    const file = require.resolve("dotenv-expand", { paths: [nxDir] });
    const source = readFileSync(file, "utf8");
    if (source !== recordedDotenvExpandSource) {
      throw new Error(
        `Nx's dotenv-expand at ${file} differs from the source text that nx-rust/src/executors/dotenv-check.ts follows. Re-read dotenv-expand's matching, splitting, escaping and replacing in that file, bring dotenv-check.ts and DES-BATCH ("Dotenv files") in line with any change, and then record the new source text here.`,
      );
    }
    expect(source).toBe(recordedDotenvExpandSource);
  });
});

describe("the environment that the plugin gives cargo", () => {
  it("leaves out what Nx's pseudo-terminal gives back and sets the task layer's variables as that layer does", () => {
    const fromTerminal = {
      KEPT: "kept",
      NX_SET_CLI: "from the command",
      NX_ORIGINAL_FORCE_COLOR: "0",
      NX_READY_SIGNAL_SOCKET: "socket",
      NX_READY_SIGNAL_TASK: "task",
      NX_READY_URL: "http://outer",
      NX_SKIP_NX_CACHE: "false",
      NX_TASK_TARGET_CONFIGURATION: "outer",
      NX_PSEUDO_TERMINAL_EXEC_ARGV: "",
    };
    expect(
      cargoTaskEnvironment(fromTerminal, { configuration: undefined, readyUrlDependency: false }),
    ).toEqual({ KEPT: "kept" });
    expect(
      cargoTaskEnvironment(
        { ...fromTerminal, NX_SKIP_NX_CACHE: "true" },
        { configuration: "ci", readyUrlDependency: true },
      ),
    ).toEqual({
      KEPT: "kept",
      NX_SKIP_NX_CACHE: "true",
      NX_TASK_TARGET_CONFIGURATION: "ci",
      NX_READY_URL: "http://outer",
    });
  });

  it("sets what Nx sets after the task layer for a task run on its own, in a batch", () => {
    const { getEnvVariablesForTask } = require("nx/src/tasks-runner/task-env");
    const task = {
      id: "indep:test",
      target: { project: "indep", target: "test" },
      projectRoot: "crates/indep",
      overrides: {},
      outputs: [],
    } as unknown as Task;
    const env = batchTaskEnvironment(
      { NX_FORKED_TASK_EXECUTOR: "false", NX_CLI_SET: "false", KEPT: "kept" },
      task,
      getEnvVariablesForTask,
      { NX_INVOCATION_ANCESTOR_PIDS: "12" },
    );
    expect(env).toMatchObject({
      NX_FORKED_TASK_EXECUTOR: "true",
      NX_CLI_SET: "true",
      NX_INVOCATION_ANCESTOR_PIDS: "12",
      KEPT: "kept",
    });
  });

  it("removes the root files' values again where Nx loads no dotenv files, apart from what Nx sets after them", () => {
    write({ ".env": "ROOT=1\nNX_SKIP_NX_CACHE=true\n", ".env.local": "OTHER=2\n" });
    const env = { ROOT: "1", OTHER: "changed", NX_SKIP_NX_CACHE: "true", KEPT: "kept" };
    expect(withoutUnloadedRootValues({ ...env, NX_LOAD_DOT_ENV_FILES: "false" }, root)).toEqual({
      OTHER: "changed",
      NX_SKIP_NX_CACHE: "true",
      KEPT: "kept",
      NX_LOAD_DOT_ENV_FILES: "false",
    });
    expect(withoutUnloadedRootValues({ ...env, NX_LOAD_DOT_ENV_FILES: "true" }, root)).toEqual({
      ...env,
      NX_LOAD_DOT_ENV_FILES: "true",
    });
  });
});
