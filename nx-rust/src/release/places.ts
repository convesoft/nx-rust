import type { Tree } from "@nx/devkit";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CargoDependency } from "../cargo/metadata";
import { satisfies } from "../cargo/version-req";
import { physicalPath, realPath } from "../graph/real-path";
import {
  dependencyEntries,
  DependencyEntry,
  isTable,
  parseManifest,
  parsePackageSpec,
  patchEntries,
  profileSpecs,
  ReleaseError,
  replaceEntries,
  tableName,
  TomlTable,
} from "./manifests";
import { ReleaseCrate, ReleaseRepository, ReleaseWorkspace, repositoryPath } from "./repository";

/** A version requirement that names a crate by path, wherever cargo reads one. */
export interface Requirement {
  /**
   * The file that holds it: relative to the repository root with `/` inside
   * the repository, absolute outside it.
   */
  file: string;
  /** Whether the file lies inside the repository, where the version actions may write it. */
  inRepository: boolean;
  /** The table that holds the entry, as a header would name it, such as `target.'cfg(unix)'.dependencies`. */
  table: string;
  /** The keys from the document root to the requirement's string. */
  versionPath: string[];
  requirement: string;
  /** `patch` for a `[patch.<source>]` entry, which never makes a dependent. */
  kind: "normal" | "dev" | "build" | "workspace" | "patch";
  /** The entry's key. */
  key: string;
  /** The workspace whose manifest or configuration holds it. */
  workspace: ReleaseWorkspace;
  /** The member whose manifest holds it, for the entry of a member's dependency table. */
  holder?: ReleaseCrate;
}

/**
 * Every version requirement on `crate` that names it by the real path of
 * its folder (`DES-RELEASE`, "Requirements"): in the dependency tables of
 * every kind of every member of the repository's workspaces and their
 * `[target.*]` forms, in each root manifest's `[workspace.dependencies]` and
 * `[patch.<source>]` tables, and in the `[patch.<source>]` tables of the
 * Cargo configuration files that cargo reads for each workspace, inside
 * the repository or not. Cargo ignores `[patch]` in a member's manifest, and
 * so do the version actions.
 */
// @mara implements DES-RELEASE
export function requirementsOn(
  tree: Tree,
  repository: ReleaseRepository,
  crate: ReleaseCrate,
): Requirement[] {
  const requirements: Requirement[] = [];
  const add = (
    file: string,
    base: string,
    workspace: ReleaseWorkspace,
    entry: { path: string[]; key: string; entry: TomlTable },
    kind: Requirement["kind"],
    holder?: ReleaseCrate,
  ) => {
    const { path, version } = entry.entry;
    if (typeof path !== "string" || typeof version !== "string") {
      return;
    }
    if (realPath(resolve(base, path)) !== crate.folder) {
      return;
    }
    const inRepository = !isOutside(file);
    requirements.push({
      file,
      inRepository,
      table: tableName({ path: entry.path }),
      versionPath: [...entry.path, "version"],
      requirement: version,
      kind,
      key: entry.key,
      workspace,
      holder,
    });
  };
  const crates = repository.workspaces.flatMap((workspace) => workspace.crates);
  for (const workspace of repository.workspaces) {
    const manifests = [
      workspace.rootManifest,
      ...workspace.crates
        .map((member) => member.manifest)
        .filter((manifest) => !isOutside(manifest)),
    ];
    for (const manifest of new Set(manifests)) {
      const document = readDocument(tree, repository, manifest);
      const base = dirname(join(repository.root, manifest));
      const holder = crates.find((candidate) => candidate.manifest === manifest);
      for (const entry of dependencyEntries(document)) {
        add(
          manifest,
          base,
          workspace,
          entry,
          entry.kind,
          entry.kind === "workspace" ? undefined : holder,
        );
      }
      if (manifest === workspace.rootManifest) {
        for (const entry of patchEntries(document)) {
          add(manifest, base, workspace, entry, "patch");
        }
      }
    }
  }
  for (const [file, workspace] of configFilesOf(repository)) {
    const relativeFile = repositoryPath(repository.root, file);
    const document = readDocument(tree, repository, relativeFile);
    for (const entry of patchEntries(document)) {
      add(
        isOutside(relativeFile) ? file : relativeFile,
        dirname(dirname(file)),
        workspace,
        entry,
        "patch",
      );
    }
  }
  return requirements;
}

