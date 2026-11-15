import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
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
  FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  lockfileCalls,
  SparseRegistry,
  testEnvironment,
  withoutColours,
} from "./harness";

// Checks group 4 of VER-RELEASE: the `cargo update --workspace` that the
// version actions' `afterAllProjectsVersioned` runs after `nx release
// version`, with the real Nx and cargo, in copies of release-crates that each
// test gives registry dependencies, locked against a harness registry of its
// own (`SparseRegistry`). Every cargo and Nx command runs with that
// registry's variables: its own Cargo home, crates.io replaced by it, and its
// proxy, which refuses every other host, so that no test reaches a real
// registry or waits for the machine's package cache lock.

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

function git(workspace: FixtureWorkspace, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspace.root,
    env: testEnvironment(gitVariables(workspace)),
    encoding: "utf8",
  });
}

function cargo(
  workspace: FixtureWorkspace,
  folder: string,
  env: Record<string, string | undefined>,
  ...args: string[]
): { status: number | null; output: string } {
  const run = spawnSync("cargo", args, {
    cwd: join(workspace.root, folder),
    env: testEnvironment(env),
    encoding: "utf8",
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

/**
 * The changes that give the fixture registry dependencies: `registry-user`
 * asks the registry for `regdep` and, as `old-base`, for a crate named `base`
 * like the member, which `[patch.crates-io]` no longer redirects, so that
 * the lockfile locks a member and a registry crate of one name. Its
 * dependency on `fork`, patched by path, stays.
 */
const registryDependencies: FileChanges = {
  "rust/Cargo.toml": (manifest) =>
    (manifest ?? "").replace('base = { path = "crates/base" }\n', ""),
  "rust/crates/registry-user/Cargo.toml": (manifest) =>
    `${manifest}regdep = "1"\nold-base = { package = "base", version = "=0.1.0" }\n`,
};

interface LockfileCopy {
  workspace: FixtureWorkspace;
  registry: SparseRegistry;
  env: Record<string, string | undefined>;
}

/**
 * A copy of release-crates with `files` applied, its lockfiles generated
 * against a new registry that has `regdep` 1.0.0 and `base` 0.1.0, committed
 * to a git repository of its own, after which the registry gets `regdep`
 * 1.0.1. `prepare` runs before the commit.
 */
async function withLockfileCopy(
  files: FileChanges,
  test: (copy: LockfileCopy) => Promise<void>,
  prepare?: (copy: LockfileCopy) => void,
): Promise<void> {
  const registry = await SparseRegistry.start();
  const workspace = FixtureWorkspace.create("release-crates", files);
  try {
    const env = registry.env();
    registry.seed({ name: "regdep", version: "1.0.0" });
    registry.seed({ name: "base", version: "0.1.0" });
    for (const folder of ["rust", "tools"]) {
      const generated = cargo(workspace, folder, env, "generate-lockfile");
      if (generated.status !== 0) {
        throw new Error(`cargo generate-lockfile failed in ${folder}:\n${generated.output}`);
      }
    }
    writeFileSync(join(workspace.root, "..", "gitconfig"), "");
    prepare?.({ workspace, registry, env });
    git(workspace, "init", "--quiet", "--initial-branch=main");
    git(workspace, "add", "--all");
    git(workspace, "commit", "--quiet", "--message", "The fixture");
    registry.seed({ name: "regdep", version: "1.0.1" });
    await test({ workspace, registry, env });
  } finally {
    workspace.remove();
    await registry.remove();
  }
}

/** Runs `nx release version` and returns its output without colours and trailing spaces. */
async function releaseVersion(
  { workspace, env }: LockfileCopy,
  args: string[],
  extra: Record<string, string | undefined> = {},
): Promise<{ status: number | null; output: string }> {
  const { status, output } = await workspace.nx(["release", "version", ...args], {
    ...env,
    ...gitVariables(workspace),
    ...extra,
  });
  return { status, output: withoutColours(output).replace(/[^\S\n]+$/gm, "") };
}

function read(workspace: FixtureWorkspace, path: string): string {
  return readFileSync(join(workspace.root, path), "utf8");
}

interface LockedPackage {
  name: string;
  version: string;
  source?: string;
  checksum?: string;
  dependencies?: string[];
}

function lockedPackages(lockfile: string): LockedPackage[] {
  return ((parse(lockfile) as { package?: LockedPackage[] }).package ?? []).map((pkg) => ({
    ...pkg,
  }));
}

/**
 * Checks that the lockfile `after` is `before` with the path packages of
 * `bumped` at their new versions and every reference to them following,
 * and nothing else changed: no other package changed its version, source or
 * checksum, and no other reference changed, apart from cargo leaving out a
 * registry package's source in a reference where the name alone no longer
 * needs it.
 */
function expectOnlyBumpedMembers(
  before: string,
  after: string,
  bumped: Record<string, [from: string, to: string]>,
): void {
  const bump = (pkg: LockedPackage) =>
    pkg.source === undefined && bumped[pkg.name]?.[0] === pkg.version
      ? { ...pkg, version: bumped[pkg.name][1] }
      : pkg;
  // A reference in the old lockfile that names a bumped member, with its
  // old version and no source, names it at its new version afterwards. Cargo
  // writes a source only where the name and version alone are ambiguous.
  const withoutSource = (text: string) => text.replace(/ \([^)]*\)$/, "");
  const bumpedReference = (text: string) => {
    const [name, version] = text.split(" ");
    return bumped[name] !== undefined && version === bumped[name][0] && !text.includes("(")
      ? `${name} ${bumped[name][1]}`
      : withoutSource(text);
  };
  const normal = (packages: LockedPackage[], reference: (text: string) => string) =>
    packages
      .map((pkg) => ({ ...pkg, dependencies: (pkg.dependencies ?? []).map(reference).sort() }))
      .map((pkg) => JSON.stringify(pkg))
      .sort();
  expect(normal(lockedPackages(after), withoutSource)).toEqual(
    normal(lockedPackages(before).map(bump), bumpedReference),
  );
  // Something moved: the lockfile held at least one of the bumped crates.
  expect(
    lockedPackages(before).some(
      (pkg) => pkg.source === undefined && bumped[pkg.name]?.[0] === pkg.version,
    ),
  ).toBe(true);
}

/** The crates that `0.2.0 --projects base` versions, with their old and new versions. */
const bumpedByBase: Record<string, [string, string]> = {
  base: ["0.1.0", "0.2.0"],
  "build-user": ["0.1.0", "0.1.1"],
  "inherit-user": ["0.1.0", "0.1.1"],
  "normal-user": ["0.1.0", "0.1.1"],
  private: ["0.1.0", "0.1.1"],
  "renamed-user": ["0.1.0", "0.1.1"],
  "star-user": ["0.1.0", "0.1.1"],
  "target-user": ["0.1.0", "0.1.1"],
  xtask: ["0.1.0", "0.1.1"],
};

describe("the lockfile step of nx release version (VER-RELEASE, group 4)", () => {
  it(
    "moves only the bumped members and the references to them, keeps an older registry version, and commits the lockfiles",
    () =>
      withLockfileCopy(registryDependencies, async (copy) => {
        const { workspace } = copy;
        const rustBefore = read(workspace, "rust/Cargo.lock");
        const toolsBefore = read(workspace, "tools/Cargo.lock");
        expect(lockedPackages(rustBefore).filter((pkg) => pkg.name === "base")).toHaveLength(2);
        const head = git(workspace, "rev-parse", "HEAD").trim();

        const { status, output } = await releaseVersion(copy, ["0.2.0", "--projects", "base"]);

        expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
        expectOnlyBumpedMembers(rustBefore, read(workspace, "rust/Cargo.lock"), bumpedByBase);
        expectOnlyBumpedMembers(toolsBefore, read(workspace, "tools/Cargo.lock"), bumpedByBase);
        // regdep stays at 1.0.0 although the registry has 1.0.1.
        expect(
          lockedPackages(read(workspace, "rust/Cargo.lock"))
            .filter((pkg) => pkg.name === "regdep")
            .map((pkg) => pkg.version),
        ).toEqual(["1.0.0"]);
        for (const folder of ["rust", "tools"]) {
          expect({
            folder,
            ...cargo(workspace, folder, copy.env, "update", "--workspace", "--locked"),
          }).toEqual({
            folder,
            status: 0,
            output: expect.any(String),
          });
        }
        expect(
          lockfileCalls(workspace)
            .map((call) => call.cwd)
            .sort(),
        ).toEqual(["rust", "tools"]);
        // Nx committed the lockfiles with the manifests.
        expect(git(workspace, "rev-parse", "HEAD~1").trim()).toBe(head);
        const committed = git(workspace, "show", "--name-only", "--format=", "HEAD")
          .trim()
          .split("\n");
        expect(committed).toEqual(expect.arrayContaining(["rust/Cargo.lock", "tools/Cargo.lock"]));
        expect(git(workspace, "status", "--porcelain").trim()).toBe("");
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "leaves the lockfile of a workspace whose manifests did not change untouched",
    () =>
      withLockfileCopy(registryDependencies, async (copy) => {
        const { workspace } = copy;
        const toolsBefore = read(workspace, "tools/Cargo.lock");
        const rustBefore = read(workspace, "rust/Cargo.lock");

        const { status, output } = await releaseVersion(copy, ["patch", "--projects", "cli"]);

        expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
        expect(read(workspace, "tools/Cargo.lock")).toBe(toolsBefore);
        expectOnlyBumpedMembers(rustBefore, read(workspace, "rust/Cargo.lock"), {
          cli: ["0.3.0", "0.3.1"],
        });
        expect(lockfileCalls(workspace).map((call) => call.cwd)).toEqual(["rust"]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "updates the lockfile of a workspace that locks a bumped crate by path although its manifests stay as they are",
    () =>
      withLockfileCopy(
        {
          ...registryDependencies,
          "tools/Cargo.toml": (manifest) =>
            (manifest ?? "").replace(
              'base = { path = "../rust/crates/base", version = "0.1.0" }',
              'base = { path = "../rust/crates/base" }',
            ),
        },
        async (copy) => {
          const { workspace } = copy;
          const toolsManifest = read(workspace, "tools/Cargo.toml");
          const toolsBefore = read(workspace, "tools/Cargo.lock");

          const { status, output } = await releaseVersion(copy, ["0.2.0", "--projects", "base"]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          expect(read(workspace, "tools/Cargo.toml")).toBe(toolsManifest);
          expectOnlyBumpedMembers(toolsBefore, read(workspace, "tools/Cargo.lock"), {
            base: ["0.1.0", "0.2.0"],
          });
          expect(
            cargo(workspace, "tools", copy.env, "update", "--workspace", "--locked").status,
          ).toBe(0);
          expect(git(workspace, "show", "--name-only", "--format=", "HEAD")).toContain(
            "tools/Cargo.lock",
          );
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "updates the lockfiles also with the plugin's locked option or NX_RUST_LOCKED=true",
    async () => {
      const lockedOption: FileChanges = {
        "nx.json": (nxJson) => {
          const config = JSON.parse(nxJson ?? "{}");
          config.plugins = config.plugins.map((entry: { plugin: string }) => ({
            ...entry,
            options: { locked: true },
          }));
          return `${JSON.stringify(config, null, 2)}\n`;
        },
      };
      for (const [files, extra] of [
        [{ ...registryDependencies, ...lockedOption }, {}],
        [registryDependencies, { NX_RUST_LOCKED: "true" }],
      ] as [FileChanges, Record<string, string>][]) {
        await withLockfileCopy(files, async (copy) => {
          const { workspace } = copy;
          const before = read(workspace, "rust/Cargo.lock");

          const { status, output } = await releaseVersion(
            copy,
            ["patch", "--projects", "cli"],
            extra,
          );

          expect({ extra, status, output }).toEqual({
            extra,
            status: 0,
            output: expect.any(String),
          });
          expect(lockfileCalls(workspace)).toEqual([
            { cwd: "rust", args: ["update", "--workspace"] },
          ]);
          expectOnlyBumpedMembers(before, read(workspace, "rust/Cargo.lock"), {
            cli: ["0.3.0", "0.3.1"],
          });
        });
      }
    },
    2 * HARNESS_TIMEOUT,
  );

  it(
    "leaves the manifests and the lockfiles staged and uncommitted without git settings, and keeps a lockfile that git ignores out of the commit",
    async () => {
      // Without release.version.git, Nx stages and does not commit.
      await withLockfileCopy(
        {
          ...registryDependencies,
          "nx.json": (nxJson) => {
            const config = JSON.parse(nxJson ?? "{}");
            delete config.release.version.git;
            return `${JSON.stringify(config, null, 2)}\n`;
          },
        },
        async (copy) => {
          const { workspace } = copy;
          const head = git(workspace, "rev-parse", "HEAD").trim();

          const { status, output } = await releaseVersion(copy, ["0.2.0", "--projects", "base"]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          expect(git(workspace, "rev-parse", "HEAD").trim()).toBe(head);
          const staged = git(workspace, "diff", "--cached", "--name-only").trim().split("\n");
          expect(staged).toEqual(
            expect.arrayContaining([
              "rust/Cargo.lock",
              "tools/Cargo.lock",
              "rust/crates/base/Cargo.toml",
            ]),
          );
          expect(git(workspace, "diff", "--name-only").trim()).toBe("");
        },
      );
      // tools/Cargo.lock ignored and untracked: updated on disk, not committed.
      await withLockfileCopy(
        { ...registryDependencies, ".gitignore": (ignore) => `${ignore}tools/Cargo.lock\n` },
        async (copy) => {
          const { workspace } = copy;
          const toolsBefore = read(workspace, "tools/Cargo.lock");

          const { status, output } = await releaseVersion(copy, ["0.2.0", "--projects", "base"]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          expectOnlyBumpedMembers(toolsBefore, read(workspace, "tools/Cargo.lock"), bumpedByBase);
          const committed = git(workspace, "show", "--name-only", "--format=", "HEAD");
          expect(committed).toContain("rust/Cargo.lock");
          expect(committed).not.toContain("tools/Cargo.lock");
          expect(git(workspace, "status", "--porcelain").trim()).toBe("");
        },
      );
    },
    2 * HARNESS_TIMEOUT,
  );

  it(
    "fails, naming the workspace with cargo's message, where cargo cannot update the second lockfile, after the first is updated, and commits nothing",
    async () => {
      // Only tools asks the registry, so with the registry stopped and an
      // empty Cargo home, rust/ updates and tools/ fails.
      const onlyToolsAsks: FileChanges = {
        "rust/crates/registry-user/Cargo.toml": (manifest) =>
          (manifest ?? "").replace('fork = "0.1"\n', ""),
        "rust/Cargo.toml": (manifest) => (manifest ?? "").replace(/\[patch\.crates-io\][^]*$/, ""),
        "tools/Cargo.toml": (manifest) => `${manifest}regdep = "1"\n`,
      };
      const cases: [string, (copy: LockfileCopy) => Promise<Record<string, string>>, RegExp][] = [
        [
          "registry stopped",
          async ({ registry, workspace }) => {
            await registry.stop();
            return { CARGO_HOME: emptyHome(workspace, registry) };
          },
          /error/,
        ],
        [
          "offline forced",
          async ({ registry, workspace }) => ({
            CARGO_HOME: emptyHome(workspace, registry),
            CARGO_NET_OFFLINE: "true",
          }),
          /offline/,
        ],
      ];
      for (const [name, setUp, cargoSays] of cases) {
        await withLockfileCopy(onlyToolsAsks, async (copy) => {
          const { workspace } = copy;
          const rustBefore = read(workspace, "rust/Cargo.lock");
          const toolsBefore = read(workspace, "tools/Cargo.lock");
          const head = git(workspace, "rev-parse", "HEAD").trim();
          const extra = await setUp(copy);

          const { status, output } = await releaseVersion(
            copy,
            ["0.2.0", "--projects", "base"],
            extra,
          );

          expect({ name, status }).toEqual({ name, status: 1 });
          const message = output.slice(output.indexOf("cargo update --workspace failed"));
          expect(message).toContain(
            "cargo update --workspace failed in the Cargo workspace tools/Cargo.toml, so nx release version cannot bring its Cargo.lock up to date:",
          );
          expect(message).toContain("- tools/Cargo.toml: cargo exited with status 101");
          expect(message).toMatch(cargoSays);
          expect(message).toContain(
            "Nx has written the new versions and cargo has updated rust/Cargo.lock, and made no commit or tag.",
          );
          expect(message).toContain(
            "To go back, run this in the root of the Nx workspace, and run nx release version again once cargo works:",
          );
          expect(message).toMatch(/^ {4}git checkout -- rust\/Cargo\.lock rust\/Cargo\.toml /m);
          expect(message).toContain(
            "To go on instead, correct what cargo reports, run this in the root of the Nx workspace, and commit and tag the release yourself:",
          );
          expect(message).toMatch(/^ {4}\(cd tools && cargo update --workspace\)$/m);
          expectOnlyBumpedMembers(rustBefore, read(workspace, "rust/Cargo.lock"), bumpedByBase);
          expect(read(workspace, "tools/Cargo.lock")).toBe(toolsBefore);
          expect(git(workspace, "rev-parse", "HEAD").trim()).toBe(head);
          expect(git(workspace, "tag", "--list").trim()).toBe("");
          // Written and not staged; git checkout takes it all back.
          expect(git(workspace, "diff", "--cached", "--name-only").trim()).toBe("");
          expect(git(workspace, "diff", "--name-only")).toContain("rust/crates/base/Cargo.toml");
          const back = /^ {4}git checkout -- (.*)$/m.exec(message)?.[1] ?? "";
          git(workspace, "checkout", "--", ...back.split(" "));
          expect(git(workspace, "status", "--porcelain").trim()).toBe("");
        });
      }
    },
    2 * HARNESS_TIMEOUT,
  );

  it(
    "creates no lockfile where a workspace has none, and fails before any write where a lockfile leads outside the repository",
    async () => {
      await withLockfileCopy(
        registryDependencies,
        async (copy) => {
          const { workspace } = copy;

          const { status, output } = await releaseVersion(copy, ["0.2.0", "--projects", "base"]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          expect(existsSync(join(workspace.root, "tools", "Cargo.lock"))).toBe(false);
          expect(lockfileCalls(workspace).map((call) => call.cwd)).toEqual(["rust"]);
        },
        ({ workspace }) => rmSync(join(workspace.root, "tools", "Cargo.lock")),
      );
      await withLockfileCopy(
        registryDependencies,
        async (copy) => {
          const { workspace } = copy;
          const outside = join(workspace.root, "..", "outside-Cargo.lock");
          const content = readFileSync(outside, "utf8");
          const status = git(workspace, "status", "--porcelain");

          const run = await releaseVersion(copy, ["0.2.0", "--projects", "base"]);

          expect(run.status).toBe(1);
          expect(run.output).toContain(`- tools/Cargo.lock leads to ${realpathSync(outside)}`);
          expect(readFileSync(outside, "utf8")).toBe(content);
          expect(git(workspace, "status", "--porcelain")).toBe(status);
          expect(lockfileCalls(workspace)).toEqual([]);
        },
        ({ workspace }) => {
          const outside = join(workspace.root, "..", "outside-Cargo.lock");
          renameSync(join(workspace.root, "tools", "Cargo.lock"), outside);
          symlinkSync(outside, join(workspace.root, "tools", "Cargo.lock"));
        },
      );
    },
    2 * HARNESS_TIMEOUT,
  );

  it(
    "commits the file that a lockfile linked inside the repository leads to",
    () =>
      withLockfileCopy(
        registryDependencies,
        async (copy) => {
          const { workspace } = copy;
          const toolsBefore = read(workspace, "locks/tools.lock");

          const { status, output } = await releaseVersion(copy, ["0.2.0", "--projects", "base"]);

          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
          expect(output).toContain(
            "Updated locks/tools.lock, to which tools/Cargo.lock leads, with cargo update --workspace",
          );
          expect(readlinkSync(join(workspace.root, "tools", "Cargo.lock"))).toBe(
            join("..", "locks", "tools.lock"),
          );
          expectOnlyBumpedMembers(toolsBefore, read(workspace, "locks/tools.lock"), bumpedByBase);
          expect(
            cargo(workspace, "tools", copy.env, "update", "--workspace", "--locked").status,
          ).toBe(0);
          expect(git(workspace, "show", "--name-only", "--format=", "HEAD").split("\n")).toContain(
            "locks/tools.lock",
          );
          expect(git(workspace, "status", "--porcelain").trim()).toBe("");
        },
        ({ workspace }) => {
          mkdirSync(join(workspace.root, "locks"));
          renameSync(
            join(workspace.root, "tools", "Cargo.lock"),
            join(workspace.root, "locks", "tools.lock"),
          );
          symlinkSync(
            join("..", "locks", "tools.lock"),
            join(workspace.root, "tools", "Cargo.lock"),
          );
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "fails before any write, naming the file, where a lockfile cannot be read or is no valid TOML",
    async () => {
      // tools/Cargo.lock without read permission; rust/Cargo.lock with the
      // markers of a merge conflict.
      const cases: [string, (lockfile: string) => () => void, string][] = [
        [
          "tools/Cargo.lock",
          (lockfile) => {
            chmodSync(lockfile, 0o200);
            return () => chmodSync(lockfile, 0o644);
          },
          "- tools/Cargo.lock: EACCES: permission denied",
        ],
        [
          "rust/Cargo.lock",
          (lockfile) => {
            const content = readFileSync(lockfile, "utf8");
            writeFileSync(lockfile, `<<<<<<< HEAD\n${content}`);
            return () => writeFileSync(lockfile, content);
          },
          "- rust/Cargo.lock: no valid TOML: ",
        ],
      ];
      for (const [path, spoil, line] of cases) {
        await withLockfileCopy(registryDependencies, async (copy) => {
          const { workspace } = copy;
          const head = git(workspace, "rev-parse", "HEAD").trim();
          const restore = spoil(join(workspace.root, path));
          let run: { status: number | null; output: string };
          try {
            run = await releaseVersion(copy, ["0.2.0", "--projects", "base"]);
          } finally {
            restore();
          }

          expect({ path, status: run.status }).toEqual({ path, status: 1 });
          expect(run.output).toContain(
            "nx release version cannot read the Cargo.lock of a Cargo workspace, which it needs to tell whether the new version 0.2.0 of base makes it stale and to bring it up to date:",
          );
          expect(run.output).toContain(line);
          expect(run.output).toContain("No file has been changed.");
          expect(git(workspace, "status", "--porcelain").trim()).toBe("");
          expect(git(workspace, "rev-parse", "HEAD").trim()).toBe(head);
          expect(lockfileCalls(workspace)).toEqual([]);
        });
      }
    },
    2 * HARNESS_TIMEOUT,
  );

  it(
    "prints the commands to go back or on so that a POSIX shell runs them as printed, for a workspace folder with a space, a linked manifest and a lockfile that git does not track",
    () =>
      withLockfileCopy(
        {
          "rust/crates/registry-user/Cargo.toml": (manifest) =>
            (manifest ?? "").replace('fork = "0.1"\n', ""),
          "rust/Cargo.toml": (manifest) =>
            (manifest ?? "").replace(/\[patch\.crates-io\][^]*$/, ""),
          "tools/Cargo.toml": (manifest) => `${manifest}regdep = "1"\n`,
        },
        async (copy) => {
          const { workspace, registry } = copy;
          // git tracks no rust/Cargo.lock, so git checkout cannot take it
          // back, and base's Cargo.toml links to a file elsewhere.
          git(workspace, "rm", "--cached", "--quiet", "rust/Cargo.lock");
          mkdirSync(join(workspace.root, "linked"));
          const manifest = join(workspace.root, "rust", "crates", "base", "Cargo.toml");
          renameSync(manifest, join(workspace.root, "linked", "base.toml"));
          symlinkSync(join("..", "..", "..", "linked", "base.toml"), manifest);
          git(workspace, "add", "--all", "--", ":!rust/Cargo.lock");
          git(workspace, "commit", "--quiet", "--message", "No rust/Cargo.lock, base linked");

          // Only "tools space" asks the registry, which an empty Cargo home
          // offline cannot reach.
          const { status, output } = await releaseVersion(copy, ["0.2.0", "--projects", "base"], {
            CARGO_HOME: emptyHome(workspace, registry),
            CARGO_NET_OFFLINE: "true",
          });

          expect(status).toBe(1);
          expect(output).toContain(
            "cargo update --workspace failed in the Cargo workspace tools space/Cargo.toml, so nx release version cannot bring its Cargo.lock up to date:",
          );
          const back = /^\s*(git checkout -- .*)$/m.exec(output)?.[1] ?? "";
          const on = /^\s*(\(cd .* && cargo update --workspace\))$/m.exec(output)?.[1] ?? "";
          expect(output).toContain(
            "To go back, run this in the root of the Nx workspace, take back rust/Cargo.lock, which git does not track, by hand, and run nx release version again once cargo works:",
          );
          expect(back).toContain("'tools space/Cargo.toml'");
          expect(back).toContain("linked/base.toml");
          expect(back).not.toContain("rust/Cargo.lock");
          expect(back).not.toContain("rust/crates/base/Cargo.toml");
          expect(on).toBe("(cd 'tools space' && cargo update --workspace)");
          const shell = (command: string, env: Record<string, string | undefined>) =>
            spawnSync("sh", ["-c", command], {
              cwd: workspace.root,
              env: testEnvironment({ ...env, ...gitVariables(workspace) }),
              encoding: "utf8",
            });

          // Going on, with the registry reachable, brings the lockfile of
          // "tools space" up to date.
          expect(shell(on, copy.env)).toMatchObject({ status: 0 });
          expect(
            cargo(workspace, "tools space", copy.env, "update", "--workspace", "--locked").status,
          ).toBe(0);
          expect(
            lockedPackages(read(workspace, "tools space/Cargo.lock"))
              .filter((pkg) => pkg.name === "xtask")
              .map((pkg) => pkg.version),
          ).toEqual(["0.1.1"]);
          // Going back takes back every file that Nx wrote and git tracks,
          // which leaves the lockfile that going on updated and the one that
          // git does not track.
          expect(shell(back, {})).toMatchObject({ status: 0 });
          expect(
            git(workspace, "status", "--porcelain", "-z")
              .split("\0")
              .filter((entry) => entry !== "")
              .sort(),
          ).toEqual([" M tools space/Cargo.lock", "?? rust/Cargo.lock"]);
        },
        ({ workspace }) =>
          renameSync(join(workspace.root, "tools"), join(workspace.root, "tools space")),
      ),
    HARNESS_TIMEOUT,
  );
});

/** An empty Cargo home with the registry's configuration, whose cache holds nothing. */
function emptyHome(workspace: FixtureWorkspace, registry: SparseRegistry): string {
  const home = join(workspace.root, "..", "cargo-home-empty");
  mkdirSync(home, { recursive: true });
  for (const file of ["config.toml", "credentials.toml"]) {
    copyFileSync(join(registry.cargoHome, file), join(home, file));
  }
  return home;
}
