"use strict";

// The body of the `cargo` wrapper that cargo-wrapper.ts puts on PATH:
//
//   node log-cargo.cjs <real cargo> <log file> [cargo arguments...]
//
// It appends one JSON line with the folder and the arguments of this call to
// the log, then runs the real cargo with the same arguments, folder, standard
// streams and environment, and exits as cargo did.

const { spawn } = require("node:child_process");
const { appendFileSync } = require("node:fs");

const [realCargo, logFile, ...args] = process.argv.slice(2);
appendFileSync(logFile, `${JSON.stringify({ cwd: process.cwd(), args })}\n`);

const child = spawn(realCargo, args, { stdio: "inherit" });
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
