import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse } from "smol-toml";
import { hostTriple } from "../cargo/host-triple";
import type { CargoDependency, CargoPackage } from "../cargo/metadata";
import type { CargoDiscovery, CargoWorkspace } from "./discovery";
import { describeWorkspaces } from "./discovery";
import { realPath } from "./real-path";
import type { FeatureUnification, GraphSettings, ProjectSettings } from "./settings";

/** What the `hakari` strategy of a workspace rests on (`DES-UNIFICATION`). */
export interface HakariSetup {
  /**
   * The configuration file of cargo-hakari, `.config/hakari.toml` or else
   * `.guppy/hakari.toml` in the workspace root, relative to the repository root.
   */
  configFile: string;
  /** The manifest of the hack crate, relative to the repository root. */
  hackManifest: string;
  /** The package name of the hack crate. */
  hackPackage: string;
  /** The triples of `platforms`, as the configuration lists them. */
  platforms: string[];
}

/** The strategy that a workspace uses, and what graph creation says about it. */
export interface WorkspaceStrategy {
  /** The strategy that applies: `hakari` only where every check passes. */
  featureUnification: FeatureUnification;
  /** Under `hakari`, the configuration and the hack crate. */
  hakari?: HakariSetup;
  /**
   * The warnings of `DES-UNIFICATION` that concern every project of the
   * workspace: the fallback to `workspace-build`, or under `hakari` a
   * non-host triple that graph creation knows and `platforms` does not list.
   */
  warnings: string[];
}

/** The strategy of a workspace that uses `workspace-build` without being checked. */
export const workspaceBuildStrategy: WorkspaceStrategy = {
  featureUnification: "workspace-build",
  warnings: [],
};

/** The configuration files that cargo-hakari reads, in its order (`EVD-HAKARI-UNIFICATION`). */
export const hakariConfigurationFiles = [".config/hakari.toml", ".guppy/hakari.toml"];

/** What the detection of a workspace's strategy reads beyond the workspace. */
export interface StrategyContext {
  /** The discovery of the graph computation, for the crates outside the workspace. */
  discovery: CargoDiscovery;
  /** The environment of graph creation, in which `rustc -vV` names the host. */
  env?: NodeJS.ProcessEnv;
  /**
   * The host's triple in a workspace root, as `rustc -vV` names it there;
   * `undefined` where it names none. A seam for the tests.
   */
  host?: (workspaceRoot: string) => string | undefined;
  /**
   * The non-host triples that graph creation knows for the workspace beyond
   * Cargo's configuration: the `targetTriple` that the metadata tables give
   * a target of a member or one of its configurations.
   */
  tableTriples?: readonly string[];
}

/**
 * The feature-unification strategy of a workspace (`DES-UNIFICATION`, "When
 * the hack crate is enough", "Fallback"): `cargo` and `workspace-build` where
 * the settings choose them, unchecked; otherwise `hakari` where the
 * workspace has a configuration that cargo-hakari reads, which parses and
 * whose `hakari-package` names a member, and passes the four checks, made
 * in their order:
 *
 * 1. no member asks a feature of another member, in any form, and no
 *    member's dev-dependency on itself has features;
 * 2. `platforms` lists the host's triple, as `rustc -vV` names it in the
 *    workspace root;
 * 3. no crate outside the workspace reaches a member through normal or build
 *    dependencies, as far as the reports show, with a redirection to a
 *    member and a crate without a report counting as failing;
 * 4. every key of the configuration is one that leaves nothing to the
 *    selection, with a value that experiments found safe.
 *
 * Where one fails, or where the settings ask for `hakari` and the workspace
 * has no such configuration, the workspace uses `workspace-build` and gets
 * the fallback warning, which names the workspace, the check and the first
 * member, crate, entry or setting that fails it. A workspace without a
 * configuration whose settings choose nothing uses `workspace-build`
 * without a warning. Under `hakari`, a non-host triple that graph creation
 * knows and `platforms` does not list gets a warning of its own; its tasks
 * run one crate per command (`groupSelection` in `groups.ts`).
 *
 * @param setting The `featureUnification` that the workspace table or the
 *   plugin options set; `undefined` for the default.
 */
