import {
  chmodSync,
  cpSync,
  mkdirSync,
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
  applyFileChanges,
  CacheKeyRow,
  CompilerLinks,
  describeCacheKeyMatrix,
  FileChanges,
  findExecutable,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  pinnedToolchain,
  pinnedToolchainAvailable,
  pluginSourceEntry,
  pnpmLockfile,
  programVersion,
  testEnvironment,
  toolchainProgram,
} from "./harness";

// The rows of VER-CACHE-KEYS that the inputs and outputs of nxr-fy4t4k
// decide, checked with Nx's own task hasher on the plugin's inferred targets.
// lockfile-keys.spec.ts holds the rows about Cargo.lock, which need the
// lockfile task and a registry. The rows that need envInputs and
// runtimeInputs read from Cargo metadata (nxr-xyq7c8), the nextest runner
// (nxr-jb6g5y), the test modes and the artifact targets are left to those
// issues. declared-files.spec.ts checks the rows for declared files that are
// ignored or linked, together with what nx affected selects.

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

/** nx.json with `exclude` set on every entry of the plugin. */
function excludedFromPlugin(...patterns: string[]) {
  return (current: string | undefined) => {
    const nxJson = JSON.parse(current ?? "{}");
    nxJson.plugins = (nxJson.plugins ?? []).map((entry: string | { plugin: string }) =>
      typeof entry === "string"
        ? { plugin: entry, exclude: patterns }
        : { ...entry, exclude: patterns },
    );
    return `${JSON.stringify(nxJson, null, 2)}\n`;
  };
}

// In backend, rust's [patch] redirects server and b to themselves. server
// depends on the registry crate wrapper, vendored with leaf, which b depends
// on by path. leaf, a crate of a directory source, has no report.
const crate = (name: string) =>
  `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`;
const assumedUseFiles: FileChanges = {
  "backend/Cargo.toml":
    '[workspace]\nmembers = ["crates/server", "crates/b"]\nresolver = "3"\n\n[patch.crates-io]\nserver = { path = "crates/server" }\nb = { path = "crates/b" }\n',
  "backend/.cargo/config.toml":
    '[source.crates-io]\nreplace-with = "vendor"\n\n[source.vendor]\ndirectory = "../vendor"\n',
  "backend/crates/server/Cargo.toml": `${crate("server")}\n[dependencies]\nwrapper = "0.1"\n`,
  "backend/crates/b/Cargo.toml": `${crate("b")}\n[dependencies]\nleaf = { path = "../../../vendor/leaf" }\n`,
  "backend/crates/b/src/lib.rs": "",
  "vendor/leaf/Cargo.toml": crate("leaf"),
  "vendor/leaf/src/lib.rs": "",
  "vendor/leaf/.cargo-checksum.json": '{"files":{},"package":null}\n',
  "vendor/wrapper/Cargo.toml": `${crate("wrapper")}\n[dependencies]\nb = "0.1"\n`,
  "vendor/wrapper/src/lib.rs": "",
  "vendor/wrapper/.cargo-checksum.json": '{"files":{},"package":null}\n',
  "nx.json": excludedFromPlugin("shared/**"),
};

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
  // shared lists no members, so cargo builds model for server but refuses
  // to report it; excluded from the plugin, model has no project.
  {
    change:
      "a change in a path dependency without a project whose report cargo refuses, because it is no member of the workspace whose folder holds it",
    fixture: "cross-workspace-path",
    base: {
      files: {
        "shared/Cargo.toml": (manifest) => manifest.replace(/members = \[[^\]]*\]/, "members = []"),
        "nx.json": excludedFromPlugin("shared/**"),
      },
    },
    after: { files: { "shared/crates/model/src/lib.rs": changed } },
    keys: {
      "server:check": "must differ",
      "server:build": "must differ",
      "server:test": "must differ",
    },
  },
  // b's use of server rests only on leaf, which has no report, so it gives
  // way to server's possible use of b: server keeps its edge to b, and b
  // takes server's files as an input instead.
  ...[
    ["server", "backend/crates/server/src/lib.rs", "b"],
    ["b", "backend/crates/b/src/lib.rs", "server"],
  ].map(([crate, path, user]): CacheKeyRow => ({
    change: `a change in ${crate}, a redirected member that ${user} may use, where b may use server only through a crate without a report`,
    fixture: "cross-workspace-path",
    base: { files: assumedUseFiles },
    after: { files: { [path]: changed } },
    keys: { [`${user}:check`]: "must differ", [`${user}:test`]: "must differ" },
  })),
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

