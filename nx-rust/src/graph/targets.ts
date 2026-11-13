import type { TargetConfiguration } from "@nx/devkit";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { PackageVersion } from "../cargo/lockfile";
import type { CargoPackage } from "../cargo/metadata";
import { cargoDenyConfigurationFiles } from "../tools/optional-tools";
import { CacheContext, CacheOptions, configureCaching } from "./caching";
import type { CargoWorkspace } from "./discovery";
import { memberManifests } from "./inputs";
import type { TargetNames } from "./options";

/**
 * The plugin's cargo executor, which runs every inferred target but `run`
 * and `lockfile`. It has a batch implementation (`DES-BATCH`).
 */
export const cargoExecutor = "@convesoft/nx-rust:cargo";

/**
 * The executor of the lockfile task, which has no batch implementation, so
 * that the task never joins a batch (`DES-LOCKFILE-HASHING`).
 */
export const lockfileExecutor = "@convesoft/nx-rust:lockfile";

/**
 * The executor of `run`, which has no batch implementation: `cargo run`
 * takes one package only (`DES-TARGET-COMMANDS`).
 */
export const runExecutor = "@convesoft/nx-rust:run";

/**
 * The inferred targets by their default names, in the order of the table in
 * `DES-TARGETS`: first those of a crate, then those of the workspace project.
 * They are also the keys that `targetNames` accepts (`readTargetNames` in
 * `options.ts`). The artifact targets and the release targets are not
 * inferred yet; each joins the list when it is.
 */
export const inferredTargetNames = [
  "build",
  "check",
  "lint",
  "test",
  "fmt-check",
  "fmt",
  "bench",
  "run",
  "doc",
  "lockfile",
  "audit",
  "deny",
  "update",
] as const;

/** The default name of an inferred target, which identifies it whatever `targetNames` calls it. */
export type InferredTargetName = (typeof inferredTargetNames)[number];

/** The key of {@link TargetCargoMetadata} in the metadata of each inferred target. */
export const targetCargoMetadataKey = "cargo";

/**
 * What each inferred target carries in its Nx metadata, under
 * {@link targetCargoMetadataKey}. The executor reads it to know which
 * command a task runs, because `targetNames` can give the target another
 * name. Nx keeps a target's metadata out of task hashes
 * (`EVD-NX-OPTION-VALIDATION`), but the name of the task's target and
 * `nx.json`, where `targetNames` is set, are part of each hash, so a change
 * of what a target runs always changes the key.
 */
export interface TargetCargoMetadata {
  /** The target's default name in `DES-TARGETS`. */
  target: InferredTargetName;
  /**
   * The `locked` option of the plugin entry that created the project, which
   * `NX_RUST_LOCKED` replaces for one run (`DES-INVOCATION`). It is no input
   * of a task's key; `nx.json`, where it is set, is part of every key anyway.
   */
  locked: boolean;
  /**
   * Why the plugin leaves the target uncached in this project
   * (`configureCaching` in `caching.ts`); absent where it caches it. The
   * executor fails a task whose configuration caches the target anyway.
   */
  uncached?: string;
  /**
   * On `build` and `doc`, the target triples that Cargo's configuration and
   * the graph's environment pick, whose folders the outputs name where a run
   * names no triple; absent where they pick none. The executor fails a
   * cached task whose environment and configuration pick other triples when
   * it starts (`DES-OUTPUTS`).
   */
  triples?: string[];
  /**
   * On `build` and `doc`, what picks a triple whose folder the plugin cannot
   * name, and why. The executor fails a cached task of the target whose run
   * names no triple (`DES-OUTPUTS`).
   */
  tripleProblem?: string;
  /**
   * On the lockfile task: the workspace's members, whose digests it writes
   * (`DES-LOCKFILE-HASHING`).
   */
  members?: PackageVersion[];
  /**
   * On a cached target that depends on the lockfile task: the members whose
   * digests its key holds, the crate itself or, on `doc`, every member. The
   * executor computes them again after cargo's call (`DES-LOCKFILE-HASHING`,
   * "Post-check").
   */
  digests?: PackageVersion[];
}

