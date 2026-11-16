import { resolve } from "node:path";
import { installedNapiCli } from "./napi-cli";

/**
 * Prints the napi CLI that `napi-build` of a crate post-processes with, as
 * the executor finds it: the package `@napi-rs/cli` that Node resolves from
 * the crate's folder, by its name and version, or a line that says that
 * none is installed. It prints no path of the checkout, so that checkouts in
 * other folders share the keys.
 *
 * The runtime input of `napi-build` runs it in the repository root with the
 * crate's folder, relative to the repository root, as its argument, so that
 * the target's key holds the CLI's version (`REQ-ARTIFACT-CACHE`,
 * `DES-NAPI`).
 */
// @mara implements DES-NAPI
function printNapiCli(): void {
  const cli = installedNapiCli(resolve(process.cwd(), process.argv[2] ?? "."));
  process.stdout.write(
    cli === undefined ? "@napi-rs/cli not installed\n" : `@napi-rs/cli ${cli.version}\n`,
  );
}

printNapiCli();
