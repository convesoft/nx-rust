import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
  changedFiles,
  FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  linesWith,
  testEnvironment,
  withoutColours,
} from "./harness";

// Checks groups 1, 2, 3 and 5 of VER-RELEASE: `nx release version` with the
// plugin's version actions, with the real Nx and cargo, in copies of the
// release-crates fixture that are made git repositories. Versioning reads no
// registry, so no test starts one, and the lockfile step that follows a run
// that writes runs offline here, which the fixture allows because it locks
// path packages only; release-lockfile.spec.ts checks that step against a
// registry (group 4). Every edge of the fixture's graph is implicit, as every
// edge of the plugin is.

/** The variables that give git, also Nx's commits and tags, an identity and no outside configuration. */
function gitVariables(workspace: FixtureWorkspace): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: "Release Test",
    GIT_AUTHOR_EMAIL: "release-test@example.com",
    GIT_COMMITTER_NAME: "Release Test",
    GIT_COMMITTER_EMAIL: "release-test@example.com",
    GIT_CONFIG_GLOBAL: join(workspace.root, "..", "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

/**
 * An empty Cargo home of the copy's own, outside its repository, for the
 * cargo commands of a test: cargo then reads no Cargo configuration of the
 * machine, and a resolving command such as `cargo metadata` does not wait for
 * the package cache lock of the machine's Cargo home, which other cargo
 * processes can hold for minutes. The fixture resolves without a registry.
 */
function emptyCargoHome(workspace: FixtureWorkspace): string {
  const home = join(workspace.root, "..", "cargo-home-empty");
  mkdirSync(home, { recursive: true });
  return home;
}

function git(workspace: FixtureWorkspace, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspace.root,
    env: testEnvironment(gitVariables(workspace)),
    encoding: "utf8",
  });
}

/** A copy of release-crates with `files` applied, committed to a git repository of its own. */
function releaseCopy(files?: FileChanges): FixtureWorkspace {
  const workspace = FixtureWorkspace.create("release-crates", files);
  writeFileSync(join(workspace.root, "..", "gitconfig"), "");
  git(workspace, "init", "--quiet", "--initial-branch=main");
  git(workspace, "add", "--all");
  git(workspace, "commit", "--quiet", "--message", "The fixture");
  return workspace;
}

async function withCopy(
  files: FileChanges | undefined,
  test: (workspace: FixtureWorkspace) => Promise<void>,
): Promise<void> {
  const workspace = releaseCopy(files);
  try {
    await test(workspace);
  } finally {
    workspace.remove();
  }
}

/**
 * Runs `nx release version`, which takes no output style, and returns its
 * output without colours and without the spaces that Nx leaves at the end
 * of lines.
 */
async function releaseVersion(
  workspace: FixtureWorkspace,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ status: number | null; output: string }> {
  const { status, output } = await workspace.nx(["release", "version", ...args], {
    ...gitVariables(workspace),
    CARGO_HOME: emptyCargoHome(workspace),
    // The lockfile step's `cargo update --workspace` reaches no registry.
    CARGO_NET_OFFLINE: "true",
    ...env,
  });
  return { status, output: withoutColours(output).replace(/[^\S\n]+$/gm, "") };
}

/**
 * Every file of the copy that git tracks or does not ignore, with its
 * content, and a symbolic link with where it leads; the fixture's
 * `.gitignore` leaves out `node_modules`, `.nx` and `target`.
 */
