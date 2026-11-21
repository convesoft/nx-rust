import type { ProjectGraph, Task } from "@nx/devkit";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { dotenvDefinitions, dotenvProblem } from "../src/executors/dotenv-check";
import {
  batchTaskEnvironment,
  cargoTaskEnvironment,
  type EnvVariablesForTask,
  rootDotenvFiles,
  runDependentVariables,
  taskDotenvLayer,
  withoutUnloadedRootValues,
} from "../src/executors/task-env";

// A guard of VER-BATCHING against the check of DES-BATCH ("Dotenv files")
// drifting from Nx: random dotenv files and command environments, from a
// seed that a failure prints, run through Nx 24's real loader. For every case
// that the check lets through, the environment that the plugin gives cargo
// for a task run on its own, piped, with its output in a file or in Nx's
// pseudo-terminal, equals the one it gives the task in a batch; and the check
// decides the same in both. The task run on its own gets its dotenv layer from
// Nx's own getTaskSpecificEnv, run over the nx process's environment; the
// task in a batch from the plugin's taskDotenvLayer, which builds it on a
// copy of the batch process's.
//
// To keep Nx's own dotenv-expand from hanging or running out of memory without
// keeping a second model of dotenv-expand here, generated references follow a
// strict acyclic order (every variable refers only to variables earlier in the
// order, plus a dedicated leaf variable that exercises self-append idioms such
// as `RUSTFLAGS=${RUSTFLAGS} ...`), so every seed terminates in Nx's loader
// with zero skips. Values can also hold the names of run-dependent variables
// (which sit at the bottom of the rank order, so `$$NAME` indirection still
// terminates cleanly and exercises `$$NAME` -> `$FORCE_COLOR` /
// `$NX_FORKED_TASK_EXECUTOR` from both files and the command's environment).
// Fixed cases below cover terminating multi-variable cycles (`A=${B}` with
// `B=${A}`) and `$$NAME` regressions directly. Set NX_RUST_DOTENV_SEED to
// rerun one seed.

const nx = dirname(require.resolve("nx/package.json"));
const taskEnv = require("nx/src/tasks-runner/task-env") as {
  getTaskSpecificEnv(task: Task, graph: ProjectGraph): NodeJS.ProcessEnv;
  unloadDotEnvFile(file: string, env: NodeJS.ProcessEnv): void;
  loadAndExpandDotEnvFile(files: string[], env: NodeJS.ProcessEnv): void;
  getEnvFilesForTask(task: Task, graph: ProjectGraph): string[];
  getEnvVariablesForTask: EnvVariablesForTask;
};
const workspaceRootModule = require("nx/src/utils/workspace-root") as {
  workspaceRoot: string;
  setWorkspaceRoot(root: string): void;
};
const { workspaceRoot } = workspaceRootModule;
const dotenv = require(require.resolve("dotenv", { paths: [nx] })) as {
  config(options: object): { parsed?: Record<string, string> };
};
const dotenvExpand = require(require.resolve("dotenv-expand", { paths: [nx] })) as {
  expand(options: object): void;
};

const graph = {
  nodes: {
    indep: { name: "indep", type: "lib", data: { root: "crates/indep", targets: { test: {} } } },
  },
  dependencies: {},
} as unknown as ProjectGraph;

const nxOwn = [
  "FORCE_COLOR",
  "NX_FORKED_TASK_EXECUTOR",
  "NX_CLI_SET",
  "NX_SKIP_NX_CACHE",
  "NX_TASK_TARGET_CONFIGURATION",
  "NX_SET_CLI",
  "NX_ORIGINAL_FORCE_COLOR",
  "NX_VERBOSE_LOGGING",
  "NX_TUI",
  "NX_WORKSPACE_ROOT",
  "NX_DAEMON",
  "NX_PARALLEL",
  "NX_READY_URL",
  "NX_TASK_TARGET_PROJECT",
  "NX_LOAD_DOT_ENV_FILES",
];
const ordinary = ["HOST", "URL", "A", "B"];
// Strict topological order for generated references: a variable at index `i`
// may refer only to variables at index `< i`, guaranteeing termination in Nx's
// own dotenv-expand without a second simulator.
const ordered = [...nxOwn, "CMD", ...ordinary];
const rankOf = new Map(ordered.map((name, index) => [name, index]));
const names = [...ordinary, ...nxOwn, "CMD", "RUSTFLAGS"];

