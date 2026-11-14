import { resolve } from "node:path";
import { repositoryFolder } from "../graph/real-path";
import { reportedDirectories } from "./directories";
import { pickedTriples, pickText } from "./target-triples";

/**
 * Prints what decides the folders that cargo writes the artifacts of `build`
 * and `doc` to in a workspace root without `--target`, as graph creation
 * reads it for the outputs (`DES-OUTPUTS`), in two lines of text without a
 * path of the checkout:
 *
 * 1. The triples that cargo builds for, from Cargo's configuration and
 *    `CARGO_BUILD_TARGET` in the environment ({@link pickedTriples}), in the
 *    text of {@link pickText}.
 * 2. `artifacts <path>`, the artifact directory that cargo reports, as the
 *    outputs name it: the folder that the system reaches, relative to the
 *    repository's real path ({@link repositoryFolder}); or
 *    `artifacts outside the repository`, where the outputs name nothing.
 *
 * The runtime input of a cached `build` and `doc` runs it in the repository
 * root with the task's environment and the workspace root, relative to the
 * repository root, as its argument, so that their key follows the triples
 * and the artifact directory that the task's cargo will use, also where the
 * graph that the Nx daemon keeps is out of date or a dotenv file of the task
 * moves the directory (`DES-INPUTS`). The directory comes from cargo's
 * `cargo metadata --no-deps` report, with `RUSTUP_AUTO_INSTALL=0`, as graph
 * creation asks for it. Where cargo fails, the script prints nothing and
 * fails, and the command prints a random value instead.
 */
// @mara implements DES-INPUTS
function printArtifactFolders(): void {
  const repositoryRoot = process.cwd();
  const workspaceRoot = resolve(repositoryRoot, process.argv[2] ?? ".");
  let artifacts: { inside: boolean; path: string };
  try {
    const directories = reportedDirectories(workspaceRoot, {
      ...process.env,
      RUSTUP_AUTO_INSTALL: "0",
    });
    artifacts = repositoryFolder(directories.artifact, repositoryRoot);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const triples = pickText(pickedTriples(workspaceRoot, process.env));
  const directory = artifacts.inside
    ? `artifacts ${artifacts.path}`
    : "artifacts outside the repository";
  process.stdout.write(`${triples}\n${directory}\n`);
}

printArtifactFolders();
