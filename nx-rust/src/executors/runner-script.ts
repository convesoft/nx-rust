import { join } from "node:path";

/**
 * The absolute path of the selecting runner's script in the plugin's
 * package, `test-runner.js` beside this module (`DES-TEST-RUN`, "The runner
 * program").
 */
export function runnerScript(): string {
  return join(__dirname, "test-runner.js");
}

/**
 * The selecting runner's command, `["<node>", "<script>"]`: the Node that
 * runs the batch implementation, or the task, and the script, by absolute
 * paths (`DES-TEST-RUN`, "The runner program").
 */
export function runnerCommand(): string[] {
  return [process.execPath, runnerScript()];
}
