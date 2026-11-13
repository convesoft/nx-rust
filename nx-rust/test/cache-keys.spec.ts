import { chmodSync, cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { environmentVariables, hostTriples } from "../src/graph/inputs";
import {
  CacheKeyRow,
  describeCacheKeyMatrix,
  FileChanges,
  findExecutable,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  pinnedToolchain,
  pinnedToolchainAvailable,
  pluginSourceEntry,
  pnpmLockfile,
  testEnvironment,
} from "./harness";

// The rows of VER-CACHE-KEYS that the inputs and outputs of nxr-fy4t4k
// decide, checked with Nx's own task hasher on the plugin's inferred targets.
// The rows that need the lockfile task (nxr-xq9ava), fileInputs (nxr-d371vy),
// envInputs and runtimeInputs read from Cargo metadata (nxr-xyq7c8), the
// nextest runner (nxr-jb6g5y), the test modes and the artifact targets are
// left to those issues.

const appended = (text: string) => (current: string | undefined) => `${current ?? ""}${text}`;
const changed = appended("// changed\n");

/** The cached targets of `api` in `subfolder-workspace`, and the workspace's `doc`. */
const apiTasks = ["api:build", "api:check", "api:lint", "api:test", "api:fmt-check"];

/** Every task of the rows below gets this verdict. */
function all(tasks: string[], verdict: "must differ" | "must not differ") {
  return Object.fromEntries(tasks.map((task) => [task, verdict] as const));
}

// In subfolder-workspace, api depends on model normally, on codegen as a
// build dependency and on testkit as a dev-dependency. model depends on leaf,
// a crate that the rows below add, so that leaf is two edges away from api.
const listedMembers = (manifest: string) =>
  manifest.replace(
    /members = \[[^\]]*\]/,
    'members = ["crates/api", "crates/codegen", "crates/model", "crates/testkit"]',
  );

const withLeaf: FileChanges = {
  "rust/crates/leaf/Cargo.toml": '[package]\nname = "leaf"\nversion = "0.1.0"\nedition = "2024"\n',
  "rust/crates/leaf/src/lib.rs": "",
  "rust/crates/model/Cargo.toml": appended('\n[dependencies]\nleaf = { path = "../leaf" }\n'),
};

