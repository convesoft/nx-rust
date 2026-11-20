import type { ProjectGraph, Task } from "@nx/devkit";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type DotenvParts,
  shieldValue,
  TaskEnvironmentError,
  taskDotenvLayer,
  taskEnvironments,
} from "../src/executors/task-env";

// VER-BATCHING: the batch builds a task's dotenv layer (DES-BATCH, "Dotenv
// files") as Nx 24's own getTaskSpecificEnv builds it, on a copy of the
// batch process's environment, which the plugin itself never changes
// (dotenv does, where a vault lies beside the files: nxr-gcknzm).

const taskEnv = require("nx/src/tasks-runner/task-env") as DotenvParts & {
  getTaskSpecificEnv(task: Task, graph: ProjectGraph): NodeJS.ProcessEnv;
};
const workspaceRootModule = require("nx/src/utils/workspace-root") as {
  workspaceRoot: string;
  setWorkspaceRoot(root: string): void;
};
const originalRoot = workspaceRootModule.workspaceRoot;

// `test` of `a` belongs to a target group whose other target is an
// atomized one, so that Nx reads the files of that target, `test-ci`, and of
// its non-atomized target `e2e` instead of those of `test`
// (`getOwnerTargetForTask` in `tasks-runner/task-env.js`).
const graph = {
  nodes: {
    a: {
      name: "a",
      type: "lib",
      data: {
        root: "crates/a",
        targets: { test: {}, "test-ci": { metadata: { nonAtomizedTarget: "e2e" } } },
        metadata: { targetGroups: { checks: ["test", "test-ci"] } },
      },
    },
  },
  dependencies: {},
} as unknown as ProjectGraph;

const files: Record<string, string> = {
  ".env": "ROOT_SAME=r\nROOT_DIFF=r\nROOT_ONLY=r\n",
  ".env.local": "LOCAL=l\n",
  ".env.e2e.ci": "C=ci-${ROOT_DIFF}\n",
  ".env.e2e": "E=e2e\n",
  "crates/a/.env": "P=project-${ROOT_DIFF}\nROOT_ONLY=project\n",
  "crates/a/.env.test-ci": "T=${P}-test\nFORCE_COLOR=${CMD}z\n",
  "crates/a/.env.test": "NOT_READ=1\n",
};

const taskOf = (configuration: string | undefined): Task =>
  ({
    id: configuration === undefined ? "a:test" : `a:test:${configuration}`,
    target: { project: "a", target: "test", configuration },
    projectRoot: "crates/a",
    overrides: {},
    outputs: [],
    parallelism: true,
    cache: true,
  }) as Task;

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nx-rust-task-dotenv-layer-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  // Where Nx's getTaskSpecificEnv reads the dotenv files.
  workspaceRootModule.setWorkspaceRoot(root);
});

afterAll(() => {
  workspaceRootModule.setWorkspaceRoot(originalRoot);
  rmSync(root, { recursive: true, force: true });
});

// Runs `body` with `env` as the process's environment, as a batch process
// that Nx started with it, and gives the environment back afterwards.
function inProcess<T>(env: NodeJS.ProcessEnv, body: () => T): T {
  const own = process.env;
  process.env = env;
  try {
    return body();
  } finally {
    process.env = own;
  }
}

// Nx keeps getTaskSpecificEnv's result by task id, so each call gets an id
// of its own.
let calls = 0;
function nxLayer(task: Task, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  calls += 1;
  return inProcess({ ...env }, () => ({
    ...taskEnv.getTaskSpecificEnv({ ...task, id: `${task.id}#${calls}` }, graph),
  }));
}

const command = (load: string | undefined): NodeJS.ProcessEnv => ({
  // Values that the nx process loaded from the root .env, one changed by
  // the command.
  ROOT_SAME: "r",
  ROOT_DIFF: "shell",
  ROOT_ONLY: "r",
  LOCAL: "l",
  CMD: "x${CMD}",
  FORCE_COLOR: "1",
  ...(load === undefined ? {} : { NX_LOAD_DOT_ENV_FILES: load }),
});

describe.each([["true"], ["false"], [undefined]])("with NX_LOAD_DOT_ENV_FILES=%s", (load) => {
  it.each([[undefined], ["ci"]])(
    "gives the layer of Nx's getTaskSpecificEnv for configuration %s",
    (configuration) => {
      const task = taskOf(configuration);
      const env = command(load);
      const shielded = ["FORCE_COLOR"];
      const layer = taskDotenvLayer(taskEnv, root, task, graph, env, shielded);
      // As Nx builds it in a process where the shielded variable has the
      // shield's value.
      expect(layer).toEqual(nxLayer(task, { ...env, FORCE_COLOR: shieldValue }));
      // The command's environment is unchanged.
      expect(env).toEqual(command(load));
      const names = ["P", "T", "E", "C", "ROOT_DIFF", "ROOT_ONLY", "ROOT_SAME", "LOCAL"];
      const seen = Object.fromEntries(names.map((name) => [name, layer[name]]));
      expect({ ...seen, NOT_READ: layer.NOT_READ, FORCE_COLOR: layer.FORCE_COLOR }).toEqual(
        load === "true"
          ? {
              P: "project-shell",
              T: "project-shell-test",
              E: "e2e",
              C: configuration === undefined ? undefined : "ci-shell",
              ROOT_DIFF: "shell",
              ROOT_ONLY: "project",
              // The root files are the task's last files, which load them back.
              ROOT_SAME: "r",
              LOCAL: "l",
              NOT_READ: undefined,
              FORCE_COLOR: shieldValue,
            }
          : {
              // Only the root values are removed.
              P: undefined,
              T: undefined,
              E: undefined,
              C: undefined,
              ROOT_DIFF: "shell",
              ROOT_ONLY: undefined,
              ROOT_SAME: undefined,
              LOCAL: undefined,
              NOT_READ: undefined,
              FORCE_COLOR: shieldValue,
            },
      );
    },
  );
});