function trackedFiles(workspace: FixtureWorkspace): Map<string, string> {
  const files = new Map<string, string>();
  const paths = git(workspace, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0")
    .filter((path) => path !== "");
  for (const path of [...new Set(paths)].sort()) {
    const file = join(workspace.root, path);
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (stat !== undefined) {
      files.set(
        path,
        stat.isSymbolicLink() ? `-> ${readlinkSync(file)}` : readFileSync(file, "utf8"),
      );
    }
  }
  return files;
}

/** The files, the commit, the tags and the state of the index and work tree. */
function repositoryState(workspace: FixtureWorkspace) {
  return {
    files: trackedFiles(workspace),
    head: git(workspace, "rev-parse", "HEAD").trim(),
    tags: git(workspace, "tag", "--list").trim(),
    status: git(workspace, "status", "--porcelain").trim(),
  };
}

/**
 * Checks that exactly the files of `changes` changed since `before`, each into
 * its old content with every pair `[from, to]` replaced, where `from` occurs
 * once in it: so every other byte is as it was. The lockfiles, which cargo
 * updates after the version actions, are left to release-lockfile.spec.ts.
 */
function expectOnly(
  workspace: FixtureWorkspace,
  allBefore: Map<string, string>,
  changes: Record<string, [from: string, to: string][]>,
): void {
  const withoutLockfiles = (files: Map<string, string>) =>
    new Map([...files].filter(([path]) => !path.endsWith("Cargo.lock")));
  const before = withoutLockfiles(allBefore);
  const after = withoutLockfiles(trackedFiles(workspace));
  expect(changedFiles(before, after)).toEqual(Object.keys(changes).sort());
  for (const [path, replacements] of Object.entries(changes)) {
    let expected = before.get(path) ?? "";
    for (const [from, to] of replacements) {
      expect({ path, from, occurrences: expected.split(from).length - 1 }).toEqual({
        path,
        from,
        occurrences: 1,
      });
      expected = expected.replace(from, to);
    }
    expect({ path, content: after.get(path) }).toEqual({ path, content: expected });
  }
}

/**
 * Checks that `lines` are lines of `output`, in this order. Nx writes the
 * title of an error and each line of its body with a write of its own to
 * standard error, and its project logs to standard output, and the harness
 * appends each pipe's data as it arrives, so another write can come between
 * two lines of one message in `output`; a line itself is one write and
 * stays whole.
 */
function expectLinesInOrder(output: string, lines: readonly string[]): void {
  const outputLines = output.split("\n").map((line) => line.replace(/^ NX {3}/, ""));
  let from = 0;
  for (const line of lines) {
    const at = outputLines.indexOf(line, from);
    expect({ line, found: at >= 0 }).toEqual({ line, found: true });
    from = at + 1;
  }
}

/** The replacement of a crate's own version line. */
function packageVersion(name: string, from: string, to: string): [string, string] {
  return [`name = "${name}"\nversion = "${from}"\n`, `name = "${name}"\nversion = "${to}"\n`];
}

/** The `[package].version` of the manifest at `path`. */
function versionIn(workspace: FixtureWorkspace, path: string): unknown {
  const manifest = parse(readFileSync(join(workspace.root, path), "utf8")) as {
    package?: { version?: unknown };
  };
  return manifest.package?.version;
}

/** Changes `nx.json` to hold `release` as the release configuration. */
function releaseConfiguration(release: object): FileChanges {
  return {
    "nx.json": (nxJson) =>
      `${JSON.stringify({ ...JSON.parse(nxJson ?? "{}"), release }, null, 2)}\n`,
  };
}

/** The projects that Nx names on the lines of `output` that contain `text`. */
function projectsOnLinesWith(output: string, text: string): string[] {
  return [...new Set(linesWith(output, text).map((line) => line.trim().split(" ")[0]))].sort();
}

/** Whether cargo resolves the workspace in `folder`, without a registry; its message where not. */
function resolves(
  workspace: FixtureWorkspace,
  folder: string,
  env: Record<string, string> = {},
): string {
  const run = spawnSync("cargo", ["metadata", "--format-version", "1", "--offline"], {
    cwd: join(workspace.root, folder),
    env: testEnvironment({ CARGO_HOME: emptyCargoHome(workspace), ...env }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return run.status === 0 ? "resolves" : run.stderr;
}

/** Changes `[patch.crates-io]` of `rust/Cargo.toml` to `patch`, the lines after its header. */
const withPatch = (patch: string): FileChanges => ({
  "rust/Cargo.toml": (manifest) =>
    (manifest ?? "").replace(/\[patch\.crates-io\][^]*$/, `[patch.crates-io]\n${patch}`),
});

/** Nx's commit and tag after `nx release version`. */
const git_ = { commit: true, tag: true };

/** Only the crates that group 1 versions: core and api in a fixed group, cli by itself. */
const bumpGroups = releaseConfiguration({
  groups: {
    crates: { projects: ["core", "api"], projectsRelationship: "fixed" },
    apps: { projects: ["cli"], projectsRelationship: "independent" },
  },
  version: { git: git_ },
});

// The crates that the fixture bumps as dependents of base: through a normal,
// build, renamed and optional, target-specific and `*` dependency, through
// [workspace.dependencies], with publish = false and from tools/.
const dependentsOfBase = [
  "build-user",
  "inherit-user",
  "normal-user",
  "private",
  "renamed-user",
  "star-user",
  "target-user",
  "xtask",
];

describe("nx release version with the plugin's version actions (VER-RELEASE)", () => {
  describe("bumps", () => {
    it(
      "writes a crate's own version into its [package] and an inherited one once into [workspace.package], read from the manifests",
      () =>
        withCopy(bumpGroups, async (workspace) => {
          const before = trackedFiles(workspace);
          const head = git(workspace, "rev-parse", "HEAD").trim();

          const { status, output } = await releaseVersion(workspace, ["major"]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          expectOnly(workspace, before, {
            "rust/Cargo.toml": [
              ['version = "0.1.0"\nedition = "2024"', 'version = "0.2.0"\nedition = "2024"'],
              ['version = "0.1.0" }\nbase', 'version = "0.2.0" }\nbase'],
            ],
            "rust/crates/cli/Cargo.toml": [
              packageVersion("cli", "0.3.0", "0.4.0"),
              [
                'api = { path = "../api", version = "0.1" }',
                'api = { path = "../api", version = "0.2.0" }',
              ],
            ],
          });
          expect(linesWith(output, "Resolved the current version as")).toEqual([
            "core 📄 Resolved the current version as 0.1.0 from manifest: rust/Cargo.toml",
            "api 📄 Resolved the current version as 0.1.0 from manifest: rust/Cargo.toml",
            "cli 📄 Resolved the current version as 0.3.0 from manifest: rust/crates/cli/Cargo.toml",
          ]);
          expect(linesWith(output, "New version 0.2.0")).toEqual([
            "core ✍️  New version 0.2.0 written to [workspace.package] in rust/Cargo.toml",
            "api ✍️  New version 0.2.0 is in [workspace.package] in rust/Cargo.toml",
          ]);
          // Nx committed and tagged what the version actions wrote.
          expect(git(workspace, "rev-parse", "HEAD~1").trim()).toBe(head);
          expect(
            git(workspace, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort(),
          ).toEqual(["rust/Cargo.lock", "rust/Cargo.toml", "rust/crates/cli/Cargo.toml"]);
          expect(git(workspace, "tag", "--list").trim().split("\n").sort()).toEqual([
            "cli@0.4.0",
            "crates-v0.2.0",
          ]);
          expect(resolves(workspace, "rust")).toBe("resolves");
        }),
      HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes where crates that inherit one version are in different release groups",
      () =>
        withCopy(
          releaseConfiguration({
            groups: {
              first: { projects: ["core"], projectsRelationship: "fixed" },
              second: { projects: ["api", "cli"], projectsRelationship: "fixed" },
            },
            version: { git: git_ },
          }),
          async (workspace) => {
            const before = repositoryState(workspace);

            const { status, output } = await releaseVersion(workspace, ["major"]);

            expect(status).toBe(1);
            expect(output).toContain(
              "The crates api and core of the Cargo workspace rust/Cargo.toml inherit version.workspace = true, so they share the one version in [workspace.package]",
            );
            expect(output).toMatch(/core is in the release group "first"/);
            expect(output).toMatch(/api is in the release group "second"/);
            expect(output).toContain(
              'Put all of them into one release group with "projectsRelationship": "fixed" in nx.json.',
            );
            expect(repositoryState(workspace)).toEqual(before);
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes where a run would version only some of the crates that inherit one version",
      () =>
        withCopy(
          {
            ...releaseConfiguration({
              groups: {
                crates: { projects: ["core", "api"], projectsRelationship: "fixed" },
                others: { projects: ["base"], projectsRelationship: "independent" },
              },
              version: { git: git_ },
            }),
            // core depends on base, and api on nothing, so that Nx adds core
            // to a run of base as its dependent, without api.
            "rust/crates/core/Cargo.toml": (manifest) =>
              `${manifest}\n[dependencies]\nbase = { workspace = true }\n`,
            "rust/crates/api/Cargo.toml": (manifest) =>
              (manifest ?? "").replace(/\n\[dependencies\][^]*$/, "\n"),
          },
          async (workspace) => {
            const before = repositoryState(workspace);

            const asDependent = await releaseVersion(workspace, ["patch", "--projects", "base"]);

            expect(asDependent.status).toBe(1);
            expect(asDependent.output).toContain(
              "nx release version would version core but not api, although they inherit version.workspace = true from rust/Cargo.toml and share one version.",
            );
            expect(repositoryState(workspace)).toEqual(before);

            // Nx itself refuses a part of a fixed group.
            const filtered = await releaseVersion(workspace, ["patch", "--projects", "core"]);

            expect(filtered.status).toBe(1);
            expect(filtered.output).toContain(
              'Cannot filter to a subset of projects within fixed release group "crates". Filtered projects: [core], All projects in group: [core, api].',
            );
            expect(repositoryState(workspace)).toEqual(before);
          },
        ),
      2 * HARNESS_TIMEOUT,
    );

    it(
      "reads the current version from the git tag with the git-tag resolver",
      () =>
        withCopy(
          releaseConfiguration({
            groups: {
              apps: {
                projects: ["cli"],
                projectsRelationship: "independent",
                version: { currentVersionResolver: "git-tag" },
              },
            },
            version: { git: git_ },
          }),
          async (workspace) => {
            git(workspace, "tag", "cli@0.5.0");
            const before = trackedFiles(workspace);

            const { status, output } = await releaseVersion(workspace, ["patch"]);

            expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
            expectOnly(workspace, before, {
              "rust/crates/cli/Cargo.toml": [packageVersion("cli", "0.3.0", "0.5.1")],
            });
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes for a crate in the release without a version, naming its manifest",
      () =>
        withCopy(
          {
            "rust/crates/cli/Cargo.toml": (manifest) =>
              (manifest ?? "").replace('version = "0.3.0"\n', ""),
          },
          async (workspace) => {
            const before = repositoryState(workspace);

            const { status, output } = await releaseVersion(workspace, [
              "patch",
              "--projects",
              "base",
            ]);

            expect(status).toBe(1);
            expect(output).toContain(
              'The crate cli has no version in rust/crates/cli/Cargo.toml, so nx release version cannot version it; cargo takes it as 0.0.0. Give its [package] table a version, such as version = "0.1.0", or leave the project "cli" out of the release groups in nx.json.',
            );
            expect(repositoryState(workspace)).toEqual(before);
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes where the current version is to come from a registry",
      () =>
        withCopy(
          releaseConfiguration({
            projects: ["base"],
            version: { git: git_, currentVersionResolver: "registry" },
          }),
          async (workspace) => {
            const before = repositoryState(workspace);

            const { status, output } = await releaseVersion(workspace, ["patch"]);

            expect(status).toBe(1);
            expect(output).toContain(
              'The project "base" reads its current version from a registry ("currentVersionResolver": "registry"), which nx-rust does not support.',
            );
            expect(repositoryState(workspace)).toEqual(before);
          },
        ),
      HARNESS_TIMEOUT,
    );
  });

  describe("dependents", () => {
    it(
      "bumps the crates that depend on a bumped crate through a normal or build dependency with a version requirement, and no others",
      () =>
        withCopy(undefined, async (workspace) => {
          const graph = await workspace.graph();
          // Every edge is implicit, also those that bring no bump: a
          // dev-dependency, a path dependency without a version, the edge
          // that [patch] gives a member with a registry dependency, the edge
          // through a crate without a project and the workspace project's.
          expect(graph.dependencies.filter((edge) => edge.type !== "implicit")).toEqual([]);
          const intoBase = graph.dependencies
            .filter((edge) => edge.target === "base")
            .map((edge) => edge.source)
            .sort();
          expect(intoBase).toEqual(
            expect.arrayContaining([
              "dev-user",
              "path-user",
              "registry-user",
              "rust",
              "via-hidden",
            ]),
          );
          const before = trackedFiles(workspace);

          const { status, output } = await releaseVersion(workspace, [
            "patch",
            "--projects",
            "base",
          ]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          expect(projectsOnLinesWith(output, "because a dependency was bumped")).toEqual(
            dependentsOfBase,
          );
          for (const crate of [
            "dev-user",
            "path-user",
            "registry-user",
            "via-hidden",
            "unreleased",
          ]) {
            expect({
              crate,
              version: versionIn(workspace, `rust/crates/${crate}/Cargo.toml`),
            }).toEqual({
              crate,
              version: "0.1.0",
            });
          }
          expectOnly(workspace, before, {
            "rust/crates/base/Cargo.toml": [packageVersion("base", "0.1.0", "0.1.1")],
            ...Object.fromEntries(
              dependentsOfBase
                .filter((crate) => crate !== "xtask" && crate !== "target-user")
                .map((crate) => [
                  `rust/crates/${crate}/Cargo.toml`,
                  [packageVersion(crate, "0.1.0", "0.1.1")],
                ]),
            ),
            // The one requirement that 0.1.1 leaves.
            "rust/crates/target-user/Cargo.toml": [
              packageVersion("target-user", "0.1.0", "0.1.1"),
              ['version = "=0.1.0"', 'version = "=0.1.1"'],
            ],
            "tools/Cargo.toml": [packageVersion("xtask", "0.1.0", "0.1.1")],
          });
        }),
      HARNESS_TIMEOUT,
    );
    it(
      "finds the entry of a reported dependency however the header of its target table spells the platform",
      () =>
        withCopy(
          {
            "rust/crates/target-user/Cargo.toml": (manifest) =>
              (manifest ?? "")
                .replace("[target.'cfg(unix)'.dependencies]", "[target.'cfg( unix )'.dependencies]")
                .replace('version = "=0.1.0"', 'version = "*"'),
          },
          async (workspace) => {
            const { status, output } = await releaseVersion(workspace, [
              "patch",
              "--projects",
              "base",
            ]);

            expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
            expect(projectsOnLinesWith(output, "because a dependency was bumped")).toContain(
              "target-user",
            );
            expect(versionIn(workspace, "rust/crates/target-user/Cargo.toml")).toBe("0.1.1");
          },
        ),
      HARNESS_TIMEOUT,
    );
  });

  describe("requirements", () => {
    it(
      "rewrites every requirement on a crate whose new version leaves it, as its operator says, in every manifest of the repository's workspaces",
      () =>
        withCopy(undefined, async (workspace) => {
          const before = trackedFiles(workspace);

          const { status, output } = await releaseVersion(workspace, [
            "0.2.0",
            "--projects",
            "base",
          ]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          const requirement = (from: string, to: string): [string, string] => [
            `version = "${from}" }`,
            `version = "${to}" }`,
          ];
          expectOnly(workspace, before, {
            "rust/Cargo.toml": [
              [
                'base = { path = "crates/base", version = "0.1.0" }',
                'base = { path = "crates/base", version = "0.2.0" }',
              ],
            ],
            "rust/crates/base/Cargo.toml": [packageVersion("base", "0.1.0", "0.2.0")],
            "rust/crates/normal-user/Cargo.toml": [
              packageVersion("normal-user", "0.1.0", "0.1.1"),
              requirement("0.1.0", "0.2.0"),
            ],
            "rust/crates/build-user/Cargo.toml": [
              packageVersion("build-user", "0.1.0", "0.1.1"),
              requirement("^0.1", "^0.2.0"),
            ],
            "rust/crates/renamed-user/Cargo.toml": [
              packageVersion("renamed-user", "0.1.0", "0.1.1"),
              ['version = "~0.1.0"', 'version = "~0.2.0"'],
            ],
            "rust/crates/target-user/Cargo.toml": [
              packageVersion("target-user", "0.1.0", "0.1.1"),
              requirement("=0.1.0", "=0.2.0"),
            ],
            "rust/crates/dev-user/Cargo.toml": [requirement("0.1.0", "0.2.0")],
            "rust/crates/star-user/Cargo.toml": [packageVersion("star-user", "0.1.0", "0.1.1")],
            "rust/crates/inherit-user/Cargo.toml": [
              packageVersion("inherit-user", "0.1.0", "0.1.1"),
            ],
            "rust/crates/hidden/Cargo.toml": [requirement("0.1.0", "0.2.0")],
            "rust/crates/unreleased/Cargo.toml": [requirement("0.1.0", "0.2.0")],
            "rust/crates/private/Cargo.toml": [
              packageVersion("private", "0.1.0", "0.1.1"),
              requirement("0.1.0", "0.2.0"),
            ],
            "tools/Cargo.toml": [
              packageVersion("xtask", "0.1.0", "0.1.1"),
              requirement("0.1.0", "0.2.0"),
            ],
          });
          expect(linesWith(output, "Kept the requirement")).toEqual([
            'base Kept the requirement "*" on base in rust/crates/star-user/Cargo.toml [dependencies]: 0.2.0 matches it, and nx-rust rewrites bare, ^, ~ and = requirements only',
          ]);
          expect(resolves(workspace, "rust")).toBe("resolves");
          expect(resolves(workspace, "tools")).toBe("resolves");
        }),
      HARNESS_TIMEOUT,
    );

    it(
      "keeps a bare, ^ or ~ requirement that the new version satisfies, and rewrites it with preserveMatchingDependencyRanges off",
      async () => {
        const changesFor = (preserved: boolean): Record<string, [string, string][]> => {
          const bare: [string, string] = ['version = "0.1.0" }', 'version = "0.1.4" }'];
          const optional = (pair: [string, string]): [string, string][] =>
            preserved ? [] : [pair];
          return {
            ...(preserved
              ? {}
              : {
                  "rust/Cargo.toml": [
                    [
                      'base = { path = "crates/base", version = "0.1.0" }',
                      'base = { path = "crates/base", version = "0.1.4" }',
                    ],
                  ],
                  "rust/crates/dev-user/Cargo.toml": [bare],
                  "rust/crates/hidden/Cargo.toml": [bare],
                  "rust/crates/unreleased/Cargo.toml": [bare],
                }),
            "rust/crates/base/Cargo.toml": [packageVersion("base", "0.1.0", "0.1.4")],
            "rust/crates/normal-user/Cargo.toml": [
              packageVersion("normal-user", "0.1.0", "0.1.1"),
              ...optional(bare),
            ],
            "rust/crates/build-user/Cargo.toml": [
              packageVersion("build-user", "0.1.0", "0.1.1"),
              ...optional(['version = "^0.1" }', 'version = "^0.1.4" }']),
            ],
            "rust/crates/renamed-user/Cargo.toml": [
              packageVersion("renamed-user", "0.1.0", "0.1.1"),
              ...optional(['version = "~0.1.0"', 'version = "~0.1.4"']),
            ],
            "rust/crates/target-user/Cargo.toml": [
              packageVersion("target-user", "0.1.0", "0.1.1"),
              ['version = "=0.1.0" }', 'version = "=0.1.4" }'],
            ],
            "rust/crates/star-user/Cargo.toml": [packageVersion("star-user", "0.1.0", "0.1.1")],
            "rust/crates/inherit-user/Cargo.toml": [
              packageVersion("inherit-user", "0.1.0", "0.1.1"),
            ],
            "rust/crates/private/Cargo.toml": [
              packageVersion("private", "0.1.0", "0.1.1"),
              ...optional(bare),
            ],
            "tools/Cargo.toml": [packageVersion("xtask", "0.1.0", "0.1.1"), ...optional(bare)],
          };
        };
        for (const preserved of [true, false]) {
          const files = preserved
            ? undefined
            : {
                "nx.json": (nxJson: string | undefined) => {
                  const config = JSON.parse(nxJson ?? "{}");
                  config.release.version.preserveMatchingDependencyRanges = false;
                  return `${JSON.stringify(config, null, 2)}\n`;
                },
              };
          await withCopy(files, async (workspace) => {
            const before = trackedFiles(workspace);

            const { status, output } = await releaseVersion(workspace, [
              "0.1.4",
              "--projects",
              "base",
            ]);

            expect({ preserved, status, output }).toEqual({
              preserved,
              status: 0,
              output: expect.any(String),
            });
            expectOnly(workspace, before, changesFor(preserved));
            expect(resolves(workspace, "rust")).toBe("resolves");
          });
        }
      },
      2 * HARNESS_TIMEOUT,
    );

    // A comparison and a wildcard in place of two of the fixture's requirements.
    const otherForms: FileChanges = {
      "rust/crates/normal-user/Cargo.toml": (manifest) =>
        (manifest ?? "").replace('version = "0.1.0" }', 'version = ">=0.1, <0.2" }'),
      "rust/crates/unreleased/Cargo.toml": (manifest) =>
        (manifest ?? "").replace('version = "0.1.0" }', 'version = "0.1.*" }'),
    };

    it(
      "keeps a comparison or wildcard requirement that the new version satisfies, also with preserveMatchingDependencyRanges off, and names it",
      () =>
        withCopy(
          {
            ...otherForms,
            "nx.json": (nxJson) => {
              const config = JSON.parse(nxJson ?? "{}");
              config.release.version.preserveMatchingDependencyRanges = false;
              return `${JSON.stringify(config, null, 2)}\n`;
            },
          },
          async (workspace) => {
            const before = trackedFiles(workspace);

            const { status, output } = await releaseVersion(workspace, [
              "0.1.4",
              "--projects",
              "base",
            ]);

            expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
            expect(linesWith(output, "Kept the requirement")).toEqual([
              'base Kept the requirement ">=0.1, <0.2" on base in rust/crates/normal-user/Cargo.toml [dependencies]: 0.1.4 matches it, and nx-rust rewrites bare, ^, ~ and = requirements only',
              'base Kept the requirement "*" on base in rust/crates/star-user/Cargo.toml [dependencies]: 0.1.4 matches it, and nx-rust rewrites bare, ^, ~ and = requirements only',
              'base Kept the requirement "0.1.*" on base in rust/crates/unreleased/Cargo.toml [dependencies]: 0.1.4 matches it, and nx-rust rewrites bare, ^, ~ and = requirements only',
            ]);
            const after = trackedFiles(workspace);
            for (const path of [
              "rust/crates/normal-user/Cargo.toml",
              "rust/crates/unreleased/Cargo.toml",
            ]) {
              const requirementLine = (files: Map<string, string>) =>
                (files.get(path) ?? "").split("\n").find((line) => line.startsWith("base = "));
              expect(requirementLine(after)).toBe(requirementLine(before));
            }
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes where a comparison or wildcard requirement does not accept the new version, naming the manifests",
      () =>
        withCopy(otherForms, async (workspace) => {
          const before = repositoryState(workspace);

          const { status, output } = await releaseVersion(workspace, [
            "0.2.0",
            "--projects",
            "base",
          ]);

          expect(status).toBe(1);
          expectLinesInOrder(output, [
            "The new version 0.2.0 of base leaves requirements on it that nx release version cannot rewrite, because only a bare, ^, ~ or = requirement inside the repository can be rewritten without inventing bounds:",
            '- ">=0.1, <0.2" in rust/crates/normal-user/Cargo.toml [dependencies]',
            '- "0.1.*" in rust/crates/unreleased/Cargo.toml [dependencies]',
            "Change each of them so that it accepts 0.2.0, or into a bare, ^, ~ or = requirement, and run nx release version again.",
            "No file has been changed.",
          ]);
          expect(repositoryState(workspace)).toEqual(before);
        }),
      HARNESS_TIMEOUT,
    );

    // Manifests with comments, layouts and quoting that a TOML writer would
    // change, in CRLF line endings and without a final newline, with oxfmt
    // configured, which formats TOML, so that Nx's formatter would change
    // every manifest that the version actions did not exclude from it.
    const unusualLayout: FileChanges = {
      ".oxfmtrc.json": "{}\n",
      "rust/Cargo.toml": [
        "# The workspace of the release fixture.",
        "[workspace]",
        "members = [",
        '  "crates/*", # every crate',
        "]",
        'resolver = "3"',
        "",
        "[workspace.package]",
        "version    =    '0.1.0'   # shared by core and api",
        'edition = "2024"',
        "",
        "[workspace.dependencies]",
        'core = { path = "crates/core", version = "0.1.0" }',
        'base.path = "crates/base"  # dotted keys',
        "base.version = '0.1.0'",
        "",
        "[patch.crates-io]",
        'base = { path = "crates/base" }',
        'fork = { path = "../third_party/fork" }',
        "",
      ].join("\r\n"),
      "rust/crates/normal-user/Cargo.toml": [
        "[package]",
        'name = "normal-user" # the name',
        'version = "0.1.0"',
        'edition = "2024"',
        "keywords = [",
        '    "release", # a comment inside an array',
        '    "fixture",',
        "]",
        "",
        "[dependencies.base]",
        "# The crate that is released.",
        'path = "../base"',
        'version = "0.1.0"        # rewritten when it no longer matches',
      ].join("\n"),
      "rust/crates/build-user/Cargo.toml": [
        "[package]",
        'name="build-user"',
        "version='0.1.0'",
        'edition="2024"',
        "",
        "[build-dependencies]",
        "base={version='^0.1',path='../base'}",
        "",
      ].join("\n"),
      "tools/Cargo.toml": [
        "[package]",
        'name = "xtask"',
        'version\t=\t"0.1.0"',
        'edition = "2024"',
        "",
        "[dependencies]",
        '"base" = { path = "../rust/crates/base", version = "0.1.0" } # quoted key',
        "",
      ].join("\n"),
    };

    // What changes in the manifests of `unusualLayout`.
    const expectedLayoutChanges: Record<string, [string, string][]> = {
      "rust/Cargo.toml": [["base.version = '0.1.0'", "base.version = '0.2.0'"]],
      "rust/crates/normal-user/Cargo.toml": [
        ['# the name\nversion = "0.1.0"', '# the name\nversion = "0.1.1"'],
        ['version = "0.1.0"        #', 'version = "0.2.0"        #'],
      ],
      "rust/crates/build-user/Cargo.toml": [
        ["version='0.1.0'", "version='0.1.1'"],
        ["base={version='^0.1',", "base={version='^0.2.0',"],
      ],
      "tools/Cargo.toml": [
        ['version\t=\t"0.1.0"', 'version\t=\t"0.1.1"'],
        ['version = "0.1.0" } # quoted key', 'version = "0.2.0" } # quoted key'],
      ],
    };

    it(
      "changes nothing but the version strings, whatever the layout of the manifests",
      () =>
        withCopy(unusualLayout, async (workspace) => {
          symlinkSync(
            join(__dirname, "..", "..", "node_modules", "oxfmt"),
            join(workspace.root, "node_modules", "oxfmt"),
            "dir",
          );
          const before = trackedFiles(workspace);

          const { status, output } = await releaseVersion(workspace, [
            "0.2.0",
            "--projects",
            "base",
          ]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          expectOnly(workspace, before, {
            ...expectedLayoutChanges,
            // The fixture's own layout in the crates that this test leaves as they are.
            "rust/crates/base/Cargo.toml": [packageVersion("base", "0.1.0", "0.2.0")],
            "rust/crates/renamed-user/Cargo.toml": [
              packageVersion("renamed-user", "0.1.0", "0.1.1"),
              ['version = "~0.1.0"', 'version = "~0.2.0"'],
            ],
            "rust/crates/target-user/Cargo.toml": [
              packageVersion("target-user", "0.1.0", "0.1.1"),
              ['version = "=0.1.0" }', 'version = "=0.2.0" }'],
            ],
            "rust/crates/dev-user/Cargo.toml": [['version = "0.1.0" }', 'version = "0.2.0" }']],
            "rust/crates/star-user/Cargo.toml": [packageVersion("star-user", "0.1.0", "0.1.1")],
            "rust/crates/inherit-user/Cargo.toml": [
              packageVersion("inherit-user", "0.1.0", "0.1.1"),
            ],
            "rust/crates/hidden/Cargo.toml": [['version = "0.1.0" }', 'version = "0.2.0" }']],
            "rust/crates/unreleased/Cargo.toml": [['version = "0.1.0" }', 'version = "0.2.0" }']],
            "rust/crates/private/Cargo.toml": [
              packageVersion("private", "0.1.0", "0.1.1"),
              ['version = "0.1.0" }', 'version = "0.2.0" }'],
            ],
          });
          expect(resolves(workspace, "rust")).toBe("resolves");
          expect(resolves(workspace, "tools")).toBe("resolves");
        }),
      HARNESS_TIMEOUT,
    );
  });

  describe("places beyond the dependency tables", () => {
    it(
      "rewrites the version requirement of a [patch] entry that names the bumped crate by path, so that cargo resolves every workspace afterwards",
      () =>
        withCopy(
          withPatch(
            'base = { path = "crates/base", version = "=0.1.0" }\nfork = { path = "../third_party/fork" }\n',
          ),
          async (workspace) => {
            const before = trackedFiles(workspace);

            const { status, output } = await releaseVersion(workspace, [
              "0.2.0",
              "--projects",
              "base",
            ]);

            expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
            expect(output).toContain(
              'base ✍️  Updated the requirement on base in rust/Cargo.toml [patch.crates-io] from "=0.1.0" to "=0.2.0"',
            );
            expect(trackedFiles(workspace).get("rust/Cargo.toml")).toBe(
              (before.get("rust/Cargo.toml") ?? "")
                .replace('version = "0.1.0" }\n\n[patch', 'version = "0.2.0" }\n\n[patch')
                .replace('version = "=0.1.0" }', 'version = "=0.2.0" }'),
            );
            // A [patch] entry makes no dependent: registry-user keeps its version.
            expect(versionIn(workspace, "rust/crates/registry-user/Cargo.toml")).toBe("0.1.0");
            expect(resolves(workspace, "rust")).toBe("resolves");
            expect(resolves(workspace, "tools")).toBe("resolves");
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes where the new version leaves a [patch] requirement that nx-rust does not rewrite",
      () =>
        withCopy(
          withPatch(
            'base = { path = "crates/base", version = ">=0.1, <0.2" }\nfork = { path = "../third_party/fork" }\n',
          ),
          async (workspace) => {
            const before = repositoryState(workspace);

            const { status, output } = await releaseVersion(workspace, [
              "0.2.0",
              "--projects",
              "base",
            ]);

            expect(status).toBe(1);
            expect(output).toContain('- ">=0.1, <0.2" in rust/Cargo.toml [patch.crates-io]');
            expect(repositoryState(workspace)).toEqual(before);
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "rewrites a [patch] requirement in a Cargo configuration file inside the repository, and fails before any file changes for one outside it",
      async () => {
        // The configuration file holds base's patch in place of the manifest.
        const configured: FileChanges = {
          ...withPatch('fork = { path = "../third_party/fork" }\n'),
          "rust/.cargo/config.toml":
            '# Patches for local work\n[patch.crates-io]\nbase = { path = "crates/base", version = "0.1.0" } # kept up to date\n',
        };
        await withCopy(configured, async (workspace) => {
          const before = trackedFiles(workspace);

          const { status, output } = await releaseVersion(workspace, [
            "0.2.0",
            "--projects",
            "base",
          ]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          expect(trackedFiles(workspace).get("rust/.cargo/config.toml")).toBe(
            (before.get("rust/.cargo/config.toml") ?? "").replace(
              'version = "0.1.0" }',
              'version = "0.2.0" }',
            ),
          );
          expect(resolves(workspace, "rust")).toBe("resolves");
        });

        // The same entry in a Cargo home of its own, outside the repository.
        await withCopy(
          withPatch('fork = { path = "../third_party/fork" }\n'),
          async (workspace) => {
            const cargoHome = join(workspace.root, "..", "cargo-home");
            mkdirSync(cargoHome, { recursive: true });
            writeFileSync(
              join(cargoHome, "config.toml"),
              `[patch.crates-io]\nbase = { path = "${join(workspace.root, "rust", "crates", "base")}", version = "0.1.0" }\n`,
            );
            const before = repositoryState(workspace);

            const { status, output } = await releaseVersion(
              workspace,
              ["0.2.0", "--projects", "base"],
              { CARGO_HOME: cargoHome },
            );

            expect(status).toBe(1);
            expect(output).toContain(
              `- "0.1.0" in ${join(cargoHome, "config.toml")} [patch.crates-io], which lies outside the repository, where nx release version writes nothing; it has to become "0.2.0"`,
            );
            expect(repositoryState(workspace)).toEqual(before);
          },
        );
      },
      2 * HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes for a [replace] entry and a profile specification that the new version would leave",
      () =>
        withCopy(
          {
            // Cargo takes no [replace] beside a [patch] in one manifest.
            "rust/Cargo.toml": (manifest) =>
              `${(manifest ?? "").replace(/\[patch\.crates-io\][^]*$/, "")}[replace]\n"base:0.1.0" = { path = "crates/base" }\n\n[profile.dev.package."base:0.1.0"]\nopt-level = 1\n`,
          },
          async (workspace) => {
            const before = repositoryState(workspace);

            const { status, output } = await releaseVersion(workspace, [
              "0.2.0",
              "--projects",
              "base",
            ]);

            expect(status).toBe(1);
            expect(output).toContain(
              "nx release version cannot give base the new version 0.2.0 while:",
            );
            expect(output).toContain(
              '- [replace] "base:0.1.0" in rust/Cargo.toml replaces a package with the folder of base, and cargo takes a replacement only with the version that it replaces, which 0.2.0 is not',
            );
            expect(output).toContain(
              '- [profile.dev.package."base:0.1.0"] in rust/Cargo.toml names base 0.1.0, which 0.2.0 does not match, so the profile\'s settings would stop applying to it',
            );
            expect(repositoryState(workspace)).toEqual(before);
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes for a registry requirement that a [patch] redirects to the bumped crate and that the new version leaves",
      () =>
        withCopy(
          {
            // registry-user asks the registry for base, which the fixture's [patch] redirects to the member.
            "rust/crates/registry-user/Cargo.toml": (manifest) => `${manifest}base = "0.1"\n`,
          },
          async (workspace) => {
            const before = repositoryState(workspace);

            const { status, output } = await releaseVersion(workspace, [
              "0.2.0",
              "--projects",
              "base",
            ]);

            expect(status).toBe(1);
            expect(output).toContain(
              '- the requirement "^0.1" of registry-user on base from crates-io, in rust/crates/registry-user/Cargo.toml, which the [patch] entry in rust/Cargo.toml redirects to base\'s folder, does not accept 0.2.0, so cargo would take base from the registry instead',
            );
            expect(repositoryState(workspace)).toEqual(before);
          },
        ),
      HARNESS_TIMEOUT,
    );
    it(
      "fails before any file changes for a registry requirement that a [patch] for a registry's name, its sparse index or a git URL redirects to the bumped crate",
      async () => {
        // A registry `private` in the workspace's Cargo configuration.
        const registry = {
          "rust/.cargo/config.toml":
            '[registries.private]\nindex = "sparse+https://example.invalid/"\n',
        };
        const cases: [string, string, string][] = [
          ["private", 'base = { version = "0.1", registry = "private" }', "private"],
          [
            '"sparse+https://example.invalid/"',
            'base = { version = "0.1", registry = "private" }',
            "sparse+https://example.invalid/",
          ],
          [
            '"https://example.invalid/base.git"',
            'base = { git = "https://example.invalid/base.git", version = "0.1" }',
            "https://example.invalid/base.git",
          ],
        ];
        for (const [key, dependency, source] of cases) {
          await withCopy(
            {
              ...registry,
              ...withPatch(
                `fork = { path = "../third_party/fork" }\n\n[patch.${key}]\nbase = { path = "crates/base" }\n`,
              ),
              "rust/crates/registry-user/Cargo.toml": (manifest) => `${manifest}${dependency}\n`,
            },
            async (workspace) => {
              // The graph keeps an edge for the redirection, a possible use
              // where it cannot tell the source, as DES-PROJECT-GRAPH says.
              const graph = await workspace.graph();
              expect(
                graph.dependencies.some(
                  (edge) => edge.source === "registry-user" && edge.target === "base",
                ),
              ).toBe(true);
              const before = repositoryState(workspace);

              const { status, output } = await releaseVersion(workspace, [
                "0.2.0",
                "--projects",
                "base",
              ]);

              expect({ key, status }).toEqual({ key, status: 1 });
              expect(output).toContain(
                `- the requirement "^0.1" of registry-user on base from ${source}, in rust/crates/registry-user/Cargo.toml, which the [patch] entry in rust/Cargo.toml redirects to base's folder, does not accept 0.2.0`,
              );
              expect(repositoryState(workspace)).toEqual(before);
            },
          );
        }
      },
      3 * HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes for a profile specification that names the bumped crate by a file URL with a version that the new one leaves",
      () =>
        withCopy(undefined, async (workspace) => {
          const folder = join(workspace.root, "rust", "crates", "base");
          const specs = [`file://${folder}#base@0.1.0`, `path+file://${folder}#0.1.0`];
          const manifest = join(workspace.root, "rust", "Cargo.toml");
          writeFileSync(
            manifest,
            `${readFileSync(manifest, "utf8")}${specs.map((spec, index) => `\n[profile.${index === 0 ? "dev" : "release"}.package."${spec}"]\nopt-level = 1\n`).join("")}`,
          );
          git(workspace, "commit", "--quiet", "--all", "--message", "Profiles");
          const before = repositoryState(workspace);

          const { status, output } = await releaseVersion(workspace, [
            "0.2.0",
            "--projects",
            "base",
          ]);

          expect(status).toBe(1);
          expect(output).toContain(
            `- [profile.dev.package."${specs[0]}"] in rust/Cargo.toml names base 0.1.0, which 0.2.0 does not match`,
          );
          expect(output).toContain(
            `- [profile.release.package."${specs[1]}"] in rust/Cargo.toml names base 0.1.0, which 0.2.0 does not match`,
          );
          expect(repositoryState(workspace)).toEqual(before);
        }),
      HARNESS_TIMEOUT,
    );
  });

  describe("writing", () => {
    it(
      "fails before any file changes where a file that the run changes is a symbolic link that leads outside the repository",
      async () => {
        // A configuration file of the workspace that links to a file outside.
        await withCopy(
          withPatch('fork = { path = "../third_party/fork" }\n'),
          async (workspace) => {
            const outside = join(workspace.root, "..", "outside-config.toml");
            const content =
              '[patch.crates-io]\nbase = { path = "crates/base", version = "=0.1.0" }\n';
            writeFileSync(outside, content);
            mkdirSync(join(workspace.root, "rust", ".cargo"));
            symlinkSync(outside, join(workspace.root, "rust", ".cargo", "config.toml"));
            git(workspace, "add", "--all");
            git(workspace, "commit", "--quiet", "--message", "A linked configuration");
            const before = repositoryState(workspace);

            const { status, output } = await releaseVersion(workspace, [
              "0.2.0",
              "--projects",
              "base",
            ]);

            expect(status).toBe(1);
            expectLinesInOrder(output, [
              "The new version 0.2.0 of base changes files that symbolic links lead outside the repository, where nx release version writes nothing:",
              `- rust/.cargo/config.toml leads to ${realpathSync(outside)}`,
            ]);
            expect(readFileSync(outside, "utf8")).toBe(content);
            expect(repositoryState(workspace)).toEqual(before);
          },
        );

        // A member whose folder links to a folder outside: Nx makes no
        // project of it, and the run would rewrite its requirement on base.
        await withCopy(undefined, async (workspace) => {
          const member = join(workspace.root, "rust", "crates", "normal-user");
          const outside = join(workspace.root, "..", "outside-normal-user");
          renameSync(member, outside);
          symlinkSync(outside, member);
          git(workspace, "add", "--all");
          git(workspace, "commit", "--quiet", "--message", "A linked member");
          const manifest = readFileSync(join(outside, "Cargo.toml"), "utf8");
          const before = repositoryState(workspace);

          const { status, output } = await releaseVersion(workspace, [
            "0.2.0",
            "--projects",
            "base",
          ]);

          expect(status).toBe(1);
          expect(output).toContain(
            `- rust/crates/normal-user/Cargo.toml leads to ${join(realpathSync(outside), "Cargo.toml")}`,
          );
          expect(readFileSync(join(outside, "Cargo.toml"), "utf8")).toBe(manifest);
          expect(repositoryState(workspace)).toEqual(before);
        });
      },
      2 * HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes where a file that the run changes cannot be written",
      () =>
        withCopy(undefined, async (workspace) => {
          const manifest = join(workspace.root, "rust", "crates", "normal-user", "Cargo.toml");
          chmodSync(manifest, 0o444);
          try {
            const before = repositoryState(workspace);

            const { status, output } = await releaseVersion(workspace, [
              "patch",
              "--projects",
              "base",
            ]);

            expect(status).toBe(1);
            expect(output).toContain(
              "nx release version cannot write rust/crates/normal-user/Cargo.toml, which the new version 0.1.1 of normal-user changes: make it writable and run the command again.",
            );
            expect(repositoryState(workspace)).toEqual(before);
          } finally {
            chmodSync(manifest, 0o644);
          }
        }),
      HARNESS_TIMEOUT,
    );

    it(
      "writes, stages and commits the files that symbolic links inside the repository lead to, for a member's manifest and a configuration file",
      () =>
        withCopy(
          { ...withPatch('fork = { path = "../third_party/fork" }\n'), ".oxfmtrc.json": "{}\n" },
          async (workspace) => {
            // normal-user's Cargo.toml and rust/.cargo/config.toml link to
            // files in another folder of the repository, in layouts that
            // oxfmt, which the copy configures, would change.
            const linked = join(workspace.root, "linked");
            mkdirSync(linked);
            const manifest = join(workspace.root, "rust", "crates", "normal-user", "Cargo.toml");
            rmSync(manifest);
            writeFileSync(
              join(linked, "normal-user.toml"),
              [
                "[package]",
                'name = "normal-user"',
                "version    =    '0.1.0'   # the version",
                'edition = "2024"',
                "",
                "[dependencies]",
                "base = {path='../base',version='0.1.0'}",
                "",
              ].join("\n"),
            );
            symlinkSync("../../../linked/normal-user.toml", manifest);
            writeFileSync(
              join(linked, "cargo-config.toml"),
              "[patch.crates-io]\nbase = {   path = 'crates/base',   version = '=0.1.0' }\n",
            );
            mkdirSync(join(workspace.root, "rust", ".cargo"));
            symlinkSync(
              "../../linked/cargo-config.toml",
              join(workspace.root, "rust", ".cargo", "config.toml"),
            );
            git(workspace, "add", "--all");
            git(workspace, "commit", "--quiet", "--message", "Linked files");
            const before = trackedFiles(workspace);

            const { status, output } = await releaseVersion(workspace, [
              "0.2.0",
              "--projects",
              "base",
            ]);

            expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
            // The links stay as they were, and what they lead to changed in
            // its version strings only, and is in Nx's commit.
            const after = trackedFiles(workspace);
            for (const link of ["rust/crates/normal-user/Cargo.toml", "rust/.cargo/config.toml"]) {
              expect({ link, leadsTo: after.get(link) }).toEqual({
                link,
                leadsTo: before.get(link),
              });
            }
            expect(after.get("linked/normal-user.toml")).toBe(
              (before.get("linked/normal-user.toml") ?? "")
                .replace("version    =    '0.1.0'", "version    =    '0.1.1'")
                .replace("version='0.1.0'", "version='0.2.0'"),
            );
            expect(after.get("linked/cargo-config.toml")).toBe(
              (before.get("linked/cargo-config.toml") ?? "").replace("'=0.1.0'", "'=0.2.0'"),
            );
            const committed = git(workspace, "show", "--name-only", "--format=", "HEAD")
              .trim()
              .split("\n");
            expect(committed).toEqual(
              expect.arrayContaining(["linked/normal-user.toml", "linked/cargo-config.toml"]),
            );
            expect(git(workspace, "status", "--porcelain").trim()).toBe("");
          },
        ),
      HARNESS_TIMEOUT,
    );
  });

  // The maintainer's answers to how Nx bumps across release groups, which
  // shows only where a group's version comes from version plans or
  // conventional commits, not from a specifier (nxr-5a9w1y).
  describe("bumps that Nx decides across release groups", () => {
    const versionPlan = (plan: Record<string, string>): string =>
      `---\n${Object.entries(plan)
        .map(([name, bump]) => `${name}: ${bump}`)
        .join("\n")}\n---\n\nA change.\n`;

    it(
      "names the edge through which Nx bumps a fixed group without a bump of its own, and goes on",
      () =>
        withCopy(
          {
            ...releaseConfiguration({
              groups: {
                core: { projects: ["base"], projectsRelationship: "independent" },
                apps: { projects: ["dev-user"], projectsRelationship: "fixed" },
              },
              versionPlans: true,
              version: { git: git_ },
            }),
            ".nx/version-plans/base.md": versionPlan({ base: "patch" }),
          },
          async (workspace) => {
            const before = trackedFiles(workspace);

            const { status, output } = await releaseVersion(workspace, []);

            expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
            expect(linesWith(output, "⚠️")).toEqual([
              'dev-user ⚠️  Nx bumps the fixed release group "apps" as a whole, because the project graph has an edge from dev-user to base, whose release group "core" it bumped before. In Cargo, dev-user depends on base through a dev-dependency. nx-rust\'s guide lists this as a known limit of Nx release.',
            ]);
            expectOnly(workspace, before, {
              "rust/crates/base/Cargo.toml": [packageVersion("base", "0.1.0", "0.1.1")],
              "rust/crates/dev-user/Cargo.toml": [packageVersion("dev-user", "0.1.0", "0.1.1")],
              // Outside the release in this configuration, so not stopped by part 2.
              "rust/crates/target-user/Cargo.toml": [['version = "=0.1.0"', 'version = "=0.1.1"']],
            });
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "fails before any file changes where a crate of an independent group would get a rewritten requirement on a bumped crate of a fixed group without a bump, and passes once it has one",
      async () => {
        const configuration = releaseConfiguration({
          groups: {
            crates: { projects: ["core", "api"], projectsRelationship: "fixed" },
            apps: { projects: ["cli"], projectsRelationship: "independent" },
          },
          versionPlans: true,
          version: { git: git_ },
        });
        await withCopy(
          { ...configuration, ".nx/version-plans/crates.md": versionPlan({ crates: "major" }) },
          async (workspace) => {
            const before = repositoryState(workspace);

            const { status, output } = await releaseVersion(workspace, []);

            expect(status).toBe(1);
            expectLinesInOrder(output, [
              "nx release version would rewrite requirements of crates in the release on crates that it bumps, without bumping those crates:",
              '- cli, in the release group "apps": its requirement on api in rust/crates/cli/Cargo.toml [dependencies] becomes "0.2.0", but Nx gives cli no new version',
              "Release each of them in the same run: give it a bump of its own, through a version plan or a conventional commit, or name a version on the command line, which applies to every crate of the run. Nx bumps no crate of an independent group for a dependency in a fixed group. No file has been changed.",
            ]);
            expect(repositoryState(workspace)).toEqual(before);
          },
        );
        await withCopy(
          {
            ...configuration,
            ".nx/version-plans/crates.md": versionPlan({ crates: "major" }),
            ".nx/version-plans/cli.md": versionPlan({ cli: "patch" }),
          },
          async (workspace) => {
            const before = trackedFiles(workspace);

            const { status, output } = await releaseVersion(workspace, []);

            expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
            expectOnly(workspace, before, {
              "rust/Cargo.toml": [
                ['version = "0.1.0"\nedition = "2024"', 'version = "0.2.0"\nedition = "2024"'],
                ['version = "0.1.0" }\nbase', 'version = "0.2.0" }\nbase'],
              ],
              "rust/crates/cli/Cargo.toml": [
                packageVersion("cli", "0.3.0", "0.3.1"),
                [
                  'api = { path = "../api", version = "0.1" }',
                  'api = { path = "../api", version = "0.2.0" }',
                ],
              ],
            });
          },
        );
      },
      2 * HARNESS_TIMEOUT,
    );
  });

  describe("dry run", () => {
    it(
      "changes no file and runs no cargo update",
      () =>
        withCopy(undefined, async (workspace) => {
          const before = repositoryState(workspace);

          const { status, output } = await releaseVersion(workspace, [
            "0.2.0",
            "--projects",
            "base",
            "--dry-run",
          ]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          // Nx shows what would change.
          expect(linesWith(output, "UPDATE rust/crates/base/Cargo.toml")).toEqual([
            "UPDATE rust/crates/base/Cargo.toml [dry-run]",
          ]);
          expect(output).toContain('+ base = { path = "crates/base", version = "0.2.0" }');
          expect(repositoryState(workspace)).toEqual(before);
          const calls = workspace.cargoCalls();
          // The version actions' own reports show that the wrapper sees their cargo calls.
          expect(calls).toEqual(
            expect.arrayContaining([
              { cwd: "rust", args: ["metadata", "--format-version", "1", "--no-deps"] },
              { cwd: "tools", args: ["metadata", "--format-version", "1", "--no-deps"] },
            ]),
          );
          expect(calls.filter((call) => call.args[0] !== "metadata")).toEqual([]);
        }),
      HARNESS_TIMEOUT,
    );
  });
});
