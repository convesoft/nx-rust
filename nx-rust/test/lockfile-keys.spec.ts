import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CacheKeyRow,
  describeCacheKeyMatrix,
  FileChanges,
  applyFileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  LocalRegistry,
  testEnvironment,
  WorkspaceState,
} from "./harness";

/** What a state does once its files are in place. */
type Prepare = NonNullable<WorkspaceState["prepare"]>;

// The rows of VER-CACHE-KEYS about Cargo.lock, checked with Nx's own task
// hasher after the lockfile tasks have run, as they do before the crate
// tasks in a real run (DES-LOCKFILE-HASHING). The external crates come from
// a local registry that replaces crates.io in a Cargo home of its own, so
// that versions can be locked, bumped and published without the network.
// The digest's own rules, such as a change of only a checksum, are checked
// in lockfile-digest.spec.ts.

let registry: LocalRegistry;
/** A git repository that a crate can depend on, with two commits. */
let gitRepository: string;
let gitCommits: string[];
/** The environment of every state: the registry's Cargo home. */
const env: Record<string, string | undefined> = {};

beforeAll(() => {
  registry = LocalRegistry.create([
    { name: "zzlib", version: "1.0.0" },
    { name: "zzlib", version: "1.0.1" },
    { name: "zzlib", version: "2.0.0" },
    { name: "yylib", version: "1.0.0" },
    { name: "yylib", version: "1.0.1" },
    { name: "xxlib", version: "1.0.0" },
    {
      name: "wwlib",
      version: "1.0.0",
      dependencies: [{ name: "xxlib", req: "^1", optional: true }],
      features: { extra: ["xxlib"] },
    },
    { name: "wrapper", version: "1.0.0", dependencies: [{ name: "zzlib", req: ">=1, <3" }] },
    { name: "vvlib", version: "1.0.0" },
  ]);
  env.CARGO_HOME = registry.cargoHome;
  gitRepository = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-gitlib-")));
  mkdirSync(join(gitRepository, "src"));
  writeFileSync(
    join(gitRepository, "Cargo.toml"),
    '[package]\nname = "gitlib"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  git("init", "-q");
  gitCommits = ["", "// changed\n"].map((source) => {
    writeFileSync(join(gitRepository, "src", "lib.rs"), source);
    git("add", "-A");
    git("commit", "-q", "-m", "commit");
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: gitRepository, encoding: "utf8" }).trim();
  });
}, HARNESS_TIMEOUT);

afterAll(() => {
  registry?.remove();
  if (gitRepository !== undefined && !process.env.NX_RUST_KEEP_FIXTURES) {
    rmSync(gitRepository, { recursive: true, force: true });
  }
});

function git(...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: gitRepository,
    env: testEnvironment(),
    stdio: "pipe",
  });
}

const appended = (text: string) => (current: string | undefined) => `${current ?? ""}${text}`;

/** A change that adds dependency lines to a manifest's `[dependencies]`, which it may lack. */
function dependencies(...lines: string[]): (manifest: string | undefined) => string {
  return (manifest = "") =>
    manifest.includes("\n[dependencies]\n")
      ? manifest.replace("\n[dependencies]\n", `\n[dependencies]\n${lines.join("\n")}\n`)
      : `${manifest}\n[dependencies]\n${lines.join("\n")}\n`;
}

/** A crate of its own in `folder`, outside any workspace's members unless one lists it. */
function crate(folder: string, name: string, ...dependencyLines: string[]): FileChanges {
  return {
    [`${folder}/Cargo.toml`]: [
      "[package]",
      `name = "${name}"`,
      'version = "0.1.0"',
      'edition = "2024"',
      "",
      "[dependencies]",
      ...dependencyLines,
      "",
    ].join("\n"),
    [`${folder}/src/lib.rs`]: "",
  };
}

