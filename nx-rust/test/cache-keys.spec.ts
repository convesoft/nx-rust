import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { environmentVariables } from "../src/graph/inputs";
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
// lockfile-keys.spec.ts holds the rows about Cargo.lock, which need the
// lockfile task and a registry. The rows that need fileInputs (nxr-d371vy),
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
  // A crate whose folder holds .cargo-checksum.json gets no report, so the
  // plugin does not know the path dependencies behind it, but its own folder
  // is an input of the crates that use it.
  {
    change:
      "a change in a path dependency without a project and without a report, a crate of a directory source",
    fixture: "crate-shapes",
    base: {
      files: {
        "rust/Cargo.toml": appended('\nexclude = ["vendor"]\n'),
        "rust/crates/cli/Cargo.toml": appended('vendorlib = { path = "../../vendor" }\n'),
        "rust/vendor/Cargo.toml":
          '[package]\nname = "vendorlib"\nversion = "0.1.0"\nedition = "2024"\n',
        "rust/vendor/.cargo-checksum.json": '{"files":{},"package":null}\n',
        "rust/vendor/src/lib.rs": "pub fn value() {}\n",
      },
    },
    after: { files: { "rust/vendor/src/lib.rs": 'compile_error!("vendored source changed");\n' } },
    keys: {
      "cli:check": "must differ",
      "cli:build": "must differ",
      "cli:test": "must differ",
      "cli:lint": "must differ",
      "core-lib:check": "must not differ",
    },
  },
  {
    change:
      "a change in a path dependency without a report that the crate reaches through a crate without a project",
    fixture: "vendored-crate",
    base: { files: { "vendor/lexer/.cargo-checksum.json": '{"files":{},"package":null}\n' } },
    after: { files: { "vendor/lexer/src/lib.rs": changed } },
    keys: { "lib:test": "must differ", "lib:build": "must differ", "app:test": "must differ" },
  },
  ...[
    [
      "without a project",
      "third_party/fork/src/lib.rs",
      ["api", "viaw", "util", "harness", "model"],
    ],
    ["whose edge is left out to avoid a cycle", "rust/crates/model/src/lib.rs", ["util"]],
    ["with a project in another workspace", "shared/crates/types/src/lib.rs", ["api", "util"]],
  ].map(([which, path, members]): CacheKeyRow => ({
    change: `a change in a redirected crate ${which as string}, for every member that may use it`,
    // rust/Cargo.toml's [patch.crates-io] redirects model, types and fork.
    fixture: "patched-workspaces",
    after: { files: { [path as string]: changed } },
    keys: all(
      (members as string[]).map((member) => `${member}:test`),
      "must differ",
    ),
  })),
  ...(
    [
      [
        "[replace]",
        {
          "rust/Cargo.toml": appended('\n[replace]\n"itoa:1.0.18" = { path = "../vendor/itoa" }\n'),
        },
      ],
      ["paths", { "rust/.cargo/config.toml": 'paths = ["../vendor/itoa"]\n' }],
    ] as const
  ).map(([table, redirection]): CacheKeyRow => ({
    change: `a change in a crate without a project that ${table} redirects to, for the members with a registry dependency and no other`,
    fixture: "subfolder-workspace",
    base: {
      files: {
        ...redirection,
        // api depends on itoa from crates.io; the plugin's entry excludes vendor.
        "rust/crates/api/Cargo.toml": (manifest) =>
          manifest.replace("[dependencies]\n", '[dependencies]\nitoa = "=1.0.18"\n'),
        "vendor/itoa/Cargo.toml":
          '[package]\nname = "itoa"\nversion = "1.0.18"\nedition = "2024"\n\n[workspace]\n',
        "vendor/itoa/src/lib.rs": "pub fn review() {}\n",
        "nx.json": (text) =>
          JSON.stringify({
            ...JSON.parse(text),
            plugins: JSON.parse(text).plugins.map((plugin: string) => ({
              plugin,
              exclude: ["vendor/**"],
            })),
          }),
      },
    },
    after: { files: { "vendor/itoa/src/lib.rs": changed } },
    keys: {
      "api:check": "must differ",
      "api:build": "must differ",
      "testkit:check": "must not differ",
    },
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
    change: "a change in a configuration file that the workspace's .cargo/config.toml includes",
    fixture: "subfolder-workspace",
    base: {
      files: {
        "rust/.cargo/config.toml": 'include = ["extra.toml"]\n',
        "rust/.cargo/extra.toml": "[build]\nrustflags = []\n",
      },
    },
    after: { files: { "rust/.cargo/extra.toml": '[build]\nrustflags = ["--cfg", "extra"]\n' } },
    keys: all(apiTasks, "must differ"),
  },
  {
    change: "a change in a clippy.toml, for lint",
    fixture: "subfolder-workspace",
    after: { files: { "rust/clippy.toml": "# changed\n" } },
    keys: { "api:lint": "must differ", "api:test": "must not differ" },
  },
  {
    change: "a change in .config/nextest.toml, for a test that nextest runs",
    fixture: "subfolder-workspace",
    base: {
      files: {
        "rust/Cargo.toml": appended('\n[workspace.metadata.nx]\ntestRunner = "nextest"\n'),
        "rust/.config/nextest.toml": "# a\n",
      },
    },
    after: { files: { "rust/.config/nextest.toml": "# b\n" } },
    keys: { "api:test": "must differ", "api:build": "must not differ" },
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
    change: "a change in a redirected crate, for a member without registry or git dependencies",
    fixture: "patched-workspaces",
    after: {
      files: {
        "third_party/fork/src/lib.rs": changed,
        "rust/crates/model/src/lib.rs": changed,
        "shared/crates/types/src/lib.rs": changed,
      },
    },
    keys: { "plain:test": "must not differ", "plain:build": "must not differ" },
  },
  {
    change: "a change of an environment variable outside the list",
    fixture: "subfolder-workspace",
    before: { env: { NX_RUST_UNLISTED: "a" } },
    after: { env: { NX_RUST_UNLISTED: "b" } },
    keys: { ...all(apiTasks, "must not differ"), "rust:doc": "must not differ" },
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

describe("keys with the environment", () => {
  // Cargo's variables for a profile or a triple, of any name; not CARGO_TARGET_DIR.
  const families = [
    "CARGO_PROFILE_DEV_DEBUG_ASSERTIONS",
    "CARGO_PROFILE_CUSTOM_OPT_LEVEL",
    "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER",
    "CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS",
    "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER",
  ];

  it(
    "differ after a change of each variable in the list, CARGO_BUILD_WARNINGS on the targets that compile and CLIPPY_CONF_DIR on lint",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace");
      try {
        const tasks = [...apiTasks, "rust:doc"];
        const base = await workspace.hashTasks(tasks);
        const failures: string[] = [];
        const expectations: [string, string[]][] = [
          ...[...environmentVariables, ...families].map((variable): [string, string[]] => [
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
  it(
    "differ after a profile or target variable in a crate's .env, for that crate only, and not after CARGO_TARGET_DIR there",
    async () => {
      // A .env that Git ignores, so that only the environment changes for Nx.
      const workspace = FixtureWorkspace.create("subfolder-workspace", {
        ".gitignore": appended(".env\n"),
      });
      try {
        const tasks = ["api:build", "api:test", "model:build"];
        const base = await workspace.hashTasks(tasks);
        const differs = async (dotenv: string) => {
          writeFileSync(join(workspace.root, "rust/crates/api/.env"), dotenv);
          const hashes = await workspace.hashTasks(tasks);
          return Object.fromEntries(
            tasks.map((task) => [task, hashes[task].value !== base[task].value]),
          );
        };

        expect(await differs("CARGO_PROFILE_DEV_DEBUG_ASSERTIONS=false\n")).toEqual({
          "api:build": true,
          "api:test": true,
          "model:build": false,
        });
        expect(await differs("CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS=--cfg=a\n")).toEqual({
          "api:build": true,
          "api:test": true,
          "model:build": false,
        });
        expect(
          await differs(`CARGO_TARGET_DIR=${join(workspace.root, "..", "elsewhere")}\n`),
        ).toEqual({
          "api:build": false,
          "api:test": false,
          "model:build": false,
        });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/** The options of the plugin's entry in `nx.json`. */
const pluginEntryOptions =
  (options: object) =>
  (text: string | undefined): string => {
    const nxJson = JSON.parse(text ?? "{}");
    nxJson.plugins = nxJson.plugins.map((entry: string | { plugin: string }) => ({
      plugin: typeof entry === "string" ? entry : entry.plugin,
      options,
    }));
    return JSON.stringify(nxJson);
  };

describeCacheKeyMatrix("keys with what the repository adds", [
  ...(
    [
      [
        "the crate's own table",
        {
          "rust/crates/model/Cargo.toml": appended(
            '\n[package.metadata.nx]\nenvInputs = ["REVIEW_ADDED"]\n',
          ),
        },
      ],
      [
        "the workspace table",
        {
          "rust/Cargo.toml": appended('\n[workspace.metadata.nx]\nenvInputs = ["REVIEW_ADDED"]\n'),
        },
      ],
      ["the plugin options", { "nx.json": pluginEntryOptions({ envInputs: ["REVIEW_ADDED"] }) }],
    ] as const
  ).map(([where, files]): CacheKeyRow => ({
    change: `a change of a variable that envInputs adds in ${where}, for the crate and the crates that depend on it`,
    fixture: "subfolder-workspace",
    base: { files },
    before: { env: { REVIEW_ADDED: "a" } },
    after: { env: { REVIEW_ADDED: "b" } },
    keys: { "model:test": "must differ", "model:build": "must differ", "api:test": "must differ" },
  })),
  {
    change:
      "a change of the output of a command that runtimeInputs adds in the crate's table, for the crate and the crates that depend on it, and no other",
    fixture: "subfolder-workspace",
    base: {
      files: {
        "rust/crates/model/Cargo.toml": appended(
          '\n[package.metadata.nx]\nruntimeInputs = ["echo $REVIEW_RUNTIME"]\n',
        ),
      },
    },
    before: { env: { REVIEW_RUNTIME: "a" } },
    after: { env: { REVIEW_RUNTIME: "b" } },
    keys: {
      "model:test": "must differ",
      "api:test": "must differ",
      "testkit:test": "must not differ",
    },
  },
  {
    change:
      "a change of a variable that the workspace table adds, for a crate that adds one of its own",
    fixture: "subfolder-workspace",
    base: {
      files: {
        "rust/Cargo.toml": appended(
          '\n[workspace.metadata.nx]\nenvInputs = ["REVIEW_WORKSPACE"]\n',
        ),
        "rust/crates/model/Cargo.toml": appended(
          '\n[package.metadata.nx]\nenvInputs = ["REVIEW_CRATE"]\n',
        ),
      },
    },
    before: { env: { REVIEW_WORKSPACE: "a" } },
    after: { env: { REVIEW_WORKSPACE: "b" } },
    keys: { "model:test": "must differ", "testkit:test": "must differ" },
  },
  {
    change: "a change of a variable that a dependency in another workspace adds",
    fixture: "cross-workspace-path",
    base: {
      files: {
        "shared/crates/model/Cargo.toml": appended(
          '\n[package.metadata.nx]\nenvInputs = ["REVIEW_ADDED"]\n',
        ),
      },
    },
    before: { env: { REVIEW_ADDED: "a" } },
    after: { env: { REVIEW_ADDED: "b" } },
    keys: { "server:test": "must differ", "model:test": "must differ" },
  },
]);

/** `nx.json` with `namedInputs` of the repository's own. */
const repositoryInputs =
  (namedInputs: object) =>
  (text: string | undefined): string =>
    JSON.stringify({ ...JSON.parse(text ?? "{}"), namedInputs });

describeCacheKeyMatrix("keys with the repository's own default named input", [
  ...(
    [
      ["an environment variable", { env: { REVIEW_SHARED: "b" } }, {}],
      ["the output of a command", { env: { REVIEW_RUNTIME: "b" } }, {}],
      ["a file under {workspaceRoot}", {}, { "shared/global.txt": "b\n" }],
    ] as const
  ).map(([what, after, files]): CacheKeyRow => ({
    change: `a change of ${what} that sharedGlobals in the repository's default names`,
    fixture: "subfolder-workspace",
    base: {
      files: {
        "nx.json": repositoryInputs({
          default: ["{projectRoot}/**/*", "sharedGlobals"],
          sharedGlobals: [
            { env: "REVIEW_SHARED" },
            { runtime: "echo $REVIEW_RUNTIME" },
            "{workspaceRoot}/shared/global.txt",
          ],
          production: ["default"],
        }),
        "shared/global.txt": "a\n",
      },
      env: { REVIEW_SHARED: "a", REVIEW_RUNTIME: "a" },
    },
    after: { ...after, files },
    keys: { "api:build": "must differ", "api:test": "must differ", "rust:doc": "must differ" },
  })),
  {
    change: "a change in a file of the crate that the repository's default leaves out",
    fixture: "subfolder-workspace",
    base: {
      files: {
        "nx.json": repositoryInputs({ default: ["{projectRoot}/**/*", "!{projectRoot}/**/*.md"] }),
        "rust/crates/api/README.md": "a\n",
      },
    },
    after: { files: { "rust/crates/api/README.md": "b\n" } },
    keys: { "api:build": "must differ", "api:test": "must differ" },
  },
  {
    change: "a change of a variable that only the repository's production names",
    fixture: "subfolder-workspace",
    base: {
      files: {
        "nx.json": repositoryInputs({
          default: ["{projectRoot}/**/*"],
          production: ["default", { env: "REVIEW_PRODUCTION" }],
        }),
      },
    },
    before: { env: { REVIEW_PRODUCTION: "a" } },
    after: { env: { REVIEW_PRODUCTION: "b" } },
    keys: {
      "api:build": "must not differ",
      "api:test": "must not differ",
      "rust:doc": "must not differ",
    },
  },
]);

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
      // The packages that the plugin loads, from this repository's root.
      symlinkSync(join(source, "..", "..", "node_modules"), join(copy, "node_modules"), "dir");
      // The plugin's own package.json with another version: the plugin reads
      // its supported Nx versions from it as well.
      const manifest = JSON.parse(readFileSync(join(source, "..", "package.json"), "utf8"));
      const version = (value: string) =>
        writeFileSync(join(copy, "package.json"), JSON.stringify({ ...manifest, version: value }));
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
  const installed = (
    integrity: { tslib?: string; leftPad?: string } = {},
    version = "0.0.1",
  ): FileChanges => ({
    "package.json": JSON.stringify({
      name: "repo",
      private: true,
      devDependencies: { "@convesoft/nx-rust": version, "left-pad": "1.3.0" },
    }),
    "pnpm-lock.yaml": pnpmLockfile(version, integrity),
    "node_modules/.modules.yaml": "{}\n",
  });

  describeCacheKeyMatrix("where the Rust targets name the plugin's package", [
    {
      change: "a new version of the installed plugin package",
      fixture: "subfolder-workspace",
      before: { files: installed() },
      after: { files: installed({}, "0.0.2") },
      keys: { "api:test": "must differ", "api:build": "must differ", "rust:doc": "must differ" },
    },
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