// @mara implements DES-UNIFICATION
// @mara implements DES-DIAGNOSTICS
export function workspaceStrategy(
  workspace: CargoWorkspace,
  setting: FeatureUnification | undefined,
  context: StrategyContext,
): WorkspaceStrategy {
  if (setting === "cargo" || setting === "workspace-build") {
    return { featureUnification: setting, warnings: [] };
  }
  const root = workspace.report.workspace_root;
  const found = hakariConfigurationFiles.find((file) => existsSync(join(root, file)));
  const describe = describeWorkspaces([workspace.root]);
  if (found === undefined) {
    return setting === "hakari"
      ? fallback(
          workspace,
          "it has no configuration of cargo-hakari",
          `featureUnification is "hakari", but neither .config/hakari.toml nor .guppy/hakari.toml exists in its root. Create one with \`cargo hakari init\`, fill in platforms and run \`cargo hakari generate\` and \`cargo hakari manage-deps\``,
        )
      : workspaceBuildStrategy;
  }
  const repositoryRoot = context.discovery.workspaceRoot;
  const configFile = posixPath(relative(repositoryRoot, join(root, found)));
  let config: Record<string, unknown>;
  try {
    config = parse(readFileSync(join(root, found), "utf8")) as Record<string, unknown>;
  } catch (error) {
    return fallback(
      workspace,
      "its configuration of cargo-hakari cannot be read",
      `${configFile} is no valid TOML (${error instanceof Error ? error.message.split("\n")[0] : String(error)}). Correct it`,
    );
  }
  const members = workspaceMembers(workspace);
  const hackName = config["hakari-package"];
  const hack =
    typeof hackName === "string" ? members.find((member) => member.name === hackName) : undefined;
  if (hack === undefined) {
    return fallback(
      workspace,
      "its configuration of cargo-hakari names no member as the hack crate",
      typeof hackName === "string"
        ? `hakari-package in ${configFile} is "${hackName}", which is no member of ${describe}. Name the hack crate there, or run \`cargo hakari init\``
        : `${configFile} has no hakari-package. Name the hack crate there, as \`cargo hakari init\` writes it`,
    );
  }
  const members1 = memberCheck(members, repositoryRoot);
  if (members1 !== undefined) {
    return fallback(workspace, "a member asks a feature of another member", members1);
  }
  const platforms = config.platforms ?? [];
  if (!Array.isArray(platforms) || !platforms.every((entry) => typeof entry === "string")) {
    return fallback(
      workspace,
      "platforms in its configuration of cargo-hakari is no list of triples",
      `platforms in ${configFile} is ${JSON.stringify(platforms)}. Write it as a list of target triples that holds the host's, such as platforms = ["x86_64-unknown-linux-gnu"], and run \`cargo hakari generate\``,
    );
  }
  const host = (context.host ?? ((folder) => hostTriple(folder, context.env ?? process.env)))(root);
  if (host === undefined) {
    return fallback(
      workspace,
      "the host's triple is unknown",
      `\`rustc -vV\` in the workspace root names no host triple, so @convesoft/nx-rust cannot tell whether platforms in ${configFile} lists it. Make sure that rustc runs there`,
    );
  }
  if (!platforms.includes(host)) {
    return fallback(
      workspace,
      "platforms does not list the host's triple",
      `platforms in ${configFile} ${platforms.length === 0 ? "is empty" : `lists ${platforms.join(", ")}`} and not the host's triple ${host}, so the hack crate does not unify the features of the dependencies that cargo compiles for the host. Add "${host}" to platforms and run \`cargo hakari generate\``,
    );
  }
  const outside = outsideCheck(workspace, context.discovery);
  if (outside !== undefined) {
    return fallback(
      workspace,
      "a crate outside the workspace may reach a member",
      `${outside}, and cargo-hakari leaves such a crate out of the hack crate, so what it asks of the member and of third-party crates would follow the crates that a command selects`,
    );
  }
  const setting4 = configurationCheck(config, configFile);
  if (setting4 !== undefined) {
    return fallback(
      workspace,
      "its configuration of cargo-hakari has a setting that @convesoft/nx-rust does not accept",
      setting4,
    );
  }
  const known = [
    ...(workspace.triples?.kind === "triples" ? workspace.triples.triples : []),
    ...(context.tableTriples ?? []),
  ];
  const unlisted = [...new Set(known)].filter(
    (triple) => triple !== host && !platforms.includes(triple),
  );
  return {
    featureUnification: "hakari",
    hakari: {
      configFile,
      hackManifest: posixPath(relative(repositoryRoot, hack.manifest_path)),
      hackPackage: hack.name,
      platforms: [...platforms],
    },
    warnings: unlisted.map((triple) => unlistedTripleWarning(workspace, triple, configFile)),
  };
}

