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
 * The features of the crate that a selection turns on, directly or through
 * other features of the crate: all of them with `--all-features`, otherwise
 * `default` unless `--no-default-features`, and those that `--features` names
 * for the crate itself. An entry that names a feature of a dependency turns
 * on none that the rule counts, so a binary that only it would turn on stays
 * unnamed and unchecked rather than read from a record that cargo may not
 * have written.
 */
export function enabledFeatures(
  packageName: string,
  table: Readonly<Record<string, readonly string[]>>,
  selection: BuildSelection,
): Set<string> {
  const features = new Map(Object.entries(table));
  const queue: string[] = [];
  if (selection.allFeatures === true) {
    queue.push(...features.keys());
  } else if (selection.noDefaultFeatures !== true) {
    queue.push("default");
  }
  for (const entry of (selection.features ?? []).flatMap((value) => value.split(/[\s,]+/))) {
    const slash = entry.indexOf("/");
    if (slash === -1) {
      queue.push(entry);
    } else if (entry.slice(0, slash) === packageName) {
      queue.push(entry.slice(slash + 1));
    }
  }
  const enabled = new Set<string>();
  while (queue.length > 0) {
    const feature = queue.pop() as string;
    const enables = features.get(feature);
    if (feature === "" || enabled.has(feature) || enables === undefined) {
      continue;
    }
    enabled.add(feature);
    queue.push(...enables.filter((entry) => !entry.includes("/") && !entry.startsWith("dep:")));
  }
  return enabled;
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
 * crate that the selection turns on, in `<artifact directory>/<profile folder>`,
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
  const enabled = enabledFeatures(packageName, source.features, selection);
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
