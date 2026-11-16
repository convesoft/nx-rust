import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { wasmTriple } from "../../src/graph/wasm";
import { testEnvironment } from "./environment";
import { fixturesDirectory } from "./fixtures";

/** The version of the `wasm-bindgen` crate that the fixture `wasm-packages` locks. */
export function lockedWasmBindgen(): string {
  const lockfile = readFileSync(join(fixturesDirectory, "wasm-packages/rust/Cargo.lock"), "utf8");
  const version = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lockfile)?.[1];
  if (version === undefined) {
    throw new Error("wasm-packages/rust/Cargo.lock locks no wasm-bindgen crate.");
  }
  return version;
}

/**
 * The folder of a real `wasm-bindgen` CLI of the version that the fixture
 * `wasm-packages` locks, looked up as a task finds it: the folder that
 * `NX_RUST_TEST_WASM_BINDGEN` names, where it holds `wasm-bindgen`, else the
 * first folder on `PATH` that holds it, else the `bin` of the Cargo home
 * (`CARGO_HOME`, or `~/.cargo`); `undefined` where none has it, or the one
 * found prints another version. The tests that need the real tool then skip
 * (`verification.mara.md`, "How the plugin is tested"). The plugin never
 * installs it (`ADR-V1-SCOPE`).
 */
export function wasmBindgenFolder(): string | undefined {
  const named = process.env.NX_RUST_TEST_WASM_BINDGEN;
  const home = process.env.CARGO_HOME || join(homedir(), ".cargo");
  const folder = [
    ...(named === undefined || named === "" ? [] : [named]),
    ...(process.env.PATH ?? "").split(delimiter),
    join(home, "bin"),
  ].find((entry) => entry !== "" && existsSync(join(entry, "wasm-bindgen")));
  if (folder === undefined) {
    return undefined;
  }
  const run = spawnSync(join(folder, "wasm-bindgen"), ["--version"], { encoding: "utf8" });
  return run.stdout?.trim() === `wasm-bindgen ${lockedWasmBindgen()}` ? folder : undefined;
}

/**
 * Whether the toolchain that the tests' cargo uses by default, rustup's
 * default where nothing names one, has the standard library for the wasm
 * triple. The tests never install it.
 */
export function wasmTargetInstalled(): boolean {
  const run = spawnSync("rustc", ["--print", "sysroot"], {
    env: testEnvironment(),
    encoding: "utf8",
  });
  return run.status === 0 && existsSync(join(run.stdout.trim(), "lib", "rustlib", wasmTriple));
}

/**
 * `PATH` of the tests' environment without the folders that hold a
 * `wasm-bindgen`, so that a test sees no CLI wherever the machine has one.
 */
export function pathWithoutWasmBindgen(): string {
  return (testEnvironment().PATH ?? "")
    .split(delimiter)
    .filter((folder) => folder === "" || !existsSync(join(folder, "wasm-bindgen")))
    .join(delimiter);
}
