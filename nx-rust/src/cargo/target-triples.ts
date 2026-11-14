import { isAbsolute, relative } from "node:path";
import { buildSettings } from "./build-settings";

/**
 * The target triples that cargo builds for when a command started in a
 * workspace root names none with `--target` (`DES-OUTPUTS`, "Paths"), from
 * `build.target` in Cargo's configuration and `CARGO_BUILD_TARGET`.
 */
export type PickedTriples =
  /** Neither picks one: cargo builds for the host, without a triple folder. */
  | { kind: "none" }
  /**
   * The triples whose folders cargo writes to, each once. An empty list
   * comes from `build.target = []`, for which cargo builds nothing.
   */
  | ({ kind: "triples"; triples: string[] } & TripleSources)
  /** A value whose folder the plugin cannot name, with the reason. */
  | ({ kind: "unnamed"; value: string; reason: string } & TripleSources);

/** Where picked triples come from. */
export interface TripleSources {
  /** The absolute paths of the configuration files whose `build.target` counts. */
  files: string[];
  /** Whether `CARGO_BUILD_TARGET` counts. */
  fromEnv: boolean;
}

// One `build.target` in a configuration file that cargo reads.
interface TripleSetting {
  file: string;
  /** A triple, a list of triples, or `undefined` for any other value, which cargo rejects. */
  value: string | string[] | undefined;
  /** Whether cargo reads the file only because another one includes it. */
  included: boolean;
}

// What `build.target` comes to once cargo has merged its files.
type Configured =
  | { kind: "none" }
  | { kind: "one"; value: string; file: string }
  | { kind: "list"; values: string[]; files: string[] }
  | { kind: "invalid"; files: string[]; reason: string };

/**
 * The triples that cargo builds for in `workspaceRoot` without `--target`,
 * as `build.target` in the configuration files that cargo reads there and
 * `CARGO_BUILD_TARGET` in `env` pick them (`DES-OUTPUTS`, `EVD-CARGO-TRIPLE-FOLDERS`):
 *
 * - The files are those of `workspaceRoot`, of each folder above it and of
 *   the Cargo home, with the files they include. A string in a deeper
 *   folder wins over one above it, a file's own value over the files it
 *   includes, and a later include over an earlier one. Lists from several
 *   files are joined. A string beside a list is no configuration that
 *   cargo loads.
 * - `CARGO_BUILD_TARGET`, also when empty, replaces a string or the absence
 *   of a value with one triple, its whole value. Where the configuration
 *   holds a list, the variable's words join the list instead.
 * - Cargo 1.91 ignores `include`, later versions apply it. Where the two
 *   readings pick different triples, the triples cannot be named.
 * - `host-tuple`, a target specification file, an empty triple and a name
 *   that an Nx output cannot hold cannot be named either.
 *
 * Files that do not exist or cannot be parsed are skipped: graph creation
 * reports the latter, and cargo fails on them.
 */
// @mara implements DES-OUTPUTS
export function pickedTriples(workspaceRoot: string, env: NodeJS.ProcessEnv): PickedTriples {
  const settings: TripleSetting[] = buildSettings(workspaceRoot, env, "target").map(
    ({ file, value, included }) => ({ file, value: tripleValue(value), included }),
  );
  const variable = env.CARGO_BUILD_TARGET;
  const applied = pick(merge(settings, true), variable);
  const ignored = pick(merge(settings, false), variable);
  if (samePick(applied, ignored)) {
    return applied;
  }
  const files = [...new Set(settings.map((setting) => setting.file))];
  return {
    kind: "unnamed",
    value: describeValue(applied),
    reason:
      "a file that include adds sets build.target, which cargo 1.91 ignores and later versions apply, so the triple depends on the Cargo version",
    files,
    fromEnv: applied.kind !== "none" && applied.fromEnv,
  };
}

/**
 * The triples that Cargo's configuration alone picks in `workspaceRoot`,
 * without `CARGO_BUILD_TARGET` ({@link pickedTriples}): what tells a
 * configuration that changed after graph creation from a variable that only
 * the task's environment sets.
 */
export function configuredTriples(workspaceRoot: string, env: NodeJS.ProcessEnv): PickedTriples {
  const rest = { ...env };
  delete rest.CARGO_BUILD_TARGET;
  return pickedTriples(workspaceRoot, rest);
}

/**
 * A pick as text that names its folders and nothing else, so that two
 * checkouts in different folders give the same text: `none`, `triples` with
 * the sorted triples, or `unnamed` with the value and the reason. The
 * runtime input of `build` and `doc` prints it (`DES-INPUTS`), and target
 * metadata records the configuration's pick in it.
 */
export function pickText(picked: PickedTriples): string {
  switch (picked.kind) {
    case "none":
      return "none";
    case "triples":
      return ["triples", ...[...new Set(picked.triples)].sort()].join(" ");
    case "unnamed":
      return `unnamed ${JSON.stringify(picked.value)}: ${picked.reason}`;
  }
}

/** Whether two picks name the same folders. */
export function samePick(a: PickedTriples, b: PickedTriples): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "triples" && b.kind === "triples") {
    const left = new Set(a.triples);
    const right = new Set(b.triples);
    return left.size === right.size && [...left].every((triple) => right.has(triple));
  }
  if (a.kind === "unnamed" && b.kind === "unnamed") {
    return a.value === b.value;
  }
  return true;
}

