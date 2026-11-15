import type { ExecutorContext, TaskGraph } from "@nx/devkit";
import {
  cargoExecutor,
  cargoOutputsExecutor,
  type InferredTargetName,
  outputsTargets,
} from "../../graph/targets";
import { type BatchReport, runBatch } from "../batch";
import type { CargoTargetOptions } from "../command";
import { declaredOptionsOf } from "../declared-options";
import { type PluginExecutor, runTask } from "../task";

// The two executors, with the options of their schema, read where graph
// creation reads them (`declaredExecutorOptions`).
const cargo: PluginExecutor = {
  name: cargoExecutor,
  shortName: "cargo",
  declared: declaredOptionsOf(cargoExecutor),
  serves: (target: InferredTargetName) =>
    !outputsTargets.has(target) && target !== "run" && target !== "lockfile",
};
const cargoOutputs: PluginExecutor = {
  name: cargoOutputsExecutor,
  shortName: "cargo-outputs",
  declared: declaredOptionsOf(cargoOutputsExecutor),
  serves: (target: InferredTargetName) => outputsTargets.has(target),
};

/**
 * The executor of every inferred target but `build` and `doc`, `run` and
 * `lockfile`, `@convesoft/nx-rust:cargo`, for a task that Nx runs on its own:
 * the task runs its own cargo command (`DES-TARGET-COMMANDS`,
 * `DES-WORKSPACE-TARGETS`).
 */
// @mara implements DES-TARGETS
export default function cargoTask(
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  return runTask(cargo, options, context);
}

/**
 * The batch implementation of `@convesoft/nx-rust:cargo`, for the tasks that
 * Nx runs together (`DES-BATCH`).
 */
// @mara implements DES-BATCH
export function batch(
  taskGraph: TaskGraph,
  inputs: Record<string, CargoTargetOptions>,
  _overrides: unknown,
  context: ExecutorContext,
): AsyncGenerator<BatchReport> {
  return runBatch(cargo, taskGraph, inputs, context);
}

/**
 * The executor of `build` and `doc`, the targets whose files Nx stores,
 * `@convesoft/nx-rust:cargo-outputs`: the same implementation under a name of
 * its own, so that Nx batches and stores these tasks apart from those that
 * wait for them (`DES-BATCH`, "Two batch executors"; `ADR-TEST-AFTER-BUILD`).
 */
// @mara implements DES-TARGETS
export function outputsTask(
  options: CargoTargetOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  return runTask(cargoOutputs, options, context);
}

/** The batch implementation of `@convesoft/nx-rust:cargo-outputs` (`DES-BATCH`). */
// @mara implements DES-BATCH
export function outputsBatch(
  taskGraph: TaskGraph,
  inputs: Record<string, CargoTargetOptions>,
  _overrides: unknown,
  context: ExecutorContext,
): AsyncGenerator<BatchReport> {
  return runBatch(cargoOutputs, taskGraph, inputs, context);
}
