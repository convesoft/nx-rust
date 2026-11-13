import type { ExecutorContext } from "@nx/devkit";
import { join } from "node:path";
import { runExecutor } from "../../graph/targets";
import type { CargoTargetOptions } from "../command";
import { type PluginExecutor, runTask } from "../task";
import { declaredOptions } from "../task-options";

// The executor, with the options of its schema, which lies beside this file
// in the source tree and in the built package alike.
const executor: PluginExecutor = {
  name: runExecutor,
  shortName: "run",
  declared: declaredOptions(join(__dirname, "schema.json")),
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
