import type { ExecutorContext } from "@nx/devkit";
import { cargoExecutor } from "../../graph/targets";
import type { CargoTargetOptions } from "../command";
import { runTask } from "../task";

/**
 * The executor of every inferred target but `run`, `@convesoft/nx-rust:cargo`:
 * each task runs its own cargo command (`DES-TARGET-COMMANDS`,
 * `DES-WORKSPACE-TARGETS`). It has no batch implementation yet; the batch
 * of `DES-BATCH` comes with milestone 0.2.
 */
// @mara implements DES-TARGETS
export default function cargo(
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  return runTask({ name: cargoExecutor, serves: (target) => target !== "run" }, options, context);
}
