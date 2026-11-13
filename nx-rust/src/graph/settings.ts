import type { TargetConfiguration } from "@nx/devkit";
import { join, relative } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import type { CargoDiscovery, CargoWorkspace } from "./discovery";
import { readLocked, readTargetNames, TargetNames } from "./options";
import { targetFieldProblems } from "./target-fields";

/** The test runner of a workspace (`DES-TEST-RUN`). */
export type TestRunner = "cargo" | "nextest";

/** The feature-unification strategy of a workspace (`DES-UNIFICATION`). */
export type FeatureUnification = "hakari" | "cargo" | "workspace-build";

/** A kind of artifact that `artifacts` names (`DES-ARTIFACT-STEPS`). */
export type ArtifactKind = "napi" | "wasm";

/**
 * The settings that hold for a whole workspace, which the plugin entries
 * that receive manifests of one workspace have to agree on
 * (`checkEntries` in `entries.ts`).
 */
export const workspaceWideSettings = ["testRunner", "affectedTests", "featureUnification"] as const;

export type WorkspaceWideSetting = (typeof workspaceWideSettings)[number];

/** The options of one entry of the plugin in `nx.json`, validated. */
export interface PluginOptions {
  targetNames: TargetNames;
  /** Locked mode for the plugin's commands (`DES-INVOCATION`); `false` where unset. */
  locked: boolean;
  testRunner?: TestRunner;
  affectedTests?: boolean;
  featureUnification?: FeatureUnification;
  envInputs: readonly string[];
  runtimeInputs: readonly string[];
}

/** The header of a metadata table, which messages name. */
export type MetadataTable =
  | "[package.metadata.nx]"
  | "[workspace.metadata.nx]"
  | "[workspace.metadata.nx.project]";

/** A `targets.<name>` table of a metadata table, with where it is written. */
export interface TargetTable {
  /**
   * The key of the table. It addresses the inferred target of that name
   * after `targetNames`, or else defines an extra target.
   */
  name: string;
  /** The table as written, shaped like an Nx target. */
  target: TargetConfiguration;
  /** The manifest that holds it, relative to the repository root. */
  manifest: string;
  /** The table it is under. */
  table: MetadataTable;
}

/** A pattern of `fileInputs`, which is relative to the folder of the manifest that holds it. */
export interface FileInput {
  pattern: string;
  /** The manifest that holds the pattern, relative to the repository root. */
  manifest: string;
}

/**
 * The settings of one workspace: the plugin options of the entry that
 * received it, with `[workspace.metadata.nx]` of its root manifest laid
 * over them (`DES-PLUGIN-OPTIONS`).
 */
export interface WorkspaceSettings {
  /** The workspace's root manifest, relative to the repository root. */
  rootManifest: string;
  /** Locked mode, from the plugin options only (`DES-INVOCATION`). */
  locked: boolean;
  testRunner: TestRunner;
  affectedTests: boolean;
  /**
   * The strategy that the workspace table or the plugin options set.
   * `undefined` means the default of `DES-UNIFICATION`, which depends on
   * whether the workspace has a cargo-hakari configuration (nxr-k64tm5).
   */
  featureUnification?: FeatureUnification;
  /** The workspace-wide settings that `[workspace.metadata.nx]` sets itself. */
  setInTable: readonly WorkspaceWideSetting[];
  /** Put in front of the package name of each member without a `name` of its own. */
  namePrefix?: string;
  /** The workspace table's tags, which every member and the workspace project have. */
  tags: readonly string[];
  /** The workspace table's implicit dependencies, which every member has. */
  implicitDependencies: readonly string[];
  /** The variables of the plugin options and of the workspace table. */
  envInputs: readonly string[];
  /** The commands of the plugin options and of the workspace table. */
  runtimeInputs: readonly string[];
  /** The patterns of the workspace table. */
  fileInputs: readonly FileInput[];
}

/**
 * What the settings give one project of the plugin: a crate, or the
 * workspace project of a root manifest without a crate. Lists that add up
 * across levels hold the values of every level that applies to the project.
 */
export interface ProjectSettings {
  workspace: WorkspaceSettings;
  /**
   * The `name` that the crate's table, or the `project` table for a
   * workspace project, sets.
   */
  name?: string;
  tags: readonly string[];
  implicitDependencies: readonly string[];
  /** The variables of the plugin options and of both tables, for a crate; none for a workspace project. */
  envInputs: readonly string[];
  /** The commands of the plugin options and of both tables, for a crate; none for a workspace project. */
  runtimeInputs: readonly string[];
  /** The patterns of both tables, for a crate; none for a workspace project. */
  fileInputs: readonly FileInput[];
  /** The crate's `artifacts`, in place of the inferred kinds; absent where it sets none. */
  artifacts?: readonly ArtifactKind[];
  /** The target tables for the project, in order of precedence: the workspace table's first. */
  targets: readonly TargetTable[];
}