it("builds every task's environment without changing the batch process's", () => {
  const batchProcess: NodeJS.ProcessEnv = {
    ...command("true"),
    NX_WORKSPACE_ROOT: root,
    NX_FORKED_TASK_EXECUTOR: "true",
    NX_CLI_SET: "true",
  };
  const writes: string[] = [];
  const guarded = new Proxy(
    { ...batchProcess },
    {
      set(_target, name) {
        writes.push(`set ${String(name)}`);
        return true;
      },
      defineProperty(_target, name) {
        writes.push(`define ${String(name)}`);
        return true;
      },
      deleteProperty(_target, name) {
        writes.push(`delete ${String(name)}`);
        return true;
      },
    },
  );
  const envOf = taskEnvironments(root, graph, () => ["FORCE_COLOR"]);
  const env = inProcess(guarded, () => envOf(taskOf("ci")));
  expect(writes).toEqual([]);
  expect({ ...guarded }).toEqual(batchProcess);
  expect(env).toMatchObject({ P: "project-shell", T: "project-shell-test", C: "ci-shell" });
  // The shield's value reaches no variable that cargo gets.
  expect(Object.values(env)).not.toContain(shieldValue);
  expect(env.FORCE_COLOR).toBeUndefined();
});

it("fails where getEnvFilesForTask of the installed Nx fails or gives no list", () => {
  const parts = (getEnvFilesForTask: DotenvParts["getEnvFilesForTask"]): DotenvParts => ({
    getEnvFilesForTask,
    loadAndExpandDotEnvFile: () => undefined,
    unloadDotEnvFile: () => undefined,
  });
  const env = { NX_LOAD_DOT_ENV_FILES: "true" };
  const failing = parts(() => {
    throw new Error("no project");
  });
  expect(() => taskDotenvLayer(failing, root, taskOf(undefined), graph, env, [])).toThrow(
    new TaskEnvironmentError(
      "getEnvFilesForTask of the installed Nx fails for a:test (no project)",
    ),
  );
  expect(() =>
    taskDotenvLayer(
      parts(() => "x"),
      root,
      taskOf(undefined),
      graph,
      env,
      [],
    ),
  ).toThrow("getEnvFilesForTask of the installed Nx gives no list of files for a:test");
});

// A tripwire on the three facts that taskDotenvLayer repeats from Nx's
// wrapper (DES-BATCH, "Dotenv files"): the root files that Nx unloads, the
// order of the calls, and the load switch. They live in these functions of
// the installed `nx/src/tasks-runner/task-env.js`, as Nx 24.0.0 to 24.0.6
// compile them. The comparison above would miss a fourth root file or a new
// condition that its fixtures do not exercise, so this test compares the
// functions' source text itself. It trips on any change to them, also one
// that changes nothing for the plugin.
const wrapper: Record<string, string> = {
  getTaskSpecificEnv: `function getTaskSpecificEnv(task, graph) {
    const cached = taskSpecificEnvCache.get(task.id);
    if (cached)
        return cached;
    // Unload any dot env files at the root of the workspace that were loaded on init of Nx.
    const taskEnv = unloadDotEnvFiles({ ...process.env });
    const env = process.env.NX_LOAD_DOT_ENV_FILES === 'true'
        ? loadDotEnvFilesForTask(task, graph, taskEnv)
        : // If not loading dot env files, ensure env vars created by system are still loaded
            taskEnv;
    taskSpecificEnvCache.set(task.id, env);
    return env;
}`,
  unloadDotEnvFiles: `function unloadDotEnvFiles(environmentVariables) {
    for (const file of ['.env', '.local.env', '.env.local']) {
        unloadDotEnvFile((0, node_path_1.join)(workspace_root_1.workspaceRoot, file), environmentVariables);
    }
    return environmentVariables;
}`,
  loadDotEnvFilesForTask: `function loadDotEnvFilesForTask(task, graph, environmentVariables) {
    const dotEnvFiles = getEnvFilesForTask(task, graph);
    loadAndExpandDotEnvFile(dotEnvFiles.map((file) => (0, node_path_1.join)(workspace_root_1.workspaceRoot, file)), environmentVariables);
    return environmentVariables;
}`,
};

it.each(Object.keys(wrapper))("finds Nx's %s as taskDotenvLayer repeats it", (name) => {
  const file = require.resolve("nx/src/tasks-runner/task-env");
  const source = readFileSync(file, "utf8");
  // A top-level function of the compiled module, from its first line to
  // the closing brace at the start of a line.
  const found = new RegExp(`^function ${name}\\([^]*?^}$`, "m").exec(source)?.[0];
  const advice = `Nx's ${name} in ${file} is not the one that taskDotenvLayer in nx-rust/src/executors/task-env.ts repeats. Re-read getTaskSpecificEnv and the functions it calls, bring taskDotenvLayer (and rootDotenvFiles) in line with them, update DES-BATCH ("Dotenv files") if what the plugin repeats changed, and then record the new source text here.`;
  // The advice shows beside the difference where the texts differ.
  expect({ advice, source: found ?? "<no such function>" }).toEqual({
    advice,
    source: wrapper[name],
  });
});