/** Runs cargo commands in a folder of the workspace, with the registry's Cargo home. */
function cargo(folder: string, ...commands: string[][]): Prepare {
  return (workspace: FixtureWorkspace, stateEnv: Record<string, string | undefined>) => {
    for (const args of commands) {
      execFileSync("cargo", args, {
        cwd: join(workspace.root, folder),
        env: testEnvironment(stateEnv),
        stdio: "pipe",
      });
    }
  };
}

/** Locks `pkg` at `version` in the workspace in `folder`, after cargo has locked the rest. */
function lockedAt(folder: string, pkg: string, version: string): Prepare {
  return cargo(folder, ["generate-lockfile"], ["update", "-p", pkg, "--precise", version]);
}

/** Lets cargo lock the workspace in `folder` at the newest versions. */
function newest(folder: string): Prepare {
  return cargo(folder, ["generate-lockfile"]);
}

/**
 * Changes files of the workspace once the base's lockfile is in place, so
 * that the lockfile is stale in the state, as after an edit.
 */
function edit(files: FileChanges): Prepare {
  return (workspace) => applyFileChanges(workspace.root, files);
}

/** Every listed task gets the verdict. */
function all(tasks: string[], verdict: "must differ" | "must not differ") {
  return Object.fromEntries(tasks.map((task) => [task, verdict] as const));
}

const compiling = ["build", "check", "lint", "test"];

// In subfolder-workspace, api depends on model normally, on codegen as a
// build dependency and on testkit as a dev-dependency. model depends on
// zzlib and testkit on yylib.
const subfolderBase = {
  files: {
    "rust/crates/model/Cargo.toml": dependencies('zzlib = "1"'),
    "rust/crates/testkit/Cargo.toml": dependencies('yylib = "1"'),
  },
  env,
};

