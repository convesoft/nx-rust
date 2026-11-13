import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, relative, resolve } from "node:path";
import { findExecutable, testEnvironment } from "./environment";

/** One cargo invocation, as the wrapper logged it. */
export interface CargoCall {
  /** The folder cargo started in. */
  cwd: string;
  /** The arguments after `cargo`. */
  args: string[];
}

/**
 * A `cargo` executable that logs every invocation and then runs the real
 * cargo found on `PATH`, unchanged, in the same folder. Put it first on
 * `PATH` with {@link CargoWrapper.environment} to count what the plugin, Nx
 * or a task runs. Rustup's proxies still choose the toolchain, because the
 * real cargo starts in the folder the wrapper was started in.
 */
export class CargoWrapper {
  private constructor(
    /** The folder holding the `cargo` wrapper. */
    readonly binDirectory: string,
    /** The log, one JSON line per invocation. */
    readonly logFile: string,
    /** The cargo that the wrapper runs. */
    readonly realCargo: string,
  ) {}

  /**
   * Writes the wrapper into `directory`, which should lie outside any
   * fixture so that Nx does not see it.
   *
   * @param env The environment whose `PATH` holds the real cargo.
   */
  static install(directory: string, env: NodeJS.ProcessEnv = testEnvironment()): CargoWrapper {
    const binDirectory = resolve(directory, "bin");
    const realCargo = findExecutable("cargo", env.PATH ?? "", binDirectory);
    if (!realCargo) {
      throw new Error(`The cargo wrapper found no cargo on PATH: ${env.PATH}`);
    }
    const logFile = resolve(directory, "cargo-calls.jsonl");
    const script = join(__dirname, "log-cargo.cjs");
    mkdirSync(binDirectory, { recursive: true });
    writeFileSync(
      join(binDirectory, "cargo"),
      [
        "#!/bin/sh",
        "# Written by the nx-rust test harness (cargo-wrapper.ts).",
        `exec ${[process.execPath, script, realCargo, logFile].map(shellQuote).join(" ")} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(logFile, "");
    return new CargoWrapper(binDirectory, logFile, realCargo);
  }

  /** `env` with the wrapper first on `PATH`. */
  environment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...env, PATH: [this.binDirectory, env.PATH].filter(Boolean).join(delimiter) };
  }

  /**
   * The invocations logged so far, oldest first.
   *
   * @param root If given, folders become relative to it (`.` for `root`
   *   itself) and every occurrence of it in an argument becomes
   *   `{workspaceRoot}`.
   */
  calls(root?: string): CargoCall[] {
    const text = existsSync(this.logFile) ? readFileSync(this.logFile, "utf8") : "";
    const calls: CargoCall[] = text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));
    if (root === undefined) {
      return calls;
    }
    return calls.map(({ cwd, args }) => ({
      cwd: relative(root, cwd) || ".",
      args: args.map((arg) => arg.split(root).join("{workspaceRoot}")),
    }));
  }

  /** Forgets the invocations logged so far. */
  clear(): void {
    writeFileSync(this.logFile, "");
  }
}

function shellQuote(value: string): string {
  return `'${value.split("'").join(`'"'"'`)}'`;
}
