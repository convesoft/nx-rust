import { spawnSync } from "node:child_process";
import { buildSettings } from "./build-settings";

/** The first Cargo that honours `build.warnings` (`EVD-CARGO-TARGET-COMMANDS`). */
const honouredFrom = { major: 1, minor: 97 };

/** Where Cargo's `build.warnings` setting denies warnings for a cargo command. */
export interface DeniedWarnings {
  /** What denies them, as a task's message names it. */
  source: string;
}

/**
 * The value of `build.warnings` for a cargo command started in `folder`
 * with the environment `env`, with what sets it, or `undefined` where
 * nothing does.
 *
 * Cargo takes the setting from `CARGO_BUILD_WARNINGS`, or else from the
 * first configuration file that sets it, in the order of
 * {@link buildSettings}: that of `folder` and of each folder above it, then
 * that of the Cargo home, each file's own value before those of the files it
 * includes. A value that is not a string is left out: cargo fails on it, as
 * on a file that cannot be read. The plugin passes cargo no `--config` that
 * sets it, so nothing else does.
 */
// @mara implements DES-BATCH
function configuredWarnings(
  folder: string,
  env: Readonly<Record<string, string | undefined>>,
): { value: string; source: string } | undefined {
  const fromEnvironment = env.CARGO_BUILD_WARNINGS;
  if (fromEnvironment !== undefined) {
    return { value: fromEnvironment, source: `CARGO_BUILD_WARNINGS is ${fromEnvironment}` };
  }
  const setting = buildSettings(folder, env, "warnings").find(
    (entry) => typeof entry.value === "string",
  );
  return setting === undefined
    ? undefined
    : {
        value: setting.value as string,
        source: `${setting.file} sets build.warnings = ${JSON.stringify(setting.value)}`,
      };
}

/**
 * What sets `build.warnings` to `deny` for a cargo command started in
 * `folder` with the environment `env`, as {@link deniedWarnings} names it,
 * without asking for cargo's version: for a command whose own output says
 * that warnings are denied (`DES-TEST-RUN`, "Denied warnings in a test
 * step"). `undefined` where nothing that the plugin reads sets it to `deny`.
 */
// @mara implements DES-TEST-RUN
export function denyingSetting(folder: string, env: NodeJS.ProcessEnv): string | undefined {
  const setting = configuredWarnings(folder, env);
  return setting?.value === "deny" ? setting.source : undefined;
}

/**
 * Whether Cargo denies warnings for a cargo command started in `folder`
 * with the environment `env` (`DES-BATCH`, "Denied warnings"): where
 * {@link configuredWarnings} gives `deny` and the cargo of that folder and
 * environment honours the setting, which Cargo does from 1.97 on, as
 * `cargo --version` tells. A version that cannot be read counts as one that
 * honours it, so that unknown counts as failed.
 *
 * @returns What denies them, or `undefined` where they are not denied.
 */
// @mara implements DES-BATCH
export function deniedWarnings(folder: string, env: NodeJS.ProcessEnv): DeniedWarnings | undefined {
  const setting = configuredWarnings(folder, env);
  if (setting?.value !== "deny") {
    return undefined;
  }
  const run = spawnSync("cargo", ["--version"], {
    cwd: folder,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const version = run.status === 0 ? /^cargo (\d+)\.(\d+)/.exec(run.stdout ?? "") : null;
  if (version !== null) {
    const [major, minor] = [Number(version[1]), Number(version[2])];
    if (
      major < honouredFrom.major ||
      (major === honouredFrom.major && minor < honouredFrom.minor)
    ) {
      return undefined;
    }
  }
  return { source: setting.source };
}
