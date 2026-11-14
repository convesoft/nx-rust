"use strict";

// Run by workspace.ts (NxSession) in a fixture workspace, which is its
// current folder, as a child process with an IPC channel. It answers the
// requests of inspect-workspace.cjs one after another, each message
// { id, request, env } with { id, result }, so that a test asks the same Nx
// many questions without starting a process for each.
//
// Each answer has to be the one a fresh process would give. Nx 24 keeps
// state in its modules that it resets only in a new process, such as the
// environment of each task by task id (tasks-runner/task-env.js) and
// database connections into the workspace's .nx folder, which the harness
// deletes when it resets the workspace (EVD-NX-24-PROCESS-STATE). So before
// each request after the first the session closes those connections, drops
// every JavaScript module from Node's module cache, so that Nx and the plugin
// load afresh, and puts back what the last request changed in the process:
// its environment, its current folder, the functions and listeners of
// `process`, the globals, `Error`'s stack trace settings and the performance
// timeline. Only Node itself, V8's caches of compiled code and Nx's native
// addon stay loaded. A request that changes a variable starting with NX_ or
// NODE_ is refused, because Node reads some of them only when it starts and
// the native addon may read them once; the harness sends it to a fresh
// process instead. A request that changes how Node loads modules, as a
// plugin written in TypeScript does, is answered, and the harness then ends
// the session.

const Module = require("node:module");

const root = process.cwd();
const startEnvironment = { ...process.env };
const watchedEvents = [
  "beforeExit",
  "exit",
  "SIGHUP",
  "SIGINT",
  "SIGTERM",
  "uncaughtException",
  "unhandledRejection",
  "warning",
];
const startListeners = new Map();
const startGlobals = new Set(Reflect.ownKeys(globalThis));
// Nx's native/index.js wraps process.emit, which process otherwise inherits
// from EventEmitter, each time it is loaded: kept, the wrappers would hold
// every earlier request's modules.
const startProcessFunctions = new Map(
  Object.getOwnPropertyNames(process)
    .filter((name) => typeof process[name] === "function")
    .map((name) => [name, process[name]]),
);
const startStackTrace = {
  prepareStackTrace: Error.prepareStackTrace,
  stackTraceLimit: Error.stackTraceLimit,
};
const startResolve = Module._resolveFilename;
const startExtensions = Object.keys(Module._extensions).join(",");

/** Why the session cannot answer a request with environment `env` as a fresh process would, if it cannot. */
function refusal(env) {
  const names = new Set([...Object.keys(env), ...Object.keys(startEnvironment)]);
  const changed = [...names].filter(
    (name) =>
      (name.startsWith("NX_") || name.startsWith("NODE_")) && env[name] !== startEnvironment[name],
  );
  return changed.length === 0
    ? undefined
    : `The session cannot change ${changed.sort().join(", ")}; such a request needs a fresh process.`;
}

/**
 * Puts the environment of a request in place. Node writes process.env
 * through to the process's real environment, which the native addon and
 * child processes read.
 */
function setEnvironment(env) {
  for (const name of Object.keys(process.env)) {
    if (!(name in env)) {
      delete process.env[name];
    }
  }
  for (const [name, value] of Object.entries(env)) {
    if (process.env[name] !== value) {
      process.env[name] = value;
    }
  }
}

/** Drops what the last request loaded and puts back what it changed. */
function forgetLastRequest() {
  const connections = require.cache[require.resolve("nx/src/utils/db-connection")];
  connections?.exports.removeDbConnections();
  // Node loads a native addon only once per process, so Nx's stays.
  for (const key of Object.keys(require.cache)) {
    if (key !== __filename && !key.endsWith(".node")) {
      delete require.cache[key];
    }
  }
  for (const kept of Object.values(require.cache)) {
    kept.children.length = 0;
  }
  for (const name of Object.getOwnPropertyNames(process)) {
    const original = startProcessFunctions.get(name);
    if (typeof process[name] !== "function" || process[name] === original) {
      continue;
    }
    if (original === undefined) {
      delete process[name];
    } else {
      process[name] = original;
    }
  }
  for (const event of watchedEvents) {
    for (const listener of process.listeners(event)) {
      if (!startListeners.get(event).has(listener)) {
        process.removeListener(event, listener);
      }
    }
  }
  for (const key of Reflect.ownKeys(globalThis)) {
    if (!startGlobals.has(key)) {
      delete globalThis[key];
    }
  }
  Object.assign(Error, startStackTrace);
  process.exitCode = undefined;
  performance.clearMarks();
  performance.clearMeasures();
}

/** What a request changed in how Node loads modules, which the session cannot put back. */
function damage() {
  if (Module._resolveFilename !== startResolve) {
    return "a request replaced Node's module resolution";
  }
  if (Object.keys(Module._extensions).join(",") !== startExtensions) {
    return "a request registered a loader for another file extension";
  }
  return undefined;
}

let answered = 0;

async function answer({ id, request, env }) {
  const refused = refusal(env);
  if (refused !== undefined) {
    return { id, refused };
  }
  setEnvironment(env);
  // The harness deletes the workspace and copies it again at the same path
  // between states.
  process.chdir(root);
  if (answered++ > 0) {
    forgetLastRequest();
  }
  const result = await require("./inspect-workspace.cjs").inspect(request);
  return { id, result, damaged: damage() };
}

process.on("message", (message) => {
  answer(message).then(
    (reply) => process.send(reply),
    (error) => process.send({ id: message.id, failed: String(error?.stack ?? error) }),
  );
});
// The harness ends the session; one whose test process has gone ends itself.
process.on("disconnect", () => process.exit(0));
for (const event of watchedEvents) {
  startListeners.set(event, new Set(process.listeners(event)));
}
process.send({ ready: true });
