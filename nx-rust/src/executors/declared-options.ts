import { readFileSync } from "node:fs";
import { join } from "node:path";

// The package root, where `package.json` and `executors.json` lie, in the
// source tree and in the built package alike.
const packageRoot = join(__dirname, "..", "..");

let declared: ReadonlyMap<string, ReadonlySet<string>> | undefined;

/**
 * The options that the schema of each of the plugin's executors declares, by
 * the executor's full name, such as `@convesoft/nx-rust:cargo`: the keys of
 * the `properties` of the schema file that `executors.json` names for it,
 * which is the file Nx checks a task's options against
 * (`DES-UNKNOWN-OPTIONS`). Reading the schema itself, rather than a list of
 * its own, keeps a check of options from disagreeing with the executor.
 *
 * @throws {Error} When `executors.json` or a schema cannot be read, or a
 *   schema declares no properties.
 */
// @mara implements DES-UNKNOWN-OPTIONS
export function declaredExecutorOptions(): ReadonlyMap<string, ReadonlySet<string>> {
  declared ??= readDeclaredOptions();
  return declared;
}

function readDeclaredOptions(): ReadonlyMap<string, ReadonlySet<string>> {
  const { name } = readJson(join(packageRoot, "package.json")) as { name: string };
  const { executors } = readJson(join(packageRoot, "executors.json")) as {
    executors: Record<string, { schema: string }>;
  };
  return new Map(
    Object.entries(executors).map(([executor, { schema }]) => {
      const file = join(packageRoot, schema);
      const properties = (readJson(file) as { properties?: unknown } | null)?.properties;
      if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
        throw new Error(`The executor schema ${file} declares no properties.`);
      }
      return [`${name}:${executor}`, new Set(Object.keys(properties))];
    }),
  );
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}