/** The settings of every workspace and project of one graph computation. */
export class GraphSettings {
  constructor(
    readonly options: PluginOptions,
    private readonly workspaces: ReadonlyMap<CargoWorkspace, WorkspaceSettings>,
    private readonly crates: ReadonlyMap<string, ProjectSettings>,
    private readonly workspaceProjects: ReadonlyMap<CargoWorkspace, ProjectSettings>,
  ) {}

  /** The settings of a workspace that discovery found. */
  workspace(workspace: CargoWorkspace): WorkspaceSettings {
    return found(this.workspaces.get(workspace), workspace.rootManifest);
  }

  /** The settings of a member that discovery handed over. */
  crate(pkg: CargoPackage): ProjectSettings {
    return found(this.crates.get(pkg.manifest_path), pkg.manifest_path);
  }

  /** The settings of the workspace project of a root manifest without a crate. */
  workspaceProject(workspace: CargoWorkspace): ProjectSettings {
    return found(this.workspaceProjects.get(workspace), workspace.rootManifest);
  }
}

function found<T>(value: T | undefined, manifest: string): T {
  if (value === undefined) {
    throw new Error(
      `nx-rust read no settings for ${manifest}. Please report this at https://github.com/convesoft/nx-rust/issues.`,
    );
  }
  return value;
}

const pluginOptionsLabel = "the options of the @convesoft/nx-rust entry";

/** Each key that a place accepts, in the order of `DES-PLUGIN-OPTIONS`. */
const keysOf = {
  plugin: [
    "targetNames",
    "locked",
    "testRunner",
    "affectedTests",
    "featureUnification",
    "envInputs",
    "runtimeInputs",
  ],
  workspace: [
    "testRunner",
    "affectedTests",
    "featureUnification",
    "namePrefix",
    "tags",
    "targets",
    "implicitDependencies",
    "envInputs",
    "runtimeInputs",
    "fileInputs",
    "project",
  ],
  project: ["name", "tags", "targets"],
  package: [
    "name",
    "artifacts",
    "tags",
    "targets",
    "implicitDependencies",
    "envInputs",
    "runtimeInputs",
    "fileInputs",
  ],
} as const;

/** Where a key that a place does not accept can be set instead, for the message. */
const placesOf: Record<string, string> = {
  targetNames: "the options of the plugin's entry in nx.json",
  locked: "the options of the plugin's entry in nx.json",
  testRunner: "[workspace.metadata.nx] or the options of the plugin's entry in nx.json",
  affectedTests: "[workspace.metadata.nx] or the options of the plugin's entry in nx.json",
  featureUnification: "[workspace.metadata.nx] or the options of the plugin's entry in nx.json",
  namePrefix: "[workspace.metadata.nx] of a workspace's root manifest",
  name: "[package.metadata.nx] of a crate, or [workspace.metadata.nx.project] for a workspace project",
  artifacts: "[package.metadata.nx] of a crate",
  tags: "[package.metadata.nx], [workspace.metadata.nx] or [workspace.metadata.nx.project]",
  targets: "[package.metadata.nx], [workspace.metadata.nx] or [workspace.metadata.nx.project]",
  implicitDependencies: "[package.metadata.nx] or [workspace.metadata.nx]",
  envInputs:
    "[package.metadata.nx], [workspace.metadata.nx] or the options of the plugin's entry in nx.json",
  runtimeInputs:
    "[package.metadata.nx], [workspace.metadata.nx] or the options of the plugin's entry in nx.json",
  fileInputs: "[package.metadata.nx] or [workspace.metadata.nx]",
  project: "[workspace.metadata.nx]",
};

/**
 * Reads the options of the plugin's entry in `nx.json`, as Nx passes them to
 * `createNodes`: each setting that `DES-PLUGIN-OPTIONS` gives the plugin
 * options, validated.
 *
 * @throws {Error} When a key is unknown there or a value is invalid, naming
 *   `nx.json` and each such key.
 */
