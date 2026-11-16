import { spawnSync } from "node:child_process";

/**
 * The host's triple, as `rustc -vV` names it after `host:` in `cwd`, the
 * folder where a task's cargo starts, with the task's environment, so that
 * the toolchain that the folder selects answers; `undefined` where rustc
 * fails or names none. rustup installs no toolchain for it.
 */
export function hostTriple(cwd: string, env: NodeJS.ProcessEnv): string | undefined {
  const run = spawnSync("rustc", ["-vV"], {
    cwd,
    env: { ...env, RUSTUP_AUTO_INSTALL: "0" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return run.status === 0 ? /^host: (\S+)$/m.exec(run.stdout ?? "")?.[1] : undefined;
}
