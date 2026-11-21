import { readCachedProjectGraph } from "@nx/devkit";
import type { ProjectGraph, ProjectGraphDependency, Tree } from "@nx/devkit";
import { join } from "node:path";
import { VersionActions } from "nx/release";
import {
  crateVersion,
  packageVersionPath,
  parseManifest,
  ReleaseError,
  tableName,
  workspaceVersion,
  workspaceVersionPath,
} from "./manifests";
import {
  blockers,
  memberEntries,
  outsideDestination,
  readDocument,
  readTreeText,
  type Requirement,
  requirementsOn,
  treePath,
} from "./places";
import {
  cargoMetadataOf,
  type ReleaseCrate,
  releaseRepository,
  type ReleaseRepository,
} from "./repository";
import { requirementChange } from "./requirements";
import type { StringEdit } from "./toml-edit";
import {
  checkDependentsVersioned,
  checkVersionedTogether,
  editedFile,
  graphBumpLines,
  inheritingCrates,
  isOn,
  type Rewrite,
  sentenceList,
  writable,
  writesRequirement,
} from "./version-checks";
import { type LockfileRun, staleLockfiles, updateVersionedLockfiles } from "./version-lockfiles";

/**
 * The version actions of every project configured for release, by project
 * name: Nx constructs them for each such project before it versions any.
 */
const configured = new Map<string, CargoVersionActions>();

/** What the version actions record about one `nx release version`. */
interface Run extends LockfileRun {
  /** The projects of the run, which are those that Nx validates. */
  projects: Set<string>;
  /** The projects whose new version the run writes. */
  versioned: Set<string>;
  /** The requirements of normal and build dependencies that the run rewrites. */
  rewrites: Rewrite[];
  /** The projects whose bump through the project graph the output has named. */
  named: Set<string>;
  /** Whether the dependents have been checked, once every version is decided. */
  dependentsChecked: boolean;
}

/** The runs, by the tree that Nx hands to each method that writes. */
const runs = new WeakMap<Tree, Run>();

/**
 * The latest run, for `calculateNewVersion`, which gets no tree. Nx calls
 * `validate` with the run's tree before it works out any version.
 */
let latestRun: Run | undefined;

/**
 * The project graph of the run, which Nx hands to `readDependencies` before
 * it versions anything; the methods that get none use it.
 */
let runGraph: ProjectGraph | undefined;

/** The repository of the run, once a method has read it. */
let runRepository: ReleaseRepository | undefined;

/**
 * The version actions that `nx release version` runs for each crate's
 * project (`DES-RELEASE`): Nx works out the bumps, walks the dependents,
 * writes the changelogs and makes the commit and tag, and these actions
 * read and write the crates' `Cargo.toml`.
 *
 * - The current version comes from the crate's manifest, following
 *   `[workspace.package].version` where the crate inherits it; `registry`
 *   is not supported, and a crate without a version fails when Nx loads
 *   the actions, because Nx would replace a later error with its own.
 * - The dependencies, which decide the dependents and the order of the
 *   release groups, come from the workspaces' `cargo metadata --no-deps`
 *   reports: normal and build dependencies that name a crate with a project
 *   by path and carry a version requirement (`ADR-RELEASE-DEPENDENTS`).
 * - A new version is written once per crate, an inherited one once to
 *   `[workspace.package]`, and every requirement on the crate that names it
 *   by path is updated at the same time, as {@link requirementChange} says,
 *   wherever cargo reads one ({@link requirementsOn}). Only the version
 *   strings change (`replaceStrings`).
 * - Every check runs before Nx writes any file: Nx keeps the changes in its
 *   tree until every release group is processed, and writes nothing when an
 *   action throws (`EVD-NX-24-VERSION-ACTIONS`).
 * - Where Nx bumps a fixed group through an edge of the project graph, the
 *   output names the edge; where a crate of the release would get a new
 *   requirement on a bumped crate without a bump of its own, the run stops
 *   (nxr-5a9w1y).
 */
