import { shellQuote } from "./artifact-kinds";

/**
 * The line that the command of a runtime input running one of the plugin's
 * Node scripts prints, before its random value, where the script cannot run
 * or fails (`DES-INPUTS`, "Failing runtime inputs"). The executor looks for
 * it when it runs such a command again (`failedInputWarnings`).
 */
export const failedInputLine = "@convesoft/nx-rust: this runtime input failed";

/**
 * The variable that names the file descriptor to which the command of a
 * script input sends the script's standard error: where it is unset, as
 * when Nx hashes a task, descriptor 3, which the command opens on
 * `/dev/null`; and `2`, the command's own standard error, where the
 * executor runs the command again to say why it failed.
 */
export const inputErrorsVariable = "NX_RUST_INPUT_ERRORS";

/**
 * Shell text that prints a value that no other evaluation prints, for a
 * runtime input whose query failed, so that Nx never restores a result
 * stored under that key (`DES-INPUTS`, "Failing runtime inputs"). It asks
 * `od` for 16 bytes of `/dev/urandom`, and where `od` is missing or fails,
 * as on a `PATH` that leaves it out with the tool whose failure the value
 * covers, it reads them from `/dev/urandom` with the shell's own `read` and
 * prints each as two hexadecimal digits with its own `printf`, in a
 * subshell with `LC_ALL=C`, so that it needs no program besides the shell.
 * Where `/dev/urandom` cannot be read either, it prints the process ids of
 * the shell and of its parent and, where `date` exists, the time; without
 * `date`, two such runs in fresh process namespaces can repeat it
 * (nxr-ntvnds). It writes nothing to standard error, which
 * Nx would hash as well.
 */
export const unrepeatableValue = [
  "{ od -An -N16 -tx1 /dev/urandom 2>/dev/null ||",
  "( LC_ALL=C; n=0; i=0;",
  "while [ $i -lt 16 ] && [ $n -lt 64 ]; do n=$((n + 1)); IFS= read -r c </dev/urandom;",
  `while [ -n "$c" ] && [ $i -lt 16 ]; do printf %02x "'$c"; c=\${c#?}; i=$((i + 1)); done; done;`,
  "[ $i -eq 16 ] && echo ) 2>/dev/null ||",
  'echo "process $$ $PPID $(date +%s.%N 2>/dev/null)"; }',
].join(" ");

/**
 * The command of a runtime input that runs one of the plugin's Node scripts
 * in the repository root with `argument`, a folder relative to it
 * (`DES-INPUTS`): the Node that creates the graph, the script and the folder,
 * by paths that reach no key, since Nx keys a task on what a runtime input
 * prints and not on its command. Where the script cannot run, as for a
 * plugin that Nx loads from its TypeScript source or a Node that is gone, or
 * fails, the command prints {@link failedInputLine} on a line of its own,
 * also after output without a final line break, and then
 * {@link unrepeatableValue}, so that no result stored under the key is ever
 * restored. It always ends with status 0, as Nx keys a task on what a
 * runtime input prints whatever its status (`EVD-RUSTUP-MISSING-TOOLCHAIN`).
 * The script's standard error goes where {@link inputErrorsVariable} says.
 */
// @mara implements DES-INPUTS
export function scriptInputCommand(script: string, argument: string): string {
  return [
    `{ ${shellQuote(process.execPath)} ${shellQuote(script)} ${shellQuote(argument)} 2>&"\${${inputErrorsVariable}:-3}" || { echo; echo ${shellQuote(failedInputLine)}; ${unrepeatableValue}; }; } 3>/dev/null`,
    "true",
  ].join("; ");
}
