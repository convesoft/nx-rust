"use strict";

// Run by workspace.ts in a fixture workspace, which is the current folder:
//
//   node inspect-workspace.cjs <request.json> <result.json>
//
// The request is { "command": "graph" } or
// { "command": "hash", "tasks": ["project:target[:configuration]"], "overrides": {} }.
// The result is { "ok": true, "graph": ... }, { "ok": true, "hashes": { [task]: { value, details } } }
// or { "ok": false, "error": "..." }.
//
// Graph and hashes come from the functions that `nx graph` and `nx run` call,
// so a hash is the one a real run of the task would compute. These are
// internal modules of Nx: check them when Nx changes major version.

const { readFileSync, writeFileSync } = require("node:fs");

async function main() {
  const [requestFile, resultFile] = process.argv.slice(2);
  let result;
  try {
    const request = JSON.parse(readFileSync(requestFile, "utf8"));
    // As the nx command line does: it loads the root dotenv files when it
    // starts, and `nx run` lets each task load its own dotenv files, which
    // its key's runtime inputs then see, unless the environment says not to.
    require("nx/src/utils/dotenv").loadRootEnvFiles(process.cwd());
    if (process.env.NX_LOAD_DOT_ENV_FILES !== "false") {
      process.env.NX_LOAD_DOT_ENV_FILES = "true";
    }
    const { createProjectGraphAsync } = require("nx/src/project-graph/project-graph");
    const graph = await createProjectGraphAsync({ exitOnError: false });
    result =
      request.command === "hash"
        ? { ok: true, hashes: await hashTasks(graph, request.tasks, request.overrides ?? {}) }
        : { ok: true, graph };
  } catch (error) {
    result = { ok: false, error: describeError(error) };
  }
  writeFileSync(resultFile, JSON.stringify(result));
}

async function hashTasks(projectGraph, taskIds, overrides) {
  const { readNxJson } = require("nx/src/config/nx-json");
  const { createTaskGraph } = require("nx/src/tasks-runner/create-task-graph");
  const { createTaskHasher } = require("nx/src/hasher/create-task-hasher");
  const {
    hashTask,
    hashTasksThatDoNotDependOnOutputsOfOtherTasks,
  } = require("nx/src/hasher/hash-task");
  const { getTaskSpecificEnv } = require("nx/src/tasks-runner/task-env");

  const nxJson = readNxJson();
  const hasher = createTaskHasher(projectGraph, nxJson);
  const hashes = {};
  for (const id of taskIds) {
    const [project, target, configuration] = id.split(":");
    const node = projectGraph.nodes[project];
    if (!node) {
      throw new Error(
        `There is no project "${project}". Projects: ${Object.keys(projectGraph.nodes).join(", ") || "none"}`,
      );
    }
    if (!node.data.targets?.[target]) {
      throw new Error(
        `Project "${project}" has no target "${target}". Targets: ${Object.keys(node.data.targets ?? {}).join(", ") || "none"}`,
      );
    }
    // The task graph that `nx run project:target` builds: the task and the
    // tasks it depends on.
    const taskGraph = createTaskGraph(
      projectGraph,
      {},
      [project],
      [target],
      configuration,
      overrides,
    );
    const task = Object.values(taskGraph.tasks).find(
      (t) => t.target.project === project && t.target.target === target,
    );
    // As in `nx run`: first the tasks whose hash needs no other task's
    // outputs, then the rest, which a real run hashes once their
    // dependencies have run.
    await hashTasksThatDoNotDependOnOutputsOfOtherTasks(
      hasher,
      projectGraph,
      taskGraph,
      nxJson,
      null,
    );
    if (!task.hash) {
      await hashTask(
        hasher,
        projectGraph,
        taskGraph,
        task,
        getTaskSpecificEnv(task, projectGraph),
        null,
      );
    }
    hashes[id] = { value: task.hash, details: task.hashDetails };
  }
  return hashes;
}

// Nx reports a failed graph as an error that holds the plugins' errors, each
// possibly with the file it concerns. Collect every message, so that a test
// can look for what a plugin said.
function describeError(error) {
  const messages = [];
  const seen = new Set();
  const visit = (value) => {
    if (value === null || value === undefined || seen.has(value)) {
      return;
    }
    if (typeof value === "string") {
      messages.push(value);
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value.message === "string") {
      messages.push(value.message);
    }
    if (typeof value.getErrors === "function") {
      value.getErrors().forEach(visit);
    }
    if (Array.isArray(value.errors)) {
      value.errors.forEach(visit);
    }
    visit(value.cause);
  };
  visit(error);
  return [...new Set(messages)].join("\n");
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