// @mara implements DES-RELEASE
export default class CargoVersionActions extends VersionActions {
  validManifestFilenames = ["Cargo.toml"];
  /**
   * Nx's formatter leaves alone the manifests in {@link manifestsToUpdate},
   * which lists every file that the actions change.
   */
  excludeManifestsFromFormatting = true;

  /** Lines that `calculateNewVersion` found for the next `updateProjectVersion` to print. */
  private pendingLines: string[] = [];

  constructor(...args: ConstructorParameters<typeof VersionActions>) {
    super(...args);
    configured.set(this.projectGraphNode.name, this);
  }

  /**
   * Checks what Nx would otherwise report in its own words or not at all,
   * for every project configured for release: that the project is a crate,
   * that its manifest gives it a version, and that its current version is
   * not to come from a registry.
   */
  async init(tree: Tree): Promise<void> {
    const crate = this.crate();
    if (this.finalConfigForProject.currentVersionResolver === "registry") {
      throw new ReleaseError(
        `The project "${this.projectGraphNode.name}" reads its current version from a registry ("currentVersionResolver": "registry"), which nx-rust does not support. Set "currentVersionResolver" to "disk", the default, which reads the version from ${crate.manifest}, or to "git-tag" in the release configuration of nx.json.`,
      );
    }
    this.currentVersion(tree);
    this.manifestsToUpdate = [
      {
        manifestPath: crate.manifest,
        preserveLocalDependencyProtocols:
          this.finalConfigForProject.preserveLocalDependencyProtocols,
      },
    ];
  }

  /**
   * Records the project as one of the run's and checks that the crates that
   * share its inherited version are in its release group, which is fixed.
   */
  async validate(tree: Tree): Promise<void> {
    runOf(tree).projects.add(this.projectGraphNode.name);
    const repository = this.repository(tree);
    const crate = this.releaseCrate(repository);
    if (crateVersion(readDocument(tree, repository, crate.manifest)).kind !== "inherited") {
      return;
    }
    const sharing = inheritingCrates(tree, repository, crate);
    const group = this.releaseGroup;
    const reasons: string[] = [];
    if (group.projectsRelationship !== "fixed") {
      reasons.push(`the release group "${group.name}" is ${group.projectsRelationship}`);
    }
    const byGroup = new Map<string, string[]>();
    for (const other of sharing) {
      const otherGroup = groupOf(other.project);
      if (other.project === undefined) {
        reasons.push(`${other.name} has no Nx project`);
      } else if (otherGroup === undefined) {
        reasons.push(`${other.name} is in no release group`);
      } else {
        byGroup.set(otherGroup, [...(byGroup.get(otherGroup) ?? []), other.name]);
      }
    }
    if (byGroup.size > 1) {
      reasons.push(
        sentenceList(
          [...byGroup].map(
            ([name, crates]) =>
              `${sentenceList(crates)} ${crates.length === 1 ? "is" : "are"} in the release group "${name}"`,
          ),
        ),
      );
    }
    if (reasons.length > 0) {
      throw new ReleaseError(
        `The crates ${sentenceList(sharing.map((other) => other.name))} of the Cargo workspace ${crate.workspace.rootManifest} inherit version.workspace = true, so they share the one version in [workspace.package], and nx release version has to version them together, but ${sentenceList(reasons)}. Put all of them into one release group with "projectsRelationship": "fixed" in nx.json.`,
      );
    }
  }

  async readCurrentVersionFromSourceManifest(
    tree: Tree,
  ): Promise<{ currentVersion: string; manifestPath: string } | null> {
    return this.currentVersion(tree);
  }

  /** nx-rust reads no version from a registry; `init` has failed already where one is asked for. */
  async readCurrentVersionFromRegistry(): Promise<null> {
    return null;
  }

