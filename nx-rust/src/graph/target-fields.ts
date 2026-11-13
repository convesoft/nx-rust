/**
 * What is wrong with the structure of one `targets.<name>` table of a
 * metadata table, which `DES-PLUGIN-OPTIONS` and `DES-METADATA-TABLES` shape
 * like an Nx target: each field that an Nx 24 target has is checked against
 * the type that Nx's project schema (`nx/schemas/project-schema.json`) gives
 * it, before the table is merged. A field that an Nx target does not have is
 * left as it is, because the items reject unknown keys only at the top level
 * of a table. Whether an option is known to the target's executor is another
 * check (`REQ-UNKNOWN-METADATA-OPTIONS`).
 *
 * @param target The table as `cargo metadata` reports it.
 * @param where The start of each message: the manifest, the field and the
 *   table, such as `rust/Cargo.toml: "options" in [workspace.metadata.nx.targets.test]`.
 * @returns One message per field of the wrong shape.
 */
// @mara implements DES-PLUGIN-OPTIONS
export function targetFieldProblems(
  target: Record<string, unknown>,
  where: (field: string) => string,
): string[] {
  const problems: string[] = [];
  for (const [field, value] of Object.entries(target)) {
    const expected = fields[field]?.(value);
    if (expected !== undefined && expected !== true) {
      problems.push(`${where(field)} has to be ${expected}, not ${JSON.stringify(value)}.`);
    }
  }
  return problems;
}

/** A check of one value: `true` where it has the shape, or else what it has to be. */
type Check = (value: unknown) => true | string;

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

const string: Check = (value) => isString(value) || "a string";
const boolean: Check = (value) => typeof value === "boolean" || "true or false";
const table: Check = (value) => isTable(value) || "a table";
const strings: Check = (value) => isStrings(value) || "a list of strings";
const oneOf =
  (...values: string[]): Check =>
  (value) =>
    values.includes(value as string) || values.map((text) => JSON.stringify(text)).join(" or ");
const stringOrStrings: Check = (value) =>
  isString(value) || isStrings(value) || "a string or a list of strings";
const positiveInteger: Check = (value) =>
  (Number.isInteger(value) && (value as number) >= 1) || "a whole number of at least 1";

/**
 * Whether `value` is a table that has exactly one of `kinds`' defining keys,
 * and only the keys that its kind allows, each of its type.
 */
function tableOfKind(
  value: unknown,
  kinds: readonly { key: string; keys: Record<string, Check> }[],
): boolean {
  if (!isTable(value)) {
    return false;
  }
  const matching = kinds.filter((kind) => kind.key in value);
  if (matching.length !== 1) {
    return false;
  }
  const { keys } = matching[0];
  return Object.entries(value).every(([key, item]) => keys[key]?.(item) === true);
}

// The kinds of input table of Nx's schema, each by its defining key.
const inputKinds = [
  {
    key: "fileset",
    keys: { fileset: string, dependencies: boolean, includeIgnored: boolean, always: boolean },
  },
  { key: "runtime", keys: { runtime: string } },
  { key: "env", keys: { env: string } },
  { key: "externalDependencies", keys: { externalDependencies: strings } },
  {
    key: "dependentTasksOutputFiles",
    keys: { dependentTasksOutputFiles: string, transitive: boolean },
  },
  { key: "json", keys: { json: string, fields: strings, excludeFields: strings, always: boolean } },
  {
    key: "input",
    keys: { input: string, projects: stringOrStrings, dependencies: boolean, always: boolean },
  },
];

const input = (value: unknown): boolean =>
  isString(value) ||
  (tableOfKind(value, inputKinds) &&
    !("projects" in (value as object) && "dependencies" in (value as object)));

const dependency = (value: unknown): boolean =>
  isString(value) ||
  (tableOfKind(value, [
    {
      key: "target",
      keys: {
        target: string,
        projects: stringOrStrings,
        dependencies: boolean,
        params: oneOf("ignore", "forward"),
        options: oneOf("ignore", "forward"),
        inputs: boolean,
        waitFor: oneOf("started", "ready"),
      },
    },
  ]) &&
    !("projects" in (value as object) && "dependencies" in (value as object)));

const readyWhenOptions = { timeout: positiveInteger, interval: positiveInteger };

const readyWhen: Check = (value) =>
  (isTable(value) && value["..."] === true && Object.keys(value).length === 1) ||
  tableOfKind(value, [
    { key: "url", keys: { url: string, ...readyWhenOptions } },
    {
      key: "port",
      keys: {
        port: (port) =>
          isString(port) ||
          (Number.isInteger(port) && (port as number) >= 0 && (port as number) <= 65535) ||
          "a port",
        host: string,
        ...readyWhenOptions,
      },
    },
    { key: "command", keys: { command: string, ...readyWhenOptions } },
    { key: "logMatches", keys: { logMatches: stringOrStrings, ...readyWhenOptions } },
    {
      key: "signal",
      keys: { signal: (signal) => signal === true || "true", timeout: positiveInteger },
    },
  ]) ||
  'a table with one of the keys "url", "port", "command", "logMatches" and "signal", such as { port = 8080 }';

// Each field of an Nx 24 target, with what it has to be.
const fields: Record<string, Check> = {
  executor: string,
  command: string,
  defaultConfiguration: string,
  cache: boolean,
  continuous: boolean,
  parallelism: boolean,
  options: table,
  metadata: table,
  ultracache: table,
  configurations: (value) =>
    (isTable(value) && Object.values(value).every(isTable)) ||
    "a table of configurations, each a table of options",
  outputs: strings,
  syncGenerators: strings,
  inputs: (value) =>
    (Array.isArray(value) && value.every(input)) ||
    'a list of inputs, each a string or one of the input tables of Nx, such as { env = "NAME" }',
  dependsOn: (value) =>
    (Array.isArray(value) && value.every(dependency)) ||
    'a list of dependencies, each a target name or a table with "target", such as { target = "build", projects = ["web"] }',
  readyWhen,
  "...": (value) => value === true || "true",
};
