"use strict";

// The body of the `cargo` wrapper that cargo-wrapper.ts puts on PATH:
//
//   node log-cargo.cjs <real cargo> <log file> [cargo arguments...]
//
// It appends one JSON line with the folder and the arguments of this call to
// the log, then runs the real cargo with the same arguments, folder, standard
// streams and environment, and exits as cargo did.
//
// One change to the environment: the real cargo's folder comes first on PATH.
// Cargo runs the `rustc` it finds on PATH, and Nx's run-commands puts Node's
// folder ahead of the inherited PATH, where a system rustc can live. With its
// own folder first, rustup's cargo runs rustup's rustc, as in a shell that has
// rustup's folder first.

const { spawn } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const { delimiter, dirname } = require("node:path");

const [realCargo, logFile, ...args] = process.argv.slice(2);
appendFileSync(logFile, `${JSON.stringify({ cwd: process.cwd(), args })}\n`);

const env = {
  ...process.env,
  PATH: [dirname(realCargo), process.env.PATH].filter(Boolean).join(delimiter),
};
const child = spawn(realCargo, args, { stdio: "inherit", env });
const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of forwardedSignals) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(`cargo wrapper: cannot run ${realCargo}: ${error.message}`);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  if (signal) {
    for (const forwarded of forwardedSignals) {
      process.removeAllListeners(forwarded);
    }
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