// In declared-files, the workspace table declares proto/**/*.proto for every
// member, and api's own table declares docs/banner.txt. app depends on api;
// other depends on neither.
const declaredFileTasks = (crate: string) => [`${crate}:build`, `${crate}:check`, `${crate}:test`];

describeCacheKeyMatrix("keys with declared files", [
  {
    change:
      "a change in a file outside the crate's folder that a fileInputs pattern of the crate's package table declares, for the crate, the crates that depend on it and their workspace's doc",
    fixture: "declared-files",
    after: { files: { "docs/banner.txt": "Built with nx-rust, changed\n" } },
    keys: {
      ...all([...declaredFileTasks("api"), "api:lint", "api:fmt-check"], "must differ"),
      ...all(declaredFileTasks("app"), "must differ"),
      "rust:doc": "must differ",
    },
  },
  {
    change:
      "a change in a file outside the crate's folder that a fileInputs pattern of its workspace table declares, for every member",
    fixture: "declared-files",
    after: { files: { "proto/greeting.proto": appended("\nmessage Farewell {}\n") } },
    keys: all(
      ["api", "app", "other"].flatMap((crate) => declaredFileTasks(crate)),
      "must differ",
    ),
  },
  {
    change: "a new file that a glob of fileInputs matches",
    fixture: "declared-files",
    after: { files: { "proto/nested/farewell.proto": 'syntax = "proto3";\n' } },
    keys: all(declaredFileTasks("other"), "must differ"),
  },
  {
    change: "a change in a declared file that Git ignores",
    fixture: "declared-files",
    base: {
      files: {
        ".gitignore": appended("generated/\n"),
        "generated/schema.json": "{}\n",
        "rust/crates/api/Cargo.toml": (manifest) =>
          manifest.replace(
            'fileInputs = ["../../../docs/banner.txt"]',
            'fileInputs = ["../../../docs/banner.txt", "../../../generated/schema.json"]',
          ),
      },
    },
    after: { files: { "generated/schema.json": '{"changed":true}\n' } },
    keys: all([...declaredFileTasks("api"), ...declaredFileTasks("app")], "must differ"),
  },
  {
    change: "a change in a declared file of a dependency in another workspace",
    fixture: "cross-workspace-path",
    base: {
      files: {
        "shared/crates/model/Cargo.toml": appended(
          '\n[package.metadata.nx]\nfileInputs = ["../../../schema/model.sql"]\n',
        ),
        "schema/model.sql": "create table model ();\n",
      },
    },
    after: { files: { "schema/model.sql": appended("-- changed\n") } },
    keys: {
      "server:test": "must differ",
      "server:build": "must differ",
      "model:test": "must differ",
    },
  },
]);