/**
 * The reasons why `crate` cannot get `newVersion` that no rewritten
 * requirement removes (`DES-RELEASE`, "Requirements"), each as a line for
 * the message:
 *
 * - a `[replace]` entry that replaces a package with the crate's folder:
 *   cargo takes a replacement only with the version that it replaces, and
 *   fails after the bump, while an entry with the new version would be left
 *   unused (`EVD-CARGO-PATCH-AFTER-BUMP`);
 * - a registry or git requirement that a `[patch]` entry naming the crate
 *   by path redirects to it, which the old version satisfies and the new one
 *   does not: cargo would then take the package from the registry instead,
 *   without an error (`EVD-CARGO-PATCH-AFTER-BUMP`);
 * - a profile's package table whose specification names the crate with a
 *   version that the new one does not match: cargo would only warn, and the
 *   profile's settings would stop applying to the crate.
 */
// @mara implements DES-RELEASE
export function blockers(
  tree: Tree,
  repository: ReleaseRepository,
  crate: ReleaseCrate,
  newVersion: string,
): string[] {
  const lines: string[] = [];
  const names = (spec: { url?: string; name: string } | undefined) =>
    spec !== undefined &&
    spec.name === crate.name &&
    (spec.url === undefined ||
      (/^(path\+)?file:\/\//.test(spec.url) &&
        realPath(fileURLToPath(spec.url.replace(/^path\+/, ""))) === crate.folder));
  const matchedBefore = (version: string) => satisfies(`=${version}`, crate.version) === true;
  const matchesNew = (version: string) => satisfies(`=${version}`, newVersion) === true;

  for (const workspace of repository.workspaces) {
    // The files whose [patch] and [profile] tables cargo applies to the
    // workspace: its root manifest and the configuration files it reads.
    const files = [
      {
        file: workspace.rootManifest,
        base: dirname(join(repository.root, workspace.rootManifest)),
      },
      ...workspace.configFiles.map((file) => ({
        file: repositoryPath(repository.root, file),
        base: dirname(dirname(file)),
      })),
    ];
    const root = readDocument(tree, repository, workspace.rootManifest);
    for (const { spec, entry } of replaceEntries(root)) {
      const parsed = parsePackageSpec(spec);
      if (
        typeof entry.path === "string" &&
        realPath(resolve(repository.root, dirname(workspace.rootManifest), entry.path)) ===
          crate.folder &&
        (parsed?.version === undefined || !matchesNew(parsed.version))
      ) {
        lines.push(
          `- [replace] "${spec}" in ${workspace.rootManifest} replaces a package with the folder of ${crate.name}, and cargo takes a replacement only with the version that it replaces, which ${newVersion} is not: write it as a [patch] entry, which nx release version keeps up to date, or leave ${crate.name} out of the release`,
        );
      }
    }
    for (const { file, base } of files) {
      for (const patch of patchEntries(readDocument(tree, repository, file))) {
        const path = patch.entry.path;
        if (typeof path !== "string" || realPath(resolve(base, path)) !== crate.folder) {
          continue;
        }
        const patched = typeof patch.entry.package === "string" ? patch.entry.package : patch.key;
        for (const member of workspace.crates) {
          for (const dependency of member.dependencies) {
            if (
              dependency.source !== null &&
              dependency.path === undefined &&
              dependency.name === crate.name &&
              patched === crate.name &&
              patchApplies(tree, repository, workspace, member, patch.source, dependency) &&
              satisfies(dependency.req, crate.version) === true &&
              satisfies(dependency.req, newVersion) !== true
            ) {
              lines.push(
                `- the requirement "${dependency.req}" of ${member.name} on ${crate.name} from ${patch.source}, in ${member.manifest}, which the [patch] entry in ${file} redirects to ${crate.name}'s folder, does not accept ${newVersion}, so cargo would take ${crate.name} from the registry instead: give the dependency a path, which nx release version keeps up to date, or change the requirement so that it accepts ${newVersion}`,
              );
            }
          }
        }
      }
    }
    for (const { file } of files) {
      for (const { profile, spec } of profileSpecs(readDocument(tree, repository, file))) {
        const parsed = parsePackageSpec(spec);
        if (
          names(parsed) &&
          parsed?.version !== undefined &&
          matchedBefore(parsed.version) &&
          !matchesNew(parsed.version)
        ) {
          lines.push(
            `- [profile.${profile}.package."${spec}"] in ${file} names ${crate.name} ${parsed.version}, which ${newVersion} does not match, so the profile's settings would stop applying to it: write the specification without its version, as [profile.${profile}.package.${crate.name}]`,
          );
        }
      }
    }
  }
  return [...new Set(lines)];
}