// @mara implements DES-PLUGIN-OPTIONS
export function readPluginOptions(options: unknown): PluginOptions {
  const problems: string[] = [];
  if (options !== undefined && options !== null && !isTable(options)) {
    throw new Error(
      `nx.json: ${pluginOptionsLabel} have to be an object, not ${JSON.stringify(options)}.`,
    );
  }
  const reader = new TableReader(
    "nx.json",
    pluginOptionsLabel,
    isTable(options) ? options : {},
    problems,
  );
  reader.unknownKeys("plugin");
  const read: PluginOptions = {
    targetNames: {},
    locked: false,
    testRunner: reader.oneOf("testRunner", testRunners),
    affectedTests: reader.boolean("affectedTests"),
    featureUnification: reader.oneOf("featureUnification", featureUnifications),
    envInputs: reader.strings("envInputs", "the names of environment variables"),
    runtimeInputs: reader.strings("runtimeInputs", "commands"),
  };
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
  // They name their own problems in the words their checks have used since 0.1.
  read.targetNames = readTargetNames(options);
  read.locked = readLocked(options);
  return read;
}

/**
 * Reads `[workspace.metadata.nx]` of each workspace that discovery found,
 * with its `project` table, and `[package.metadata.nx]` of each member that
 * becomes a project, from the `cargo metadata` reports (`DES-METADATA-REPORT`),
 * and combines them with the plugin options by the precedence of
 * `DES-PLUGIN-OPTIONS`: a crate's value wins over the workspace's, which wins
 * over the plugin options', and tags, `implicitDependencies`, `fileInputs`,
 * `envInputs` and `runtimeInputs` add up.
 *
 * @throws {Error} Naming every manifest with an unknown key, an invalid
 *   value, an `implicitDependencies` entry starting with `!`, or a `project`
 *   table in a root manifest that defines a crate.
 */
// @mara implements DES-METADATA-TABLES
// @mara implements DES-PLUGIN-OPTIONS
// @mara implements REQ-METADATA-OVERRIDES
export function readSettings(discovery: CargoDiscovery, options: PluginOptions): GraphSettings {
  const problems: string[] = [];
  const workspaces = new Map<CargoWorkspace, WorkspaceSettings>();
  const crates = new Map<string, ProjectSettings>();
  const workspaceProjects = new Map<CargoWorkspace, ProjectSettings>();
  for (const workspace of discovery.workspaces) {
    const rootManifestPath = join(workspace.report.workspace_root, "Cargo.toml");
    const rootIsCrate = workspace.report.packages.some(
      (pkg) => pkg.manifest_path === rootManifestPath,
    );
    const table = readWorkspaceTable(workspace, rootIsCrate, problems);
    const settings: WorkspaceSettings = {
      rootManifest: workspace.rootManifest,
      locked: options.locked,
      testRunner: table.testRunner ?? options.testRunner ?? "cargo",
      affectedTests: table.affectedTests ?? options.affectedTests ?? false,
      featureUnification: table.featureUnification ?? options.featureUnification,
      setInTable: workspaceWideSettings.filter((setting) => table[setting] !== undefined),
      namePrefix: table.namePrefix,
      tags: table.tags,
      implicitDependencies: table.implicitDependencies,
      envInputs: union(options.envInputs, table.envInputs),
      runtimeInputs: union(options.runtimeInputs, table.runtimeInputs),
      fileInputs: table.fileInputs,
    };
    workspaces.set(workspace, settings);
    for (const pkg of workspace.members) {
      const own = readPackageTable(pkg, discovery.workspaceRoot, problems);
      crates.set(pkg.manifest_path, {
        workspace: settings,
        name: own.name,
        tags: union(settings.tags, own.tags),
        implicitDependencies: union(settings.implicitDependencies, own.implicitDependencies),
        envInputs: union(settings.envInputs, own.envInputs),
        runtimeInputs: union(settings.runtimeInputs, own.runtimeInputs),
        fileInputs: [...settings.fileInputs, ...own.fileInputs],
        artifacts: own.artifacts,
        targets: [...table.targets, ...own.targets],
      });
    }
    workspaceProjects.set(workspace, {
      workspace: settings,
      name: table.project.name,
      tags: union(settings.tags, table.project.tags),
      implicitDependencies: [],
      envInputs: [],
      runtimeInputs: [],
      fileInputs: [],
      targets: table.project.targets,
    });
  }
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
  return new GraphSettings(options, workspaces, crates, workspaceProjects);
}

interface SharedTable {
  tags: readonly string[];
  targets: readonly TargetTable[];
  implicitDependencies: readonly string[];
  envInputs: readonly string[];
  runtimeInputs: readonly string[];
  fileInputs: readonly FileInput[];
}

interface WorkspaceTable extends SharedTable {
  testRunner?: TestRunner;
  affectedTests?: boolean;
  featureUnification?: FeatureUnification;
  namePrefix?: string;
  project: { name?: string; tags: readonly string[]; targets: readonly TargetTable[] };
}