// The files that a crate declares travel with its folder where another
// crate's inputs name the folder beside an edge.
describeCacheKeyMatrix("keys with the declared files of a crate without an edge", [
  {
    change:
      "a change in a file that a crate without a project declares, which the crate reaches through another crate without a project",
    fixture: "declared-files",
    base: {
      files: {
        "rust/crates/api/Cargo.toml": appended(
          '\n[dependencies]\nlexer = { path = "../../../vendor/lexer" }\n',
        ),
        "vendor/lexer/Cargo.toml": `${crate("lexer")}\n[workspace]\n\n[dependencies]\ntoken = { path = "../token" }\n`,
        "vendor/lexer/src/lib.rs": "",
        "vendor/token/Cargo.toml": `${crate("token")}\n[workspace]\n\n[package.metadata.nx]\nfileInputs = ["../../shared/token.txt"]\n`,
        "vendor/token/src/lib.rs": "",
        "shared/token.txt": "token\n",
        "nx.json": excludedFromPlugin("vendor/**"),
      },
    },
    after: { files: { "shared/token.txt": appended("changed\n") } },
    keys: { "api:test": "must differ", "app:test": "must differ", "other:test": "must not differ" },
  },
  {
    change:
      "a change in a file that a redirected crate without a project declares, for every member that may use it",
    fixture: "patched-workspaces",
    base: {
      files: {
        "third_party/fork/Cargo.toml": appended(
          '\n[package.metadata.nx]\nfileInputs = ["../../schema/fork.sql"]\n',
        ),
        "schema/fork.sql": "create table fork ();\n",
      },
    },
    after: { files: { "schema/fork.sql": appended("-- changed\n") } },
    keys: {
      "api:test": "must differ",
      "viaw:test": "must differ",
      "plain:test": "must not differ",
    },
  },
  {
    change:
      "a change in a file that a redirected crate declares whose edge is left out to avoid a cycle",
    fixture: "patched-workspaces",
    base: {
      files: {
        "rust/crates/model/Cargo.toml": appended(
          '\n[package.metadata.nx]\nfileInputs = ["../../../schema/model.sql"]\n',
        ),
        "schema/model.sql": "create table model ();\n",
      },
    },
    after: { files: { "schema/model.sql": appended("-- changed\n") } },
    keys: { "util:test": "must differ", "plain:test": "must not differ" },
  },
]);

