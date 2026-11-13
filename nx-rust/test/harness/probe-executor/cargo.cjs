"use strict";

// A stand-in for an executor that runs cargo itself, as the plugin's executor
// will (cargo-wrapper.ts, `probeExecutor`). It starts `cargo` from PATH in the
// project's folder, with the environment Nx gives the executor process.

const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

function runCargo(args, cwd) {
  const result = spawnSync("cargo", args, { cwd, encoding: "utf8" });
  return {
    success: result.status === 0,
    terminalOutput: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`,
  };
}

// One task: `cargo --version`.
module.exports = async function cargo(_options, context) {
  const root = context.projectsConfigurations.projects[context.projectName].root;
  const { success, terminalOutput } = runCargo(["--version"], join(context.root, root));
  process.stdout.write(terminalOutput);
  return { success };
};

// A batch: `cargo -V` for each task, so that a test can tell a batch apart.
module.exports.batch = async function batch(taskGraph, _inputs, _overrides, context) {
  const results = {};
  for (const task of Object.values(taskGraph.tasks)) {
    results[task.id] = runCargo(["-V"], join(context.root, task.projectRoot));
  }
  return results;
};
