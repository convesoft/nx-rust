import { resolve } from "node:path";
import { testMode, testModeText } from "./test-mode";

/**
 * Prints the test mode of a `test` task in a workspace that uses selection
 * (`DES-TEST-MODE`): `full`, `affected:<commits>` or the line for an invalid
 * `NX_RUST_TEST_MODE` ({@link testModeText}), by the rule that the test
 * executor applies as well ({@link testMode}).
 *
 * The runtime input of such a `test` runs it in the repository root with
 * the task's environment and the workspace root, relative to the repository
 * root, as its argument. It reads cargo-affected's database without writing
 * to it and starts no other program, so that it costs a start of Node and a
 * query.
 */
// @mara implements DES-TEST-MODE
function printTestMode(): void {
  const workspaceRoot = resolve(process.cwd(), process.argv[2] ?? ".");
  process.stdout.write(`${testModeText(testMode(process.env, workspaceRoot))}\n`);
}

printTestMode();
