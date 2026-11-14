import { dirname, resolve } from "node:path";
import { BuildSetting, buildSettings } from "./build-settings";

/**
 * The programs that `build.rustc` and `build.rustdoc` in Cargo's
 * configuration name for a command started in a workspace root, which cargo
 * runs in place of `rustc` and `rustdoc` unless `RUSTC`, `CARGO_BUILD_RUSTC`,
 * `RUSTDOC` or `CARGO_BUILD_RUSTDOC` names another (`DES-INPUTS`,
 * `EVD-CARGO-COMPILER-SELECTION`).
 *
 * Each list names every program that a setting makes cargo run, once: none
 * where no file sets the key, and otherwise the one that the files give.
 * Where a file that `include` adds sets it, Cargo 1.91, which ignores
 * `include`, may take another value than later versions, and the list then
 * also names that one; where 1.91 finds none, it runs `rustc` or `rustdoc`
 * as without a setting. A program is an absolute path, or a bare name that
 * cargo looks up on `PATH`.
 */
export interface ConfiguredTools {
  rustc: string[];
  rustdoc: string[];
}

/** The tools of a workspace whose configuration names neither. */
export const noConfiguredTools: ConfiguredTools = { rustc: [], rustdoc: [] };

/**
 * The programs that `build.rustc` and `build.rustdoc` name in the
 * configuration files that cargo reads in `workspaceRoot`, read with the
 * precedence of {@link buildSettings} and resolved as cargo resolves them: a
 * value with a `/` against the folder above the one that holds the file,
 * which for `.cargo/config.toml` is the folder that holds `.cargo` and for
 * the Cargo home's `config.toml` the Cargo home's parent; a value without one
 * stays a bare name. The value of the file with the highest precedence
 * counts, and cargo fails on one that is no string, which names nothing here.
 *
 * @param env Where `CARGO_HOME` is read from; the variables that name a
 *   compiler are read by the toolchain input with the task's environment.
 */
// @mara implements DES-INPUTS
export function configuredTools(workspaceRoot: string, env: NodeJS.ProcessEnv): ConfiguredTools {
  return {
    rustc: configuredPrograms(buildSettings(workspaceRoot, env, "rustc")),
    rustdoc: configuredPrograms(buildSettings(workspaceRoot, env, "rustdoc")),
  };
}

// The program that the settings name with includes applied, and the one
// without them, as Cargo 1.91 reads them, each once.
function configuredPrograms(settings: readonly BuildSetting[]): string[] {
  const programs = [
    program(settings[0]),
    program(settings.find((setting) => !setting.included)),
  ].filter((found): found is string => found !== undefined);
  return [...new Set(programs)];
}

function program(setting: BuildSetting | undefined): string | undefined {
  if (setting === undefined || typeof setting.value !== "string") {
    return undefined;
  }
  return setting.value.includes("/")
    ? resolve(dirname(dirname(setting.file)), setting.value)
    : setting.value;
}
