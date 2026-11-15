import type { ProjectGraph, Task } from "@nx/devkit";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  dotenvProblem,
  expansionLookup,
  followedDotenvExpand,
  lengthLimit,
  nestingLimit,
} from "../src/executors/dotenv-check";
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

describe("the check of a task's dotenv files", () => {
  it("follows the dotenv-expand that this repository's Nx installs", () => {
    const nx = dirname(require.resolve("nx/package.json"));
    const version = require(require.resolve("dotenv-expand/package.json", { paths: [nx] })).version;
    expect(version).toBe(followedDotenvExpand);
  });

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
        rmSync(root, { recursive: true, force: true });
        mkdirSync(root);
        expect({ form, problem: check({ ".env": `VALUE=${form}\n` }) }).toEqual({
          form,
          problem: expect.stringContaining(`.env makes Nx look up ${name} where it expands VALUE`),
        });
      }
    },
  );

  it("follows the values that dotenv-expand substitutes and the references it assembles", () => {
    const fails = (files: Record<string, string>, env: NodeJS.ProcessEnv = {}) => {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root);
      return check(files, env);
    };
    // A value of the command's environment that holds a reference.
    expect(
      fails({ ".env.test": "VALUE=${INDIRECT}\n" }, { INDIRECT: "${NX_WORKSPACE_ROOT}" }),
    ).toContain("makes Nx look up NX_WORKSPACE_ROOT where it expands VALUE");
    // A variable of another file, as dotenv puts its raw value in place.
    expect(
      fails({ ".env": "VALUE=${INDIRECT}\n", "crates/indep/.env": "INDIRECT=$NX_TUI\n" }),
    ).toContain("look up NX_TUI");
    // A name put together from a value and the file's text.
    expect(fails({ ".env": "VALUE=${FORCE_${PART}}\n" }, { PART: "COLOR" })).toContain(
      "look up FORCE_COLOR where it expands VALUE",
    );
    expect(fails({ ".env": "VALUE=$${NAME}\n" }, { NAME: "NX_TASK_HASH" })).toContain(
      "look up NX_TASK_HASH where it expands VALUE",
    );
    expect(fails({ ".env": "VALUE=${DOLLAR}NX_VERBOSE_LOGGING\n" }, { DOLLAR: "$" })).toContain(
      "look up NX_VERBOSE_LOGGING where it expands VALUE",
    );
    // A variable that a file defines can be empty where Nx expands, if the
    // command sets it so, although the task ends with the file's value; its
    // default is followed too.
    expect(
      fails({ ".env": "SET=x\nVALUE=${SET:-$NX_FORKED_TASK_EXECUTOR}\n" }, { SET: "x" }),
    ).toContain("look up NX_FORKED_TASK_EXECUTOR where it expands VALUE");
    // Where the variable is set nowhere but in the file, its default is not.
    expect(
      fails({ ".env": "SET=x\nVALUE=${UNSET_TOO:+$NX_TUI}${SET:+ok}\n" }, { SET: "x" }),
    ).toBeUndefined();
  });

  it("passes files that only define such a variable, escape it, or read other variables", () => {
    expect(
      check(
        {
          ".env": "FORCE_COLOR=1\nNX_TASK_HASH=${FORCE_COLOR}\nPASSWORD=pa$$word\n",
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
      ["A=${X${Y}}\nB=$${Z}\n", { Y: "1", Z: "HOME", HOME: "/h" }],
      ["FORCE_COLOR=1\nA=${UNSET:-plain}\n", {}],
    ];
    const names = Object.keys(runDependentVariables);
    for (const [content, env] of cases) {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root);
      expect(check({ ".env": content }, env)).toBeUndefined();
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

  it("follows each value that a name can have and gives up after a limit", () => {
    const lookups = (raw: string, values: Record<string, (string | undefined)[]>) =>
      expansionLookup(
        raw,
        (name) => values[name] ?? [undefined],
        (name) => name === "U",
        Math.max(
          raw.length,
          ...Object.values(values)
            .flat()
            .map((value) => value?.length ?? 0),
        ),
      );
    expect(lookups("${A:-$U}", { A: ["x"] })).toBeUndefined();
    expect(lookups("${A:-$U}", { A: ["x", ""] })).toBe("U");
    expect(lookups("${A:+$U}", { A: [""] })).toBeUndefined();
    expect(lookups("${A:+$U}", { A: ["", "x"] })).toBe("U");
    // One value per name: two hundred values of A, each referring to A,
    // end on the value already seen.
    expect(lookups("$A", { A: Array.from({ length: 200 }, (_, i) => `$A${i}$A`) })).toBeUndefined();
    // A variable that refers to itself with text around the reference, on
    // which dotenv-expand does not end, and two that refer to each other.
    expect(lookups("${B}z", { B: ["x${B}"] })).toEqual({ stop: "nesting", name: "B" });
    expect(lookups("x$A", { A: ["${B}"], B: ["${A}"] })).toEqual({ stop: "cycle" });
    // A name that comes back inside its own value, where the expansion still
    // ends: the second time, its value equals an earlier whole result.
    expect(lookups("${A}", { A: ["x${A}"] })).toBeUndefined();
    // Twenty variables that the files define, read plainly, follow one path.
    const many = Array.from({ length: 20 }, (_, index) => `V${index}`);
    expect(
      lookups(
        many.map((name) => `\${${name}}`).join(",") + "$U",
        Object.fromEntries(many.map((name) => [name, [`${name}-value`, ""]])),
      ),
    ).toBe("U");
  });

  it("keeps one value for each name within one expansion, so that repeated references do not multiply", () => {
    // The reviewer's file: fourteen references to a variable that the file
    // defines and the command does not set.
    const origins = Array.from({ length: 14 }, (_, port) => `http://\${HOST}:80${10 + port}`);
    expect(
      check(
        { "crates/indep/.env.test": `HOST=localhost\nORIGINS=${origins.join(",")}\n` },
        { HOST: "localhost", ORIGINS: origins.join(",").split("${HOST}").join("localhost") },
      ),
    ).toBeUndefined();
    // The reviewer's list: 257 references to a variable of the command,
    // which Nx expands to 5,653 characters.
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    const long = Array.from({ length: 257 }, (_, port) => `http://\${HOST}:${8000 + port}`);
    expect(
      check({ "crates/indep/.env.test": `ORIGINS=${long.join(",")}\n` }, { HOST: "localhost" }),
    ).toBeUndefined();
    // An expansion that does not end, and one that grows too long.
    write({ "crates/indep/.env": "B=x${B}\nVALUE=${B}z\n" });
    expect(check({}, { B: "x" })).toContain(
      `crates/indep/.env: Nx's expansion of VALUE does not end: the value of B is put in again inside the text that putting it in gave, ${nestingLimit} times over`,
    );
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    const huge = "y".repeat(lengthLimit / 2);
    expect(check({ "crates/indep/.env": `VALUE=\${HUGE}\${HUGE}z\n` }, { HUGE: huge })).toContain(
      `Nx's expansion of VALUE grows beyond ${lengthLimit} characters`,
    );
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
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    expect(
      check({ ".env.local": "NX_LOAD_DOT_ENV_FILES=true\n" }, { NX_LOAD_DOT_ENV_FILES: "false" }),
    ).toContain(".env.local defines NX_LOAD_DOT_ENV_FILES");
    // Defined nowhere, the task's value is the nx process's.
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    expect(
      check(
        { "crates/indep/.env.test": "REVIEW_COLOR=${FORCE_COLOR-unset}\n" },
        { NX_LOAD_DOT_ENV_FILES: "false" },
      ),
    ).toBeUndefined();
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
      cargoTaskEnvironment(fromTerminal, { configuration: undefined, continuousDependency: false }),
    ).toEqual({ KEPT: "kept" });
    expect(
      cargoTaskEnvironment(
        { ...fromTerminal, NX_SKIP_NX_CACHE: "true" },
        { configuration: "ci", continuousDependency: true },
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