/** mulberry32: a small seeded generator. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GeneratedCase {
  configuration: string | undefined;
  files: Record<string, string>;
  command: NodeJS.ProcessEnv;
  verbose: boolean | undefined;
  tui: string;
  stream: boolean;
  skipFlag: boolean;
  way: "piped" | "file" | "terminal";
  streamOutput: boolean;
}

function caseOf(seed: number): GeneratedCase {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const varNameLiteral = () =>
    pick(["FORCE_COLOR", "NX_FORKED_TASK_EXECUTOR", "NX_TUI", "NX_TASK_HASH", "HOST"]);
  const literal = () =>
    next() < 0.15
      ? varNameLiteral()
      : pick(["x", "1", "true", "false", "", "a b", "0", "localhost"]);
  const earlierPool = (owner: string): { safe: string[]; nx: string[] } => {
    const ownerRank = rankOf.get(owner) ?? ordered.length;
    const safe = ["CMD", ...ordinary].filter((name) => (rankOf.get(name) ?? 0) < ownerRank);
    const nx = nxOwn.filter((name) => (rankOf.get(name) ?? 0) < ownerRank);
    return { safe, nx };
  };
  const piece = (owner: string, depth: number): string => {
    const pool = earlierPool(owner);
    const canRef = pool.safe.length > 0 || pool.nx.length > 0;
    const pickRef = (): string => {
      if (pool.safe.length > 0 && (pool.nx.length === 0 || next() < 0.75)) {
        return pick(pool.safe);
      }
      return pick(pool.nx);
    };
    const inner = () => (depth < 1 && next() < 0.5 ? piece(owner, depth + 1) : literal());
    const kind = Math.floor(next() * 12);
    if (!canRef && kind >= 1 && kind <= 10) {
      return literal();
    }
    switch (kind) {
      case 0:
        return literal();
      case 1:
        return `$${pickRef()}`;
      case 2:
        return `\${${pickRef()}}`;
      case 3:
        return `\${${pickRef()}:-${inner()}}`;
      case 4:
        return `\${${pickRef()}-${inner()}}`;
      case 5:
        return `\${${pickRef()}:+${inner()}}`;
      case 6:
        return `\${${pickRef()}+${inner()}}`;
      case 7:
        return `\\$${pickRef()}`;
      case 8:
        return pick(["$$", "$", "$$" + pickRef()]);
      case 9:
        // Prefixes never assemble a variable in `ordinary` or `CMD`, so dynamic
        // names cannot introduce a cycle in dotenv-expand.
        return `\${${pick(["NX_", "FORCE_", "X_"])}\${${pickRef()}}}`;
      case 10:
        return `\\\\$${pickRef()}`;
      default:
        return `${literal()}:${literal()}`;
    }
  };
  const value = (owner: string) => {
    let text = "";
    for (let parts = 1 + Math.floor(next() * 3); parts > 0; parts--) {
      text += piece(owner, 0);
    }
    const quote = next();
    return quote < 0.1 ? `'${text}'` : quote < 0.2 ? `"${text}"` : text;
  };
  const configuration = next() < 0.3 ? "ci" : undefined;
  const candidates = [
    ".env",
    ".local.env",
    ".env.local",
    ".env.test",
    ".env.test.local",
    "crates/indep/.env",
    "crates/indep/.env.test",
    "crates/indep/.env.local",
    ...(configuration === undefined ? [] : [".env.ci", "crates/indep/.env.test.ci"]),
  ];
  const files: Record<string, string> = {};
  for (const path of candidates) {
    if (next() < 0.35) {
      const lines: string[] = [];
      for (let count = 1 + Math.floor(next() * 4); count > 0; count--) {
        // Nx's own variables, mostly with the plain values that Nx gives them.
        const own = next() < 0.3;
        const name = own ? pick(nxOwn) : pick(ordinary);
        lines.push(
          `${name}=${own && next() < 0.6 ? pick(["true", "false", "0", "1", ""]) : value(name)}`,
        );
      }
      files[path] = `${lines.join("\n")}\n`;
    }
  }
  // A long list of references to one variable, which Nx expands in finitely
  // many steps.
  if (next() < 0.06) {
    const path = pick(candidates);
    const name = pick([...ordinary, "CMD"]);
    const list = Array.from(
      { length: 150 + Math.floor(next() * 250) },
      (_, index) => `http://\${${name}}:${8000 + index}`,
    );
    files[path] = `${files[path] ?? ""}LIST=${list.join(",")}\n`;
  }
  // Self-append idiom on a leaf variable (referenced by no other variable),
  // which dotenv-expand's `seen` guard terminates in one step.
  if (next() < 0.08) {
    const path = pick(candidates);
    const line = pick([
      "RUSTFLAGS=${RUSTFLAGS} --cfg tokio_unstable",
      'RUSTFLAGS="$RUSTFLAGS -C target-cpu=native"',
      "RUSTFLAGS=${RUSTFLAGS:-} -C debuginfo=0",
    ]);
    files[path] = `${files[path] ?? ""}${line}\n`;
  }
  // Explicit `$$NAME` indirection where `NAME` holds a variable name in a file
  // or in the command's environment (strictly lower rank, so still acyclic).
  if (next() < 0.08) {
    const path = pick(candidates);
    const targetVar = varNameLiteral();
    if (next() < 0.5) {
      files[path] = `${files[path] ?? ""}HOST=${targetVar}\nB=$$HOST\n`;
    } else {
      files[path] = `${files[path] ?? ""}B=$$CMD\n`;
    }
  }
  // A root vault, which decrypts with the key below to REVIEW_VAULT=secret,
  // with plain files beside it or, in four of ten, alone.
  if (next() < 0.1) {
    if (next() < 0.4) {
      for (const path of Object.keys(files)) {
        delete files[path];
      }
    }
    files[".env.vault"] =
      "DOTENV_VAULT_TEST=AwMDAwMDAwMDAwMDd7v1Sh9/ARQ7FQ8I1iSab59ZlOWMBKuvFAC/hi8OKy8QioBd\n";
  }
  const dotenvKey =
    next() < (".env.vault" in files ? 0.6 : 0.03)
      ? "dotenv://:0707070707070707070707070707070707070707070707070707070707070707@dotenvx.com/.env.vault?environment=test"
      : undefined;
  const command: NodeJS.ProcessEnv = {};
  for (const name of names) {
    if (next() < 0.25) {
      command[name] =
        name === "FORCE_COLOR"
          ? pick(["0", "1", "true", "false"])
          : name === "NX_SKIP_NX_CACHE" || name === "NX_VERBOSE_LOGGING"
            ? pick(["true", "false"])
            : name === "NX_LOAD_DOT_ENV_FILES"
              ? pick(["false", "true", "false"])
              : name === "RUSTFLAGS"
                ? pick(["-Dwarnings", "", "-C opt-level=2"])
                : name === "CMD" && next() < 0.4
                  ? varNameLiteral()
                  : next() < 0.2
                    ? ""
                    : value(name).replace(/^['"]|['"]$/g, "");
    }
  }
  if (dotenvKey !== undefined) {
    command.DOTENV_KEY = dotenvKey;
    command.REVIEW_VAULT = "secret";
  }
  return {
    configuration,
    files,
    command,
    verbose: pick([undefined, true, false]),
    tui: pick(["true", "false"]),
    stream: pick([false, true]),
    skipFlag: next() < 0.3,
    way: pick(["piped", "file", "terminal"] as const),
    streamOutput: next() < 0.5,
  };
}

// The nx process's environment after it started for the command, as
// `EVD-NX-24-BATCHES` ("Task environment") lists its changes.
function nxProcess(root: string, generated: GeneratedCase) {
  const env: NodeJS.ProcessEnv = { ...generated.command };
  if (env.FORCE_COLOR === "0") {
    env.NX_ORIGINAL_FORCE_COLOR = "0";
    env.NO_COLOR = "1";
    delete env.FORCE_COLOR;
  }
  // loadRootEnvFiles (`utils/dotenv.js`), into the process's environment.
  const loaded = dotenv.config({
    path: [".local.env", ".env.local", ".env"].map((file) => join(root, file)),
    processEnv: env,
  });
  dotenvExpand.expand({ ...loaded, processEnv: env });
  env.NX_CLI_SET = "true";
  env.NX_VERBOSE_LOGGING = String(generated.verbose ?? env.NX_VERBOSE_LOGGING === "true");
  env.NX_TUI = generated.tui;
  const loadDotEnvFiles = env.NX_LOAD_DOT_ENV_FILES !== "false";
  if (generated.stream) {
    env.NX_STREAM_OUTPUT = "true";
    env.NX_PREFIX_OUTPUT = "true";
  }
  if (loadDotEnvFiles) {
    env.NX_LOAD_DOT_ENV_FILES = "true";
  }
  const skipNxCache = generated.skipFlag || env.NX_SKIP_NX_CACHE === "true";
  return { env, skipNxCache };
}

// Nx's own getTaskSpecificEnv in a process whose environment is
// `processEnv`, under the case's root (beforeAll). Nx keeps its result by
// task id for the life of the process, so each call gets an id of its own.
let calls = 0;
function nxDotenvLayer(task: Task, processEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const own = process.env;
  process.env = { ...processEnv };
  try {
    calls += 1;
    return { ...taskEnv.getTaskSpecificEnv({ ...task, id: `${task.id}#${calls}` }, graph) };
  } finally {
    process.env = own;
  }
}

const defined = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));

const forceColorForChild = (env: NodeJS.ProcessEnv) =>
  env.FORCE_COLOR !== undefined
    ? env.FORCE_COLOR
    : env.NX_ORIGINAL_FORCE_COLOR === "0"
      ? "0"
      : "true";

const ancestors = () =>
  process.env.NX_INVOCATION_ANCESTOR_PIDS
    ? `${process.env.NX_INVOCATION_ANCESTOR_PIDS},${process.pid}`
    : String(process.pid);

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nx-rust-dotenv-equivalence-"));
  // Where Nx's getTaskSpecificEnv reads the dotenv files.
  workspaceRootModule.setWorkspaceRoot(root);
});

afterAll(() => {
  workspaceRootModule.setWorkspaceRoot(workspaceRoot);
  rmSync(root, { recursive: true, force: true });
});

function evaluateCase(
  label: number | string,
  generated: GeneratedCase,
): {
  passes: boolean;
  aloneProblem: string | undefined;
  batchProblem: string | undefined;
  mismatches: object[];
} {
  for (const [path, content] of Object.entries(generated.files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  // dotenv reads DOTENV_KEY from the process's own environment.
  const key = process.env.DOTENV_KEY;
  if (generated.command.DOTENV_KEY === undefined) {
    delete process.env.DOTENV_KEY;
  } else {
    process.env.DOTENV_KEY = generated.command.DOTENV_KEY;
  }
  try {
    const task = {
      id: generated.configuration === undefined ? "indep:test" : "indep:test:ci",
      target: { project: "indep", target: "test", configuration: generated.configuration },
      projectRoot: "crates/indep",
      overrides: {},
      outputs: [],
      hash: "hash",
    } as unknown as Task;
    const shape = { configuration: generated.configuration, readyUrlDependency: false };
    const { env: nxEnv, skipNxCache } = nxProcess(root, generated);

    // The same task in a batch.
    const batchProcess = defined({
      ...nxEnv,
      FORCE_COLOR: forceColorForChild(nxEnv),
      NX_WORKSPACE_ROOT: workspaceRoot,
      NX_SKIP_NX_CACHE: skipNxCache ? "true" : undefined,
      NX_INVOCATION_ANCESTOR_PIDS: ancestors(),
      NX_FORKED_TASK_EXECUTOR: "true",
      NX_CLI_SET: "true",
    });
    for (const name of [
      "NX_ORIGINAL_FORCE_COLOR",
      "NX_READY_SIGNAL_SOCKET",
      "NX_READY_SIGNAL_TASK",
      "NX_READY_URL",
    ]) {
      delete batchProcess[name];
    }
    // While the batch builds the task's dotenv layer, it gives Nx's own
    // variables that the task's files define a value of its own.
    const shieldedNames = dotenvDefinitions(task, graph, root).filter((name) =>
      Object.prototype.hasOwnProperty.call(runDependentVariables, name),
    );
    // A task run on its own: the layer in the nx process, the fork, and the
    // task's process.
    const piped = generated.way === "piped";
    const layer = defined(
      taskEnv.getEnvVariablesForTask(
        task,
        nxDotenvLayer(task, nxEnv),
        piped ? forceColorForChild(nxEnv) : undefined,
        skipNxCache,
        false,
        piped ? null : "/nx/output",
        piped ? null : generated.streamOutput,
      ) as NodeJS.ProcessEnv,
    );
    const forked = { ...layer, NX_FORKED_TASK_EXECUTOR: "true" };
    // Nx's pseudo-terminal lays the task's environment over the nx process's.
    const started =
      generated.way === "terminal"
        ? { ...defined(nxEnv), ...forked, NX_PSEUDO_TERMINAL_EXEC_ARGV: "" }
        : forked;
    const alone = withoutUnloadedRootValues(
      cargoTaskEnvironment({ ...started, NX_CLI_SET: "true" }, shape),
      root,
    );

    const batched = withoutUnloadedRootValues(
      batchTaskEnvironment(
        taskDotenvLayer(taskEnv, root, task, graph, batchProcess, shieldedNames),
        task,
        taskEnv.getEnvVariablesForTask,
        batchProcess,
      ),
      root,
    );

    const aloneProblem = dotenvProblem(task, graph, root, alone);
    const batchProblem = dotenvProblem(task, graph, root, batched);
    const description = { label, files: generated.files, command: generated.command };
    const mismatches: object[] = [];
    if ((aloneProblem === undefined) !== (batchProblem === undefined)) {
      mismatches.push({ ...description, alone: aloneProblem, batched: batchProblem });
    } else if (aloneProblem === undefined && !isDeepStrictEqual(alone, batched)) {
      mismatches.push({ ...description, way: generated.way, alone, batched });
    }
    return { passes: aloneProblem === undefined, aloneProblem, batchProblem, mismatches };
  } finally {
    if (key === undefined) {
      delete process.env.DOTENV_KEY;
    } else {
      process.env.DOTENV_KEY = key;
    }
    for (const path of Object.keys(generated.files)) {
      rmSync(join(root, path), { force: true });
    }
    for (const file of rootDotenvFiles) {
      rmSync(join(root, `${file}.vault`), { force: true });
    }
  }
}

it("gives cargo the same environment alone and in a batch for every case that the check lets through", () => {
  // dotenv reports where it reads a vault, or misses one, on the console.
  const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  const first = Number(process.env.NX_RUST_DOTENV_SEED ?? 20261115);
  const count = process.env.NX_RUST_DOTENV_SEED === undefined ? 2500 : 1;
  let passed = 0;
  let refused = 0;
  const kinds = {
    vaultAlone: 0,
    vaultBeside: 0,
    list: 0,
    selfAppend: 0,
    doubleDollarIndirect: 0,
    forceColorZero: 0,
  };
  const mismatches: object[] = [];
  for (let seed = first; seed < first + count; seed++) {
    const generated = caseOf(seed);
    const { files } = generated;
    const plain = Object.keys(files).filter((path) => path !== ".env.vault").length;
    kinds.vaultAlone += ".env.vault" in files && plain === 0 ? 1 : 0;
    kinds.vaultBeside += ".env.vault" in files && plain > 0 ? 1 : 0;
    kinds.list += Object.values(files).some((content) => content.includes("LIST=")) ? 1 : 0;
    kinds.selfAppend += Object.values(files).some((content) => content.includes("RUSTFLAGS="))
      ? 1
      : 0;
    kinds.doubleDollarIndirect += Object.values(files).some((content) =>
      /\$\$(?:HOST|CMD)\b/.test(content),
    )
      ? 1
      : 0;
    kinds.forceColorZero += generated.command.FORCE_COLOR === "0" ? 1 : 0;
    const result = evaluateCase(seed, generated);
    if (result.passes) {
      passed += 1;
    } else {
      refused += 1;
    }
    mismatches.push(...result.mismatches);
  }
  log.mockRestore();
  // The first mismatches, each with its seed.
  expect(mismatches.slice(0, 3)).toEqual([]);
  // The cases must exercise both outcomes, root vaults alone and beside plain
  // files, long lists of references, self-append idioms, `$$NAME` indirection
  // and FORCE_COLOR=0.
  const coverage = {
    passed,
    refused,
    enough:
      count === 1 ||
      (passed > count / 5 &&
        refused > count / 4 &&
        kinds.vaultAlone > 0 &&
        kinds.vaultBeside > 0 &&
        kinds.list > 0 &&
        kinds.selfAppend > 0 &&
        kinds.doubleDollarIndirect > 0 &&
        kinds.forceColorZero > 0),
  };
  expect(coverage).toEqual(
    process.env.NX_RUST_DOTENV_SEED === undefined
      ? { passed: 716, refused: 1784, enough: true }
      : { passed, refused, enough: true },
  );
});

it("compares terminating cycles and $$NAME indirection against Nx's real loader", () => {
  const base: Omit<GeneratedCase, "files" | "command"> = {
    configuration: undefined,
    verbose: false,
    tui: "false",
    stream: false,
    skipFlag: false,
    way: "file",
    streamOutput: false,
  };
  const cases: {
    name: string;
    files: Record<string, string>;
    command: NodeJS.ProcessEnv;
    expectPass: boolean;
  }[] = [
    {
      name: "terminating mutual cycle",
      files: { "crates/indep/.env.test": "A=${B}\nB=${A}\n" },
      command: {},
      expectPass: true,
    },
    {
      name: "terminating indirect cycle with shell value",
      files: { "crates/indep/.env.test": "A=${B}\nB=${A}\nVALUE=x${A}\n" },
      command: { A: "shell" },
      expectPass: true,
    },
    {
      name: "cycle with unsafe branch",
      files: { "crates/indep/.env.test": "A=${B:-$NX_FORKED_TASK_EXECUTOR}\nB=${A}\n" },
      command: { A: "shell" },
      expectPass: false,
    },
    {
      name: "double dollar indirection via file with shield",
      files: {
        "crates/indep/.env.test":
          "SELECTED=FORCE_COLOR\nFORCE_COLOR=file-value\nVALUE=$$SELECTED\n",
      },
      command: {},
      expectPass: false,
    },
    {
      name: "double dollar indirection via command",
      files: { "crates/indep/.env.test": "VALUE=$$SELECTED\n" },
      command: { SELECTED: "NX_FORKED_TASK_EXECUTOR" },
      expectPass: false,
    },
    {
      name: "safe double dollar password",
      files: { "crates/indep/.env.test": "PASSWORD=pa$$word\nVALUE=${PASSWORD}\n" },
      command: {},
      expectPass: true,
    },
    {
      name: "split(null) literal null separator naming run-dependent key",
      files: { "crates/indep/.env.test": "VALUE=${NX_FORKED_TASK_EXECUTORnull}\n" },
      command: {},
      expectPass: false,
    },
    {
      name: "split(null) literal null separator with run-dependent default",
      files: { "crates/indep/.env.test": "VALUE=${Anull$FORCE_COLOR}\n" },
      command: {},
      expectPass: false,
    },
    {
      name: "escaped earlier copy replaced by String.prototype.replace",
      files: { "crates/indep/.env.test": "VALUE=\\$NAMEEXECUTOR $NAME\n" },
      command: { NAME: "x$NX_FORKED_TASK_" },
      expectPass: false,
    },
    {
      name: "escaped earlier copy replaced indirectly through spaced reference",
      files: { "crates/indep/.env.test": "VALUE=\\${A}COLOR ${B}\n" },
      command: { A: "x$FORCE_", B: "p${A} " },
      expectPass: false,
    },
    {
      name: "top-level unclosed braced followed by matched reference",
      files: { "crates/indep/.env.test": "VALUE=${FORCE_${PART}\n" },
      command: { PART: "COLOR}" },
      expectPass: false,
    },
    {
      name: "even backslashes before dollar pass as escaped text",
      files: { "crates/indep/.env.test": "VALUE=\\\\$FORCE_COLOR\n" },
      command: {},
      expectPass: true,
    },
    {
      name: "unknown POSIX operator stays one literal key",
      files: { "crates/indep/.env.test": "VALUE=${SET:?error}\n" },
      command: { SET: "$FORCE_COLOR" },
      expectPass: true,
    },
    {
      name: "top-level unclosed braced with no following reference passes",
      files: { "crates/indep/.env.test": "VALUE=${UNCLOSED\n" },
      command: {},
      expectPass: true,
    },
    {
      name: "top-level empty braced passes",
      files: { "crates/indep/.env.test": "VALUE=${}\n" },
      command: {},
      expectPass: true,
    },
  ];
  for (const item of cases) {
    for (const way of ["piped", "file", "terminal"] as const) {
      const result = evaluateCase(`${item.name}:${way}`, {
        ...base,
        way,
        files: item.files,
        command: item.command,
      });
      expect(result.mismatches).toEqual([]);
      expect({ name: item.name, way, passes: result.passes }).toEqual({
        name: item.name,
        way,
        passes: item.expectPass,
      });
    }
  }
});
