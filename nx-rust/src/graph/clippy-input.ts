import { dirname, resolve } from "node:path";
import { tableSettings } from "../cargo/build-settings";
import { shellQuote } from "./artifact-kinds";
import { unrepeatableValue } from "./script-input";

/** The last line that {@link clippyConfigurationCommand} prints for a folder that it looks in. */
export const clippyConfigurationEnd = "end of clippy configuration";

/**
 * The folders that `CLIPPY_CONF_DIR` under `[env]` names in the
 * configuration files that cargo reads for a command started in
 * `workspaceRoot`, the files that `include` adds among them, each once and
 * in the order of {@link tableSettings} (`DES-INPUTS`, "Clippy's
 * configuration folder"). Cargo gives clippy-driver such a value as
 * `CLIPPY_CONF_DIR` (`EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`): a string, or the
 * `value` of a table, as it is written, which clippy resolves from the
 * workspace root where it is relative, and with `relative = true` resolved
 * against the folder that holds the `.cargo` folder of the file. Which of
 * them, or the variable of the task's environment, clippy receives is left
 * to cargo: the runtime input prints the configuration of every one. A value
 * of another type, on which cargo fails, names nothing.
 *
 * @param env Where `CARGO_HOME` is read from.
 */
// @mara implements DES-INPUTS
export function configuredClippyFolders(workspaceRoot: string, env: NodeJS.ProcessEnv): string[] {
  const folders = tableSettings(workspaceRoot, env, "env", "CLIPPY_CONF_DIR").flatMap(
    ({ file, value }) => {
      if (typeof value === "string") {
        return [value];
      }
      const table = typeof value === "object" && value !== null ? value : {};
      const { value: folder, relative } = table as { value?: unknown; relative?: unknown };
      if (typeof folder !== "string") {
        return [];
      }
      return [relative === true ? resolve(dirname(dirname(file)), folder) : folder];
    },
  );
  return [...new Set(folders)];
}

/**
 * The command of the runtime input of `lint` that carries the Clippy
 * configuration that `CLIPPY_CONF_DIR` can select into the key
 * (`DES-INPUTS`, "Clippy's configuration folder"). The `env` input of the
 * variable hashes only its value, the folder's path, Cargo's `[env]` can set
 * it where Nx's environment does not, and Nx hashes no file outside the
 * repository.
 *
 * It looks in each folder that clippy can be given: the variable of the
 * task's environment, where it is set, after a line `CLIPPY_CONF_DIR of the
 * environment`, and each folder of `configured`, after a line
 * `CLIPPY_CONF_DIR of the Cargo configuration` and its number. Where none is
 * set, it prints nothing, so those keys hold nothing of it. For each folder,
 * it goes to the workspace root, where cargo runs clippy-driver and so where
 * a relative folder starts, and from the folder, with symbolic links
 * followed, up to the file system's root, looks for `.clippy.toml` and
 * `clippy.toml`, as clippy does, and stops at the first folder that holds
 * either (`EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`). There it prints each of the
 * two that exists and is no folder, with its name and size and then its
 * content, so that it need not decide which of them clippy takes, and then
 * {@link clippyConfigurationEnd}. It prints a line that says so in place of
 * all that where the value names no folder or is empty, and before that end
 * where a file cannot be read or no folder holds a file, cases in which
 * clippy fails or uses its defaults whatever the key holds. It prints a
 * value that no other evaluation prints ({@link unrepeatableValue}) where
 * the workspace root is missing, or where the size or content of a file
 * that it found readable cannot be read. It prints no path, writes nothing
 * to standard error, which Nx would hash as well, and ends with status 0.
 *
 * @param workspaceRoot The workspace's root folder, relative to the repository root.
 * @param configured The folders that the workspace's Cargo configuration
 *   names ({@link configuredClippyFolders}).
 */
// @mara implements DES-INPUTS
export function clippyConfigurationCommand(
  workspaceRoot: string,
  configured: readonly string[] = [],
): string {
  const folder = workspaceRoot === "." ? "." : `./${workspaceRoot}`;
  // A relative value gets `./`, so that `cd` neither reads `-` as the
  // previous folder nor looks it up in CDPATH.
  const lookup = [
    "nx_rust_clippy() (",
    "unset CDPATH;",
    `cd ${shellQuote(folder)} || { ${unrepeatableValue}; exit 0; };`,
    "d=$1; case $d in /*) ;; *) d=./$d ;; esac;",
    `if [ -z "$1" ] || ! cd -P -- "$d"; then echo 'names no folder'; exit 0; fi;`,
    "while :; do found=;",
    "for name in .clippy.toml clippy.toml; do",
    'if [ -e "$name" ] && [ ! -d "$name" ]; then found=1;',
    'if [ -r "$name" ]; then',
    `if size=$(wc -c < "$name"); then echo "$name" $size; cat "$name" || ${unrepeatableValue}; echo; else ${unrepeatableValue}; fi;`,
    'else echo "$name cannot be read"; fi;',
    "fi; done;",
    '[ -n "$found" ] && break;',
    `if [ "$(pwd -P)" = / ]; then echo 'no configuration file'; break; fi;`,
    `cd -P .. || { ${unrepeatableValue}; break; };`,
    "done;",
    `echo '${clippyConfigurationEnd}'`,
    ");",
  ].join(" ");
  const calls = [
    `if [ -n "\${CLIPPY_CONF_DIR+x}" ]; then echo 'CLIPPY_CONF_DIR of the environment'; nx_rust_clippy "$CLIPPY_CONF_DIR"; fi;`,
    ...configured.map(
      (value, index) =>
        `echo 'CLIPPY_CONF_DIR of the Cargo configuration ${index + 1}'; nx_rust_clippy ${shellQuote(value)};`,
    ),
  ].join(" ");
  return `{ ${lookup} ${calls} } 2>/dev/null; true`;
}
