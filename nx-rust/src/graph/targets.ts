import type { NamedArtifact } from "./artifact-names";
import type { TargetConfiguration } from "@nx/devkit";
import { statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { PackageVersion } from "../cargo/lockfile";
import type { CargoPackage } from "../cargo/metadata";
import type { BuildRecordSource } from "./build-records";
import { cargoDenyConfigurationFiles } from "../tools/optional-tools";
import { CacheContext, CacheOptions, configureCaching } from "./caching";
import type { CargoWorkspace } from "./discovery";
import { memberManifests } from "./inputs";
import { directoryPattern } from "./lockfile-task";
import { producesNodeAddon } from "./napi";
import type { TargetNames } from "./options";
import type { ArtifactKind, FeatureUnification } from "./settings";
import { hackCrateName, memberNames } from "./unification";
import { defaultJsFlavour, producesWasmPackage, wasmPackageFolder, wasmTriple } from "./wasm";

/**
 * The plugin's cargo executor, which runs every inferred target but `build`
 * and `doc`, `run` and `lockfile`. It has a batch implementation (`DES-BATCH`).
 */
export const cargoExecutor = "@convesoft/nx-rust:cargo";

/**
 * The executor of `build` and `doc`, the targets whose files Nx stores: the
 * cargo executor under a name of its own, with the same implementation,
 * batch implementation and schema, so that Nx batches and stores these
 * tasks apart from the tasks that wait for them (`DES-BATCH`, "Two batch
 * executors"; `ADR-TEST-AFTER-BUILD`).
 */
export const cargoOutputsExecutor = "@convesoft/nx-rust:cargo-outputs";

/**
 * The inferred targets, by their default names, that run
 * {@link cargoOutputsExecutor} in place of {@link cargoExecutor}.
 */
export const outputsTargets: ReadonlySet<InferredTargetName> = new Set([
  "build",
  "napi-build",
  "wasm-build",
  "doc",
]);

/**
 * The executor of the lockfile task and of `hakari-check`, which has no
 * batch implementation, so that neither task ever joins a batch
 * (`DES-LOCKFILE-HASHING`, `DES-UNIFICATION`, "Drift").
 */
export const lockfileExecutor = "@convesoft/nx-rust:lockfile";

/**
 * The executor of `run`, which has no batch implementation: `cargo run`
 * takes one package only (`DES-TARGET-COMMANDS`).
 */
export const runExecutor = "@convesoft/nx-rust:run";

/**
 * The executor of `nx-release-publish`, with a batch implementation of its
 * own that publishes the crates of each Cargo workspace and registry with
 * one `cargo publish` (`DES-RELEASE`, `ADR-BATCHED-PUBLISH`).
 */
export const releasePublishExecutor = "@convesoft/nx-rust:release-publish";

/**
 * The name of the publish target, which Nx release runs under this name
 * only, so that `targetNames` cannot rename it (`DES-RELEASE`, "Publish
 * target"; `DES-PLUGIN-OPTIONS`, "Target names").
 */
export const releasePublishTarget = "nx-release-publish";

/**
 * The inferred targets by their default names, in the order of the table in
 * `DES-TARGETS`: first those of a crate, then those of the workspace project.
 * They are also the keys that `targetNames` accepts (`readTargetNames` in
 * `options.ts`), apart from {@link releasePublishTarget}, which keeps its
 * name.
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
  "napi-build",
  "wasm-build",
  releasePublishTarget,
  "doc",
  "lockfile",
  "hakari-check",
  "audit",
  "deny",
  "update",
] as const;

/** The default name of an inferred target, which identifies it whatever `targetNames` calls it. */
export type InferredTargetName = (typeof inferredTargetNames)[number];

/**
 * The inferred targets that compile, which take the feature and profile
 * options (`DES-PLUGIN-OPTIONS`) and get the configuration for all features
 * ({@link allFeaturesConfiguration}).
 */
export const compilingTargets: readonly InferredTargetName[] = [
  "build",
  "check",
  "lint",
  "test",
  "bench",
  "run",
  "napi-build",
  "wasm-build",
  "doc",
];

/**
 * The configuration that every compiling target of every crate and
 * workspace gets, the feature set of all features, beside the default
 * features of its options (`DES-FEATURE-SETS`): `nx run-many -t test -c
 * all-features`. A target table can lay its own configuration of that name
 * over it.
 */
export const allFeaturesConfiguration = "all-features";

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
   * (`configureCaching` in `caching.ts`, or a target table that sets
   * `cache = false`, `applyTargetTables` in `target-tables.ts`); absent
   * where it caches it. The executor fails a task whose configuration
   * caches the target anyway.
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
   * On `build` and `doc`, the triples that Cargo's configuration alone
   * picked when the graph was created, without `CARGO_BUILD_TARGET`, as
   * `pickText` in `target-triples.ts` writes them; absent where it picked
   * none. The executor tells by it
   * whether a cached task's triples differ because the configuration
   * changed after graph creation or because of the task's environment
   * (`DES-OUTPUTS`).
   */
  configuredPick?: string;
  /**
   * On `build` and `doc`, the workspace's artifact directory whose folders
   * the outputs name, relative to the repository's real path; absent where
   * it lies outside the repository. The executor fails a cached task for
   * which cargo reports another directory when it starts (`DES-OUTPUTS`).
   */
  artifactDirectory?: string;
  /**
   * On `build` and `doc`, the variables of graph creation's environment that
   * move the artifact directory, `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`
   * and `CARGO_HOME`, with their values; absent where none is set. The
   * executor tells by them whether a cached task's artifact directory
   * differs because Cargo's configuration changed after graph creation or
   * because of the task's environment (`DES-OUTPUTS`).
   */
  directoryVariables?: Record<string, string>;
  /**
   * On the lockfile task: the workspace's members, whose digests it writes
   * (`DES-LOCKFILE-HASHING`).
   */
  members?: PackageVersion[];
  /**
   * On a cached target that depends on the lockfile task: the crate's own
   * member, whose digest its key holds, or nothing for a workspace project
   * without a crate. The executor computes the digests again after cargo's
   * call, the crate's own first (`DES-LOCKFILE-HASHING`, "Post-check").
   */
  digests?: PackageVersion[];
  /**
   * On such a target whose key holds the digests of every member of its
   * workspace (`holdsEveryDigest` in `inputs.ts`): the executor compares
   * those of the other members as well, which it takes from the
   * {@link TargetCargoMetadata.members} of the lockfile task that the task
   * depends on. Naming them once per workspace, on the lockfile task, keeps
   * the graph from carrying every member on every target.
   */
  everyDigest?: boolean;
  /**
   * On a crate's `build`: what the executor names the dependency files of
   * the crate's library and binaries from, which it compares with the
   * task's inputs after cargo's call (`DES-BUILD-INPUT-CHECK`).
   */
  records?: BuildRecordSource;
  /**
   * On a crate's `test`: `true` where `cargo test` replaces the executables
   * that the crate's `build` declares ({@link testReplacesExecutables}), so
   * that the target depends on that `build` (`DES-TARGETS`).
   */
  waitsForBuild?: boolean;
  /**
   * On a crate's `test`: the roots, relative to the repository root, of the
   * crates whose `build` the target depends on because the test's cargo
   * commands replace the executables that it declares ({@link testBuilds}),
   * the crate's own among them where it has such executables. The executor
   * fails a task whose run holds one of those `build` tasks without an order
   * between the two (`DES-TARGETS`, "Guard").
   */
  waitsForBuilds?: string[];
  /**
   * On a crate's `build`, cached or not: the files that the crate's targets
   * put into the folders of its artifact directory, with whether they are
   * executables and whether `build` declares them (`namedArtifacts` in
   * `artifact-names.ts`). The executor compares them with those of other
   * projects when a cached task starts (`DES-OUTPUTS`, "Files of one name").
   */
  artifactFiles?: NamedArtifact[];
  /**
   * On `napi-build`: the addon's file in the crate's folder, which the
   * outputs name, and the host triple whose name it holds; absent where
   * graph creation could not name it. The executor fails a cached task
   * whose installed napi CLI names the addon otherwise (`DES-NAPI`).
   */
  napiAddon?: string;
  /** On `napi-build`: the host triple that {@link TargetCargoMetadata.napiAddon} comes from. */
  napiHost?: string;
  /**
   * On `napi-build`: the `dtsHeaderFile` of the crate's napi settings,
   * relative to the repository root, where the target's inputs hold it, or
   * absolute outside the repository, where the executor fails the cached
   * task before cargo (`DES-NAPI`).
   */
  napiHeaderFile?: string;
  /**
   * On `napi-build` and `wasm-build`: why the crate's library has the file
   * name of another crate's file, so that cargo builds one file for both;
   * the executor fails the task before cargo runs (`DES-NAPI`, "Library
   * names"; `DES-WASM`).
   */
  sharedLibrary?: string;
  /**
   * On a crate's `test`: `nextest` where the workspace's settings choose the
   * nextest runner (`REQ-TEST-RUNNER`); absent for the `cargo` runner. Like
   * `locked`, it is no input of a key: the setting lies in `nx.json` or in
   * the workspace's root `Cargo.toml`, both of which every key of the
   * crate's `test` holds, and the nextest runner gives the target inputs of
   * its own, the variables that start with `NEXTEST_` and the workspace's
   * `.config/nextest.toml` (`DES-INPUTS`).
   */
  testRunner?: "nextest";
  /**
   * On a crate's `test`: `true` where the workspace uses the selection of
   * affected tests (`affectedTests`), so that the executor decides the test
   * mode as the target's mode input does (`DES-TEST-MODE`); absent
   * otherwise. Like `testRunner`, it is no input of a key: the setting lies
   * in a file that every key of the crate's `test` holds, and it gives the
   * target the mode input.
   */
  affectedTests?: true;
}