describeCacheKeyMatrix("keys must differ after", [
  ...[
    ["a source file", "rust/crates/api/src/lib.rs"],
    ["build.rs", "rust/crates/api/build.rs"],
    ["Cargo.toml", "rust/crates/api/Cargo.toml"],
    ["a README", "rust/crates/api/README.md"],
    ["a template", "rust/crates/api/templates/page.html"],
  ].map(([file, path]): CacheKeyRow => ({
    change: `a change in ${file} of the crate's folder`,
    fixture: "subfolder-workspace",
    base: { files: { [path]: (current) => current ?? "fn main() {}\n" } },
    after: { files: { [path]: path.endsWith(".toml") ? appended("\n# changed\n") : changed } },
    keys: { ...all(apiTasks, "must differ"), "rust:doc": "must differ" },
  })),
  ...[
    ["a normal dependency", "model"],
    ["a build dependency", "codegen"],
    ["a dev-dependency", "testkit"],
    ["a dependency two edges away", "leaf"],
  ].map(([kind, crate]): CacheKeyRow => ({
    change: `a change in ${kind}`,
    fixture: "subfolder-workspace",
    base: { files: withLeaf },
    after: { files: { [`rust/crates/${crate}/src/lib.rs`]: changed } },
    keys: all(apiTasks, "must differ"),
  })),
  ...[
    ["directly", "vendor/parser/src/lib.rs"],
    ["through another crate without a project", "vendor/lexer/src/lib.rs"],
  ].map(([how, path]): CacheKeyRow => ({
    change: `a change in an excluded crate that the crate depends on by path ${how}`,
    fixture: "vendored-crate",
    after: { files: { [path]: changed } },
    // app reaches both through lib.
    keys: { "lib:test": "must differ", "lib:build": "must differ", "app:test": "must differ" },
  })),
  {
    change: "a change in the root Cargo.toml",
    fixture: "subfolder-workspace",
    after: { files: { "rust/Cargo.toml": appended("\n# changed\n") } },
    keys: { ...all(apiTasks, "must differ"), "model:test": "must differ" },
  },
  ...[
    ["at crate level", "rust/crates/api/rust-toolchain.toml"],
    ["at workspace level", "rust/rust-toolchain.toml"],
  ].map(([level, path]): CacheKeyRow => ({
    change: `a change in a rust-toolchain.toml ${level}`,
    fixture: "subfolder-workspace",
    base: { files: { [path]: '[toolchain]\nchannel = "stable"\n' } },
    after: { files: { [path]: appended("# changed\n") } },
    keys: all(apiTasks, "must differ"),
  })),
  ...[
    ["at crate level", "rust/crates/api/.cargo/config.toml"],
    ["at workspace level", "rust/.cargo/config.toml"],
    ["in a folder in between", "rust/crates/.cargo/config.toml"],
    ["at the repository root", ".cargo/config.toml"],
  ].map(([level, path]): CacheKeyRow => ({
    change: `a change in a .cargo/config.toml ${level}`,
    fixture: "subfolder-workspace",
    // Members listed one by one, which `crates/*` would make of crates/.cargo too.
    base: { files: { "rust/Cargo.toml": listedMembers } },
    after: { files: { [path]: "# changed\n" } },
    keys: all(apiTasks, "must differ"),
  })),
  {
    change: "a change in a clippy.toml, for lint",
    fixture: "subfolder-workspace",
    after: { files: { "rust/clippy.toml": "# changed\n" } },
    keys: { "api:lint": "must differ", "api:test": "must not differ" },
  },
  {
    change: "a change in a rustfmt.toml, for fmt-check",
    fixture: "subfolder-workspace",
    after: { files: { "rust/rustfmt.toml": "# changed\n" } },
    keys: { "api:fmt-check": "must differ", "api:test": "must not differ" },
  },
  ...(
    [
      ["features", { features: ["extra"] }],
      ["profile", { profile: "release" }],
      ["target triple", { targetTriple: "wasm32-unknown-unknown" }],
    ] as const
  ).map(([option, overrides]): CacheKeyRow => ({
    change: `a change of ${option}`,
    fixture: "subfolder-workspace",
    after: { overrides },
    keys: { "api:build": "must differ" },
  })),
  {
    change: "a locked version bump of an external crate",
    fixture: "subfolder-workspace",
    base: { files: { "rust/Cargo.lock": appended(registryPackage("1.0.0", "a".repeat(64))) } },
    after: {
      files: {
        "rust/Cargo.lock": (lockfile) => lockfile.replace('version = "1.0.0"', 'version = "1.0.1"'),
      },
    },
    keys: all(
      apiTasks.filter((task) => task !== "api:fmt-check"),
      "must differ",
    ),
  },
  {
    change: "a change of only the checksum of an external crate",
    fixture: "subfolder-workspace",
    base: { files: { "rust/Cargo.lock": appended(registryPackage("1.0.0", "a".repeat(64))) } },
    after: {
      files: { "rust/Cargo.lock": (lockfile) => lockfile.replace("a".repeat(64), "b".repeat(64)) },
    },
    keys: { "api:test": "must differ", "model:build": "must differ" },
  },
  {
    change: "a change of only the commit of a git dependency",
    fixture: "subfolder-workspace",
    base: { files: { "rust/Cargo.lock": appended(gitPackage("1".repeat(40))) } },
    after: {
      files: { "rust/Cargo.lock": (lockfile) => lockfile.replace("1".repeat(40), "2".repeat(40)) },
    },
    keys: { "api:test": "must differ", "model:build": "must differ" },
  },
  {
    change: "a locked version bump in a Cargo.lock that Git ignores",
    fixture: "subfolder-workspace",
    base: {
      files: {
        ".gitignore": appended("Cargo.lock\n"),
        "rust/Cargo.lock": appended(registryPackage("1.0.0", "a".repeat(64))),
      },
    },
    after: {
      files: {
        "rust/Cargo.lock": (lockfile) => lockfile.replace('version = "1.0.0"', 'version = "1.0.1"'),
      },
    },
    keys: { "api:test": "must differ" },
  },
  {
    change:
      "a locked version bump that a crate reaches only through a path dependency without a project",
    fixture: "vendored-crate",
    base: { files: { "rust/Cargo.lock": appended(registryPackage("1.0.0", "a".repeat(64))) } },
    after: {
      files: {
        "rust/Cargo.lock": (lockfile) => lockfile.replace('version = "1.0.0"', 'version = "1.0.1"'),
      },
    },
    keys: { "lib:test": "must differ", "app:test": "must differ" },
  },
  {
    change: "a change in the manifest of another member, under the workspace-build strategy",
    fixture: "subfolder-workspace",
    after: { files: { "rust/crates/api/Cargo.toml": appended("\n# changed\n") } },
    // testkit depends on no other crate.
    keys: { "testkit:test": "must differ", "testkit:build": "must differ" },
  },
]);

