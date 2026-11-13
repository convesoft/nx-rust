/**
 * The names that the plugin options' `targetNames` gives inferred targets:
 * from the default name of a target to the name to use, such as
 * `{ lint: "clippy" }`. A target without an entry keeps its default name.
 */
export type TargetNames = Readonly<Record<string, string>>;

/**
 * Reads `targetNames` from the options of the plugin's entry in `nx.json`.
 *
 * The other settings of the option reference are read where they take
 * effect (nxr-xyq7c8); unknown keys are not checked here.
 *
 * @param options The `options` of the entry, as Nx passes them to `createNodes`.
 * @throws {Error} When `targetNames` is no object of names, naming the key.
 */
// @mara implements DES-PLUGIN-OPTIONS
export function readTargetNames(options: unknown): TargetNames {
  const value = isObject(options) ? options.targetNames : undefined;
  if (value === undefined) {
    return {};
  }
  const where = `"targetNames" in the options of the @convesoft/nx-rust entry in nx.json`;
  if (!isObject(value)) {
    throw new Error(
      `${where} has to be an object that maps the default name of an inferred target to the name to use, such as { "lint": "clippy" }.`,
    );
  }
  for (const [target, name] of Object.entries(value)) {
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error(
        `${where} gives the target "${target}" ${JSON.stringify(name)}, but a target name has to be a string that is not empty.`,
      );
    }
  }
  return value as TargetNames;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