/**
 * Whether `cargo test` for the crate replaces the executables in the
 * artifact directory that its `build` declares as outputs (`DES-OUTPUTS`),
 * read from the crate's report: the crate has a target of kind `bin`, and a
 * target of kind `test` or `bench` whose `test` flag is on. Cargo builds the
 * crate's binaries for such a target, with what dev-dependencies turn on and
 * with the `test` profile, and replaces the uplifted files even when their
 * units are fresh (`EVD-CARGO-ARTIFACT-WRITERS`). The `required-features` of
 * either target do not count: whether cargo builds them depends on the
 * features of the run, and a crate counted without need only orders two
 * tasks. A flag that the report lacks counts as on. Examples, unit tests,
 * doctests and `cdylib` and `staticlib` files never make cargo replace them.
 */
// @mara implements DES-TARGETS
// @mara implements DES-OUTPUTS
export function testReplacesExecutables(pkg: CargoPackage): boolean {
  return (
    pkg.targets.some((target) => target.kind.includes("bin")) &&
    pkg.targets.some(
      (target) =>
        (target.kind.includes("test") || target.kind.includes("bench")) && target.test !== false,
    )
  );
}

/**
 * The inferred targets that the plugin caches, as `DES-TARGETS` and
 * `DES-OUTPUTS` give them, with the inputs of `DES-INPUTS` and the outputs
 * of `DES-OUTPUTS` (`configureCaching` in `caching.ts`). `build` and `doc`
 * are left uncached for a project where the plugin cannot name or store
 * their artifacts, and `build` and `test` for a crate whose artifacts share
 * a file name with another crate's in its artifact directory
 * (`sharedArtifactNames` in `artifact-names.ts`), with the reason in
 * `metadata.cargo.uncached`. Graph
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
  "napi-build",
  "wasm-build",
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
  /** The project's settings, of which the crate's `artifacts` replace the inference of artifact targets. */
  settings?: { artifacts?: readonly ArtifactKind[] };
}

