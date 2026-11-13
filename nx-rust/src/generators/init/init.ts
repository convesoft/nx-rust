import {
  formatFiles,
  logger,
  readNxJson,
  Tree,
  updateJson,
  writeJson,
  type NxJsonConfiguration,
} from "@nx/devkit";
import { checkGraphCreation, GraphCheckError, isPluginEntry, pluginName } from "./graph-check";
import { initReport } from "./report";

/** The options of `init`, which has none of its own. */
export type InitGeneratorSchema = Record<string, never>;

/**
 * The generator that `nx add @convesoft/nx-rust` runs once Nx has installed
 * the package. It checks the repository the way graph creation will once
 * the plugin is registered, registers the plugin in `nx.json` and reports.
 * Its only change is the plugin entry in `nx.json`; an entry that is there
 * already, with its options, stays as it is.
 *
 * @throws {Error} When graph creation would fail with the plugin, before
 *   anything is written.
 */
// @mara implements DES-GENERATORS
export async function initGenerator(tree: Tree, _options: InitGeneratorSchema): Promise<void> {
  const nxJson: NxJsonConfiguration = readNxJson(tree) ?? {};
  const registered = (nxJson.plugins ?? []).some(isPluginEntry);
  const plugins = registered ? nxJson.plugins : [...(nxJson.plugins ?? []), pluginName];

  // 1. Check.
  let check;
  try {
    check = await checkGraphCreation({ ...nxJson, plugins }, tree.root);
  } catch (error) {
    if (error instanceof GraphCheckError) {
      throw new Error(
        [
          registered
            ? "Nx cannot create the project graph with nx-rust as nx.json registers it."
            : "nx-rust was not added to nx.json: Nx could not create the project graph with it.",
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
  if (!registered) {
    register(tree, plugins);
    await formatFiles(tree);
  }

  // 3. Report.
  const report = initReport(check, tree.root, process.env);
  for (const warning of report.warnings) {
    logger.warn(warning);
  }
  for (const info of report.info) {
    logger.info(info);
  }
}

// Writes `plugins` into nx.json, leaving its other keys as they are. Where
// nx.json extends another file and only that file has `plugins`, the
// combined list goes into nx.json, which is what Nx reads then.
function register(tree: Tree, plugins: NxJsonConfiguration["plugins"]): void {
  if (!tree.exists("nx.json")) {
    writeJson(tree, "nx.json", { plugins });
    return;
  }
  updateJson<NxJsonConfiguration>(tree, "nx.json", (json) => ({ ...json, plugins }));
}

export default initGenerator;