/** Each configuration file of the repository's workspaces once, with the first workspace that reads it. */
function configFilesOf(repository: ReleaseRepository): Map<string, ReleaseWorkspace> {
  const files = new Map<string, ReleaseWorkspace>();
  for (const workspace of repository.workspaces) {
    for (const file of workspace.configFiles) {
      if (!files.has(file)) {
        files.set(file, workspace);
      }
    }
  }
  return files;
}

// Whether a path relative to the repository root leads outside it.
function isOutside(path: string): boolean {
  return path === ".." || path.startsWith("../") || path.startsWith("/");
}

/**
 * A manifest or configuration file as the run sees it: through the run's
 * tree inside the repository ({@link readTreeText}), from disk outside it.
 *
 * @param file Relative to the repository root, or absolute outside it.
 * @throws {ReleaseError} When the file does not exist or cannot be read,
 *   saying which.
 */
export function readDocument(tree: Tree, repository: ReleaseRepository, file: string): TomlTable {
  if (!isOutside(file)) {
    return parseManifest(readTreeText(tree, file), file);
  }
  let text: string;
  try {
    text = readFileSync(file.startsWith("/") ? file : join(repository.root, file), "utf8");
  } catch (error) {
    throw readFailure(file, error);
  }
  return parseManifest(text, file);
}

/**
 * The path by which the run reads and writes a file inside the repository
 * in Nx's tree: where the file lies once symbolic links are followed,
 * relative to the real path of the repository root, with `/`. Nx stages the
 * paths that its tree changed, and git keeps a link apart from the file it
 * leads to, so a write through the path of a link would change the file
 * without putting it into the commit (`DES-RELEASE`, "Writes"). A file that
 * lies outside the repository, which the run does not write, keeps its path.
 *
 * @param file Relative to the repository root.
 */
export function treePath(root: string, file: string): string {
  if (isOutside(file)) {
    return file;
  }
  const real = relative(realPath(root), physicalPath(join(root, file)));
  return real === "" || real === ".." || real.startsWith(`..${sep}`) || isAbsolute(real)
    ? file
    : real.split(sep).join("/");
}

/**
 * The text of a file inside the repository, as the run's tree holds it at
 * the file's {@link treePath}.
 *
 * @param file Relative to the repository root.
 * @throws {ReleaseError} When the file does not exist or cannot be read,
 *   saying which: Nx's tree answers `null` for every file that it cannot
 *   read, so the file is read from disk once more to tell.
 */
export function readTreeText(tree: Tree, file: string): string {
  const path = treePath(tree.root, file);
  const text = tree.read(path, "utf-8");
  if (text !== null) {
    return text;
  }
  try {
    readFileSync(join(tree.root, path));
  } catch (error) {
    throw readFailure(file, error);
  }
  throw new ReleaseError(
    `nx release version cannot read ${file} through Nx's tree, although the file can be read. Run nx reset and the command again.`,
  );
}

/**
 * Whether a failure to read a file says that the file does not exist. Every
 * other failure, such as a missing permission, says nothing about whether
 * it exists.
 */
export function isAbsence(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

// The error for a file that the run cannot read: that it does not exist only
// where reading it says so, and otherwise why it cannot be read.
function readFailure(file: string, error: unknown): ReleaseError {
  return isAbsence(error)
    ? new ReleaseError(
        `${file} does not exist, so nx release version cannot read it. Run nx reset and the command again.`,
      )
    : new ReleaseError(
        `nx release version cannot read ${file}: ${errorMessage(error)}. Make it readable and run the command again.`,
      );
}

/** The message of an error, also of one from another realm, as Node's own errors are under Jest. */
export function errorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : String(error);
}

/** An entry of a member's dependency tables, with what it names and writes, its own or inherited. */
export interface MemberEntry extends DependencyEntry {
  /** The real path of the folder it names, its own or that of the `[workspace.dependencies]` entry it inherits. */
  folder?: string;
  /** Its version requirement, its own or that of the entry it inherits. */
  requirement?: string;
  /** The name of the registry it asks, its own `registry` or that of the entry it inherits. */
  registry?: string;
}

/**
 * The entries of a member's dependency tables, each with the folder that it
 * names, the requirement that it writes and the registry that it names, in
 * itself or in the `[workspace.dependencies]` entry of the same key that it
 * inherits.
 */