interface PackageTable extends SharedTable {
  name?: string;
  artifacts?: readonly ArtifactKind[];
}

const testRunners = ["cargo", "nextest"] as const;
const featureUnifications = ["hakari", "cargo", "workspace-build"] as const;
const artifactKinds = ["napi", "wasm"] as const;

function readWorkspaceTable(
  workspace: CargoWorkspace,
  rootIsCrate: boolean,
  problems: string[],
): WorkspaceTable {
  const manifest = workspace.rootManifest;
  const value = nxTable(workspace.report.metadata, manifest, "[workspace.metadata]", problems);
  const reader = new TableReader(manifest, "[workspace.metadata.nx]", value, problems);
  reader.unknownKeys("workspace");
  const project = reader.table("project");
  if (project !== undefined && rootIsCrate) {
    problems.push(
      `${manifest}: [workspace.metadata.nx.project] configures the workspace project, but this root manifest defines a crate, which is the workspace project. Move its settings to [package.metadata.nx] in ${manifest}.`,
    );
  }
  const projectReader = new TableReader(
    manifest,
    "[workspace.metadata.nx.project]",
    project ?? {},
    problems,
  );
  projectReader.unknownKeys("project");
  return {
    testRunner: reader.oneOf("testRunner", testRunners),
    affectedTests: reader.boolean("affectedTests"),
    featureUnification: reader.oneOf("featureUnification", featureUnifications),
    namePrefix: reader.string("namePrefix", { nonEmpty: false }),
    ...readShared(reader, manifest),
    project: {
      name: projectReader.string("name", { nonEmpty: true }),
      tags: projectReader.strings("tags", "tags"),
      targets: projectReader.targets(),
    },
  };
}

function readPackageTable(
  pkg: CargoPackage,
  repositoryRoot: string,
  problems: string[],
): PackageTable {
  const manifest = relative(repositoryRoot, pkg.manifest_path);
  const value = nxTable(pkg.metadata, manifest, "[package.metadata]", problems);
  const reader = new TableReader(manifest, "[package.metadata.nx]", value, problems);
  reader.unknownKeys("package");
  const artifacts = reader.strings("artifacts", `kinds of artifact, "napi" or "wasm"`);
  const unknownKinds = artifacts.filter(
    (kind) => !(artifactKinds as readonly string[]).includes(kind),
  );
  if (unknownKinds.length > 0) {
    problems.push(
      `${manifest}: "artifacts" in [package.metadata.nx] names ${list(unknownKinds.map(quote))}, but the kinds of artifact are "napi" and "wasm"; an empty list means none.`,
    );
  }
  return {
    name: reader.string("name", { nonEmpty: true }),
    artifacts: reader.has("artifacts") ? (artifacts as ArtifactKind[]) : undefined,
    ...readShared(reader, manifest),
  };
}

function readShared(reader: TableReader, manifest: string): SharedTable {
  return {
    tags: reader.strings("tags", "tags"),
    targets: reader.targets(),
    implicitDependencies: reader.implicitDependencies(),
    envInputs: reader.strings("envInputs", "the names of environment variables"),
    runtimeInputs: reader.strings("runtimeInputs", "commands"),
    fileInputs: reader
      .strings("fileInputs", "glob patterns")
      .map((pattern) => ({ pattern, manifest })),
  };
}

// The `nx` table inside a `metadata` value of the report, or an empty one.
function nxTable(
  metadata: unknown,
  manifest: string,
  parent: string,
  problems: string[],
): Record<string, unknown> {
  const value = isTable(metadata) ? metadata.nx : undefined;
  if (value === undefined || value === null) {
    return {};
  }
  if (!isTable(value)) {
    problems.push(
      `${manifest}: "nx" in ${parent} has to be a table, not ${JSON.stringify(value)}.`,
    );
    return {};
  }
  return value;
}

/** Reads the values of one table or of the plugin options, collecting what is wrong. */
class TableReader {
  constructor(
    private readonly file: string,
    private readonly label: string,
    private readonly value: Record<string, unknown>,
    private readonly problems: string[],
  ) {}

  has(key: string): boolean {
    return this.value[key] !== undefined;
  }

