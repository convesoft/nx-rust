import type { ExecutorContext } from "@nx/devkit";
import { cargoExecutor } from "../../graph/targets";
import type { CargoTargetOptions } from "../command";
import { type PluginExecutor, runTask } from "../task";
import { declaredOptionsOf } from "../declared-options";

// The executor, with the options of its schema, read where graph creation
// reads them (`declaredExecutorOptions`).
const executor: PluginExecutor = {
  name: cargoExecutor,
  shortName: "cargo",
  declared: declaredOptionsOf(cargoExecutor),
  serves: (target) => target !== "run",
};

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
  return runTask(executor, options, context);
}
