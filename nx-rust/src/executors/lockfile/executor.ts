import type { ExecutorContext } from "@nx/devkit";
import { lockfileExecutor, targetCargoMetadataKey } from "../../graph/targets";
import type { CargoTargetOptions } from "../command";
import { declaredOptionsOf } from "../declared-options";
import { collectBaseline } from "../coverage-baseline";
import { type PluginExecutor, runTask } from "../task";

// The executor, with the options of its schema, read where graph creation
// reads them (`declaredExecutorOptions`).
const executor: PluginExecutor = {
  name: lockfileExecutor,
  shortName: "lockfile",
  declared: declaredOptionsOf(lockfileExecutor),
  serves: (target) => target === "lockfile" || target === "hakari-check",
};

/**
 * The executor of the lockfile task and of `hakari-check`,
 * `@convesoft/nx-rust:lockfile`, which has no batch implementation, so that
 * neither task ever joins a batch (`DES-LOCKFILE-HASHING`,
 * `DES-UNIFICATION`). The lockfile task runs `cargo update --workspace` in
 * the workspace root, with `--locked` in locked mode, and then writes the
 * members' digests from the `Cargo.lock` that cargo leaves; `hakari-check`
 * runs `cargo hakari generate --diff` and then `cargo hakari manage-deps
 * --dry-run` there, and fails where either fails. It also runs the coverage
 * baseline target (`DES-BASELINE`, `collectBaseline`).
 */
// @mara implements DES-UNIFICATION
// @mara implements DES-TARGETS
// @mara implements DES-LOCKFILE-HASHING
export default function lockfile(
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const metadata = context.target?.metadata?.[targetCargoMetadataKey] as
    | { target?: unknown }
    | undefined;
  return metadata?.target === "coverage-baseline"
    ? collectBaseline(options, context)
    : runTask(executor, options, context);
}