  /** Reports each key that `place` does not accept. */
  unknownKeys(place: keyof typeof keysOf): void {
    const known: readonly string[] = keysOf[place];
    for (const key of Object.keys(this.value)) {
      if (known.includes(key)) {
        continue;
      }
      const similar = known.find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      const elsewhere = placesOf[key];
      this.problems.push(
        [
          `${this.file}: nx-rust does not know the key ${quote(key)} in ${this.label}.`,
          similar === undefined ? undefined : `Did you mean ${quote(similar)}?`,
          similar === undefined && key === "affectedTests" && place === "package"
            ? `A crate opts out of the selection of affected tests with affectedTests = false under [package.metadata.nx.targets.test.options].`
            : similar === undefined && elsewhere !== undefined
              ? `${quote(key)} can be set in ${elsewhere}.`
              : undefined,
          `The keys it knows there are ${list(known.map(quote))}.`,
        ]
          .filter((sentence) => sentence !== undefined)
          .join(" "),
      );
    }
  }

  string(key: string, { nonEmpty }: { nonEmpty: boolean }): string | undefined {
    const value = this.value[key];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "string" || (nonEmpty && value.trim() === "")) {
      this.invalid(key, nonEmpty ? "a string that is not empty" : "a string");
      return undefined;
    }
    return value;
  }

  boolean(key: string): boolean | undefined {
    const value = this.value[key];
    if (value === undefined || typeof value === "boolean") {
      return value as boolean | undefined;
    }
    this.invalid(key, "true or false");
    return undefined;
  }

  oneOf<T extends string>(key: string, values: readonly T[]): T | undefined {
    const value = this.value[key];
    if (value === undefined || values.includes(value as T)) {
      return value as T | undefined;
    }
    this.invalid(key, list(values.map(quote), "or"));
    return undefined;
  }

  /** A list of strings that are not empty; an empty list where the key is not set. */
  strings(key: string, what: string): string[] {
    const value = this.value[key];
    if (value === undefined) {
      return [];
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
      this.invalid(key, `a list of ${what}, each a string that is not empty`);
      return [];
    }
    return value;
  }

  table(key: string): Record<string, unknown> | undefined {
    const value = this.value[key];
    if (value === undefined || isTable(value)) {
      return value as Record<string, unknown> | undefined;
    }
    this.invalid(key, "a table");
    return undefined;
  }

  /** `implicitDependencies`, which only adds: an entry starting with `!` is an error. */
  implicitDependencies(): string[] {
    const entries = this.strings("implicitDependencies", "project names");
    const negated = entries.filter((entry) => entry.startsWith("!"));
    if (negated.length > 0) {
      this.problems.push(
        `${this.file}: "implicitDependencies" in ${this.label} has ${negated.length === 1 ? "the entry" : "the entries"} ${list(negated.map(quote))}, but the key only adds dependencies, so an entry starting with "!" is an error, whatever it names. Remove ${negated.length === 1 ? "it" : "them"}; nx-rust keeps the edge of every Cargo dependency.`,
      );
    }
    return entries.filter((entry) => !entry.startsWith("!"));
  }

  /**
   * The `targets.<name>` tables, each a table shaped like an Nx target whose
   * fields have the types that Nx gives them ({@link targetFieldProblems}).
   * A table with a field of another type is reported and left out.
   */
  targets(): TargetTable[] {
    const targets = this.table("targets") ?? {};
    const tables: TargetTable[] = [];
    for (const [name, target] of Object.entries(targets)) {
      if (!isTable(target)) {
        this.problems.push(
          `${this.file}: ${targetHeader(this.label as MetadataTable, name)} has to be a table shaped like an Nx target, not ${JSON.stringify(target)}.`,
        );
        continue;
      }
      const header = targetHeader(this.label as MetadataTable, name);
      const problems = targetFieldProblems(
        target,
        (field) => `${this.file}: ${quote(field)} in ${header}`,
      );
      if (problems.length > 0) {
        this.problems.push(...problems);
        continue;
      }
      tables.push({
        name,
        target: target as TargetConfiguration,
        manifest: this.file,
        table: this.label as MetadataTable,
      });
    }
    return tables;
  }

  private invalid(key: string, expected: string): void {
    this.problems.push(
      `${this.file}: ${quote(key)} in ${this.label} has to be ${expected}, not ${JSON.stringify(this.value[key])}.`,
    );
  }
}

/** The header of a target table in messages, such as `[package.metadata.nx.targets.test]`. */
export function targetHeader(table: MetadataTable, target: string, ...path: string[]): string {
  return `${table.slice(0, -1)}.targets.${[target, ...path].map(tomlKey).join(".")}]`;
}

// A key as TOML writes it in a dotted header: bare where it can be.
function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The values of every list, each once, in the order they first appear.
function union(...lists: (readonly string[])[]): string[] {
  return [...new Set(lists.flat())];
}

function quote(value: string): string {
  return JSON.stringify(value);
}

// `a`, `a and b`, `a, b and c`
function list(items: readonly string[], conjunction = "and"): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}
