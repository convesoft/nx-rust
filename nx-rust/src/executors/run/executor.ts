import type { ExecutorContext } from "@nx/devkit";
import { runExecutor } from "../../graph/targets";
import type { CargoTargetOptions } from "../command";
import { runTask } from "../task";

/**
 * The executor of `run`, `@convesoft/nx-rust:run`, which has no batch
 * implementation: `cargo run` accepts one package only, and Nx would hand
 * every task of an executor with one to a single batch (`DES-TARGET-COMMANDS`).
 */
// @mara implements DES-TARGETS
// @mara implements DES-TARGET-COMMANDS
export default function run(
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  return runTask({ name: runExecutor, serves: (target) => target === "run" }, options, context);
}