  /**
   * The crates with a project that the crate depends on through a normal or
   * build dependency with a version requirement, matched by the real path
   * of their folders, in any of the repository's workspaces. A requirement
   * of `*` in the report is looked up in the manifest, because cargo gives
   * it also where the entry has no version (`EVD-CARGO-PUBLISH`).
   */
  async readDependencies(
    tree: Tree,
    projectGraph: ProjectGraph,
  ): Promise<ProjectGraphDependency[]> {
    runGraph = projectGraph;
    const repository = this.repository(tree);
    const crate = this.releaseCrate(repository);
    const targets = new Set<string>();
    for (const dependency of crate.dependencies) {
      if (dependency.kind === "dev" || dependency.path === undefined) {
        continue;
      }
      const target = repository.crateAt(dependency.path);
      if (target?.project === undefined || target === crate || targets.has(target.project)) {
        continue;
      }
      if (dependency.req !== "*" || writesRequirement(tree, repository, crate, dependency)) {
        targets.add(target.project);
      }
    }
    return [...targets].map((target) => ({
      source: this.projectGraphNode.name,
      target,
      type: "static",
    }));
  }

  /**
   * The crate's requirement on the crate of `dependencyProjectName`, as its
   * manifest or the `[workspace.dependencies]` entry it inherits writes it,
   * for Nx's record of the run; `null` where it has none of kind normal or
   * build.
   */
  async readCurrentVersionOfDependency(
    tree: Tree,
    projectGraph: ProjectGraph,
    dependencyProjectName: string,
  ): Promise<{ currentVersion: string | null; dependencyCollection: string | null }> {
    runGraph ??= projectGraph;
    const repository = this.repository(tree);
    const crate = this.releaseCrate(repository);
    const target = repository.crateOfProject(dependencyProjectName);
    if (target !== undefined) {
      for (const entry of memberEntries(tree, repository, crate)) {
        if (
          (entry.kind === "normal" || entry.kind === "build") &&
          entry.folder === target.folder &&
          entry.requirement !== undefined
        ) {
          return { currentVersion: entry.requirement, dependencyCollection: tableName(entry) };
        }
      }
    }
    return { currentVersion: null, dependencyCollection: null };
  }

  /**
   * Names the edges through which Nx bumps a fixed group that has no bump of
   * its own (nxr-5a9w1y, part 1), which Nx reports with the reason
   * `DEPENDENCY_ACROSS_GROUPS_WAS_BUMPED` for each project of the group with
   * such an edge; the lines come out with the project's version.
   */
  async calculateNewVersion(
    currentVersion: string | null,
    newVersionInput: string,
    newVersionInputReason: string,
    newVersionInputReasonData: Record<string, unknown>,
    preid: string,
  ): Promise<{ newVersion: string; logText: string }> {
    const result = await super.calculateNewVersion(
      currentVersion,
      newVersionInput,
      newVersionInputReason,
      newVersionInputReasonData,
      preid,
    );
    const run = latestRun;
    if (
      newVersionInputReason === "DEPENDENCY_ACROSS_GROUPS_WAS_BUMPED" &&
      run !== undefined &&
      runGraph !== undefined &&
      !run.named.has(this.projectGraphNode.name)
    ) {
      run.named.add(this.projectGraphNode.name);
      this.pendingLines = graphBumpLines(
        this.projectGraphNode.name,
        this.releaseGroup.name,
        run.versioned,
        runGraph,
        runRepository,
        groupOf,
      );
    }
    return result;
  }