describeCacheKeyMatrix("keys with the lockfile task: must differ after", [
  {
    change:
      "a locked version bump of an external crate the crate depends on, directly or transitively, and not for fmt-check",
    fixture: "subfolder-workspace",
    lockfileTask: true,
    base: subfolderBase,
    before: { prepare: lockedAt("rust", "zzlib", "1.0.0") },
    after: { prepare: lockedAt("rust", "zzlib", "1.0.1") },
    keys: {
      ...all(
        compiling.map((target) => `model:${target}`),
        "must differ",
      ),
      ...all(
        compiling.map((target) => `api:${target}`),
        "must differ",
      ),
      "rust:doc": "must differ",
      "model:fmt-check": "must not differ",
    },
  },
  {
    change: "such a bump in a Cargo.lock that Git ignores",
    fixture: "subfolder-workspace",
    lockfileTask: true,
    base: { ...subfolderBase, files: { ...subfolderBase.files, ".gitignore": appended("Cargo.lock\n") } },
    before: { prepare: lockedAt("rust", "zzlib", "1.0.0") },
    after: { prepare: lockedAt("rust", "zzlib", "1.0.1") },
    keys: { "model:test": "must differ", "api:test": "must differ" },
  },
  {
    change: "a locked version bump that a crate reaches only through a path dependency without a project",
    // lib depends on vendor/parser, which nx.json excludes.
    fixture: "vendored-crate",
    lockfileTask: true,
    base: { files: { "vendor/parser/Cargo.toml": dependencies('zzlib = "1"') }, env },
    before: { prepare: lockedAt("rust", "zzlib", "1.0.0") },
    after: { prepare: lockedAt("rust", "zzlib", "1.0.1") },
    keys: { "lib:test": "must differ", "lib:build": "must differ", "app:test": "must differ" },
  },
  {
    change:
      "a locked version bump that a crate reaches through a crate of another workspace, as its own workspace's lockfile resolves it",
    // server, in backend, depends by path on model, a member of shared.
    fixture: "cross-workspace-path",
    lockfileTask: true,
    base: {
      files: { "shared/crates/model/Cargo.toml": dependencies('zzlib = "1"') },
      env,
      prepare: lockedAt("shared", "zzlib", "1.0.0"),
    },
    before: { prepare: lockedAt("backend", "zzlib", "1.0.0") },
    after: { prepare: lockedAt("backend", "zzlib", "1.0.1") },
    keys: { "server:test": "must differ", "model:test": "must not differ" },
  },
  {
    change: "a locked version bump that a crate reaches only through a replace entry of the lockfile",
    // [replace] puts third_party/zzlib, which depends on yylib, in place of zzlib 1.0.0.
    fixture: "subfolder-workspace",
    lockfileTask: true,
    base: {
      files: {
        "rust/crates/model/Cargo.toml": dependencies('zzlib = "=1.0.0"'),
        "rust/Cargo.toml": appended('\n[replace]\n"zzlib:1.0.0" = { path = "../third_party/zzlib" }\n'),
        "third_party/zzlib/Cargo.toml":
          '[package]\nname = "zzlib"\nversion = "1.0.0"\nedition = "2021"\n\n[dependencies]\nyylib = "1"\n',
        "third_party/zzlib/src/lib.rs": "",
      },
      env,
    },
    before: { prepare: lockedAt("rust", "yylib", "1.0.0") },
    after: { prepare: lockedAt("rust", "yylib", "1.0.1") },
    keys: { "model:test": "must differ", "api:test": "must differ", "codegen:test": "must not differ" },
  },
  {
    change: "a change of only the commit of a git dependency",
    fixture: "subfolder-workspace",
    lockfileTask: true,
    base: {
      files: {
        "rust/crates/model/Cargo.toml": (manifest) =>
          dependencies(`gitlib = { git = "file://${gitRepository}" }`)(manifest),
      },
      env,
    },
    before: { prepare: (workspace, stateEnv) => lockedAt("rust", "gitlib", gitCommits[0])(workspace, stateEnv) },
    after: { prepare: (workspace, stateEnv) => lockedAt("rust", "gitlib", gitCommits[1])(workspace, stateEnv) },
    keys: { "model:test": "must differ", "testkit:test": "must not differ" },
  },
  {
    change:
      "a requirement that a sibling adds and that moves a shared version, which the lockfile task brings into the stale lockfile",
    fixture: "subfolder-workspace",
    lockfileTask: true,
    base: { ...subfolderBase, prepare: lockedAt("rust", "zzlib", "1.0.0") },
    after: { prepare: edit({ "rust/crates/codegen/Cargo.toml": dependencies('zzlib = "=1.0.1"') }) },
    keys: { "model:test": "must differ" },
  },
  {
    change:
      "a feature that a sibling switches on and that adds packages to the crate's dependencies, in the stale lockfile",
    fixture: "subfolder-workspace",
    lockfileTask: true,
    base: {
      files: { "rust/crates/model/Cargo.toml": dependencies('wwlib = "1"') },
      env,
      prepare: newest("rust"),
    },
    after: {
      prepare: edit({
        "rust/crates/codegen/Cargo.toml": dependencies('wwlib = { version = "1", features = ["extra"] }'),
      }),
    },
    keys: { "model:test": "must differ" },
  },
  {
    change: "a [replace] added to the root manifest, in the stale lockfile",
    fixture: "subfolder-workspace",
    lockfileTask: true,
    base: {
      ...subfolderBase,
      files: {
        ...subfolderBase.files,
        "rust/crates/model/Cargo.toml": dependencies('zzlib = "=1.0.0"'),
        "third_party/zzlib/Cargo.toml":
          '[package]\nname = "zzlib"\nversion = "1.0.0"\nedition = "2021"\n',
        "third_party/zzlib/src/lib.rs": "",
      },
      prepare: newest("rust"),
    },
    after: {
      prepare: edit({
        "rust/Cargo.toml": appended('\n[replace]\n"zzlib:1.0.0" = { path = "../third_party/zzlib" }\n'),
      }),
    },
    keys: { "model:test": "must differ" },
  },
  {
    change:
      "a stale lockfile, identical in both states, that the lockfile task resolves to a version published to the registry between the two runs",
    fixture: "subfolder-workspace",
    lockfileTask: true,
    // model gets vvlib, which the fixture's Cargo.lock does not lock.
    base: { files: { "rust/crates/model/Cargo.toml": dependencies('vvlib = "1"') }, env },
    after: {
      prepare: () => {
        try {
          registry.publish({ name: "vvlib", version: "1.0.1" });
        } catch {
          // Published by an earlier run of this row.
        }
      },
    },
    keys: { "model:test": "must differ", "api:test": "must differ", "testkit:test": "must not differ" },
  },
  {
    change:
      "two current lockfiles that lock the same packages and differ only in a dependency of one entry",
    // model uses zzlib 1 and 2 directly, and wrapper, which takes either.
    fixture: "subfolder-workspace",
    lockfileTask: true,
    base: {
      files: {
        "rust/crates/model/Cargo.toml": dependencies(
          'zzlib = "1"',
          'zz2 = { package = "zzlib", version = "2" }',
          'wrapper = "1"',
        ),
      },
      env,
      prepare: newest("rust"),
    },
    after: {
      prepare: (workspace) => {
        const file = join(workspace.root, "rust", "Cargo.lock");
        const lockfile = readFileSync(file, "utf8");
        const edited = lockfile.replace(
          /(name = "wrapper"[^[]*dependencies = \[\s*)"zzlib 2\.0\.0"/,
          '$1"zzlib 1.0.1"',
        );
        expect(edited).not.toBe(lockfile);
        writeFileSync(file, edited);
      },
    },
    keys: { "model:test": "must differ", "api:test": "must differ" },
  },
]);

describeCacheKeyMatrix("keys with the lockfile task: must not differ after", [
  {
    change: "a locked version bump of an external crate outside the crate's resolved dependencies",
    fixture: "subfolder-workspace",
    lockfileTask: true,
    base: subfolderBase,
    before: { prepare: lockedAt("rust", "yylib", "1.0.0") },
    after: { prepare: lockedAt("rust", "yylib", "1.0.1") },
    keys: {
      ...all(
        compiling.map((target) => `model:${target}`),
        "must not differ",
      ),
      "codegen:test": "must not differ",
      // testkit uses yylib, and api dev-depends on testkit.
      "testkit:test": "must differ",
      "api:test": "must differ",
    },
  },
  {
    change:
      "such a bump for the crate at the root of its workspace and for a crate that depends on it",
    // tools is the crate of tools/'s root manifest; extra is a member that
    // tools does not depend on, and consumer a member that depends on tools.
    fixture: "two-workspaces",
    lockfileTask: true,
    base: {
      files: {
        "tools/Cargo.toml": (manifest) =>
          (manifest ?? "").replace(
            'members = ["scaffold"]',
            'members = ["scaffold", "extra", "consumer"]',
          ),
        ...crate("tools/extra", "extra", 'zzlib = "1"'),
        ...crate("tools/consumer", "consumer", 'tools = { path = ".." }'),
      },
      env,
    },
    before: { prepare: lockedAt("tools", "zzlib", "1.0.0") },
    after: { prepare: lockedAt("tools", "zzlib", "1.0.1") },
    keys: {
      "tools:test": "must not differ",
      "tools:build": "must not differ",
      "scaffold:test": "must not differ",
      "consumer:test": "must not differ",
      "app:test": "must not differ",
      "extra:test": "must differ",
    },
  },
  {
    change:
      "a bump in the lockfile of a standalone crate, for a crate of another workspace that depends on it",
    // legacy, which the workspace in rust excludes, is a workspace of its own.
    fixture: "excluded-member",
    lockfileTask: true,
    base: {
      files: {
        "rust/crates/legacy/Cargo.toml": dependencies('zzlib = "1"'),
        "rust/crates/app/Cargo.toml": dependencies('legacy = { path = "../legacy" }'),
      },
      env,
      prepare: lockedAt("rust", "zzlib", "1.0.0"),
    },
    before: { prepare: lockedAt("rust/crates/legacy", "zzlib", "1.0.0") },
    after: { prepare: lockedAt("rust/crates/legacy", "zzlib", "1.0.1") },
    keys: { "app:test": "must not differ", "legacy:test": "must differ" },
  },
  {
    change:
      "a bump in the lockfile of the workspace of a crate that depends on a standalone crate, for the standalone crate",
    fixture: "excluded-member",
    lockfileTask: true,
    base: {
      files: {
        "rust/crates/legacy/Cargo.toml": dependencies('zzlib = "1"'),
        "rust/crates/app/Cargo.toml": dependencies('legacy = { path = "../legacy" }'),
      },
      env,
      prepare: lockedAt("rust/crates/legacy", "zzlib", "1.0.0"),
    },
    before: { prepare: lockedAt("rust", "zzlib", "1.0.0") },
    after: { prepare: lockedAt("rust", "zzlib", "1.0.1") },
    keys: { "legacy:test": "must not differ", "legacy:build": "must not differ", "app:test": "must differ" },
  },
  {
    change: "a change in the lockfile of another workspace",
    fixture: "cross-workspace-path",
    lockfileTask: true,
    base: {
      files: { "shared/crates/model/Cargo.toml": dependencies('zzlib = "1"') },
      env,
      prepare: lockedAt("backend", "zzlib", "1.0.0"),
    },
    before: { prepare: lockedAt("shared", "zzlib", "1.0.0") },
    after: { prepare: lockedAt("shared", "zzlib", "1.0.1") },
    // server, in backend, depends on model, in shared, and is keyed on backend's lockfile.
    keys: { "server:test": "must not differ", "server:build": "must not differ", "model:test": "must differ" },
  },
]);

describe("the digests of a run", () => {
  it(
    "follow a stale lockfile that the lockfile task brings up to date, and leave a current one as it is",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace", subfolderBase.files);
      try {
        const digests = () => {
          const folder = join(workspace.root, ".nx", "workspace-data", "nx-rust", "lockfile", "rust");
          return Object.fromEntries(
            ["api", "codegen", "model", "testkit"].map((name) => [
              name,
              readFileSync(join(folder, `${name}.digest`), "utf8"),
            ]),
          );
        };
        const run = async () => {
          const { status, output } = await workspace.nx(
            ["run-many", "-t", "lockfile", "--output-style=static"],
            env,
          );
          expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
        };
        await lockedAt("rust", "zzlib", "1.0.0")(workspace, env);
        await run();
        const first = digests();
        const lockfile = readFileSync(join(workspace.root, "rust", "Cargo.lock"), "utf8");

        // A current lockfile: cargo leaves it, and the digests stay.
        await run();
        expect(readFileSync(join(workspace.root, "rust", "Cargo.lock"), "utf8")).toBe(lockfile);
        expect(digests()).toEqual(first);

        // codegen asks for the newer zzlib, which model shares.
        writeFileSync(
          join(workspace.root, "rust", "crates", "codegen", "Cargo.toml"),
          dependencies('zzlib = "=1.0.1"')(
            readFileSync(join(workspace.root, "rust", "crates", "codegen", "Cargo.toml"), "utf8"),
          ),
        );
        await run();
        const second = digests();
        expect(readFileSync(join(workspace.root, "rust", "Cargo.lock"), "utf8")).toContain(
          'name = "zzlib"\nversion = "1.0.1"',
        );
        // model's own files did not change, its locked dependencies did.
        expect(second.model).not.toBe(first.model);
        expect(second.api).not.toBe(first.api);
        expect(second.testkit).toBe(first.testkit);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
