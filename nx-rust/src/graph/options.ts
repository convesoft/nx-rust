import { inferredTargetNames } from "./targets";

/**
 * The names that the plugin options' `targetNames` gives inferred targets:
 * from the default name of a target to the name to use, such as
 * `{ lint: "clippy" }`. A target without an entry keeps its default name.
 */
export type TargetNames = Readonly<Record<string, string>>;

/**
 * Reads `targetNames` from the options of the plugin's entry in `nx.json`.
 *
 * Each key has to be the default name of an inferred target that this
 * version of the plugin knows ({@link inferredTargetNames}), whether or not
 * a project has that target, and each value a target name. The other
 * plugin options are read with it (`readPluginOptions` in `settings.ts`).
 *
 * @param options The `options` of the entry, as Nx passes them to `createNodes`.
 * @throws {Error} When `targetNames` is no object, has a key that names no
 *   inferred target or a value that is no name, naming the keys.
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
  const known = new Set<string>(inferredTargetNames);
  const unknown = Object.keys(value).filter((target) => !known.has(target));
  if (unknown.length > 0) {
    throw new Error(
      [
        `${where} names ${list(unknown.map((target) => `"${target}"`))}, which ${unknown.length === 1 ? "is not the default name of an inferred target" : "are not default names of inferred targets"}.`,
        `The targets that can be renamed are ${list(inferredTargetNames.map((target) => `"${target}"`))}.`,
      ].join(" "),
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

// `"a"`, `"a" and "b"`, `"a", "b" and "c"`
function list(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
