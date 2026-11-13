import { createHash } from "node:crypto";
import { parse } from "smol-toml";

/** A package entry of `Cargo.lock`, a `[[package]]` table, as far as the digest reads it. */
export interface LockfileEntry {
  name: string;
  version: string;
  /** Where the package comes from; absent for a path package, members included. */
  source?: string;
  /** The checksum of a registry package. */
  checksum?: string;
  /** The entry that `[replace]` puts in this one's place, as the lockfile names it. */
  replace?: string;
  /** The entries this one depends on, as the lockfile writes them: `name`, `name version` or `name version (source)`. */
  dependencies: string[];
}

/** A package by the name and version that its manifest gives it. */
export interface PackageVersion {
  name: string;
  version: string;
}

/** The package entries of a `Cargo.lock`, without `[[patch.unused]]`. */
export interface Lockfile {
  entries: LockfileEntry[];
}

/** A `Cargo.lock` that the digest cannot read, or a package that it does not lock. */
export class LockfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockfileError";
  }
}

/**
 * Reads the package entries of a `Cargo.lock`: the `[[package]]` tables,
 * not the `[[patch.unused]]` ones. A lockfile of the first format keeps the
 * checksums in its `[metadata]` table, under keys such as
 * `checksum ryu 1.0.0 (registry+https://github.com/rust-lang/crates.io-index)`;
 * they are read as the entries' own.
 *
 * @throws {LockfileError} When the text is no TOML or an entry lacks its name or version.
 */
export function parseLockfile(text: string): Lockfile {
  let document: Record<string, unknown>;
  try {
    document = parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new LockfileError(`it is no valid TOML: ${(error as Error).message}`);
  }
  const packages = Array.isArray(document.package) ? document.package : [];
  const metadata = isRecord(document.metadata) ? document.metadata : {};
  const entries = packages.map((value, index): LockfileEntry => {
    const table = isRecord(value) ? value : {};
    const name = table.name;
    const version = table.version;
    if (typeof name !== "string" || typeof version !== "string") {
      throw new LockfileError(`its package entry number ${index + 1} has no name or no version`);
    }
    const source = typeof table.source === "string" ? table.source : undefined;
    const ownChecksum = typeof table.checksum === "string" ? table.checksum : undefined;
    const listedChecksum =
      source === undefined ? undefined : metadata[`checksum ${name} ${version} (${source})`];
    const checksum =
      ownChecksum ?? (typeof listedChecksum === "string" ? listedChecksum : undefined);
    return {
      name,
      version,
      ...(source === undefined ? {} : { source }),
      ...(checksum === undefined ? {} : { checksum }),
      ...(typeof table.replace === "string" ? { replace: table.replace } : {}),
      dependencies: Array.isArray(table.dependencies)
        ? table.dependencies.filter(
            (dependency): dependency is string => typeof dependency === "string",
          )
        : [],
    };
  });
  return { entries };
}

/**
 * The digest of a member's external dependencies (`DES-LOCKFILE-HASHING`,
 * "Digest"): a SHA-256, in hexadecimal, over the entries that the member's
 * entry reaches in the lockfile's graph.
 *
 * The walk starts at the entry without a source that has the member's name
 * and version, takes every dependency that an entry lists, passes through
 * path packages and follows `replace = …` to the entry it names. Each
 * reachable entry gives one line: its name, version, source, checksum and
 * `replace` value, then its dependency strings as the lockfile writes them,
 * in byte order, all joined by tab characters, with an empty field for a
 * value the entry lacks. The digest is the SHA-256 of these lines in byte
 * order, each ended by a line feed, in UTF-8.
 *
 * @throws {LockfileError} When the lockfile has no entry for the member, or
 *   a dependency string or `replace` value names no entry or several.
 */
// @mara implements DES-LOCKFILE-HASHING
export function memberDigest(lockfile: Lockfile, member: PackageVersion): string {
  const byName = new Map<string, LockfileEntry[]>();
  for (const entry of lockfile.entries) {
    byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);
  }
  const start = (byName.get(member.name) ?? []).find(
    (entry) => entry.version === member.version && entry.source === undefined,
  );
  if (start === undefined) {
    throw new LockfileError(`it has no entry for the package ${member.name} ${member.version}`);
  }
  const reached = new Set<LockfileEntry>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const entry = queue.shift() as LockfileEntry;
    const references = [
      ...entry.dependencies,
      ...(entry.replace === undefined ? [] : [entry.replace]),
    ];
    for (const reference of references) {
      const target = resolveReference(byName, reference, entry);
      if (!reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  const lines = [...reached].map((entry) =>
    [
      entry.name,
      entry.version,
      entry.source ?? "",
      entry.checksum ?? "",
      entry.replace ?? "",
      ...sortedBytewise(entry.dependencies),
    ].join("\t"),
  );
  const hash = createHash("sha256");
  for (const line of sortedBytewise(lines)) {
    hash.update(`${line}\n`, "utf8");
  }
  return hash.digest("hex");
}

// The entry that a dependency string or `replace` value of `from` names. A
// reference without a source that two entries share by name and version
// means the entry without a source, as cargo writes a path package.
function resolveReference(
  byName: ReadonlyMap<string, readonly LockfileEntry[]>,
  reference: string,
  from: LockfileEntry,
): LockfileEntry {
  const match = /^(\S+)(?: (\S+))?(?: \((.+)\))?$/.exec(reference);
  if (match === null) {
    throw new LockfileError(
      `the entry ${from.name} ${from.version} names "${reference}", which is no package reference`,
    );
  }
  const [, name, version, source] = match;
  let candidates = (byName.get(name) ?? []).filter(
    (entry) =>
      (version === undefined || entry.version === version) &&
      (source === undefined || entry.source === source),
  );
  if (candidates.length > 1 && version !== undefined && source === undefined) {
    candidates = candidates.filter((entry) => entry.source === undefined);
  }
  if (candidates.length !== 1) {
    throw new LockfileError(
      `the entry ${from.name} ${from.version} names "${reference}", which ${candidates.length === 0 ? "matches no entry" : "matches several entries"}`,
    );
  }
  return candidates[0];
}

// The strings sorted by their UTF-8 bytes.
function sortedBytewise(strings: readonly string[]): string[] {
  return strings
    .map((string) => ({ string, bytes: Buffer.from(string, "utf8") }))
    .sort((a, b) => Buffer.compare(a.bytes, b.bytes))
    .map(({ string }) => string);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
