import type { ExecutorContext } from "@nx/devkit";

/** One cargo command that a task runs. */
export interface CargoInvocation {
  /** The arguments after `cargo`. */
  args: string[];
  /** The absolute path of the folder where cargo starts, the workspace root. */
  cwd: string;
  /**
   * The environment variables that the plugin sets for this command over
   * the task's environment, which it otherwise passes on unchanged
   * (`DES-INVOCATION`): only the compile of `napi-build` sets some (`DES-NAPI`).
   */
  env?: Readonly<Record<string, string>>;
}

/**
 * The environment that cargo runs with for `invocation`: the task's
 * environment, with the variables of the invocation laid over it.
 */
export function cargoEnvironment(
  invocation: CargoInvocation,
  taskEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return invocation.env === undefined ? taskEnv : { ...taskEnv, ...invocation.env };
}

/**
 * Whether Nx runs a single task verbosely, through its `--verbose` flag or
 * `NX_VERBOSE_LOGGING=true` (`DES-INVOCATION`, "Printing the command"): what
 * `isVerbose` in the task's executor context says, and nothing else.
 *
 * Nx 24 turns the flag and the variable into one value of
 * `NX_VERBOSE_LOGGING` in the `nx` process, the flag winning both ways, and
 * hands that to the executor as `isVerbose`. The task's own environment is
 * no substitute: Nx deletes from it each variable whose value a root `.env`
 * file repeats and then loads the task's dotenv files, so a crate's `.env`
 * can give the task another `NX_VERBOSE_LOGGING` than the run's
 * (`EVD-NX-24-VERBOSE`). A batch implementation, whose context never says
 * that the run is verbose, asks {@link batchRunsVerbosely} instead.
 */
// @mara implements DES-INVOCATION
export function taskRunsVerbosely(context: Pick<ExecutorContext, "isVerbose">): boolean {
  return context.isVerbose === true;
}

/**
 * Whether Nx runs a batch verbosely, for a batch implementation, whose
 * context in Nx 24 always has `isVerbose: false` (`DES-INVOCATION`, "Printing
 * the command"): whether `NX_VERBOSE_LOGGING` is `true` in the batch
 * process's environment. Nx copies that environment from the `nx` process
 * after its `--verbose` flag has set the variable there, and loads no task's
 * dotenv file into it (`EVD-NX-24-VERBOSE`). A single task asks
 * {@link taskRunsVerbosely} instead.
 *
 * @param batchEnv The batch process's own environment, `process.env`, not a
 *   task's environment that the batch rebuilds from dotenv files.
 */
// @mara implements DES-INVOCATION
export function batchRunsVerbosely(batchEnv: NodeJS.ProcessEnv): boolean {
  return batchEnv.NX_VERBOSE_LOGGING === "true";
}

/**
 * The lines that a verbose run prints before cargo starts for `invocation`
 * (`DES-INVOCATION`, "Printing the command"): a heading that names `tasks`,
 * then, indented, a `cd` to the folder where cargo starts and the command,
 * with the variables that the plugin sets for it before `cargo`, as POSIX
 * shell code that runs the same command where it is pasted. Every word is
 * quoted where a shell would read it otherwise ({@link shellWord}).
 *
 * The lines come from the invocation that cargo is started with, so that
 * they cannot differ from what runs.
 *
 * @param tasks The task, or the tasks, whose command it is, such as `api:test`.
 * @throws {Error} When a variable's name is no name that a POSIX shell can
 *   assign.
 */
// @mara implements DES-INVOCATION
export function commandBlock(tasks: string, invocation: CargoInvocation): string {
  const assignments = Object.entries(invocation.env ?? {}).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`The variable name ${JSON.stringify(name)} cannot be set in a POSIX shell.`);
    }
    return `${name}=${shellWord(value)}`;
  });
  const command = [...assignments, "cargo", ...invocation.args.map(shellWord)].join(" ");
  return [
    `${tasks}: @convesoft/nx-rust runs cargo as these lines do in a POSIX shell:`,
    `  cd ${shellWord(invocation.cwd)}`,
    `  ${command}`,
    "",
  ].join("\n");
}

/**
 * Writes the lines of {@link commandBlock} for `invocation` to this
 * process's standard error, and resolves once they are out, so that they
 * come before what cargo prints (`DES-INVOCATION`, "Printing the command").
 * A task run on its own and a batch both print through it: a task's
 * standard error is its own output, and a batch process's is the batch's,
 * which belongs to no task.
 */
// @mara implements DES-INVOCATION
export function printCommand(tasks: string, invocation: CargoInvocation): Promise<void> {
  const block = commandBlock(tasks, invocation);
  return new Promise((resolve) => process.stderr.write(block, () => resolve()));
}

/**
 * `word` as a POSIX shell reads it back: as it is where it holds only
 * letters, digits and `_ - . / : @ % + , =`, and does not start with `=`,
 * which zsh expands, and else in single quotes, with each single quote
 * written `'\''`. So a package ID specification is quoted for its `#`,
 * which starts a comment in some places and is a glob operator in zsh, and
 * a folder for its spaces, while `%20` in a specification stays as it is.
 */
export function shellWord(word: string): string {
  if (/^[A-Za-z0-9_\-./:@%+,][A-Za-z0-9_\-./:@%+,=]*$/.test(word)) {
    return word;
  }
  return `'${word.replace(/'/g, `'\\''`)}'`;
}