export function memberEntries(
  tree: Tree,
  repository: ReleaseRepository,
  crate: ReleaseCrate,
): MemberEntry[] {
  const rootManifest = crate.workspace.rootManifest;
  const inherited = new Map(
    dependencyEntries(readDocument(tree, repository, rootManifest))
      .filter((entry) => entry.kind === "workspace")
      .map((entry) => [entry.key, entry]),
  );
  return dependencyEntries(readDocument(tree, repository, crate.manifest))
    .filter((entry) => entry.kind !== "workspace")
    .map((entry) => {
      const [source, manifest] =
        entry.entry.workspace === true
          ? [inherited.get(entry.key), rootManifest]
          : [entry, crate.manifest];
      const { path, version, registry } = source?.entry ?? {};
      return {
        ...entry,
        folder:
          typeof path === "string"
            ? realPath(resolve(repository.root, dirname(manifest), path))
            : undefined,
        requirement: typeof version === "string" ? version : undefined,
        registry: typeof registry === "string" ? registry : undefined,
      };
    });
}

/**
 * Where a file that the run would write lies, links followed, where that is
 * outside the repository: the real path of the file, or of the deepest
 * folder of it that exists, compared with the real path of the repository
 * root (`DES-RELEASE`, "Writes"). `undefined` inside.
 *
 * @param file Relative to the repository root.
 */
export function outsideDestination(root: string, file: string): string | undefined {
  const destination = realPath(join(root, file));
  const inside = relative(realPath(root), destination);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))
    ? undefined
    : destination;
}

/**
 * A source as cargo compares a `[patch]` key with it: `crates-io` for
 * crates.io, otherwise the URL of the git repository or of the registry's
 * index without query, fragment, trailing slashes and `.git`, keeping
 * `sparse+` for a sparse index, because a plain URL does not name a sparse
 * registry for cargo (`EVD-CARGO-PATCH-AFTER-BUMP`).
 */
export function sourceKey(source: string): string {
  const kind = /^(registry|sparse|git)\+/.exec(source);
  let url = kind === null ? source : source.slice(kind[0].length);
  const end = url.search(/[?#]/);
  url = (end === -1 ? url : url.slice(0, end)).replace(/\/+$/, "").replace(/\.git$/, "");
  const key = `${kind?.[1] === "sparse" ? "sparse+" : ""}${url}`;
  return key === "https://github.com/rust-lang/crates.io-index" ||
    key === "sparse+https://index.crates.io"
    ? "crates-io"
    : key;
}

// Whether the `[patch.<source>]` table of `source` applies to a registry or
// git dependency of `member`: `crates-io`, a URL, or a registry's name, which
// the Cargo configuration of the workspace or `CARGO_REGISTRIES_<NAME>_INDEX`
// maps to its index. A registry's name also applies where the dependency's
// entry names that registry.
function patchApplies(
  tree: Tree,
  repository: ReleaseRepository,
  workspace: ReleaseWorkspace,
  member: ReleaseCrate,
  source: string,
  dependency: CargoDependency,
): boolean {
  const dependencySource = sourceKey(dependency.source ?? "");
  if (source === "crates-io" || source.includes("://")) {
    return sourceKey(source) === dependencySource;
  }
  const index = registryIndex(tree, repository, workspace, source);
  if (index !== undefined && sourceKey(index) === dependencySource) {
    return true;
  }
  const kind = dependency.kind ?? "normal";
  const key = dependency.rename ?? dependency.name;
  return memberEntries(tree, repository, member).some(
    (entry) =>
      entry.kind === kind &&
      entry.key === key &&
      entry.folder === undefined &&
      entry.registry === source,
  );
}

// The index of the registry `name`, as cargo finds it for the workspace:
// `CARGO_REGISTRIES_<NAME>_INDEX`, or `[registries.<name>].index` in the
// first of the workspace's configuration files that sets it.
function registryIndex(
  tree: Tree,
  repository: ReleaseRepository,
  workspace: ReleaseWorkspace,
  name: string,
): string | undefined {
  const variable = process.env[`CARGO_REGISTRIES_${name.toUpperCase().replace(/-/g, "_")}_INDEX`];
  if (variable) {
    return variable;
  }
  for (const file of workspace.configFiles) {
    const document = readDocument(tree, repository, repositoryPath(repository.root, file));
    const registry = isTable(document.registries) ? document.registries[name] : undefined;
    if (isTable(registry) && typeof registry.index === "string") {
      return registry.index;
    }
  }
  return undefined;
}
