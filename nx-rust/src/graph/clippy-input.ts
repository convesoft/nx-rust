import { shellQuote } from "./artifact-kinds";
import { unrepeatableValue } from "./script-input";

/** The last line that {@link clippyConfigurationCommand} prints where `CLIPPY_CONF_DIR` is set. */
export const clippyConfigurationEnd = "end of clippy configuration";

/**
 * The command of the runtime input of `lint` that carries the Clippy
 * configuration that `CLIPPY_CONF_DIR` selects into the key (`DES-INPUTS`,
 * "Clippy's configuration folder"). The `env` input of the variable hashes
 * only its value, the folder's path, and Nx hashes no file outside the
 * repository.
 *
 * Where the variable is unset, the command prints nothing, so those keys
 * hold nothing of it. Where it is set, the command goes to the workspace
 * root, where cargo runs clippy-driver and so where a relative folder
 * starts, and from the folder that the variable names, with symbolic links
 * followed, up to the file system's root, looks for `.clippy.toml` and
 * `clippy.toml`, as clippy does, and stops at the first folder that holds
 * either (`EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`). There it prints each of the
 * two that exists and is no folder, with its name and size and then its
 * content, so that it need not decide which of them clippy takes. It prints
 * a line that says so where the variable names no folder, where a file
 * cannot be read and where no folder holds a file, cases in which clippy
 * fails or uses its defaults whatever the key, and a value that no other
 * evaluation prints ({@link unrepeatableValue}) where the workspace root is
 * missing or a read fails after the file was found readable. It prints no
 * path, writes nothing to standard error, which Nx would hash as well, and
 * ends with {@link clippyConfigurationEnd} and status 0.
 *
 * @param workspaceRoot The workspace's root folder, relative to the repository root.
 */
// @mara implements DES-INPUTS
export function clippyConfigurationCommand(workspaceRoot: string): string {
  const folder = workspaceRoot === "." ? "." : `./${workspaceRoot}`;
  const body = [
    "unset CDPATH;",
    `cd ${shellQuote(folder)} || { ${unrepeatableValue}; exit 0; };`,
    `if [ -z "$CLIPPY_CONF_DIR" ] || ! cd -P -- "$CLIPPY_CONF_DIR"; then echo 'CLIPPY_CONF_DIR names no folder'; exit 0; fi;`,
    "while :; do found=;",
    "for name in .clippy.toml clippy.toml; do",
    'if [ -e "$name" ] && [ ! -d "$name" ]; then found=1;',
    'if [ -r "$name" ] && size=$(wc -c < "$name"); then',
    `echo "$name" $size; cat "$name" || ${unrepeatableValue}; echo;`,
    'else echo "$name cannot be read"; fi;',
    "fi; done;",
    '[ -n "$found" ] && break;',
    `if [ "$(pwd -P)" = / ]; then echo 'no configuration file'; break; fi;`,
    `cd -P .. || { ${unrepeatableValue}; break; };`,
    "done;",
    `echo '${clippyConfigurationEnd}'`,
  ].join(" ");
  return `if [ -n "\${CLIPPY_CONF_DIR+x}" ]; then ( ${body} ) 2>/dev/null; fi; true`;
}
