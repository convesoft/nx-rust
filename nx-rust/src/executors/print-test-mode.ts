import { printedTestMode } from "./test-mode";

/**
 * Prints the test mode of a `test` task in a workspace that uses selection
 * (`DES-TEST-MODE`): `full`, `affected:<commits>` or the line for an invalid
 * `NX_RUST_TEST_MODE`, by the rule that the test executor applies as well,
 * or a value that is never restored where a subset of the same `nx` command
 * ran in another mode or the record cannot be written
 * ({@link printedTestMode}).
 *
 * The runtime input of such a `test` runs it in the repository root with
 * the task's environment and the workspace root, relative to the repository
 * root, as its argument. It reads cargo-affected's database without writing
 * to it and starts no other program, so that it costs a start of Node and a
 * query; in a run, it adds the line it prints to the command's record in
 * the plugin's folder under `.nx/workspace-data`.
 */
// @mara implements DES-TEST-MODE
function printTestMode(): void {
  process.stdout.write(`${printedTestMode(process.env, process.cwd(), process.argv[2] ?? ".")}\n`);
}

printTestMode();