/**
 * The inferred targets that the plugin caches, as `DES-TARGETS` and
 * `DES-OUTPUTS` give them, with the inputs of `DES-INPUTS` and the outputs
 * of `DES-OUTPUTS` (`configureCaching` in `caching.ts`). `build` and `doc`
 * are left uncached for a project where the plugin cannot name or store
 * their artifacts, with the reason in `metadata.cargo.uncached`. Graph
 * creation fails for a `targetDefaults` entry in `nx.json` that turns caching
 * on for a target that the plugin leaves uncached in a project
 * (`DES-TARGET-DEFAULT-GUARD`, which compares with the `cache` that
 * {@link inferTargets} sets), and the executor fails a task of such a target
 * that its configuration caches after all, so that Nx stores no result for it.
 */
export const cachedTargets: ReadonlySet<InferredTargetName> = new Set<InferredTargetName>([
  "build",
  "check",
  "lint",
  "test",
  "fmt-check",
  "doc",
]);

/** What the inference of a project's targets needs to know about the project. */
export interface TargetSubject {
  /** The project's folder, relative to the repository root: `.` for the root itself. */
  root: string;
  /** The workspace the project belongs to. */
  workspace: CargoWorkspace;
  /** The crate; absent for a workspace project without a crate. */
  pkg?: CargoPackage;
  /** Whether the project hosts the workspace's own targets. */
  isWorkspaceProject: boolean;
}

/**
 * The targets that the plugin infers for a project, by their default names,
 * in the order of {@link inferredTargetNames}.
 *
 * A crate gets `build`, `check`, `lint`, `test`, `fmt-check` and `fmt`, `run`
 * when it has a binary target and `bench` when it has a bench target. The
 * workspace project gets `doc`, `lockfile`, `audit` and `update`, and `deny`
 * where a cargo-deny configuration file is in the workspace root; a root
 * manifest's crate gets both sets. Whether a tool is installed decides
 * nothing.
 *
 * Only the targets in {@link cachedTargets} are cached; their inputs and
 * outputs, the exceptions for the artifact directory, and the dependency of
 * every cached target but `fmt-check` on the lockfile task of its workspace,
 * which is the one task dependency of a crate's target
 * (`REQ-NO-RUST-TASK-DEPS`), come from `configureCaching` in `caching.ts`.
 *
 * @param context What the caching of the graph's projects shares.
 * @param caching What the project's settings change in its caching.
 * @param locked The `locked` option of the plugin entry, which each target
 *   carries in its metadata for the executor ({@link TargetCargoMetadata}).
 */
// @mara implements DES-TARGETS
// @mara implements DES-TARGET-COMMANDS
// @mara implements DES-WORKSPACE-TARGETS
export function inferTargets(
  subject: TargetSubject,
  context: CacheContext,
  locked = false,
  caching?: CacheOptions,
): Map<InferredTargetName, TargetConfiguration> {
  const targets = new Map<InferredTargetName, TargetConfiguration>();
  const { pkg, workspace } = subject;
  const target = (
    inferred: InferredTargetName,
    description: string,
    options: Record<string, unknown> = {},
  ) => inferredTarget(inferred, description, options, locked);
  if (pkg !== undefined) {
    const kinds = new Set(pkg.targets.flatMap((target) => target.kind));
    targets.set("build", target("build", "Builds the crate with cargo build."));
    targets.set(
      "check",
      target("check", "Checks the crate with cargo check.", { allTargets: true }),
    );
    targets.set("lint", target("lint", "Lints the crate with cargo clippy.", { allTargets: true }));
    targets.set("test", target("test", "Runs the tests of the crate."));
    targets.set(
      "fmt-check",
      target("fmt-check", "Checks the formatting of the crate with cargo fmt --check."),
    );
    targets.set("fmt", target("fmt", "Formats the crate with cargo fmt."));
    if (kinds.has("bench")) {
      targets.set("bench", {
        ...target("bench", "Runs the benchmarks of the crate with cargo bench."),
        parallelism: false,
      });
    }
    if (kinds.has("bin")) {
      targets.set("run", {
        ...target("run", "Runs a binary of the crate with cargo run."),
        executor: runExecutor,
        continuous: false,
      });
    }
  }
  if (subject.isWorkspaceProject) {
    const lockfile = "{projectRoot}/Cargo.lock";
    const manifest = "{projectRoot}/Cargo.toml";
    targets.set(
      "doc",
      target("doc", "Documents the members of the Cargo workspace with cargo doc.", {
        noDeps: true,
      }),
    );
    targets.set("lockfile", {
      ...target(
        "lockfile",
        "Lets cargo update --workspace bring Cargo.lock up to date and writes a digest of each member's locked dependencies.",
      ),
      executor: lockfileExecutor,
    });
    targets.set("audit", {
      ...target("audit", "Checks Cargo.lock for security advisories with cargo audit."),
      inputs: [lockfile, manifest, "{projectRoot}/.cargo/audit.toml"],
    });
    if (hasCargoDenyConfiguration(workspace)) {
      targets.set("deny", {
        ...target("deny", "Checks the dependencies of the Cargo workspace with cargo deny check."),
        inputs: [
          lockfile,
          manifest,
          ...cargoDenyConfigurationFiles.map((file) => `{projectRoot}/${file}`),
          ...memberManifests(workspace, context.repositoryRoot),
        ],
      });
    }
    targets.set("update", {
      ...target("update", "Updates Cargo.lock with cargo update."),
      inputs: [lockfile, manifest],
    });
  }
  configureCaching(targets, subject, context, caching);
  return targets;
}