/**
 * The strategy of each workspace of a graph computation, by the workspace's
 * root folder ({@link workspaceStrategy}), with the `featureUnification`
 * that its settings give and the triples that the metadata tables of its
 * members and workspace project give a target or a configuration.
 */
// @mara implements DES-UNIFICATION
export function workspaceStrategies(
  discovery: CargoDiscovery,
  settings: GraphSettings,
  context: Omit<StrategyContext, "discovery" | "tableTriples"> = {},
): Map<string, WorkspaceStrategy> {
  const strategies = new Map<string, WorkspaceStrategy>();
  for (const workspace of discovery.workspaces) {
    const projects = [
      ...workspace.members.map((pkg) => settings.crate(pkg)),
      ...(workspace.rootManifestHanded &&
      !workspace.report.packages.some(
        (pkg) => pkg.manifest_path === join(workspace.report.workspace_root, "Cargo.toml"),
      )
        ? [settings.workspaceProject(workspace)]
        : []),
    ];
    strategies.set(
      workspace.root,
      workspaceStrategy(workspace, settings.workspace(workspace).featureUnification, {
        ...context,
        discovery,
        tableTriples: tableTriples(projects),
      }),
    );
  }
  return strategies;
}

// The triples that target tables give in their options or configurations.
function tableTriples(projects: readonly ProjectSettings[]): string[] {
  const triples = new Set<string>();
  const add = (options: unknown) => {
    const triple = (options as { targetTriple?: unknown } | null | undefined)?.targetTriple;
    if (
      typeof triple === "string" &&
      triple !== "" &&
      triple !== "host-tuple" &&
      !triple.endsWith(".json")
    ) {
      triples.add(triple);
    }
  };
  for (const project of projects) {
    for (const table of project.targets) {
      add(table.target.options);
      for (const configuration of Object.values(table.target.configurations ?? {})) {
        add(configuration);
      }
    }
  }
  return [...triples].sort();
}

// The fallback of `DES-UNIFICATION`: the workspace uses `workspace-build`,
// with the warning that names the check, what fails it and what would
// change the outcome.
function fallback(workspace: CargoWorkspace, check: string, detail: string): WorkspaceStrategy {
  return {
    featureUnification: "workspace-build",
    warnings: [
      [
        `nx-rust: ${describeWorkspaces([workspace.root])} uses the feature strategy workspace-build in place of hakari, because ${check}: ${detail}.`,
        `Until then its groups build the whole workspace, and a change to Cargo.lock runs every crate of it again.`,
        `If that is how the workspace is meant to build, set featureUnification = "workspace-build" in [workspace.metadata.nx] of ${workspace.rootManifest}, which ends this warning.`,
      ].join(" "),
    ],
  };
}

// The warning for a non-host triple that `platforms` does not list.
function unlistedTripleWarning(
  workspace: CargoWorkspace,
  triple: string,
  configFile: string,
): string {
  return `nx-rust: ${describeWorkspaces([workspace.root])} builds for the triple ${triple}, which platforms in ${configFile} does not list, so the hack crate does not unify the features that cargo compiles for it: the tasks for ${triple} run one crate per cargo command. Add "${triple}" to platforms and run \`cargo hakari generate\` to let them share commands.`;
}

// Every member of the workspace, also those without a project, by the path
// of their manifests.
function workspaceMembers(workspace: CargoWorkspace): CargoPackage[] {
  const ids = new Set(workspace.report.workspace_members);
  return workspace.report.packages
    .filter((pkg) => ids.has(pkg.id))
    .sort((a, b) =>
      a.manifest_path < b.manifest_path ? -1 : a.manifest_path > b.manifest_path ? 1 : 0,
    );
}

/** A dependency as the report gives it, with the fields of features that the check reads. */
type FeatureDependency = CargoDependency & {
  features?: string[];
  uses_default_features?: boolean;
};

/**
 * The first check of `DES-UNIFICATION`: the first member, by the path of
 * its manifest, that asks a feature of another member, with what it asks,
 * or `undefined` where none does. A dependency on another member's folder,
 * of every kind and under every platform table, fails where it has a
 * `features` list, or turns off default features of a member whose
 * `features` table declares `default`; a member's dev-dependency on itself
 * fails where it has a `features` list; and an entry of a member's
 * `features` table fails where it names a feature of another member as
 * `<name>/<feature>` or `<name>?/<feature>`, by the dependency's name or
 * its rename.
 */
