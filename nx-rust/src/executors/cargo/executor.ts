import type { ExecutorContext } from "@nx/devkit";
import { join } from "node:path";
import { cargoExecutor } from "../../graph/targets";
import type { CargoTargetOptions } from "../command";
import { type PluginExecutor, runTask } from "../task";
import { declaredOptions } from "../task-options";

// The executor, with the options of its schema, which lies beside this file
// in the source tree and in the built package alike.
const executor: PluginExecutor = {
  name: cargoExecutor,
  shortName: "cargo",
  declared: declaredOptions(join(__dirname, "schema.json")),
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
