import { dirname, resolve } from "node:path";
import { buildSettingsAndUnreadable } from "./build-settings";

/**
 * The folder that `build.dep-info-basedir` gives a cargo command started in
 * `folder` with the environment `env`, as an absolute path; `undefined`
 * where nothing sets it or a file that would decide cannot be read.
 *
 * Cargo takes the setting from `CARGO_BUILD_DEP_INFO_BASEDIR`, relative to
 * the folder it starts in, or else from the first configuration file that
 * sets it to a string, in the order of {@link buildSettingsAndUnreadable}:
 * that of `folder` and of each folder above it, then that of the Cargo
 * home, reading `.cargo/config` where it exists and `.cargo/config.toml`
 * otherwise. A file's own value comes before those of the files it
 * includes, and a later include before an earlier one. A path in a file is
 * relative to the folder above the one that holds the file. A file that
 * exists but cannot be read, met before the deciding one, leaves the folder
 * unknown. The plugin's `build` passes cargo no `--config`, so nothing else
 * sets it.
 */
export function configuredDepInfoBasedir(
  folder: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const fromEnvironment = env.CARGO_BUILD_DEP_INFO_BASEDIR;
  if (fromEnvironment !== undefined && fromEnvironment !== "") {
    return resolve(folder, fromEnvironment);
  }
  for (const entry of buildSettingsAndUnreadable(folder, env, "dep-info-basedir")) {
    if ("unreadable" in entry) {
      return undefined;
    }
    if (typeof entry.value === "string") {
      return resolve(dirname(dirname(entry.file)), entry.value);
    }
  }
  return undefined;
}