describeCacheKeyMatrix("keys without declared files", [
  {
    change: "a change in a file outside the crate's folder that a dependent declares",
    fixture: "declared-files",
    after: { files: { "docs/banner.txt": "Built with nx-rust, changed\n" } },
    keys: all(declaredFileTasks("other"), "must not differ"),
  },
  {
    change: "a change in a file outside the crate's folder that none of the task's inputs covers",
    fixture: "declared-files",
    base: { files: { "docs/guide.md": "# Guide\n", "proto/README.md": "Protocols\n" } },
    after: {
      files: { "docs/guide.md": appended("changed\n"), "proto/README.md": appended("changed\n") },
    },
    keys: all(
      ["api", "app", "other"].flatMap((crate) => declaredFileTasks(crate)),
      "must not differ",
    ),
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

  it(
    "never repeat where RUSTC or CARGO_BUILD_RUSTC is empty or names no program, or build.rustc names one that does not exist, on which cargo fails too",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace");
      try {
        const tasks = ["api:build", "api:test"];
        const missing = join(workspace.root, "no-such-rustc");
        const repeats = async (env: Record<string, string> = {}) => {
          const first = await workspace.hashTasks(tasks, { env });
          const second = await workspace.hashTasks(tasks, { env });
          return Object.fromEntries(
            tasks.map((task) => [task, first[task].value === second[task].value]),
          );
        };
        const never = { "api:build": false, "api:test": false };

        expect(await repeats()).toEqual({ "api:build": true, "api:test": true });
        expect(await repeats({ RUSTC: "" })).toEqual(never);
        expect(await repeats({ CARGO_BUILD_RUSTC: "" })).toEqual(never);
        expect(await repeats({ RUSTC: missing })).toEqual(never);
        expect(await repeats({ RUSTDOC: missing })).toEqual({
          "api:build": true,
          "api:test": false,
        });
        applyFileChanges(workspace.root, {
          "rust/.cargo/config.toml": `[build]\nrustc = ${JSON.stringify(missing)}\n`,
        });
        expect(await repeats()).toEqual(never);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // These need a second installed toolchain, which CI installs; elsewhere
  // they skip where rustup lacks 1.91.0. Each points links at 1.91.0 and
  // then at rustup's default toolchain, so that the compiler behind a path
  // changes while the path and every file and variable stay the same.
  (pinnedToolchainAvailable() ? describe : describe.skip)(
    "where a setting names the compiler",
    () => {
      /** The cached targets of api and the workspace's doc. */
      const tasks = [...apiTasks, "rust:doc"];

      let links: CompilerLinks;
      beforeEach(() => {
        links = CompilerLinks.create(pinnedToolchain);
        // A test of a replaced compiler needs two different ones.
        if (programVersion(toolchainProgram("rustc")) === programVersion(links.rustc)) {
          throw new Error(
            `rustup's default toolchain is ${pinnedToolchain}, which these tests replace`,
          );
        }
      });
      afterEach(() => links.remove());

      /**
       * The tasks of `checked` whose keys change when the compiler behind
       * the links is replaced, in a copy of subfolder-workspace whose
       * `.gitignore` ignores `.env` files, changed by `files` once it is in
       * place, and hashed with the environment that `env` gives.
       */
      async function changedByReplacement(
        env: (links: CompilerLinks) => Record<string, string>,
        files: (links: CompilerLinks, root: string) => FileChanges = () => ({}),
        checked = tasks,
      ): Promise<string[]> {
        const workspace = FixtureWorkspace.create("subfolder-workspace", {
          ".gitignore": appended(".env\n"),
        });
        try {
          links.point(pinnedToolchain);
          applyFileChanges(workspace.root, files(links, workspace.root));
          const before = await workspace.hashTasks(checked, { env: env(links) });
          links.point();
          const after = await workspace.hashTasks(checked, { env: env(links) });
          return checked.filter((task) => before[task].value !== after[task].value);
        } finally {
          workspace.remove();
        }
      }

      const buildRustc = (program: string) => `[build]\nrustc = ${JSON.stringify(program)}\n`;

      it(
        "differ after the compiler at the path that RUSTC names is replaced",
        async () => {
          expect(await changedByReplacement((links) => ({ RUSTC: links.rustc }))).toEqual(tasks);
        },
        HARNESS_TIMEOUT,
      );

      it(
        "differ after the compiler at the path that CARGO_BUILD_RUSTC names is replaced",
        async () => {
          expect(
            await changedByReplacement((links) => ({ CARGO_BUILD_RUSTC: links.rustc })),
          ).toEqual(tasks);
        },
        HARNESS_TIMEOUT,
      );

      it(
        "differ after the compiler at the path that build.rustc names is replaced, in the workspace's configuration, above the repository and through a relative path",
        async () => {
          expect(
            await changedByReplacement(
              () => ({}),
              (links) => ({ "rust/.cargo/config.toml": buildRustc(links.rustc) }),
            ),
          ).toEqual(tasks);
          expect(
            await changedByReplacement(
              () => ({}),
              (links, root) => {
                // A folder above the repository, which no file input covers.
                mkdirSync(join(root, "..", ".cargo"), { recursive: true });
                writeFileSync(join(root, "..", ".cargo", "config.toml"), buildRustc(links.rustc));
                return {};
              },
            ),
          ).toEqual(tasks);
          expect(
            await changedByReplacement(
              () => ({}),
              (links, root) => {
                // Relative to rust, the folder that holds .cargo, through a
                // link that Git ignores and no project holds.
                symlinkSync(links.folder, join(root, "compilers"));
                return {
                  ".gitignore": appended("/compilers\n"),
                  "rust/.cargo/config.toml": buildRustc("../compilers/rustc"),
                };
              },
            ),
          ).toEqual(tasks);
        },
        HARNESS_TIMEOUT * 3,
      );

      it(
        "differ after the compiler at the path that RUSTC in a crate's .env names is replaced, for that crate only",
        async () => {
          expect(
            await changedByReplacement(
              () => ({}),
              (links) => ({ "rust/crates/api/.env": `RUSTC=${links.rustc}\n` }),
              ["api:build", "api:test", "model:build", "model:test"],
            ),
          ).toEqual(["api:build", "api:test"]);
        },
        HARNESS_TIMEOUT,
      );

      it(
        "differ for doc and test after the rustdoc at the path that RUSTDOC names is replaced",
        async () => {
          expect(await changedByReplacement((links) => ({ RUSTDOC: links.rustdoc }))).toEqual([
            "api:test",
            "rust:doc",
          ]);
        },
        HARNESS_TIMEOUT,
      );

      it(
        "differ after RUSTUP_TOOLCHAIN chooses another toolchain, which runs cargo and rustdoc, while RUSTC names a compiler",
        async () => {
          const workspace = FixtureWorkspace.create("subfolder-workspace");
          try {
            const before = await workspace.hashTasks(tasks, { env: { RUSTC: links.rustc } });
            const after = await workspace.hashTasks(tasks, {
              env: { RUSTC: links.rustc, RUSTUP_TOOLCHAIN: pinnedToolchain },
            });
            expect(tasks.filter((task) => before[task].value !== after[task].value)).toEqual(tasks);
          } finally {
            workspace.remove();
          }
        },
        HARNESS_TIMEOUT,
      );

      it(
        "differ after build.rustc is set in the Cargo home's configuration, and after the compiler it names is replaced, without the daemon",
        async () => {
          const cargoHome = mkdtempSync(join(tmpdir(), "nx-rust-cargo-home-"));
          const workspace = FixtureWorkspace.create("subfolder-workspace");
          try {
            const env = { CARGO_HOME: cargoHome };
            const unset = await workspace.hashTasks(tasks, { env });
            writeFileSync(join(cargoHome, "config.toml"), buildRustc(links.rustc));
            const set = await workspace.hashTasks(tasks, { env });
            links.point();
            const replaced = await workspace.hashTasks(tasks, { env });

            const changed = (a: typeof unset, b: typeof unset) =>
              tasks.filter((task) => a[task].value !== b[task].value);
            expect(changed(unset, set)).toEqual(tasks);
            expect(changed(set, replaced)).toEqual(tasks);
          } finally {
            workspace.remove();
            rmSync(cargoHome, { recursive: true, force: true });
          }
        },
        HARNESS_TIMEOUT,
      );
    },
  );
});

/**
 * A root `package.json` and a pnpm lockfile that list `left-pad` and, unless
 * `version` is `null`, the plugin, as an installed plugin has them. `fields`
 * are added to the `package.json`.
 */
const installed = (
  integrity: { tslib?: string; leftPad?: string } = {},
  version: string | null = "0.0.1",
  fields: Record<string, unknown> = {},
): FileChanges => ({
  "package.json": JSON.stringify({
    name: "repo",
    private: true,
    ...fields,
    devDependencies: {
      ...(version === null ? {} : { "@convesoft/nx-rust": version }),
      "left-pad": "1.3.0",
    },
  }),
  "pnpm-lock.yaml": pnpmLockfile(version, integrity),
  "node_modules/.modules.yaml": "{}\n",
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

// The accepted limit of DES-INPUTS, "A project at the repository root": a
// crate or workspace project there shares its folder with the JS package, so
// its folder input covers package.json and the JS lockfile, and the edges that
// Nx's JS plugin draws from it to npm packages reach its ^default. These rows
// record that behaviour, so that a change of it is noticed.
describe("keys of a project at the repository root", () => {
  const newLeftPad = `sha512-${"9".repeat(86)}==`;

  // two-workspaces with a package at the repository root, whose project then
  // holds the workspace's targets.
  const rootPackage: FileChanges = {
    "Cargo.toml": [
      "[package]",
      'name = "rootpkg"',
      'version = "0.1.0"',
      'edition = "2024"',
      "",
      "[workspace]",
      'members = ["crates/*"]',
      'resolver = "3"',
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn root() {}\n",
    "Cargo.lock": (lockfile) => withRootPackage(lockfile ?? ""),
  };

  function withRootPackage(lockfile: string) {
    return lockfile.replace(
      '[[package]]\nname = "util"',
      '[[package]]\nname = "rootpkg"\nversion = "0.1.0"\n\n[[package]]\nname = "util"',
    );
  }

  // The same, with app in crates/ depending on the crate at the root, whose
  // folder its ^default then holds.
  const appOnRootPackage: FileChanges = {
    ...rootPackage,
    "crates/app/Cargo.toml": appended('rootpkg = { path = "../.." }\n'),
    "Cargo.lock": (lockfile) =>
      withRootPackage(lockfile ?? "").replace(
        'name = "app"\nversion = "0.1.0"\ndependencies = [\n "util",\n]',
        'name = "app"\nversion = "0.1.0"\ndependencies = [\n "rootpkg",\n "util",\n]',
      ),
  };

  // In two-workspaces the virtual workspace's project cargo-workspace lies at
  // the repository root, and the tools/ workspace in a subfolder.
  const virtualRootKeys = {
    "cargo-workspace:doc": "must differ",
    "cargo-workspace:lockfile": "must not differ",
    ...all(["app:test", "app:build", "app:check", "app:lint", "app:fmt-check"], "must not differ"),
    ...all(["util:test", "tools:test", "tools:doc", "scaffold:test"], "must not differ"),
  } as const;
  const rootPackageKeys = {
    ...all(
      ["rootpkg:test", "rootpkg:build", "rootpkg:check", "rootpkg:lint", "rootpkg:fmt-check"],
      "must differ",
    ),
    "rootpkg:doc": "must differ",
    "rootpkg:lockfile": "must not differ",
    ...all(["app:test", "util:test", "tools:test", "tools:doc"], "must not differ"),
  } as const;

  describeCacheKeyMatrix("change with the JS package beside them", [
    {
      change:
        "a change in the JS lockfile outside the plugin's package, for a virtual workspace at the repository root",
      fixture: "two-workspaces",
      before: { files: installed() },
      after: { files: installed({ leftPad: newLeftPad }) },
      keys: virtualRootKeys,
    },
    {
      change: "a change in the root package.json, for a virtual workspace at the repository root",
      fixture: "two-workspaces",
      before: { files: installed() },
      after: { files: installed({}, "0.0.1", { description: "changed" }) },
      keys: virtualRootKeys,
    },
    {
      change:
        "a change in a JS lockfile that does not list the plugin, for a crate at the repository root",
      fixture: "two-workspaces",
      base: { files: rootPackage },
      before: { files: installed({}, null) },
      after: { files: installed({ leftPad: newLeftPad }, null) },
      keys: rootPackageKeys,
    },
    {
      change: "a change in the root package.json, for a crate at the repository root",
      fixture: "two-workspaces",
      base: { files: rootPackage },
      before: { files: installed({}, null) },
      after: { files: installed({}, null, { description: "changed" }) },
      keys: rootPackageKeys,
    },
    {
      change:
        "a change in the JS lockfile outside the plugin's package, for a crate that depends on the crate at the repository root",
      fixture: "two-workspaces",
      base: { files: appOnRootPackage },
      before: { files: installed() },
      after: { files: installed({ leftPad: newLeftPad }) },
      keys: {
        "rootpkg:test": "must differ",
        "app:test": "must differ",
        "app:build": "must differ",
        "rootpkg:lockfile": "must not differ",
        ...all(["util:test", "tools:test", "tools:doc"], "must not differ"),
      },
    },
  ]);
});