describeCacheKeyMatrix("keys must not differ after", [
  {
    change: "a change in a crate that is not a dependency",
    fixture: "subfolder-workspace",
    after: { files: { "rust/crates/api/src/lib.rs": changed } },
    keys: all(["model:build", "model:test", "testkit:lint", "codegen:check"], "must not differ"),
  },
  {
    change: "a change of an environment variable outside the list",
    fixture: "subfolder-workspace",
    before: { env: { NX_RUST_UNLISTED: "a" } },
    after: { env: { NX_RUST_UNLISTED: "b" } },
    keys: { ...all(apiTasks, "must not differ"), "rust:doc": "must not differ" },
  },
  {
    change: "a change in the lockfile of another workspace",
    fixture: "cross-workspace-path",
    after: { files: { "backend/Cargo.lock": appended(registryPackage("1.0.0", "a".repeat(64))) } },
    // server, in backend, depends on model, in shared.
    keys: {
      "model:test": "must not differ",
      "model:build": "must not differ",
      "server:test": "must differ",
    },
  },
  {
    change: "a change in the toolchain file of another workspace",
    fixture: "cross-workspace-path",
    base: { files: { "backend/rust-toolchain.toml": '[toolchain]\nchannel = "stable"\n' } },
    after: { files: { "backend/rust-toolchain.toml": appended("# changed\n") } },
    keys: { "model:test": "must not differ", "server:test": "must differ" },
  },
  {
    change:
      "a change in the lockfile of a crate at the root of another workspace that the crate depends on",
    // legacy, which the workspace in rust excludes, is a workspace of its own.
    fixture: "excluded-member",
    base: {
      files: {
        "rust/crates/app/Cargo.toml": appended(
          '\n[dependencies]\nlegacy = { path = "../legacy" }\n',
        ),
      },
    },
    after: {
      files: {
        "rust/crates/legacy/Cargo.lock": appended(registryPackage("1.0.0", "a".repeat(64))),
      },
    },
    keys: { "app:test": "must not differ", "legacy:test": "must differ" },
  },
  {
    change:
      "a change in a file of the crate's folder that a negated pattern in the crate's own inputs leaves out",
    fixture: "subfolder-workspace",
    base: {
      files: {
        "rust/crates/api/project.json": JSON.stringify({
          targets: { test: { inputs: ["...", "!{projectRoot}/docs/**"] } },
        }),
        "rust/crates/api/docs/guide.md": "guide\n",
      },
    },
    after: { files: { "rust/crates/api/docs/guide.md": appended("changed\n") } },
    keys: { "api:test": "must not differ", "api:build": "must differ" },
  },
  {
    change: "a change in a file outside the crate's folder that none of the task's inputs covers",
    fixture: "subfolder-workspace",
    base: { files: { "README.md": "readme\n" } },
    after: { files: { "README.md": appended("changed\n") } },
    keys: { ...all(apiTasks, "must not differ"), "rust:doc": "must not differ" },
  },
]);

/** A `Cargo.lock` entry for a package from a git repository, locked to `commit`. */
function gitPackage(commit: string): string {
  return [
    "",
    "[[package]]",
    'name = "itoa"',
    'version = "1.0.15"',
    `source = "git+https://github.com/dtolnay/itoa?branch=master#${commit}"`,
    "",
  ].join("\n");
}

/** A `Cargo.lock` entry for a package from crates.io. */
function registryPackage(version: string, checksum: string): string {
  return [
    "",
    "[[package]]",
    'name = "ryu"',
    `version = "${version}"`,
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    `checksum = "${checksum}"`,
    "",
  ].join("\n");
}

