/**
 * The selecting runner of the test binaries' step under `workspace-build`
 * (`DES-TEST-RUN`, "The selecting runner" and "The runner program"). Cargo
 * starts it, as `target.<host>.runner`, for every test executable of the
 * workspace, with the program and its arguments as its own arguments, in
 * the package's folder and with the package's name in `CARGO_PKG_NAME`. The
 * plugin gives it the group's packages in `NX_RUST_TEST_PACKAGES`, as
 * `:a:b:`, and the folder of the step's record in `NX_RUST_TEST_RECORD`.
 *
 * For each start it:
 *
 * 1. records the start before anything else, in a file of its own that it
 *    creates exclusively in the record folder, which it creates where it is
 *    missing, naming the package and the program, and exits with 125, having
 *    started nothing, where it cannot;
 * 2. adds an error entry, says why on standard error and exits with 125
 *    where `CARGO_PKG_NAME` is missing or empty, no program is given, or the
 *    list of packages is missing or not of its form;
 * 3. adds a skip entry and exits with 0 for a package that is not in the
 *    list, compared by exact name;
 * 4. otherwise starts the program by its path, with its arguments and with
 *    the environment that cargo gave the runner less the runner's own two
 *    variables, and once the program has ended adds an end entry with its
 *    exit status or the signal that ended it, and ends the same way; where
 *    it cannot add the end entry, it exits with 125.
 *
 * The script is started with the Node that runs the batch implementation,
 * by absolute paths, and imports only Node's own modules. It starts nothing
 * through `PATH`.
 */
// @mara implements DES-TEST-RUN
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

/** The variable that names the group's packages, as `:a:b:`. */
export const packagesVariable = "NX_RUST_TEST_PACKAGES";
/** The variable that names the folder of the step's record. */
export const recordVariable = "NX_RUST_TEST_RECORD";
/** The status with which the runner ends where it cannot do its part. */
export const runnerFailureStatus = 125;

/** One entry of a record file, one JSON object per line. */
export type RecordEntry =
  | { start: { package: string; program: string } }
  | { skip: true }
  | { error: string }
  | { end: { status: number } | { signal: string } };

function main(): void {
  const program = process.argv[2];
  const args = process.argv.slice(3);
  const pkg = process.env.CARGO_PKG_NAME ?? "";
  const folder = process.env[recordVariable];
  // 1. The start, before anything else.
  let fd: number;
  try {
    if (folder === undefined || folder === "") {
      throw new Error(`${recordVariable} is not set`);
    }
    // The plugin creates the folder for its step; a command that a verbose
    // run printed and that someone runs by hand finds it gone.
    mkdirSync(folder, { recursive: true });
    fd = openSync(
      join(
        folder,
        `${process.pid}-${process.hrtime.bigint()}-${Math.random().toString(36).slice(2)}.jsonl`,
      ),
      "wx",
    );
    append(fd, { start: { package: pkg, program: program ?? "" } });
  } catch (error) {
    process.stderr.write(
      `@convesoft/nx-rust's test runner could not record the start of ${program ?? "a test executable"}, so it starts nothing: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(runnerFailureStatus);
  }
  // 2. Fail closed on what cargo or the plugin should have given.
  const packages = process.env[packagesVariable];
  const problem =
    pkg === ""
      ? "CARGO_PKG_NAME is missing or empty"
      : program === undefined || program === ""
        ? "cargo gave it no program to run"
        : packages === undefined
          ? `${packagesVariable} is not set`
          : !/^:(?:[^:\s]+:)+$/.test(packages)
            ? `${packagesVariable} is ${JSON.stringify(packages)}, which is not of the form :a:b:`
            : undefined;
  if (problem !== undefined) {
    process.stderr.write(
      `@convesoft/nx-rust's test runner starts nothing for ${program ?? "a test executable"}: ${problem}.\n`,
    );
    finish(fd, { error: problem });
    process.exit(runnerFailureStatus);
  }
  // 3. Another package's test executable.
  if (!(packages as string).includes(`:${pkg}:`)) {
    finish(fd, { skip: true });
    process.exit(0);
  }
  // 4. A test executable of the group: cargo's environment, less the runner's own variables.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[packagesVariable];
  delete env[recordVariable];
  const child = spawn(resolve(program as string), args, { env, stdio: "inherit" });
  superviseChild(child, fd, program as string);
}

/** What {@link superviseChild} needs from a started program. */
export interface SupervisedChild {
  kill(signal: NodeJS.Signals): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

/** How the runner ends: by a signal it raises on itself, or with a status. */
export interface RunnerEnding {
  raise(signal: NodeJS.Signals): void;
  exit(status: number): void;
}

/** The runner's own ending: the child's signal raised on the runner's own process. */
export const processEnding: RunnerEnding = {
  raise: (signal) => {
    process.kill(process.pid, signal);
  },
  exit: (status) => process.exit(status),
};

/**
 * Forwards the signals that end a run to the started program and, once it
 * has ended, adds the end entry to the record file `fd` and ends the runner
 * the same way, through `ending`. Tests pass an ending of their own, so
 * that a program ended by a signal that dumps core does not make the test
 * process raise it on itself.
 */
export function superviseChild(
  child: SupervisedChild,
  fd: number,
  program: string,
  ending: RunnerEnding = processEnding,
): void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  for (const signal of signals) {
    process.on(signal, forward);
  }
  child.on("error", (error) => {
    process.stderr.write(
      `@convesoft/nx-rust's test runner could not start ${program}: ${error.message}\n`,
    );
    // The program did not run: the record ends with the status that a
    // shell gives a command it cannot start, so that its task fails.
    finish(fd, { end: { status: 127 } });
    ending.exit(127);
  });
  child.on("exit", (code, signal) => {
    for (const name of signals) {
      process.off(name, forward);
    }
    if (signal !== null) {
      finish(fd, { end: { signal } });
      ending.raise(signal);
      // A signal that Node ignores, such as SIGPIPE, does not end the
      // runner: it then fails, so that cargo does not see a success.
      setTimeout(() => ending.exit(runnerFailureStatus), 1000);
      return;
    }
    const status = code ?? runnerFailureStatus;
    finish(fd, { end: { status } });
    ending.exit(status);
  });
}

// Adds an entry to the record file as one line.
function append(fd: number, entry: RecordEntry): void {
  writeSync(fd, `${JSON.stringify(entry)}\n`);
}

// Adds the last entry and closes the record file; where that fails, the
// runner exits with 125, so that the start stays without its end.
function finish(fd: number, entry: RecordEntry): void {
  try {
    append(fd, entry);
    closeSync(fd);
  } catch (error) {
    process.stderr.write(
      `@convesoft/nx-rust's test runner could not record how ${process.argv[2] ?? "a test executable"} ended: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(runnerFailureStatus);
  }
}

if (require.main === module) {
  main();
}
