import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { findExecutable, testEnvironment } from "./environment";

/** One cargo invocation, as the wrapper logged it. */
export interface CargoCall {
  /** The folder cargo started in. */
  cwd: string;
  /** The arguments after `cargo`. */
  args: string[];
}

/** The variables of cargo's environment that the wrapper records with each call. */
export type RecordedVariable = "RUSTUP_AUTO_INSTALL";

/** A {@link CargoCall} with the recorded variables, each `null` where it was unset. */
export interface CargoCallWithEnv extends CargoCall {
  env: Record<RecordedVariable, string | null>;
}

/**
 * The `cargo metadata` call with which graph creation reads the report of
 * `manifest`, started in `cwd`. A manifest inside the repository is named
 * from `{workspaceRoot}`, one outside it by its absolute path.
 */
export function metadataCall(cwd: string, manifest: string): CargoCall {
  const path = manifest.startsWith("/") ? manifest : `{workspaceRoot}/${manifest}`;
  return {
    cwd,
    args: ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", path],
  };
}

/** The `cargo metadata` call that reads the workspace whose root manifest lies in `root`. */
export function workspaceCall(root: string): CargoCall {
  return metadataCall(root, root === "." ? "Cargo.toml" : `${root}/Cargo.toml`);
}

/**
 * A `cargo` executable that logs every invocation and then runs the real
 * cargo found on `PATH` in the same folder, with the real cargo's folder
 * first on `PATH` so that it runs the matching `rustc`. Rustup's proxies
 * still choose the toolchain, because the real cargo starts in the folder the
 * wrapper was started in. The wrapper is the shell script `log-cargo.sh`,
 * which hands the calls that it does not take itself to `log-cargo.cjs` in
 * Node.
 *
 * To count what the plugin, Nx or a task runs, the wrapper has to come first
 * wherever cargo is looked up:
 *
 * - {@link CargoWrapper.environment} puts it first on the `PATH` of the
 *   command a test starts. Graph creation, executors and batches inherit
 *   that `PATH` from Nx.
 * - Nx's `nx:run-commands` rebuilds the `PATH` of its tasks: the
 *   `node_modules/.bin` folders from the task's folder up to the file system
 *   root come first, then the folder of the Node executable, then the
 *   inherited `PATH`. A copy in the workspace's `node_modules/.bin`, written
 *   with {@link CargoWrapper.placeIn}, therefore comes ahead of Node's folder
 *   for those tasks, wherever Node and cargo are installed.
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
    const wrapper = new CargoWrapper(binDirectory, logFile, realCargo);
    wrapper.placeIn(binDirectory);
    writeFileSync(logFile, "");
    return wrapper;
  }

  /**
   * Writes another `cargo` into `folder` that logs to the same log, such as a
   * workspace's `node_modules/.bin`, where Nx's `nx:run-commands` looks first.
   */
  placeIn(folder: string): void {
    const paths = new Map([
      ["NODE", process.execPath],
      ["SCRIPT", join(__dirname, "log-cargo.cjs")],
      ["CARGO", this.realCargo],
      ["CARGO_FOLDER", dirname(this.realCargo)],
      ["LOG", this.logFile],
    ]);
    const template = readFileSync(join(__dirname, "log-cargo.sh"), "utf8");
    const script = template.replace(/@([A-Z_]+)@/g, (placeholder, name: string) => {
      const path = paths.get(name);
      if (path === undefined) {
        throw new Error(`log-cargo.sh has an unknown placeholder: ${placeholder}`);
      }
      return shellQuote(path);
    });
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "cargo"), script, { mode: 0o755 });
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
    return this.callsWithEnv(root).map(({ cwd, args }) => ({ cwd, args }));
  }

  /**
   * The invocations logged so far, as {@link CargoWrapper.calls} returns
   * them, each with the {@link RecordedVariable}s of its environment.
   */
  callsWithEnv(root?: string): CargoCallWithEnv[] {
    const text = existsSync(this.logFile) ? readFileSync(this.logFile, "utf8") : "";
    const calls: CargoCallWithEnv[] = text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));
    if (root === undefined) {
      return calls;
    }
    return calls.map(({ cwd, args, env }) => ({
      cwd: relative(root, cwd) || ".",
      args: args.map((arg) => arg.split(root).join("{workspaceRoot}")),
      env,
    }));
  }

  /** Forgets the invocations logged so far. */
  clear(): void {
    writeFileSync(this.logFile, "");
  }
}

/**
 * The task `<project>:cargo` of a project whose `targets` include
 * `{ "cargo": { "executor": probeExecutor } }` runs `cargo --version` in the
 * project's folder from an executor process, the way the plugin's executor
 * will run cargo. Run in a batch, it runs `cargo -V` for each task instead, so
 * that a test can tell the two apart in the log. Install it with
 * {@link installProbeExecutor}.
 */
export const probeExecutor = "cargo-probe-executor:cargo";

/**
 * A `project.json` for a crate folder with a target for each way a task can
 * run cargo: `probe-command`, an `nx:run-commands` target that prints the
 * cargo it finds on `PATH` and runs `cargo --version` in the project's
 * folder, and `probe-executor`, which runs {@link probeExecutor}.
 */
export function cargoProbeProject(name: string): string {
  return JSON.stringify({
    name,
    targets: {
      "probe-command": {
        executor: "nx:run-commands",
        options: { command: "command -v cargo && cargo --version", cwd: "{projectRoot}" },
      },
      "probe-executor": { executor: probeExecutor },
    },
  });
}

/** Copies the package of {@link probeExecutor} into `root/node_modules`, which Nx ignores. */
export function installProbeExecutor(root: string): void {
  cpSync(join(__dirname, "probe-executor"), join(root, "node_modules", "cargo-probe-executor"), {
    recursive: true,
  });
}

/** A pause of the cargo wrapper before one subcommand ({@link holdCargo}). */
export interface CargoHold {
  /** The variable to give the command whose cargo call is to wait. */
  env: Record<string, string>;
  /** Resolves once a call has reached the pause. */
  held(timeout?: number): Promise<void>;
  /** Lets the waiting call run the real cargo. */
  release(): void;
  /** Deletes the hold's folder. */
  remove(): void;
}

/**
 * Makes the cargo wrapper wait before the real cargo of a call whose first
 * argument is `subcommand`, in the commands that get {@link CargoHold.env}:
 * after Nx has computed the task's key and started its executor, and
 * before cargo reads `Cargo.lock`. Meanwhile a test can change the
 * repository or run another command.
 */
export function holdCargo(subcommand: string): CargoHold {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-hold-")));
  return {
    env: { NX_RUST_TEST_HOLD_CARGO: `${subcommand}|${folder}` },
    async held(timeout = 60_000) {
      for (const start = Date.now(); !existsSync(join(folder, "held"));) {
        if (Date.now() - start > timeout) {
          throw new Error(`No cargo ${subcommand} reached the hold in ${folder}.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    release: () => writeFileSync(join(folder, "release"), ""),
    remove: () => rmSync(folder, { recursive: true, force: true }),
  };
}

function shellQuote(value: string): string {
  return `'${value.split("'").join(`'"'"'`)}'`;
}
