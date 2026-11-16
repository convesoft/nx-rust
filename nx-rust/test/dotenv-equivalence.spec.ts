import type { ProjectGraph, Task } from "@nx/devkit";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  dotenvDefinitions,
  dotenvProblem,
  expandLikeNx,
  tooComplex,
} from "../src/executors/dotenv-check";
import {
  batchTaskEnvironment,
  cargoTaskEnvironment,
  type EnvVariablesForTask,
  runDependentVariables,
  shieldValue,
  withoutUnloadedRootValues,
} from "../src/executors/task-env";

// A guard of VER-BATCHING against the check of DES-BATCH ("Dotenv files")
// drifting from Nx: random dotenv files and command environments, from a
// seed that a failure prints, run through Nx 24's real loader. For every case
// that the check lets through, the environment that the plugin gives cargo
// for a task run on its own, piped, with its output in a file or in Nx's
// pseudo-terminal, equals the one it gives the task in a batch; the check
// decides the same in both; and the check's own expansion gives what
// dotenv-expand gives. Set NX_RUST_DOTENV_SEED to rerun one seed.

const nx = dirname(require.resolve("nx/package.json"));
const taskEnv = require("nx/src/tasks-runner/task-env") as {
  unloadDotEnvFile(file: string, env: NodeJS.ProcessEnv): void;
  loadAndExpandDotEnvFile(files: string[], env: NodeJS.ProcessEnv): void;
  getEnvFilesForTask(task: Task, graph: ProjectGraph): string[];
  getEnvVariablesForTask: EnvVariablesForTask;
};
const { workspaceRoot } = require("nx/src/utils/workspace-root") as { workspaceRoot: string };
const dotenv = require(require.resolve("dotenv", { paths: [nx] })) as {
  config(options: object): { parsed?: Record<string, string> };
  parse(source: string): Record<string, string>;
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

const ordinary = ["A", "B", "HOST", "URL"];
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
const names = [...ordinary, ...nxOwn, "CMD"];

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

function caseOf(seed: number) {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const literal = () => pick(["x", "1", "true", "false", "", "a b", "0", "localhost"]);
  const piece = (depth: number): string => {
    const name = next() < 0.75 ? pick([...ordinary, "CMD"]) : pick(nxOwn);
    const inner = () => (depth < 1 && next() < 0.5 ? piece(depth + 1) : literal());
    switch (Math.floor(next() * 11)) {
      case 0:
        return literal();
      case 1:
        return `$${name}`;
      case 2:
        return `\${${name}}`;
      case 3:
        return `\${${name}:-${inner()}}`;
      case 4:
        return `\${${name}-${inner()}}`;
      case 5:
        return `\${${name}:+${inner()}}`;
      case 6:
        return `\${${name}+${inner()}}`;
      case 7:
        return `\\$${name}`;
      case 8:
        return pick(["$$", "$", "$$" + name]);
      case 9:
        return `\${${pick(["NX_", "FORCE_", "A"])}\${${name}}}`;
      default:
        return `${literal()}:${literal()}`;
    }
  };
  const value = () => {
    let text = "";
    for (let parts = 1 + Math.floor(next() * 3); parts > 0; parts--) {
      text += piece(0);
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
          `${name}=${own && next() < 0.6 ? pick(["true", "false", "0", "1", ""]) : value()}`,
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
              : next() < 0.2
                ? ""
                : value().replace(/^['"]|['"]$/g, "");
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
function nxProcess(root: string, generated: ReturnType<typeof caseOf>) {
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

// getTaskSpecificEnv over `processEnv`, with Nx's own parts.
function dotenvLayer(root: string, task: Task, processEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...processEnv };
  for (const file of [".env", ".local.env", ".env.local"]) {
    taskEnv.unloadDotEnvFile(join(root, file), env);
  }
  if (processEnv.NX_LOAD_DOT_ENV_FILES === "true") {
    taskEnv.loadAndExpandDotEnvFile(
      taskEnv.getEnvFilesForTask(task, graph).map((file) => join(root, file)),
      env,
    );
  }
  return env;
}

/**
 * Whether the check's own expansion of `paths` over `processEnv` ends within
 * its limits (DES-BATCH, "Dotenv files"). dotenv-expand has none, and Nx's
 * loader does not return where its expansion does not end, so the test calls
 * the loader only where this holds. A case where it does not hold is skipped:
 * the check's budget ran out, which proves neither that dotenv-expand would
 * not finish nor that it would.
 */
function bounded(paths: string[], processEnv: NodeJS.ProcessEnv): boolean {
  const parsed: Record<string, string> = {};
  for (const path of paths.filter((file) => existsSync(file))) {
    for (const [name, value] of Object.entries(dotenv.parse(readFileSync(path, "utf8")))) {
      if (!Object.prototype.hasOwnProperty.call(parsed, name)) {
        parsed[name] = value;
      }
    }
  }
  const env: NodeJS.ProcessEnv = { ...processEnv };
  for (const name in parsed) {
    if (!Object.prototype.hasOwnProperty.call(env, name)) {
      env[name] = parsed[name];
    }
  }
  return expandLikeNx(parsed, env) !== tooComplex;
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
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function runCase(seed: number): {
  passes: boolean;
  compared: boolean;
  skipped: boolean;
  mismatches: object[];
} {
  const generated = caseOf(seed);
  for (const [path, content] of Object.entries(generated.files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const skipped = { passes: false, compared: false, skipped: true, mismatches: [] };
  // dotenv reads DOTENV_KEY from the process's own environment.
  const key = process.env.DOTENV_KEY;
  if (generated.command.DOTENV_KEY === undefined) {
    delete process.env.DOTENV_KEY;
  } else {
    process.env.DOTENV_KEY = generated.command.DOTENV_KEY;
  }
  try {
    // The root files that the nx process loads at start, and each of them
    // on its own, as Nx unloads them.
    const atStart: NodeJS.ProcessEnv = { ...generated.command };
    if (atStart.FORCE_COLOR === "0") {
      atStart.NX_ORIGINAL_FORCE_COLOR = "0";
      atStart.NO_COLOR = "1";
      delete atStart.FORCE_COLOR;
    }
    if (
      !bounded(
        [".local.env", ".env.local", ".env"].map((file) => join(root, file)),
        atStart,
      ) ||
      [".env", ".local.env", ".env.local"].some((file) => !bounded([join(root, file)], {}))
    ) {
      return skipped;
    }
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
    const taskPaths = taskEnv.getEnvFilesForTask(task, graph).map((file) => join(root, file));
    const unloadedNx = { ...nxEnv };
    for (const file of [".env", ".local.env", ".env.local"]) {
      taskEnv.unloadDotEnvFile(join(root, file), unloadedNx);
    }
    if (nxEnv.NX_LOAD_DOT_ENV_FILES === "true" && !bounded(taskPaths, unloadedNx)) {
      return skipped;
    }

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
    // While Nx builds the batch task's dotenv layer, the batch gives Nx's
    // own variables that the task's files define a value of its own.
    const shielded: NodeJS.ProcessEnv = { ...batchProcess };
    for (const name of dotenvDefinitions(task, graph, root)) {
      if (Object.prototype.hasOwnProperty.call(runDependentVariables, name)) {
        shielded[name] = shieldValue;
      }
    }
    const unloadedBatch = { ...shielded };
    for (const file of [".env", ".local.env", ".env.local"]) {
      taskEnv.unloadDotEnvFile(join(root, file), unloadedBatch);
    }
    if (batchProcess.NX_LOAD_DOT_ENV_FILES === "true" && !bounded(taskPaths, unloadedBatch)) {
      return skipped;
    }
    // A task run on its own: the layer in the nx process, the fork, and the
    // task's process.
    const piped = generated.way === "piped";
    const layer = defined(
      taskEnv.getEnvVariablesForTask(
        task,
        { ...dotenvLayer(root, task, nxEnv) },
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
        dotenvLayer(root, task, shielded),
        task,
        taskEnv.getEnvVariablesForTask,
        batchProcess,
      ),
      root,
    );

    const aloneProblem = dotenvProblem(task, graph, root, alone);
    const batchProblem = dotenvProblem(task, graph, root, batched);
    const description = { seed, files: generated.files, command: generated.command };
    const mismatches: object[] = [];
    if ((aloneProblem === undefined) !== (batchProblem === undefined)) {
      mismatches.push({ ...description, alone: aloneProblem, batched: batchProblem });
    } else if (aloneProblem === undefined && !isDeepStrictEqual(alone, batched)) {
      mismatches.push({ ...description, way: generated.way, alone, batched });
    }

    // The check's expansion against dotenv-expand's, over both processes'
    // environments as dotenv's config leaves them.
    // Not where dotenv reads a vault instead, which the check refuses.
    let compared = false;
    const vault = generated.command.DOTENV_KEY !== undefined && ".env.vault" in generated.files;
    for (const processEnv of vault ? [] : [nxEnv, shielded]) {
      if (processEnv.NX_LOAD_DOT_ENV_FILES !== "true") {
        continue;
      }
      const unloaded = { ...processEnv };
      for (const file of [".env", ".local.env", ".env.local"]) {
        taskEnv.unloadDotEnvFile(join(root, file), unloaded);
      }
      const paths = taskEnv.getEnvFilesForTask(task, graph).map((file) => join(root, file));
      const real = { ...unloaded };
      taskEnv.loadAndExpandDotEnvFile(paths, real);
      const parsed: Record<string, string> = {};
      for (const path of paths.filter((file) => existsSync(file))) {
        for (const [name, value] of Object.entries(dotenv.parse(readFileSync(path, "utf8")))) {
          if (!Object.prototype.hasOwnProperty.call(parsed, name)) {
            parsed[name] = value;
          }
        }
      }
      const mine: NodeJS.ProcessEnv = { ...unloaded };
      for (const name in parsed) {
        if (!Object.prototype.hasOwnProperty.call(mine, name)) {
          mine[name] = parsed[name];
        }
      }
      const expanded = expandLikeNx(parsed, mine);
      if (expanded !== tooComplex) {
        Object.assign(mine, expanded);
        if (!isDeepStrictEqual(mine, real)) {
          mismatches.push({ ...description, expansion: mine, dotenvExpand: real });
        }
        compared = true;
      }
    }
    return { passes: aloneProblem === undefined, compared, skipped: false, mismatches };
  } finally {
    if (key === undefined) {
      delete process.env.DOTENV_KEY;
    } else {
      process.env.DOTENV_KEY = key;
    }
    for (const path of Object.keys(generated.files)) {
      rmSync(join(root, path), { force: true });
    }
  }
}

it("gives cargo the same environment alone and in a batch for every case that the check lets through, and expands as dotenv-expand does", () => {
  // dotenv reports where it reads a vault, or misses one, on the console.
  const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  const first = Number(process.env.NX_RUST_DOTENV_SEED ?? 20261115);
  const count = process.env.NX_RUST_DOTENV_SEED === undefined ? 2500 : 1;
  let passed = 0;
  let compared = 0;
  let skipped = 0;
  const kinds = { vaultAlone: 0, vaultBeside: 0, list: 0 };
  const mismatches: object[] = [];
  for (let seed = first; seed < first + count; seed++) {
    const { files } = caseOf(seed);
    const plain = Object.keys(files).filter((path) => path !== ".env.vault").length;
    kinds.vaultAlone += ".env.vault" in files && plain === 0 ? 1 : 0;
    kinds.vaultBeside += ".env.vault" in files && plain > 0 ? 1 : 0;
    kinds.list += Object.values(files).some((content) => content.includes("LIST=")) ? 1 : 0;
    const result = runCase(seed);
    passed += result.passes ? 1 : 0;
    compared += result.compared ? 1 : 0;
    skipped += result.skipped ? 1 : 0;
    mismatches.push(...result.mismatches);
  }
  log.mockRestore();
  // The first mismatches, each with its seed.
  expect(mismatches.slice(0, 3)).toEqual([]);
  // The cases must exercise both outcomes, the comparison of expansions,
  // root vaults alone and beside plain files, and long lists of references.
  // A skipped case is one on which the check's own expansion ran out of its
  // budget ({@link bounded}); the test then runs neither path.
  const coverage = {
    passed,
    compared,
    skipped,
    enough:
      count === 1 ||
      (passed > count / 4 &&
        passed < count &&
        compared > count / 2 &&
        skipped < count * 0.3 &&
        kinds.vaultAlone > 0 &&
        kinds.vaultBeside > 0 &&
        kinds.list > 0),
  };
  expect(coverage).toEqual({ passed, compared, skipped, enough: true });
});

it("runs the case of the fourth review's seed, which a start environment without NX_ORIGINAL_FORCE_COLOR skipped wrongly", () => {
  // FORCE_COLOR=0 in the command: the nx process starts with
  // NX_ORIGINAL_FORCE_COLOR=0 and NO_COLOR=1 in its place.
  expect(caseOf(20261815).command.FORCE_COLOR).toBe("0");
  const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  const result = runCase(20261815);
  log.mockRestore();
  expect(result).toMatchObject({ skipped: false, mismatches: [] });
});