  /**
   * Writes the new version, and updates every requirement on the crate
   * wherever cargo reads one. Nothing is written when a check fails.
   *
   * @returns The lines that Nx prints for the crate.
   */
  async updateProjectVersion(tree: Tree, newVersion: string): Promise<string[]> {
    const run = runOf(tree);
    const repository = this.repository(tree);
    const crate = this.releaseCrate(repository);
    const edits = new Map<string, StringEdit[]>();
    const addEdit = (file: string, edit: StringEdit) =>
      edits.set(file, [...(edits.get(file) ?? []), edit]);
    const lines: string[] = this.pendingLines;
    this.pendingLines = [];
    if (crateVersion(readDocument(tree, repository, crate.manifest)).kind === "inherited") {
      const rootManifest = crate.workspace.rootManifest;
      const sharing = inheritingCrates(tree, repository, crate);
      checkVersionedTogether(run.projects, crate, sharing);
      // Nx may bump a crate twice in a run (EVD-NX-24-VERSION-ACTIONS); the
      // last version stays, as for a version of the crate's own.
      if (workspaceVersion(readDocument(tree, repository, rootManifest)) === newVersion) {
        lines.push(`✍️  New version ${newVersion} is in [workspace.package] in ${rootManifest}`);
      } else {
        addEdit(rootManifest, { path: workspaceVersionPath, value: newVersion });
        lines.push(
          `✍️  New version ${newVersion} written to [workspace.package] in ${rootManifest}`,
        );
      }
    } else {
      addEdit(crate.manifest, { path: packageVersionPath, value: newVersion });
      lines.push(`✍️  New version ${newVersion} written to manifest: ${crate.manifest}`);
    }

    const failures: string[] = [];
    const rewrites: Rewrite[] = [];
    for (const requirement of requirementsOn(tree, repository, crate)) {
      const place = `${requirement.file} [${requirement.table}]`;
      const change = requirementChange(
        requirement.requirement,
        newVersion,
        this.preservesMatchingRequirements(requirement),
      );
      if (change.kind === "rewrite" && !requirement.inRepository) {
        failures.push(
          `- "${requirement.requirement}" in ${place}, which lies outside the repository, where nx release version writes nothing; it has to become "${change.requirement}"`,
        );
      } else if (change.kind === "rewrite") {
        addEdit(requirement.file, { path: requirement.versionPath, value: change.requirement });
        rewrites.push({ requirement, crate, to: change.requirement });
        lines.push(
          `✍️  Updated the requirement on ${crate.name} in ${place} from "${requirement.requirement}" to "${change.requirement}"`,
        );
      } else if (change.kind === "keep-other") {
        lines.push(
          `Kept the requirement "${requirement.requirement}" on ${crate.name} in ${place}: ${newVersion} matches it, and nx-rust rewrites bare, ^, ~ and = requirements only`,
        );
      } else if (change.kind === "fail") {
        failures.push(
          `- "${requirement.requirement}" in ${place}${change.leaves ? "" : `, of which nx-rust cannot tell whether it accepts ${newVersion}`}`,
        );
      }
    }
    const blocking = blockers(tree, repository, crate, newVersion);
    // The lockfiles that cargo will rewrite after Nx has written the files
    // (`afterAllProjectsVersioned`), checked now with them.
    const { lockfiles, unreadable } = staleLockfiles(tree, repository, run, crate, [
      ...edits.keys(),
    ]);
    const files = [...new Set([...edits.keys(), ...lockfiles.keys()])];
    // A file inside the repository by its path can lead outside it through
    // a symbolic link, of its own or of a folder on the way.
    const outside = files.flatMap((file) => {
      const destination = outsideDestination(tree.root, file);
      return destination === undefined ? [] : [`- ${file} leads to ${destination}`];
    });
    const unwritable = files.filter(
      (file) =>
        outsideDestination(tree.root, file) === undefined && !writable(join(tree.root, file)),
    );
    const sections: string[] = [];
    if (failures.length > 0) {
      sections.push(
        [
          `The new version ${newVersion} of ${crate.name} leaves ${failures.length === 1 ? "a requirement" : "requirements"} on it that nx release version cannot rewrite, because only a bare, ^, ~ or = requirement inside the repository can be rewritten without inventing bounds:`,
          ...failures,
          `Change ${failures.length === 1 ? "it" : "each of them"} so that it accepts ${newVersion}, or into a bare, ^, ~ or = requirement, and run nx release version again.`,
        ].join("\n"),
      );
    }
    if (blocking.length > 0) {
      sections.push(
        [
          `nx release version cannot give ${crate.name} the new version ${newVersion} while:`,
          ...blocking,
        ].join("\n"),
      );
    }
    if (outside.length > 0) {
      sections.push(
        [
          `The new version ${newVersion} of ${crate.name} changes files that symbolic links lead outside the repository, where nx release version writes nothing:`,
          ...outside,
          "Change the versions there by hand, or put the files themselves into the repository, and run nx release version again.",
        ].join("\n"),
      );
    }
    if (unreadable.length > 0) {
      const one = unreadable.length === 1;
      sections.push(
        [
          `nx release version cannot read the Cargo.lock of ${one ? "a Cargo workspace" : "Cargo workspaces"}, which it needs to tell whether the new version ${newVersion} of ${crate.name} makes ${one ? "it" : "them"} stale and to bring ${one ? "it" : "them"} up to date:`,
          ...unreadable,
          `Make ${one ? "it" : "them"} readable and valid, and run the command again.`,
        ].join("\n"),
      );
    }
    if (unwritable.length > 0) {
      sections.push(
        `nx release version cannot write ${sentenceList(unwritable)}, which the new version ${newVersion} of ${crate.name} changes: make ${unwritable.length === 1 ? "it" : "them"} writable and run the command again.`,
      );
    }
    if (sections.length > 0) {
      throw new ReleaseError([...sections, "No file has been changed."].join("\n\n"));
    }

    // Written at the path of what a symbolic link leads to, which Nx then
    // stages and its formatter leaves alone.
    for (const [file, fileEdits] of edits) {
      const path = treePath(tree.root, file);
      tree.write(path, editedFile(tree, file, fileEdits));
      if (!this.manifestsToUpdate.some((update) => update.manifestPath === path)) {
        this.manifestsToUpdate.push({
          manifestPath: path,
          preserveLocalDependencyProtocols:
            this.finalConfigForProject.preserveLocalDependencyProtocols,
        });
      }
      run.written.add(path);
    }
    run.versioned.add(this.projectGraphNode.name);
    run.rewrites.push(...rewrites);
    for (const [lockfile, workspace] of lockfiles) {
      run.lockfiles.set(lockfile, workspace);
    }
    return lines;
  }

