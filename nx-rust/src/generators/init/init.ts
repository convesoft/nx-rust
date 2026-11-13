import {
  formatFiles,
  logger,
  readNxJson,
  Tree,
  updateJson,
  writeJson,
  type NxJsonConfiguration,
} from "@nx/devkit";
import { targetDefaultsGuide } from "../../graph/target-defaults";
import { cargoExecutor, runExecutor } from "../../graph/targets";
import {
  checkGraphCreation,
  GraphCheckError,
  isPluginEntry,
  pluginName,
  UnsupportedNxError,
} from "./graph-check";
import { initReport } from "./report";

/** The options of `init`, which has none of its own. */
export type InitGeneratorSchema = Record<string, never>;

/**
 * The executors of the plugin's targets, each of which gets an empty
 * `targetDefaults` entry where `nx.json` has none for it.
 */
export const shieldedExecutors = [cargoExecutor, runExecutor];

/**
 * The generator that `nx add @convesoft/nx-rust` runs once Nx has installed
 * the package. It checks the repository the way graph creation will once
 * the plugin is registered, registers the plugin in `nx.json`, adds an empty
 * `targetDefaults` entry for each of {@link shieldedExecutors} that is
 * missing, and reports. These are its only changes; an entry that is there
 * already, a plugin entry with its options included, stays as it is.
 *
 * @throws {Error} When graph creation would fail with the plugin, before
 *   anything is written.
 */
// @mara implements DES-GENERATORS
export async function initGenerator(tree: Tree, _options: InitGeneratorSchema): Promise<void> {
  const nxJson: NxJsonConfiguration = readNxJson(tree) ?? {};
  const registered = (nxJson.plugins ?? []).some(isPluginEntry);
  const plugins = registered ? nxJson.plugins : [...(nxJson.plugins ?? []), pluginName];
  const missing = shieldedExecutors.filter(
    (executor) => !Object.prototype.hasOwnProperty.call(nxJson.targetDefaults ?? {}, executor),
  );
  const targetDefaults =
    missing.length === 0
      ? nxJson.targetDefaults
      : {
          ...nxJson.targetDefaults,
          ...Object.fromEntries(missing.map((executor) => [executor, {}])),
        };

  // 1. Check, on nx.json as it will be.
  let check;
  try {
    check = await checkGraphCreation({ ...nxJson, plugins, targetDefaults }, tree.root);
  } catch (error) {
    if (error instanceof GraphCheckError || error instanceof UnsupportedNxError) {
      const graph = error instanceof GraphCheckError;
      throw new Error(
        [
          registered
            ? graph
              ? "Nx cannot create the project graph with nx-rust as nx.json registers it."
              : "nx-rust cannot check the project graph that nx.json registers it for."
            : graph
              ? "nx-rust was not added to nx.json: Nx could not create the project graph with it."
              : "nx-rust was not added to nx.json: it could not check the project graph.",
          "",
          error.message,
          "",
          `nx.json is unchanged. Fix the problem above and run \`nx add ${pluginName}\` again.`,
        ].join("\n"),
      );
    }
    throw error;
  }

  // 2. Register.
  const changes: NxJsonConfiguration = {
    ...(registered ? {} : { plugins }),
    ...(missing.length === 0 ? {} : { targetDefaults }),
  };
  if (Object.keys(changes).length > 0) {
    write(tree, changes);
    await formatFiles(tree);
  }

  // 3. Report.
  if (missing.length > 0) {
    logger.info(addedEntriesMessage(missing));
  }
  const report = initReport(check, tree.root, process.env);
  for (const warning of report.warnings) {
    logger.warn(warning);
  }
  for (const info of report.info) {
    logger.info(info);
  }
}

/** What `init` says about the `targetDefaults` entries it added. */
export function addedEntriesMessage(executors: string[]): string {
  const names = executors.map((executor) => `"${executor}": {}`).join(" and ");
  return [
    `Added ${names} to targetDefaults in nx.json, keyed by the executors of the targets that nx-rust infers.`,
    `Nx chooses an entry keyed by a target's executor before one keyed by the target's name or a glob, so entries such as "build" or "test" apply to your other projects and not to Rust targets, whose inputs, outputs, caching and dependencies nx-rust declares itself (${targetDefaultsGuide}).`,
  ].join("\n");
}

// Writes `changes` into nx.json, leaving its other keys as they are. Where
// nx.json extends another file and only that file has a key, the combined
// value goes into nx.json, which is what Nx reads then.
function write(tree: Tree, changes: NxJsonConfiguration): void {
  if (!tree.exists("nx.json")) {
    writeJson(tree, "nx.json", changes);
    return;
  }
  updateJson<NxJsonConfiguration>(tree, "nx.json", (json) => ({ ...json, ...changes }));
}

export default initGenerator;
