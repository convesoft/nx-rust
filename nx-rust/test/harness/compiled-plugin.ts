import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pluginPackageDirectory, pluginSourceEntry } from "./fixtures";
import { testRunFolder } from "./test-run";

/**
 * The variable that tells the test processes where the current test run
 * keeps its compiled copy of the plugin ({@link compilePlugin}). It starts
 * with `NX_`, so that `testEnvironment` keeps it from the commands.
 */
const compiledPluginVariable = "NX_RUST_TEST_COMPILED_PLUGIN";

/**
 * Compiles the plugin's TypeScript source into the folder of the current
 * test run ({@link testRunFolder}), laid out as its built package, and
 * records the folder for the test processes, which then load the copy in
 * every fixture ({@link pluginPackage}). The unit tests' global setup calls
 * it, so that every run tests the source as it is, without a separate build;
 * the end of the run removes the copy with the run's folder.
 *
 * Nx would otherwise compile the source with swc in each process that loads
 * the plugin, its executors or its generators: a plugin worker, a task's
 * process, a generator. That took about 110 ms of each graph creation and
 * about 170 ms of each task.
 *
 * `tsc` compiles the copy in a process of its own, which takes about a
 * second and keeps its memory out of Jest's, with the options of
 * `tsconfig.lib.json` but for target ES2021 and source maps inline, as Nx
 * compiles the source, and without the type check, which `nx build` and the
 * editor do. The commands of the fixtures enable source maps, so that a stack
 * trace of the copy names the lines of the source. Beside the compiled files,
 * the copy has what the package has: `package.json`, `executors.json`,
 * `generators.json` and the files of `src` that are not TypeScript, such as
 * the schemas. Its `node_modules` links to this repository's, where the
 * source finds the packages it loads.
 *
 * @throws {Error} When there is no test run, or `tsc` fails, as on a source
 *   that does not parse.
 */
export function compilePlugin(): void {
  const run = testRunFolder();
  if (run === undefined) {
    throw new Error("compilePlugin needs the folder of a test run (startTestRun).");
  }
  const destination = join(run, "plugin");
  mkdirSync(destination, { recursive: true });
  const tsc = spawnSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "--project",
      join(pluginPackageDirectory, "tsconfig.lib.json"),
      "--rootDir",
      pluginPackageDirectory,
      "--outDir",
      destination,
      "--target",
      "es2021",
      "--sourceMap",
      "false",
      "--inlineSourceMap",
      "--declaration",
      "false",
      "--declarationMap",
      "false",
      "--noCheck",
    ],
    { encoding: "utf8" },
  );
  if (tsc.status !== 0) {
    throw new Error(
      `tsc could not compile the plugin (${tsc.error?.message ?? `status ${tsc.status}`}):\n${tsc.stdout}${tsc.stderr}`,
    );
  }
  for (const file of ["package.json", "executors.json", "generators.json"]) {
    cpSync(join(pluginPackageDirectory, file), join(destination, file));
  }
  cpSync(join(pluginPackageDirectory, "src"), join(destination, "src"), {
    recursive: true,
    filter: (path) => !path.endsWith(".ts"),
  });
  symlinkSync(
    join(pluginPackageDirectory, "..", "node_modules"),
    join(destination, "node_modules"),
    "dir",
  );
  process.env[compiledPluginVariable] = destination;
}

/**
 * The folder of the plugin's package that the fixtures load: the copy that
 * {@link compilePlugin} compiled for the current test run, or, without one,
 * the package in this repository, whose source Nx then compiles itself.
 */
export function pluginPackage(): string {
  const compiled = process.env[compiledPluginVariable];
  return compiled && existsSync(compiled) ? compiled : pluginPackageDirectory;
}

/**
 * The plugin's entry point that the fixtures' `nx.json` names: `src/index.js`
 * of the test run's compiled copy, or {@link pluginSourceEntry} without one.
 */
export function pluginEntry(): string {
  const folder = pluginPackage();
  return folder === pluginPackageDirectory ? pluginSourceEntry : join(folder, "src", "index.js");
}

/** Whether the fixtures load the compiled copy of {@link compilePlugin}. */
export function loadsCompiledPlugin(): boolean {
  return pluginPackage() !== pluginPackageDirectory;
}