  /**
   * Nx calls it, for each crate whose version a run writes, only once it has
   * decided every version of the run, before it writes any file. The first
   * call checks that no crate of the release gets a rewritten requirement on
   * a bumped crate without a new version of its own (nxr-5a9w1y, part 2).
   * The requirements themselves were updated with the versions.
   */
  async updateProjectDependencies(tree: Tree): Promise<string[]> {
    const run = runOf(tree);
    if (!run.dependentsChecked) {
      run.dependentsChecked = true;
      checkDependentsVersioned(tree, this.repository(tree), run.rewrites, run.versioned, groupOf);
    }
    return [];
  }

  // What the plugin recorded in the project's metadata about its crate.
  private crate(): { manifest: string; workspaceManifest: string; packageName: string } {
    const cargo = cargoMetadataOf(this.projectGraphNode.data.metadata);
    if (cargo?.packageName === undefined) {
      throw new ReleaseError(
        `The project "${this.projectGraphNode.name}" uses nx-rust's version actions, but it is no crate: ${
          cargo === undefined
            ? `nx-rust created no crate project in ${this.projectGraphNode.data.root}`
            : `it is the workspace project of ${cargo.manifest}, which has no [package] table and so no version`
        }. Leave it out of the release groups in nx.json.`,
      );
    }
    return {
      manifest: cargo.manifest,
      workspaceManifest: cargo.workspaceManifest,
      packageName: cargo.packageName,
    };
  }