/**
 * The targets that the plugin infers for a project, by their default names,
 * in the order of {@link inferredTargetNames}.
 *
 * A crate gets `build`, `check`, `lint`, `test`, `fmt-check` and `fmt`, `run`
 * when it has a binary target, `bench` when it has a bench target, and
 * `nx-release-publish` unless its manifest sets `publish = false`, which the
 * report gives as an empty `publish` list, or it is the hack crate that the
 * workspace's cargo-hakari configuration names (`DES-RELEASE`, "Publish
 * target", "Hack crate"), `napi-build` where it produces a Node addon and
 * `wasm-build` where it produces a wasm package, with the JS flavour of
 * `wasm-bindgen`'s own default in its options (`DES-ARTIFACT-STEPS`,
 * `DES-WASM`). The
 * workspace project gets `doc`, `lockfile`, `audit` and `update`, `deny`
 * where a cargo-deny configuration file is in the workspace root, and
 * `hakari-check` where the workspace uses the `hakari` strategy
 * (`DES-UNIFICATION`, "Drift"); a root
 * manifest's crate gets both sets. Whether a tool is installed decides
 * nothing.
 *
 * Only the targets in {@link cachedTargets} are cached; their inputs and
 * outputs, the exceptions for the artifact directory, and the dependency of
 * every cached target but `fmt-check` on the lockfile task of its workspace,
 * the one task dependency of a crate's target on another project
 * (`REQ-NO-RUST-TASK-DEPS`), come from `configureCaching` in `caching.ts`.
 * Where `cargo test` replaces the executables of the crate's `build`
 * ({@link testReplacesExecutables}), `test` also depends on that `build`,
 * cached or not, so that the two never run at the same time (`DES-TARGETS`).
 *
 * @param context What the caching of the graph's projects shares.
 * @param caching What the project's settings change in its caching.
 * @param locked The `locked` option of the plugin entry, which each target
 *   carries in its metadata for the executor ({@link TargetCargoMetadata}).
 * @param targetNames The names that the plugin options give the inferred
 *   targets, under which `test` names the `build` it depends on.
 */
