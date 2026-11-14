import { parse } from "smol-toml";

/** A parsed TOML table. */
export type TomlTable = Record<string, unknown>;

/** Versioning cannot go on; the message says why and what to do. */
export class ReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseError";
  }
}

/** Whether `value` is a TOML table. */
export function isTable(value: unknown): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The manifest's text parsed.
 *
 * @param manifest The manifest's path, for the message.
 * @throws {ReleaseError} When the text is no valid TOML.
 */
export function parseManifest(text: string, manifest: string): TomlTable {
  try {
    return parse(text) as TomlTable;
  } catch (error) {
    throw new ReleaseError(
      `${manifest} is no valid TOML, so nx release version cannot read it: ${(error as Error).message.split("\n")[0]}. Correct the manifest and run the command again.`,
    );
  }
}

/**
 * Where a crate's manifest gives its version: in its own `[package]` table,
 * through `version.workspace = true` from `[workspace.package]`, or not at
 * all, which cargo reports as 0.0.0.
 */
export type CrateVersion =
  | { kind: "own"; version: string }
  | { kind: "inherited" }
  | { kind: "missing" };

/** Where the crate whose parsed manifest is `manifest` takes its version from. */
export function crateVersion(manifest: TomlTable): CrateVersion {
  const version = isTable(manifest.package) ? manifest.package.version : undefined;
  if (typeof version === "string") {
    return { kind: "own", version };
  }
  if (isTable(version) && version.workspace === true) {
    return { kind: "inherited" };
  }
  return { kind: "missing" };
}

/** The `[workspace.package].version` of a parsed root manifest, where it has one. */
export function workspaceVersion(root: TomlTable): string | undefined {
  const workspace = isTable(root.workspace) ? root.workspace : undefined;
  const version = isTable(workspace?.package) ? workspace.package.version : undefined;
  return typeof version === "string" ? version : undefined;
}

/** The keys from the document root to `[package].version` and to `[workspace.package].version`. */
export const packageVersionPath = ["package", "version"] as const;
export const workspaceVersionPath = ["workspace", "package", "version"] as const;

/** An entry of a dependency table of a manifest. */
export interface DependencyEntry {
  /** The keys from the document root to the entry, such as `["target", "cfg(unix)", "dependencies", "a"]`. */
  path: string[];
  /** `workspace` for an entry of `[workspace.dependencies]`. */
  kind: "normal" | "dev" | "build" | "workspace";
  /** The platform of a `[target.<platform>]` table; `null` elsewhere. */
  target: string | null;
  /** The entry's key, which is the package name unless the entry renames it. */
  key: string;
  /** The entry's table; a plain string, a registry requirement, gives `{ version }`. */
  entry: TomlTable;
}

const dependencyTables = [
  ["dependencies", "normal"],
  ["dev-dependencies", "dev"],
  ["dev_dependencies", "dev"],
  ["build-dependencies", "build"],
  ["build_dependencies", "build"],
] as const;

/**
 * Every entry of the dependency tables of a parsed manifest: those of each
 * kind, under their old spellings with `_` too, their `[target.*]` forms,
 * and `[workspace.dependencies]` where the manifest has it.
 */
export function dependencyEntries(manifest: TomlTable): DependencyEntry[] {
  const entries: DependencyEntry[] = [];
  const add = (
    path: string[],
    table: unknown,
    kind: DependencyEntry["kind"],
    target: string | null,
  ) => {
    if (!isTable(table)) {
      return;
    }
    for (const [key, value] of Object.entries(table)) {
      const entry = typeof value === "string" ? { version: value } : isTable(value) ? value : {};
      entries.push({ path: [...path, key], kind, target, key, entry });
    }
  };
  for (const [name, kind] of dependencyTables) {
    add([name], manifest[name], kind, null);
  }
  if (isTable(manifest.target)) {
    for (const [platform, table] of Object.entries(manifest.target)) {
      if (isTable(table)) {
        for (const [name, kind] of dependencyTables) {
          add(["target", platform, name], table[name], kind, platform);
        }
      }
    }
  }
  if (isTable(manifest.workspace)) {
    add(["workspace", "dependencies"], manifest.workspace.dependencies, "workspace", null);
  }
  return entries;
}

/** The table, as a header would name it, that holds the entry at `entry.path`. */
export function tableName(entry: { path: readonly string[] }): string {
  return entry.path
    .slice(0, -1)
    .map((key) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : `'${key}'`))
    .join(".");
}

/** An entry of a `[patch.<source>]` table, in a root manifest or a Cargo configuration file. */
export interface PatchEntry {
  /** The keys from the document root to the entry, `["patch", source, key]`. */
  path: string[];
  /** The table's source: `crates-io`, a registry's name or a URL. */
  source: string;
  /** The entry's key, which is the package name unless the entry renames it. */
  key: string;
  entry: TomlTable;
}

/** Every entry of the `[patch.<source>]` tables of a parsed manifest or configuration file. */
export function patchEntries(document: TomlTable): PatchEntry[] {
  const entries: PatchEntry[] = [];
  if (isTable(document.patch)) {
    for (const [source, table] of Object.entries(document.patch)) {
      if (isTable(table)) {
        for (const [key, entry] of Object.entries(table)) {
          if (isTable(entry)) {
            entries.push({ path: ["patch", source, key], source, key, entry });
          }
        }
      }
    }
  }
  return entries;
}

/** An entry of `[replace]`, whose key is the package ID specification of what it replaces. */
export interface ReplaceEntry {
  spec: string;
  entry: TomlTable;
}

/** Every entry of the `[replace]` table of a parsed manifest. */
export function replaceEntries(manifest: TomlTable): ReplaceEntry[] {
  return isTable(manifest.replace)
    ? Object.entries(manifest.replace)
        .filter((entry): entry is [string, TomlTable] => isTable(entry[1]))
        .map(([spec, entry]) => ({ spec, entry }))
    : [];
}

/** The package ID specification of a `[profile.<name>.package.<spec>]` table. */
export interface ProfileSpec {
  profile: string;
  spec: string;
}

/** Every package ID specification of the profiles' package tables of a parsed manifest or configuration file. */
export function profileSpecs(document: TomlTable): ProfileSpec[] {
  const specs: ProfileSpec[] = [];
  if (isTable(document.profile)) {
    for (const [profile, table] of Object.entries(document.profile)) {
      if (isTable(table) && isTable(table.package)) {
        for (const spec of Object.keys(table.package)) {
          specs.push({ profile, spec });
        }
      }
    }
  }
  return specs;
}

/**
 * The parts of a package ID specification, such as `base`, `base:0.1.0`,
 * `base@0.1`, `https://github.com/rust-lang/crates.io-index#base@0.1.0` or
 * `path+file:///repo/crates/base#0.1.0`, where the name is the URL's last
 * segment. `undefined` for `*` and other forms that name no package.
 */
export function parsePackageSpec(
  spec: string,
): { url?: string; name: string; version?: string } | undefined {
  const hash = spec.indexOf("#");
  const url = hash === -1 ? undefined : spec.slice(0, hash);
  const rest = hash === -1 ? spec : spec.slice(hash + 1);
  const match =
    /^([A-Za-z0-9_-]+)?(?:[@:]([0-9][^@:]*))?$/.exec(rest) ?? /^()([0-9][^@:]*)$/.exec(rest);
  if (match === null) {
    return undefined;
  }
  const name =
    match[1] || (url === undefined ? "" : (url.replace(/\/+$/, "").split("/").pop() ?? ""));
  return name === "" ? undefined : { url, name, version: match[2] || undefined };
}