// @mara implements DES-UNIFICATION
export function memberCheck(
  members: readonly CargoPackage[],
  repositoryRoot: string,
): string | undefined {
  const byFolder = new Map(
    members.map((member) => [realPath(dirname(member.manifest_path)), member]),
  );
  for (const member of members) {
    const manifest = posixPath(relative(repositoryRoot, member.manifest_path));
    const own = realPath(dirname(member.manifest_path));
    const named = new Map<string, CargoPackage>();
    for (const dependency of member.dependencies as FeatureDependency[]) {
      if (dependency.path === undefined) {
        continue;
      }
      const folder = realPath(dependency.path);
      const target = byFolder.get(folder);
      if (target === undefined) {
        continue;
      }
      const kind = dependency.kind === null ? "dependency" : `${dependency.kind}-dependency`;
      const where = dependency.target ? ` under [target.'${dependency.target}']` : "";
      const features = dependency.features ?? [];
      if (folder === own) {
        if (features.length > 0) {
          return `${manifest} has a dev-dependency on its own crate ${member.name}${where} with the features ${features.join(", ")}, which cargo then turns on for every crate of a command that links it. Remove the features there`;
        }
        continue;
      }
      named.set(dependency.rename ?? dependency.name, target);
      if (features.length > 0) {
        return `${manifest} asks the member ${target.name} for the features ${features.join(", ")} in a ${kind}${where}, so ${target.name} compiles with other features depending on what else a command selects. Turn those features on in ${target.name}'s own default features, or set featureUnification = "workspace-build"`;
      }
      if (dependency.uses_default_features === false && target.features?.default !== undefined) {
        return `${manifest} turns off the default features of the member ${target.name} in a ${kind}${where}, while ${target.name} declares a default feature, so ${target.name} compiles with the feature default or without it depending on what else a command selects. Remove default-features = false there`;
      }
    }
    for (const [feature, entries] of Object.entries(member.features ?? {})) {
      for (const entry of entries) {
        const match = /^([^/?]+)\??\/(.+)$/.exec(entry);
        if (match === null) {
          continue;
        }
        const target = named.get(match[1]);
        if (target !== undefined) {
          return `the feature ${feature} of ${manifest} turns on "${entry}", a feature of the member ${target.name}, so ${target.name} compiles with other features depending on what else a command selects. Turn it on in ${target.name} itself, or set featureUnification = "workspace-build"`;
        }
      }
    }
  }
  return undefined;
}

/**
 * The third check of `DES-UNIFICATION`: the first crate outside the
 * workspace, by the path of its manifest, that reaches a member through
 * normal or build dependencies, directly or through other such crates, or
 * whose dependencies the plugin cannot know, or the first redirection whose
 * crate is a member; `undefined` where none does. The crates outside the
 * workspace are those whose reports graph creation requests anyway: the
 * path crates that the members reach through dependencies of every kind,
 * and behind those through normal and build dependencies, and the crates
 * that the workspace's `[patch]`, `[replace]` and `paths` entries name, with
 * those behind them.
 */
