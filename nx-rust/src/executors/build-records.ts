import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  binaryRecordName,
  type BuildRecordSource,
  libraryRecordName,
} from "../graph/build-records";

/** What a `build` task's options say about the cargo call, as far as the records depend on it. */
export interface BuildSelection {
  /** `--features`: features of the crate, or `<package>/<feature>` entries, each possibly a list. */
  features?: readonly string[];
  /** `--all-features`. */
  allFeatures?: boolean;
  /** `--no-default-features`. */
  noDefaultFeatures?: boolean;
  /** `--profile`; the default profile `dev` where absent. */
  profile?: string;
  /** `--target`. */
  targetTriple?: string;
}

/** A dependency file that `cargo build -p <crate>` exports for one of the crate's targets. */
export interface NamedRecord {
  /** The absolute path of the record. */
  path: string;
  /** Whether it belongs to the crate's library or to one of its binaries. */
  kind: "library" | "binary";
  /** The name of the library or binary. */
  target: string;
}

/**
 * The folder that cargo gives a profile's artifacts: `debug` for `dev` and
 * `test`, `release` for `release` and `bench`, and the profile's own name for
 * any other, also one that inherits from those four.
 */
export function profileFolder(profile: string | undefined): string {
  switch (profile) {
    case undefined:
    case "":
    case "dev":
    case "test":
      return "debug";
    case "release":
    case "bench":
      return "release";
    default:
      return profile;
  }
}

/**
 * The features of the crate that a selection turns on, as cargo resolves
 * them: all of them with `--all-features`, otherwise `default` unless
 * `--no-default-features`, and those that `--features` names, a
 * `<package>/<feature>` entry for the crate itself included; then, to any
 * depth, what each turned-on feature turns on. A plain entry turns on the
 * feature it names. A `<dependency>/<feature>` entry also turns on the
 * crate's feature of the dependency's name where the dependency is
 * optional, as cargo does for the implicit feature of an optional
 * dependency; `dep:<name>` and the weak `<dependency>?/<feature>` turn on
 * no feature of the crate. An optional dependency that a platform limits
 * counts as required, since cargo matches it only on that platform: a binary
 * that only it would turn on then stays unnamed and unchecked rather than
 * read from a record that cargo may not have written.
 *
 * @param optionalDependencies The names under which the crate lists its
 *   optional dependencies that no platform limits.
 */
export function enabledFeatures(
  packageName: string,
  table: Readonly<Record<string, readonly string[]>>,
  selection: BuildSelection,
  optionalDependencies: readonly string[] = [],
): Set<string> {
  const features = new Map(Object.entries(table));
  const optional = new Set(optionalDependencies);
  const queue: string[] = [];
  if (selection.allFeatures === true) {
    queue.push(...features.keys());
  } else if (selection.noDefaultFeatures !== true) {
    queue.push("default");
  }
  const own = `${packageName}/`;
  for (const entry of (selection.features ?? []).flatMap((value) => value.split(/[\s,]+/))) {
    queue.push(entry.startsWith(own) ? entry.slice(own.length) : entry);
  }
  const enabled = new Set<string>();
  while (queue.length > 0) {
    const feature = turnedOnFeature(queue.pop() as string, optional);
    const enables = feature === undefined ? undefined : features.get(feature);
    if (feature === undefined || enables === undefined || enabled.has(feature)) {
      continue;
    }
    enabled.add(feature);
    queue.push(...enables);
  }
  return enabled;
}

// The feature of the crate that a feature entry turns on, if any: the one
// it names, or for `<dependency>/<feature>` that of an optional dependency's
// name; none for `dep:<name>` and the weak `<dependency>?/<feature>`.
function turnedOnFeature(entry: string, optional: ReadonlySet<string>): string | undefined {
  if (entry === "" || entry.startsWith("dep:")) {
    return undefined;
  }
  const slash = entry.indexOf("/");
  if (slash === -1) {
    return entry;
  }
  const dependency = entry.slice(0, slash);
  return optional.has(dependency) ? dependency : undefined;
}

/**
 * The target triple that the call builds for, as far as the plugin can
 * know it: the task's triple, or else `CARGO_BUILD_TARGET` in the task's
 * environment; `undefined` where neither names one.
 */
export function namedTriple(
  selection: BuildSelection,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  for (const triple of [selection.targetTriple, env.CARGO_BUILD_TARGET]) {
    if (typeof triple === "string" && triple !== "") {
      return triple;
    }
  }
  return undefined;
}