describe("keys with the environment", () => {
  const triples = hostTriples().flatMap((triple) => {
    const key = triple.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return ["LINKER", "RUSTFLAGS", "RUNNER"].map((setting) => `CARGO_TARGET_${key}_${setting}`);
  });

  it(
    "differ after a change of each variable in the list, CARGO_BUILD_WARNINGS on the targets that compile and CLIPPY_CONF_DIR on lint",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace");
      try {
        const tasks = [...apiTasks, "rust:doc"];
        const base = await workspace.hashTasks(tasks);
        const failures: string[] = [];
        const expectations: [string, string[]][] = [
          ...[...environmentVariables, ...triples].map((variable): [string, string[]] => [
            variable,
            tasks,
          ]),
          ["CARGO_BUILD_WARNINGS", tasks.filter((task) => task !== "api:fmt-check")],
          ["CLIPPY_CONF_DIR", ["api:lint"]],
        ];
        for (const [variable, differing] of expectations) {
          // Cargo, which reads some of them when the graph is created, accepts these values.
          const value = variable === "CARGO_BUILD_WARNINGS" ? "deny" : "changed";
          const hashes = await workspace.hashTasks(tasks, { env: { [variable]: value } });
          for (const task of tasks) {
            const differs = hashes[task].value !== base[task].value;
            if (differs !== differing.includes(task)) {
              failures.push(
                `${variable}: the key of ${task} ${differs ? "changed" : "did not change"}`,
              );
            }
          }
        }
        expect(failures).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 4,
  );
});

describe("keys with the toolchain", () => {
  /**
   * A folder with a `rustc` that prints `rustc fake $FAKE_RUSTC_VERSION` in
   * the folder `fakeIn` and runs the real one elsewhere, so that a test can
   * update the toolchain of one workspace only.
   */
  function fakeRustc(fakeIn: string): { path: string; remove: () => void } {
    const folder = mkdtempSync(join(tmpdir(), "nx-rust-fake-rustc-"));
    const real = findExecutable("rustc", testEnvironment().PATH ?? "");
    writeFileSync(
      join(folder, "rustc"),
      [
        "#!/bin/sh",
        `case "$(pwd)" in */${fakeIn}) echo "rustc fake $FAKE_RUSTC_VERSION"; exit 0;; esac`,
        `exec '${real}' "$@"`,
        "",
      ].join("\n"),
    );
    chmodSync(join(folder, "rustc"), 0o755);
    return {
      path: [folder, testEnvironment().PATH].join(delimiter),
      remove: () => rmSync(folder, { recursive: true, force: true }),
    };
  }

  it(
    "differ after a toolchain update for the tasks of the workspace that uses it, and only for those",
    async () => {
      const rustc = fakeRustc("backend");
      const workspace = FixtureWorkspace.create("cross-workspace-path");
      try {
        const tasks = ["server:test", "server:build", "model:test", "model:build"];
        const before = await workspace.hashTasks(tasks, {
          env: { PATH: rustc.path, FAKE_RUSTC_VERSION: "1" },
        });
        const after = await workspace.hashTasks(tasks, {
          env: { PATH: rustc.path, FAKE_RUSTC_VERSION: "2" },
        });

        // server runs in backend; model, which server depends on, in shared.
        expect(
          Object.fromEntries(tasks.map((task) => [task, before[task].value !== after[task].value])),
        ).toEqual({
          "server:test": true,
          "server:build": true,
          "model:test": false,
          "model:build": false,
        });
      } finally {
        workspace.remove();
        rustc.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // Another installed toolchain; CI installs it for the different-toolchains fixture.
  if (pinnedToolchainAvailable()) {
    it(
      "differ after RUSTUP_TOOLCHAIN chooses another toolchain, also through a crate's .env, for that crate only",
      async () => {
        // A .env that Git ignores, so that only the toolchain changes for Nx.
        const workspace = FixtureWorkspace.create("subfolder-workspace", {
          ".gitignore": appended(".env\n"),
        });
        try {
          const tasks = ["api:test", "model:test", "testkit:test"];
          const base = await workspace.hashTasks(tasks);
          const shell = await workspace.hashTasks(tasks, {
            env: { RUSTUP_TOOLCHAIN: pinnedToolchain },
          });
          writeFileSync(
            join(workspace.root, "rust/crates/api/.env"),
            `RUSTUP_TOOLCHAIN=${pinnedToolchain}\n`,
          );
          const dotenv = await workspace.hashTasks(tasks);

          const differs = (hashes: typeof base) =>
            Object.fromEntries(
              tasks.map((task) => [task, hashes[task].value !== base[task].value]),
            );
          expect(differs(shell)).toEqual({
            "api:test": true,
            "model:test": true,
            "testkit:test": true,
          });
          // model and testkit do not depend on api.
          expect(differs(dotenv)).toEqual({
            "api:test": true,
            "model:test": false,
            "testkit:test": false,
          });
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  }

  it(
    "never repeat while the toolchain that a task uses is missing, and repeat otherwise",
    async () => {
      // A toolchain that rustup cannot have; the harness also sets
      // RUSTUP_AUTO_INSTALL=0, as the input's command does itself.
      const workspace = FixtureWorkspace.create("subfolder-workspace", {
        ".gitignore": appended(".env\n"),
      });
      try {
        const tasks = ["api:test", "model:test"];
        const first = await workspace.hashTasks(tasks);
        const second = await workspace.hashTasks(tasks);
        expect(second["api:test"].value).toBe(first["api:test"].value);

        // Missing after the graph was created: graph creation does not read a crate's .env.
        writeFileSync(
          join(workspace.root, "rust/crates/api/.env"),
          "RUSTUP_TOOLCHAIN=nx-rust-missing-toolchain\n",
        );
        const third = await workspace.hashTasks(tasks);
        const fourth = await workspace.hashTasks(tasks);
        expect(third["api:test"].value).not.toBe(fourth["api:test"].value);
        expect(third["model:test"].value).toBe(first["model:test"].value);
        expect(fourth["model:test"].value).toBe(first["model:test"].value);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("keys with the plugin's version", () => {
  it(
    "differ for another version of the plugin loaded by path, with Nx's lockfile analysis off, and no task fails to hash",
    async () => {
      // A copy of the plugin outside the repository, which nx.json names by path.
      const copy = mkdtempSync(join(tmpdir(), "nx-rust-plugin-copy-"));
      const source = join(pluginSourceEntry, "..");
      cpSync(source, join(copy, "src"), { recursive: true });
      const version = (value: string) =>
        writeFileSync(
          join(copy, "package.json"),
          JSON.stringify({ name: "@convesoft/nx-rust", version: value }),
        );
      const files: FileChanges = {
        "nx.json": JSON.stringify({
          plugins: [join(copy, "src", "index.ts")],
          pluginsConfig: { "@nx/js": { analyzeLockfile: false } },
        }),
      };
      version("1.0.0");
      const workspace = FixtureWorkspace.create("subfolder-workspace", files);
      try {
        const tasks = ["api:test", "api:build", "rust:doc", "rust:audit"];
        const before = await workspace.hashTasks(tasks);
        version("1.0.1");
        workspace.reset(files);
        const after = await workspace.hashTasks(tasks);

        for (const task of tasks) {
          expect({ task, differs: before[task].value !== after[task].value }).toEqual({
            task,
            differs: true,
          });
        }
      } finally {
        workspace.remove();
        rmSync(copy, { recursive: true, force: true });
      }
    },
    HARNESS_TIMEOUT,
  );

  // A root package.json and a pnpm lockfile that lists the plugin, as an
  // installed plugin has them.
  const installed = (integrity: { tslib?: string; leftPad?: string } = {}): FileChanges => ({
    "package.json": JSON.stringify({
      name: "repo",
      private: true,
      devDependencies: { "@convesoft/nx-rust": "0.0.1", "left-pad": "1.3.0" },
    }),
    "pnpm-lock.yaml": pnpmLockfile("0.0.1", integrity),
    "node_modules/.modules.yaml": "{}\n",
  });

  describeCacheKeyMatrix("where the Rust targets name the plugin's package", [
    {
      change: "a change in the JS lockfile to a package that the plugin depends on",
      fixture: "subfolder-workspace",
      before: { files: installed() },
      after: { files: installed({ tslib: `sha512-${"9".repeat(86)}==` }) },
      keys: { "api:test": "must differ", "rust:doc": "must differ" },
    },
    {
      change:
        "a change in the JS lockfile outside the plugin's package and the packages it depends on",
      fixture: "subfolder-workspace",
      before: { files: installed() },
      after: { files: installed({ leftPad: `sha512-${"9".repeat(86)}==` }) },
      keys: { "api:test": "must not differ", "rust:doc": "must not differ" },
    },
  ]);
});
