import type { ExecutorContext } from "@nx/devkit";
import { runExecutor } from "../../graph/targets";
import type { CargoTargetOptions } from "../command";
import { type PluginExecutor, runTask } from "../task";
import { declaredOptionsOf } from "../declared-options";

// The executor, with the options of its schema, read where graph creation
// reads them (`declaredExecutorOptions`).
const executor: PluginExecutor = {
  name: runExecutor,
  shortName: "run",
  declared: declaredOptionsOf(runExecutor),
  serves: (target) => target === "run",
};

/**
 * The executor of `run`, `@convesoft/nx-rust:run`, which has no batch
 * implementation: `cargo run` accepts one package only, and Nx would hand
 * every task of an executor with one to a single batch (`DES-TARGET-COMMANDS`).
 * The binary gets the words of the `args` option and the arguments after
 * `--` on the command line (`DES-UNKNOWN-OPTIONS`).
 */
// @mara implements DES-TARGETS
// @mara implements DES-TARGET-COMMANDS
export default function run(
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  return runTask(executor, options, context);
}
