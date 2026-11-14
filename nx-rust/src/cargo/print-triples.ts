import { pickedTriples, pickText } from "./target-triples";

/**
 * Prints the triples that cargo builds for in the current folder without
 * `--target`, from Cargo's configuration and `CARGO_BUILD_TARGET` in the
 * environment, as graph creation reads them ({@link pickedTriples}), in the
 * text of {@link pickText}. The runtime input of `build` and `doc` runs it
 * in the workspace root with the task's environment, so that their key
 * follows the triples that the task's cargo will use, also where the graph
 * that the Nx daemon keeps is out of date (`DES-INPUTS`, `DES-OUTPUTS`).
 */
// @mara implements DES-INPUTS
function printTriples(): void {
  process.stdout.write(`${pickText(pickedTriples(process.cwd(), process.env))}\n`);
}

printTriples();