// @mara implements DES-UNIFICATION
export function outsideCheck(
  workspace: CargoWorkspace,
  discovery: CargoDiscovery,
): string | undefined {
  const repositoryRoot = discovery.workspaceRoot;
  const shown = (folder: string) => {
    const inside = posixPath(relative(realPath(repositoryRoot), folder));
    return inside.startsWith("..") ? folder : inside === "" ? "." : inside;
  };
  const members = workspaceMembers(workspace);
  const memberFolders = new Map(
    members.map((member) => [realPath(dirname(member.manifest_path)), member]),
  );
  const reports = new Map<string, CargoPackage>();
  for (const report of [
    ...discovery.workspaces.map((entry) => entry.report),
    ...discovery.pathDependencyReports.map((entry) => entry.report),
  ]) {
    for (const pkg of report.packages) {
      const folder = realPath(dirname(pkg.manifest_path));
      if (!reports.has(folder)) {
        reports.set(folder, pkg);
      }
    }
  }
  const failures: { key: string; message: string }[] = [];
  const queue: string[] = [];
  for (const member of members) {
    for (const dependency of member.dependencies) {
      if (dependency.path !== undefined) {
        const folder = realPath(dependency.path);
        if (!memberFolders.has(folder)) {
          queue.push(folder);
        }
      }
    }
  }
  for (const redirection of workspace.redirections) {
    const candidates =
      redirection.table === "paths"
        ? (workspace.pathsCrates?.get(redirection.folder) ?? [])
        : [redirection.folder];
    for (const candidate of candidates) {
      const folder = realPath(candidate);
      const member = memberFolders.get(folder);
      if (member !== undefined) {
        const entry =
          redirection.table === "paths"
            ? `the paths entry for ${shown(realPath(redirection.folder))}`
            : `the [${redirection.table}${redirection.key === undefined ? "" : `.${redirection.key}`}] entry`;
        failures.push({
          key: member.manifest_path,
          message: `${entry} in ${shown(redirection.file)} redirects to the member ${member.name}, so any registry or git crate that depends on ${member.name} depends on the member, which only Cargo.lock shows`,
        });
      } else {
        queue.push(folder);
      }
    }
  }
  const visited = new Set<string>();
  while (queue.length > 0) {
    const folder = queue.shift() as string;
    if (visited.has(folder) || memberFolders.has(folder)) {
      continue;
    }
    visited.add(folder);
    const pkg = reports.get(folder);
    const manifest = join(folder, "Cargo.toml");
    if (pkg === undefined || existsSync(join(folder, ".cargo-checksum.json"))) {
      failures.push({
        key: manifest,
        message: `@convesoft/nx-rust has no report of the crate in ${shown(folder)} outside the workspace${
          existsSync(join(folder, ".cargo-checksum.json"))
            ? ", whose folder holds .cargo-checksum.json"
            : discovery.unreportedPathDependencies.has(folder)
              ? ", which cargo refused to report"
              : ""
        }, so it cannot tell whether that crate depends on a member`,
      });
      continue;
    }
    for (const dependency of pkg.dependencies) {
      if (dependency.path === undefined || dependency.kind === "dev") {
        continue;
      }
      const target = realPath(dependency.path);
      const member = memberFolders.get(target);
      if (member !== undefined) {
        failures.push({
          key: pkg.manifest_path,
          message: `the crate ${pkg.name} in ${shown(folder)}, outside the workspace, depends on the member ${member.name} through a ${dependency.kind === "build" ? "build" : "normal"} dependency`,
        });
      } else {
        queue.push(target);
      }
    }
  }
  failures.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return failures[0]?.message;
}

/** The values of each key of cargo-hakari's configuration that the fourth check accepts. */
const acceptedValues: Readonly<Record<string, (value: unknown) => boolean>> = {
  "hakari-package": (value) => typeof value === "string",
  platforms: (value) => Array.isArray(value),
  resolver: (value) => value === "1" || value === "2" || value === "3",
  "unify-target-host": (value) =>
    value === "auto" ||
    value === "none" ||
    value === "unify-if-both" ||
    value === "replicate-target-on-host",
  "dep-format-version": (value) => value === "1" || value === "2" || value === "3" || value === "4",
  "exact-versions": (value) => typeof value === "boolean",
  "output-single-feature": (value) => typeof value === "boolean",
  "workspace-hack-line-style": (value) => value === "full" || value === "workspace-dotted",
  "traversal-excludes": isEmpty,
  "final-excludes": isEmpty,
  registries: isEmpty,
};

/**
 * The fourth check of `DES-UNIFICATION`: the first key of the configuration,
 * in the file's order, that is not one of those that the plugin accepts or
 * has a value that it does not accept, with what to change; `undefined`
 * where every key passes.
 */
// @mara implements DES-UNIFICATION
export function configurationCheck(
  config: Record<string, unknown>,
  configFile: string,
): string | undefined {
  for (const [key, value] of Object.entries(config)) {
    const accepts = acceptedValues[key];
    if (accepts === undefined) {
      return `${configFile} sets ${key} = ${JSON.stringify(value)}, a setting that @convesoft/nx-rust does not know to leave nothing to the crates that a command selects. Remove it, or set featureUnification = "workspace-build"`;
    }
    if (!accepts(value)) {
      const why =
        key === "traversal-excludes" || key === "final-excludes"
          ? ", which leaves crates out of the hack crate's unification"
          : key === "workspace-hack-line-style"
            ? ", with which the members' dependency on the hack crate names no path"
            : key === "registries"
              ? ", which @convesoft/nx-rust has not tried"
              : ", a value that @convesoft/nx-rust does not know to leave nothing to the crates that a command selects";
      return `${configFile} sets ${key} = ${JSON.stringify(value)}${why}. Remove it or change it, or set featureUnification = "workspace-build"`;
    }
  }
  return undefined;
}

// Whether a value holds nothing: an empty list, or a table whose values all
// hold nothing.
function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object" && value !== null && !(value instanceof Date)) {
    return Object.values(value).every(isEmpty);
  }
  return false;
}

function posixPath(path: string): string {
  return path.split("\\").join("/");
}