// @mara implements DES-TARGETS
// @mara implements DES-TARGET-COMMANDS
// @mara implements DES-WORKSPACE-TARGETS
export function inferTargets(
  subject: TargetSubject,
  context: CacheContext,
  locked = false,
  caching?: CacheOptions,
  targetNames: TargetNames = {},
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
    if (producesNodeAddon(subject)) {
      targets.set(
        "napi-build",
        target(
          "napi-build",
          "Builds the crate's Node addon for the host with cargo build, and writes the .node file, its JS loader and its type definitions into the crate's folder.",
        ),
      );
    }
    if (producesWasmPackage(subject)) {
      targets.set(
        "wasm-build",
        target(
          "wasm-build",
          `Builds the crate for ${wasmTriple} with cargo build, and writes the wasm package, the .wasm file with its JS glue and type definitions, into the crate's ${wasmPackageFolder} folder with the wasm-bindgen CLI.`,
          { jsFlavour: defaultJsFlavour },
        ),
      );
    }
    if (
      !(Array.isArray(pkg.publish) && pkg.publish.length === 0) &&
      hackCrateName(workspace.report.workspace_root, memberNames(workspace)) !== pkg.name
    ) {
      targets.set(releasePublishTarget, {
        ...target(
          releasePublishTarget,
          "Publishes the crate with cargo publish, with one call for the crates of its Cargo workspace and registry that nx release publish publishes together.",
        ),
        executor: releasePublishExecutor,
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
    if (caching?.settings.featureUnification === "hakari") {
      targets.set("hakari-check", {
        ...target(
          "hakari-check",
          "Checks that the hack crate of cargo-hakari is current, with cargo hakari generate --diff and cargo hakari manage-deps --dry-run.",
        ),
        executor: lockfileExecutor,
      });
    }
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
  const test = targets.get("test");
  const testMetadata = test?.metadata?.[targetCargoMetadataKey] as TargetCargoMetadata | undefined;
  if (testMetadata !== undefined && caching?.settings.testRunner === "nextest") {
    testMetadata.testRunner = "nextest";
  }
  if (testMetadata !== undefined && caching?.settings.affectedTests === true) {
    testMetadata.affectedTests = true;
  }
  const builds =
    pkg === undefined
      ? []
      : testBuilds(
          subject,
          context.repositoryRoot,
          caching?.settings.featureUnification ?? "workspace-build",
        );
  if (pkg !== undefined && test !== undefined && builds.length > 0) {
    const build = targetNames.build ?? "build";
    const own = builds.includes(subject.root);
    const others = builds.filter((root) => root !== subject.root);
    test.dependsOn = [
      ...(test.dependsOn ?? []),
      ...(own ? [{ target: build }] : []),
      ...(others.length > 0 ? [{ projects: others.map(directoryPattern), target: build }] : []),
    ];
    const metadata = test.metadata?.[targetCargoMetadataKey] as TargetCargoMetadata | undefined;
    if (metadata !== undefined) {
      if (own) {
        metadata.waitsForBuild = true;
      }
      metadata.waitsForBuilds = builds;
    }
  }
  return targets;
}

/**
 * The roots, relative to the repository root and sorted, of the crates whose
 * `build` a crate's `test` waits for (`DES-TARGETS`, `ADR-WORKSPACE-TEST-EXECUTABLES`):
 * every member of its workspace that has a project and for which `cargo
 * test` replaces the executables that its `build` declares
 * ({@link testReplacesExecutables}), the crate itself among them where it is
 * one. Under `workspace-build`, every step of a `test` group selects the
 * whole workspace, and such a command replaces those executables of every
 * such member, of no other crate, and no `cdylib` or `staticlib` file, on
 * Cargo 1.91.0 and 1.100.0 (`EVD-CARGO-ARTIFACT-WRITERS`, "Commands that
 * select the whole workspace"); the rule counts a crate whatever the
 * `required-features` of its targets, so that the set is a superset of the
 * crates whose files cargo replaces. Under `hakari` and `cargo`, whose
 * commands select their crates with `-p`, a `cargo test` replaces the
 * executables of the crates it selects only, and a group selects those of
 * its own tasks, each of which waits for its own crate's `build`: the crate
 * itself, where it is one.
 */
// @mara implements DES-TARGETS
export function testBuilds(
  subject: TargetSubject,
  repositoryRoot: string,
  strategy: FeatureUnification = "workspace-build",
): string[] {
  const crates =
    strategy === "workspace-build"
      ? subject.workspace.members
      : subject.pkg === undefined
        ? []
        : [subject.pkg];
  return crates
    .filter(testReplacesExecutables)
    .map((member) => relative(repositoryRoot, dirname(member.manifest_path)) || ".")
    .map((root) => root.split(sep).join("/"))
    .sort();
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
    executor: outputsTargets.has(inferred) ? cargoOutputsExecutor : cargoExecutor,
    options,
    ...(compilingTargets.includes(inferred)
      ? { configurations: { [allFeaturesConfiguration]: { allFeatures: true } } }
      : {}),
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