  // The current version and the manifest that holds it.
  private currentVersion(tree: Tree): { currentVersion: string; manifestPath: string } {
    const crate = this.crate();
    const read = (path: string) => readTreeText(tree, path);
    const version = crateVersion(parseManifest(read(crate.manifest), crate.manifest));
    if (version.kind === "own") {
      return { currentVersion: version.version, manifestPath: crate.manifest };
    }
    if (version.kind === "missing") {
      throw new ReleaseError(
        `The crate ${crate.packageName} has no version in ${crate.manifest}, so nx release version cannot version it; cargo takes it as 0.0.0. Give its [package] table a version, such as version = "0.1.0", or leave the project "${this.projectGraphNode.name}" out of the release groups in nx.json.`,
      );
    }
    const inherited = workspaceVersion(
      parseManifest(read(crate.workspaceManifest), crate.workspaceManifest),
    );
    if (inherited === undefined) {
      throw new ReleaseError(
        `The crate ${crate.packageName} inherits its version from [workspace.package] in ${crate.workspaceManifest}, which sets none, so nx release version cannot version it. Set version in [workspace.package] of ${crate.workspaceManifest}, or leave the project "${this.projectGraphNode.name}" out of the release groups in nx.json.`,
      );
    }
    return { currentVersion: inherited, manifestPath: crate.workspaceManifest };
  }

  private repository(tree: Tree): ReleaseRepository {
    runGraph ??= readCachedProjectGraph();
    runRepository = releaseRepository(tree.root, runGraph);
    return runRepository;
  }

  private releaseCrate(repository: ReleaseRepository): ReleaseCrate {
    const crate = repository.crateOfProject(this.projectGraphNode.name);
    if (crate === undefined) {
      throw new ReleaseError(
        `cargo metadata reports no crate for the project "${this.projectGraphNode.name}" (${this.crate().manifest}), so the project graph is out of date: run nx reset and the command again.`,
      );
    }
    return crate;
  }

  // Whether Nx's `preserveMatchingDependencyRanges` is on for a
  // requirement: that of the crate whose manifest holds it where that crate
  // is configured for release, and otherwise, as in
  // `[workspace.dependencies]` and `[patch]`, that of the crate whose
  // version changes.
  private preservesMatchingRequirements(requirement: Requirement): boolean {
    const holder = requirement.holder?.project;
    const setting =
      holder === undefined
        ? undefined
        : configured.get(holder)?.finalConfigForProject.preserveMatchingDependencyRanges;
    return isOn(setting ?? this.finalConfigForProject.preserveMatchingDependencyRanges ?? true);
  }
}

/** The run of `tree`, which becomes the latest. */
function runOf(tree: Tree): Run {
  let run = runs.get(tree);
  if (run === undefined) {
    run = {
      projects: new Set(),
      versioned: new Set(),
      rewrites: [],
      named: new Set(),
      dependentsChecked: false,
      lockfiles: new Map(),
      written: new Set(),
      lockfileStates: new Map(),
    };
    runs.set(tree, run);
  }
  latestRun = run;
  return run;
}

/** The release group of a project configured for release. */
function groupOf(project: string | undefined): string | undefined {
  return project === undefined ? undefined : configured.get(project)?.releaseGroup.name;
}

/**
 * Brings the `Cargo.lock` of each Cargo workspace that the run changed up to
 * date (`DES-RELEASE`, "Lockfile"). Nx calls it once, after it has written
 * the files of the run and before it stages and commits them
 * (`EVD-NX-24-VERSION-ACTIONS`); in a dry run it does nothing, because Nx has
 * written nothing.
 *
 * For each lockfile that `updateProjectVersion` recorded, in the order of
 * their paths, it runs `cargo update --workspace` in the workspace's root
 * folder, with the environment of the run and never with `--locked` or
 * `--offline`, whatever the plugin's `locked` option says, because the
 * lockfile has to change. It goes on after a workspace whose cargo fails,
 * so that the message names every failure, and then throws.
 *
 * @returns The lockfiles that cargo changed and that git does not ignore,
 *   for Nx to stage and commit, each by its {@link treePath}: where it lies
 *   once symbolic links are followed, relative to the repository root.
 * @throws {ReleaseError} When cargo fails in a workspace, or a lockfile
 *   cannot be read, naming the workspace, with cargo's message and the
 *   commands that go back or on.
 */
// @mara implements DES-RELEASE
export async function afterAllProjectsVersioned(
  cwd: string,
  options: { dryRun?: boolean },
): Promise<{ changedFiles: string[]; deletedFiles: string[] }> {
  return updateVersionedLockfiles(latestRun, cwd, options);
}