/**
 * Gives each project's inferred targets the names that `targetNames` asks
 * for, a target without an entry keeping its default name.
 *
 * @returns Each project's targets by name, in the order of `projects`.
 * @throws {Error} When two inferred targets of one project would get one
 *   name, naming every such project, its targets and the name.
 */
// @mara implements REQ-TARGET-NAMES
// @mara implements DES-PLUGIN-OPTIONS
export function nameTargets<P extends { name: string; manifest: string }>(
  projects: readonly { project: P; targets: Map<InferredTargetName, TargetConfiguration> }[],
  targetNames: TargetNames,
): Record<string, TargetConfiguration>[] {
  const collisions: string[] = [];
  const named = projects.map(({ project, targets }) => {
    const byName = new Map<string, InferredTargetName[]>();
    for (const inferred of targets.keys()) {
      const name = targetNames[inferred] ?? inferred;
      byName.set(name, [...(byName.get(name) ?? []), inferred]);
    }
    for (const [name, inferred] of byName) {
      if (inferred.length > 1) {
        collisions.push(
          `- the project "${project.name}" (${project.manifest}): ${list(inferred.map((target) => `\`${target}\``))} would ${inferred.length === 2 ? "both" : "all"} be called "${name}"`,
        );
      }
    }
    return Object.fromEntries(
      [...targets].map(([inferred, configuration]) => [
        targetNames[inferred] ?? inferred,
        configuration,
      ]),
    );
  });
  if (collisions.length > 0) {
    throw new Error(
      [
        `"targetNames" in the options of the @convesoft/nx-rust entry in nx.json gives two inferred targets of one project the same name, and a project can have only one target of each name:`,
        ...collisions,
        `Change "targetNames" so that every inferred target keeps a name of its own.`,
      ].join("\n"),
    );
  }
  return named;
}

// A target of the plugin, cached only if it is in cachedTargets.
function inferredTarget(
  inferred: InferredTargetName,
  description: string,
  options: Record<string, unknown>,
  locked: boolean,
): TargetConfiguration {
  const metadata: TargetCargoMetadata = { target: inferred, locked };
  return {
    executor: cargoExecutor,
    options,
    cache: cachedTargets.has(inferred),
    metadata: {
      description,
      technologies: ["cargo"],
      [targetCargoMetadataKey]: metadata,
    },
  };
}

// Whether the workspace root holds one of cargo-deny's configuration files.
function hasCargoDenyConfiguration(workspace: CargoWorkspace): boolean {
  return cargoDenyConfigurationFiles.some((file) => {
    try {
      return statSync(join(workspace.report.workspace_root, file)).isFile();
    } catch {
      return false;
    }
  });
}

// "`a`, `b` and `c`"
function list(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
