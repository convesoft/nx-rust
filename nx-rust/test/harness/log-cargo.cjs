"use strict";

// The body of the `cargo` wrapper that cargo-wrapper.ts puts on PATH:
//
//   node log-cargo.cjs <real cargo> <log file> [cargo arguments...]
//
// It appends one JSON line with the folder, the arguments and the recorded
// variables of this call to the log, then runs the real cargo with the same
// arguments, folder, standard streams and environment, and exits as cargo did.
//
// One change to the environment: the real cargo's folder comes first on PATH.
// Cargo runs the `rustc` it finds on PATH, and Nx's run-commands puts Node's
// folder ahead of the inherited PATH, where a system rustc can live. With its
// own folder first, rustup's cargo runs rustup's rustc, as in a shell that has
// rustup's folder first.
//
// With NX_RUST_TEST_CARGO_VERSION set, for example to 1.90.0, the wrapper
// pretends to be a Cargo of that version older than 1.91, which the machine
// need not have: `cargo --version`, `cargo -V` and `cargo version` print the
// version without running cargo, and the report of `cargo metadata` lacks
// `build_directory`, as the report of every stable Cargo before 1.91 does
// (EVD-CARGO-DIRECTORIES). Everything else runs the real cargo.
//
// With NX_RUST_TEST_HOLD_CARGO set to `<subcommand>|<folder>`, a call whose
// first argument is that subcommand is logged, writes `<folder>/held` and
// waits until `<folder>/release` exists before it runs the real cargo, so
// that a test can act while a task is between its cache key and its cargo
// call (holdCargo in cargo-wrapper.ts).

const { spawn } = require("node:child_process");
const { appendFileSync, existsSync, writeFileSync } = require("node:fs");
const { delimiter, dirname, join } = require("node:path");

// The variables of this call's environment that the log records, each null
// where it is unset. cargo-wrapper.ts names the same ones.
const recordedVariables = ["RUSTUP_AUTO_INSTALL"];

const [realCargo, logFile, ...args] = process.argv.slice(2);
const recorded = Object.fromEntries(
  recordedVariables.map((name) => [name, process.env[name] ?? null]),
);
appendFileSync(logFile, `${JSON.stringify({ cwd: process.cwd(), args, env: recorded })}\n`);

const env = {
  ...process.env,
  PATH: [dirname(realCargo), process.env.PATH].filter(Boolean).join(delimiter),
};
const fakeVersion = process.env.NX_RUST_TEST_CARGO_VERSION;
if (fakeVersion && args.length === 1 && ["--version", "-V", "version"].includes(args[0])) {
  // Exits once the output is written: writes to a pipe can be asynchronous.
  process.stdout.write(`cargo ${fakeVersion} (0000000 2025-01-01)\n`, () => process.exit(0));
} else {
  holdIfAsked(() => runCargo(Boolean(fakeVersion) && args[0] === "metadata"));
}

// Waits as NX_RUST_TEST_HOLD_CARGO asks, then calls `next`.
function holdIfAsked(next) {
  const [subcommand, folder] = (process.env.NX_RUST_TEST_HOLD_CARGO ?? "").split("|");
  if (!subcommand || !folder || args[0] !== subcommand) {
    next();
    return;
  }
  writeFileSync(join(folder, "held"), "");
  const wait = setInterval(() => {
    if (existsSync(join(folder, "release"))) {
      clearInterval(wait);
      next();
    }
  }, 50);
}

function runCargo(rewriteReport) {
  const child = spawn(realCargo, args, {
    stdio: ["inherit", rewriteReport ? "pipe" : "inherit", "inherit"],
    env,
  });
  const stdout = [];
  if (rewriteReport) {
    child.stdout.on("data", (chunk) => stdout.push(chunk));
  }
  const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of forwardedSignals) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    console.error(`cargo wrapper: cannot run ${realCargo}: ${error.message}`);
    process.exit(127);
  });
  child.on("close", (code, signal) => {
    const finish = () => {
      if (signal) {
        for (const forwarded of forwardedSignals) {
          process.removeAllListeners(forwarded);
        }
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 1);
    };
    if (rewriteReport) {
      process.stdout.write(withoutBuildDirectory(Buffer.concat(stdout).toString("utf8")), finish);
    } else {
      finish();
    }
  });
}

// The report without `build_directory`, or the output as it is where it is no
// report.
function withoutBuildDirectory(output) {
  try {
    const report = JSON.parse(output);
    delete report.build_directory;
    return `${JSON.stringify(report)}\n`;
  } catch {
    return output;
  }
}
