import type { ExecutorContext } from "@nx/devkit";
import { lockfileExecutor } from "../../graph/targets";
import type { CargoTargetOptions } from "../command";
import { declaredOptionsOf } from "../declared-options";
import { type PluginExecutor, runTask } from "../task";

// The executor, with the options of its schema, read where graph creation
// reads them (`declaredExecutorOptions`).
const executor: PluginExecutor = {
  name: lockfileExecutor,
  shortName: "lockfile",
  declared: declaredOptionsOf(lockfileExecutor),
  serves: (target) => target === "lockfile",
};

/**
 * The executor of the lockfile task, `@convesoft/nx-rust:lockfile`, which
 * has no batch implementation, so that the task never joins a batch
 * (`DES-LOCKFILE-HASHING`). It runs `cargo update --workspace` in the
 * workspace root, with `--locked` in locked mode, and then writes the
 * members' digests from the `Cargo.lock` that cargo leaves.
 */
// @mara implements DES-TARGETS
// @mara implements DES-LOCKFILE-HASHING
export default function lockfile(
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  return runTask(executor, options, context);
}