/**
 * What picks triples, for messages: `build.target in <files>`,
 * `CARGO_BUILD_TARGET`, or both, with each file relative to `repositoryRoot`
 * where it lies inside it.
 */
export function tripleSource(sources: TripleSources, repositoryRoot: string): string {
  const files = sources.files.map((file) => {
    const shown = relative(repositoryRoot, file);
    return shown === "" || shown.startsWith("..") || isAbsolute(shown) ? file : shown;
  });
  return [
    ...(files.length > 0 ? [`build.target in ${files.join(" and ")}`] : []),
    ...(sources.fromEnv ? ["CARGO_BUILD_TARGET"] : []),
  ].join(" and ");
}

/** What picks a triple whose folder the plugin cannot name, and why, for messages. */
export function unnamedTripleProblem(
  picked: Extract<PickedTriples, { kind: "unnamed" }>,
  repositoryRoot: string,
): string {
  return `${tripleSource(picked, repositoryRoot)} picks the target triple ${JSON.stringify(picked.value)}, whose folder @convesoft/nx-rust cannot name: ${picked.reason}`;
}

/** Picked triples, for messages: "the triple a", "the triples a and b", "no triple". */
export function describeTriples(picked: PickedTriples): string {
  switch (picked.kind) {
    case "none":
      return "no triple";
    case "triples":
      return picked.triples.length === 0
        ? "no triple, from an empty list"
        : `the ${picked.triples.length === 1 ? "triple" : "triples"} ${listed(picked.triples)}`;
    case "unnamed":
      return `the triple ${JSON.stringify(picked.value)}`;
  }
}

/** The folders that outputs name for picked triples, for messages. */
export function describeFolders(picked: PickedTriples): string {
  switch (picked.kind) {
    case "none":
      return "the artifact directory itself, for no triple";
    case "triples":
      return picked.triples.length === 0
        ? "no folder, for an empty list of triples"
        : `the ${picked.triples.length === 1 ? "folder of the triple" : "folders of the triples"} ${listed(picked.triples)}`;
    case "unnamed":
      return "no folder";
  }
}

function listed(words: readonly string[]): string {
  return words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function tripleValue(value: unknown): string | string[] | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value as string[];
  }
  return undefined;
}

// Merges the settings, given in descending precedence, as cargo does, with
// or without the files that only `include` adds.
function merge(all: readonly TripleSetting[], applyIncludes: boolean): Configured {
  const settings = all.filter((setting) => applyIncludes || !setting.included);
  if (settings.length === 0) {
    return { kind: "none" };
  }
  const files = settings.map((setting) => setting.file);
  if (settings.some((setting) => setting.value === undefined)) {
    return { kind: "invalid", files, reason: "cargo accepts only a string or a list of strings" };
  }
  const strings = settings.filter((setting) => typeof setting.value === "string");
  const lists = settings.filter((setting) => Array.isArray(setting.value));
  if (strings.length > 0 && lists.length > 0) {
    return { kind: "invalid", files, reason: "cargo cannot merge a string with a list" };
  }
  if (strings.length > 0) {
    const [winner] = strings;
    return { kind: "one", value: winner.value as string, file: winner.file };
  }
  return {
    kind: "list",
    values: [...lists].reverse().flatMap((setting) => setting.value as string[]),
    files: [...new Set(files)],
  };
}

// Applies `CARGO_BUILD_TARGET` to the merged configuration and checks that
// each triple names a folder.
function pick(configured: Configured, variable: string | undefined): PickedTriples {
  const fromEnv = variable !== undefined;
  let triples: string[];
  let files: string[];
  switch (configured.kind) {
    case "invalid":
      return {
        kind: "unnamed",
        value: "build.target",
        reason: configured.reason,
        files: configured.files,
        fromEnv: false,
      };
    case "list":
      triples = [...configured.values, ...(variable ?? "").split(/\s+/).filter(Boolean)];
      files = configured.files;
      break;
    case "one":
      triples = [variable ?? configured.value];
      files = fromEnv ? [] : [configured.file];
      break;
    case "none":
      if (variable === undefined) {
        return { kind: "none" };
      }
      triples = [variable];
      files = [];
      break;
  }
  for (const triple of triples) {
    const reason = unnamedReason(triple);
    if (reason !== undefined) {
      return { kind: "unnamed", value: triple, reason, files, fromEnv };
    }
  }
  return { kind: "triples", triples: [...new Set(triples)], files, fromEnv };
}

// Why the plugin cannot put a triple's folder into an output, or undefined.
function unnamedReason(triple: string): string | undefined {
  if (triple === "") {
    return "cargo rejects an empty triple";
  }
  if (triple === "host-tuple") {
    return "cargo replaces it with the host's triple";
  }
  if (triple.endsWith(".json")) {
    return "it names a target specification file";
  }
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(triple)) {
    return "it is no triple name";
  }
  return undefined;
}

function describeValue(picked: PickedTriples): string {
  switch (picked.kind) {
    case "none":
      return "";
    case "triples":
      return picked.triples.join(" ");
    case "unnamed":
      return picked.value;
  }
}