/**
 * The records that `cargo build -p <crate>` exports for a call with this
 * selection, named from what graph creation reported, without asking cargo
 * (`DES-BUILD-INPUT-CHECK`, point 1): `lib<name>.d` for the library and
 * `<name>.d` for each binary whose required features are all features of the
 * crate that the selection turns on ({@link enabledFeatures}), in `<artifact directory>/<profile folder>`,
 * or in `<artifact directory>/<triple>/<profile folder>` where the call
 * builds for a named triple; a proc macro's library record stays in the
 * profile folder whatever the triple.
 *
 * Left out are the records it cannot name with certainty (point 2): one whose
 * name a target of another crate with the same artifact directory shares,
 * and, where the call names no triple, one whose folder depends on the
 * triple while a record of the same name lies in any
 * `<artifact directory>/<folder>/<profile folder>`, since Cargo's
 * configuration may then have sent the call's records there.
 *
 * @param artifactDirectory The absolute path of Cargo's artifact directory.
 */
// @mara implements DES-BUILD-INPUT-CHECK
export function nameRecords(
  source: BuildRecordSource,
  packageName: string,
  selection: BuildSelection,
  env: Readonly<Record<string, string | undefined>>,
  artifactDirectory: string,
): NamedRecord[] {
  const profile = profileFolder(selection.profile);
  const triple = namedTriple(selection, env);
  const hostFolder = join(artifactDirectory, profile);
  const tripleFolder =
    triple === undefined ? hostFolder : join(artifactDirectory, tripleFolderName(triple), profile);
  const shared = new Set(source.shared);
  const records: NamedRecord[] = [];
  const add = (kind: NamedRecord["kind"], target: string, name: string, followsTriple: boolean) => {
    if (shared.has(name)) {
      return;
    }
    if (
      followsTriple &&
      triple === undefined &&
      inAnyTripleFolder(artifactDirectory, profile, name)
    ) {
      return;
    }
    records.push({ path: join(followsTriple ? tripleFolder : hostFolder, name), kind, target });
  };
  if (source.library !== undefined) {
    const { name, procMacro } = source.library;
    add("library", name, libraryRecordName(name), !procMacro);
  }
  const enabled = enabledFeatures(
    packageName,
    source.features,
    selection,
    source.optionalDependencies ?? [],
  );
  for (const binary of source.binaries) {
    if (binary.requiredFeatures.every((feature) => enabled.has(feature))) {
      add("binary", binary.name, binaryRecordName(binary.name), true);
    }
  }
  return records;
}

/**
 * One rule of a record: the artifact it describes and the paths that cargo
 * would rebuild it for, unescaped.
 */
export interface RecordRule {
  /** The artifact, as the record spells it. */
  target: string;
  /** The paths it depends on, as the record spells them. */
  paths: string[];
}

/**
 * The rules of a record in Makefile syntax, as cargo writes it
 * (`DES-BUILD-INPUT-CHECK`, point 3): `<artifact>: <path> <path> ...`, with a
 * space inside a path escaped by a backslash. A line without a target is
 * skipped, and so is a comment.
 */
// @mara implements DES-BUILD-INPUT-CHECK
export function parseRecord(text: string): RecordRule[] {
  const rules: RecordRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) {
      continue;
    }
    const words = splitMakeWords(line);
    const index = words.findIndex((word) => word.endsWith(":"));
    if (index !== 0) {
      continue;
    }
    rules.push({ target: words[0].slice(0, -1), paths: words.slice(1) });
  }
  return rules;
}

// The words of a Makefile line, split at unescaped spaces and tabs, with
// `\ ` read as a space. Cargo escapes nothing else, so any other backslash
// stays.
function splitMakeWords(line: string): string[] {
  const words: string[] = [];
  let word = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\" && line[index + 1] === " ") {
      word += " ";
      index += 1;
    } else if (character === " " || character === "\t") {
      if (word !== "") {
        words.push(word);
      }
      word = "";
    } else {
      word += character;
    }
  }
  if (word !== "") {
    words.push(word);
  }
  return words;
}

// The folder cargo names after a triple: the triple, or the file stem of a
// target specification file.
function tripleFolderName(triple: string): string {
  return extname(triple) === ".json" ? basename(triple, ".json") : triple;
}

// Whether a record of this name lies in `<artifact directory>/<folder>/<profile folder>`
// for any folder.
function inAnyTripleFolder(artifactDirectory: string, profile: string, name: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(artifactDirectory);
  } catch {
    return false;
  }
  return entries.some((entry) => existsSync(join(artifactDirectory, entry, profile, name)));
}
