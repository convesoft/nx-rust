import { symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  applyFileChanges,
  CargoCall,
  FileChanges,
  FixtureGraph,
  FixtureName,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  loadFixtureGraph,
  pinnedToolchainAvailable,
} from "./harness";

// Checks the parts of VER-GRAPH about projects, names and edges, with a real
// cargo and Nx's own graph creation, together with the cargo calls that
// creating each fixture's graph takes. How discovery reads workspaces in other
// situations, and how it fails, is checked in discovery.spec.ts.

interface ExpectedGraph {
  /**
   * The folder of each cargo call that creating the graph takes, sorted: one
   * per workspace, in its root folder, and one for each path dependency
   * without a project, from the workspace that uses it.
   */
  cargoFolders: string[];
  /** Each project's name with its folder. */
  projects: Record<string, string>;
  /** Each edge as source and target, sorted. */
  edges: [source: string, target: string][];
}

// The edges of patched-workspaces.
const patchedEdges: [string, string][] = [
  ["api", "model"],
  ["api", "types"],
  ["harness", "model"],
  ["harness", "types"],
  ["model", "harness"],
  ["model", "types"],
  ["model", "util"],
  ["rust", "api"],
  ["rust", "harness"],
  ["rust", "model"],
  ["rust", "plain"],
  ["rust", "util"],
  ["rust", "viaw"],
  ["shared", "types"],
  ["util", "types"],
  ["viaw", "model"],
  ["viaw", "types"],
];

const expected: Record<Exclude<FixtureName, "name-collision">, ExpectedGraph> = {
  // api has a normal dependency on model, a build dependency on codegen and a
  // dev-dependency on testkit.
  "subfolder-workspace": {
    cargoFolders: ["rust"],
    projects: {
      api: "rust/crates/api",
      codegen: "rust/crates/codegen",
      model: "rust/crates/model",
      rust: "rust",
      testkit: "rust/crates/testkit",
    },
    edges: [
      ["api", "codegen"],
      ["api", "model"],
      ["api", "testkit"],
      ["rust", "api"],
      ["rust", "codegen"],
      ["rust", "model"],
      ["rust", "testkit"],
    ],
  },
  // A workspace at the root, without a root package.json or project.json, and
  // one in tools/ whose root manifest is the crate tools, which therefore is
  // the workspace project.
  "two-workspaces": {
    cargoFolders: [".", "tools"],
    projects: {
      app: "crates/app",
      "cargo-workspace": ".",
      scaffold: "tools/scaffold",
      tools: "tools",
      util: "crates/util",
    },
    edges: [
      ["app", "util"],
      ["cargo-workspace", "app"],
      ["cargo-workspace", "util"],
      ["tools", "scaffold"],
    ],
  },
  // xtask is a standalone crate: a workspace of one, without an extra project.
  "standalone-crate": {
    cargoFolders: ["rust", "tools/xtask"],
    projects: { api: "rust/crates/api", rust: "rust", xtask: "tools/xtask" },
    edges: [["rust", "api"]],
  },
  // legacy is excluded from rust/ and so a standalone crate.
  "excluded-member": {
    cargoFolders: ["rust", "rust/crates/legacy"],
    projects: { app: "rust/crates/app", legacy: "rust/crates/legacy", rust: "rust" },
    edges: [["rust", "app"]],
  },
  // model is one project, in shared/, with an edge from server in backend/.
  "cross-workspace-path": {
    cargoFolders: ["backend", "shared"],
    projects: {
      backend: "backend",
      model: "shared/crates/model",
      server: "backend/crates/server",
      shared: "shared",
    },
    edges: [
      ["backend", "server"],
      ["server", "model"],
      ["shared", "model"],
    ],
  },
  // The vendored crates are excluded, so lib has no edge to parser, and they
  // are read as path dependencies, from the workspace that uses them.
  "vendored-crate": {
    cargoFolders: ["rust", "rust", "rust"],
    projects: { app: "rust/crates/app", lib: "rust/crates/lib", rust: "rust" },
    edges: [
      ["app", "lib"],
      ["rust", "app"],
      ["rust", "lib"],
    ],
  },
  // model dev-depends on testkit, which depends on model: both edges stay.
  "dev-dependency-cycle": {
    cargoFolders: ["rust"],
    projects: { model: "rust/crates/model", rust: "rust", testkit: "rust/crates/testkit" },
    edges: [
      ["model", "testkit"],
      ["rust", "model"],
      ["rust", "testkit"],
      ["testkit", "model"],
    ],
  },
  "different-toolchains": {
    cargoFolders: ["pinned", "stable"],
    projects: {
      pinned: "pinned",
      "pinned-lib": "pinned/crates/pinned-lib",
      stable: "stable",
      "stable-lib": "stable/crates/stable-lib",
    },
    edges: [
      ["pinned", "pinned-lib"],
      ["stable", "stable-lib"],
    ],
  },
  // Nx names napi-addon after the package.json that the project.json beside
  // it makes it read, and engine after its project.json. The project.json
  // files without a name in unnamed/ and in the workspace folder leave the
  // plugin's names, which are not what Nx would derive from those folders.
  // Every edge names its ends as Nx does.
  "mixed-folders": {
    cargoFolders: ["libs/rust"],
    projects: {
      "@mixed/napi-addon": "libs/rust/crates/addon",
      cli: "libs/rust/crates/cli",
      "libs-rust": "libs/rust",
      plain: "libs/rust/crates/unnamed",
      "rust-engine": "libs/rust/crates/engine",
    },
    edges: [
      ["@mixed/napi-addon", "rust-engine"],
      ["cli", "@mixed/napi-addon"],
      ["cli", "plain"],
      ["cli", "rust-engine"],
      ["libs-rust", "@mixed/napi-addon"],
      ["libs-rust", "cli"],
      ["libs-rust", "plain"],
      ["libs-rust", "rust-engine"],
    ],
  },
  // Workspace projects keep the punctuation and case of their folders.
  "nested-folders": {
    cargoFolders: ["apps/Billing.API/rust_v2", "services/billing"],
    projects: {
      "apps-Billing.API-rust_v2": "apps/Billing.API/rust_v2",
      gateway: "apps/Billing.API/rust_v2/crates/gateway",
      invoice: "services/billing/crates/invoice",
      "services-billing": "services/billing",
    },
    edges: [
      ["apps-Billing.API-rust_v2", "gateway"],
      ["services-billing", "invoice"],
    ],
  },
  "crate-shapes": {
    cargoFolders: ["rust"],
    projects: {
      cli: "rust/crates/cli",
      "core-lib": "rust/crates/core",
      internal: "rust/crates/internal",
      perf: "rust/crates/perf",
      rust: "rust",
      server: "rust/crates/server",
    },
    edges: [
      ["cli", "core-lib"],
      ["rust", "cli"],
      ["rust", "core-lib"],
      ["rust", "internal"],
      ["rust", "perf"],
      ["rust", "server"],
      ["server", "core-lib"],
    ],
  },
  // rust's [patch] redirects model, types and fork, which has no project.
  // Every member with a registry dependency, of its own or behind a path
  // dependency, gets an edge to model and types, apart from model itself,
  // plain, which has none, and util, which model reaches through a normal
  // dependency. model reaches harness only through a dev-dependency, so
  // harness keeps its edge, which closes a cycle. fork is read from rust,
  // where the redirection applies.
  "patched-workspaces": {
    cargoFolders: ["rust", "rust", "shared"],
    projects: {
      api: "rust/crates/api",
      harness: "rust/crates/harness",
      model: "rust/crates/model",
      plain: "rust/crates/plain",
      rust: "rust",
      shared: "shared",
      types: "shared/crates/types",
      util: "rust/crates/util",
      viaw: "rust/crates/viaw",
    },
    edges: patchedEdges,
  },
  // app depends on api, which reads files outside its folder.
  "declared-files": {
    cargoFolders: ["rust"],
    projects: {
      api: "rust/crates/api",
      app: "rust/crates/app",
      other: "rust/crates/other",
      rust: "rust",
    },
    edges: [
      ["app", "api"],
      ["rust", "api"],
      ["rust", "app"],
      ["rust", "other"],
    ],
  },
  // reader depends on base; the others depend on nothing.
  "undeclared-files": {
    cargoFolders: ["rust"],
    projects: {
      base: "rust/crates/base",
      cola: "rust/crates/cola",
      colb: "rust/crates/colb",
      macros: "rust/crates/macros",
      multi: "rust/crates/multi",
      plain: "rust/crates/plain",
      reader: "rust/crates/reader",
      rust: "rust",
    },
    edges: [
      ["reader", "base"],
      ["rust", "base"],
      ["rust", "cola"],
      ["rust", "colb"],
      ["rust", "macros"],
      ["rust", "multi"],
      ["rust", "plain"],
      ["rust", "reader"],
    ],
  },
};

// Without the toolchain that it pins, cargo fails in different-toolchains/pinned.
const fixtures = (Object.keys(expected) as (keyof typeof expected)[]).filter(
  (fixture) => fixture !== "different-toolchains" || pinnedToolchainAvailable(),
);

/** Each project's name with its folder. */
function roots(graph: FixtureGraph): Record<string, string> {
  return Object.fromEntries(
    Object.entries(graph.projects).map(([name, project]) => [name, project.root]),
  );
}

/** Each edge as source and target, sorted. */
function edges(graph: FixtureGraph): [string, string][] {
  return graph.dependencies
    .map((edge): [string, string] => [edge.source, edge.target])
    .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The folder that each cargo call started in, in order, after checking that
 * each asks for a `cargo metadata` report without dependencies: how many
 * reports creating the graph takes and where cargo runs for each, not how
 * the arguments are spelt.
 */
function metadataFolders(calls: CargoCall[]): string[] {
  for (const call of calls) {
    expect(call.args).toEqual(expect.arrayContaining(["metadata", "--no-deps"]));
  }
  return calls.map((call) => call.cwd);
}

describe("projects and edges of each fixture", () => {
  it.each(fixtures)(
    "%s has a project per crate and per workspace, with an edge per path dependency, and reads each workspace with one cargo call",
    async (fixture) => {
      const workspace = FixtureWorkspace.create(fixture);
      try {
        const files = workspace.files();

        const graph = await workspace.graph();

        expect(roots(graph)).toEqual(expected[fixture].projects);
        expect(edges(graph)).toEqual(expected[fixture].edges);
        expect(graph.externalNodes).toEqual({});
        expect(metadataFolders(workspace.cargoCalls()).sort()).toEqual(
          expected[fixture].cargoFolders,
        );
        // The plugin writes no file, in a crate or anywhere else.
        expect(workspace.files()).toEqual(files);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "adds an edge when a crate gets a project and no manifest changes",
    async () => {
      // Nx reuses what it found for a file that did not change. testkit is
      // ignored first, so api's manifest gives no edge to it.
      const workspace = FixtureWorkspace.create("subfolder-workspace", {
        ".nxignore": "rust/crates/testkit\n",
      });
      try {
        const before = await workspace.graph();
        applyFileChanges(workspace.root, { ".nxignore": null });

        const after = await workspace.graph();

        expect(edges(before)).not.toContainEqual(["api", "testkit"]);
        expect(edges(after)).toContainEqual(["api", "testkit"]);
        expect(edges(after)).toContainEqual(["rust", "testkit"]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives edges to the vendored crates, read as standalone crates, once they are no longer excluded",
    async () => {
      // The positive control for the exclude in vendored-crate's nx.json.
      const graph = await loadFixtureGraph("vendored-crate", {
        files: { "nx.json": pluginEntries({}) },
      });

      expect(metadataFolders(graph.cargoCalls).sort()).toEqual([
        "rust",
        "vendor/lexer",
        "vendor/parser",
      ]);
      expect(edges(graph)).toEqual([
        ["app", "lib"],
        ["lib", "parser"],
        ["parser", "lexer"],
        ["rust", "app"],
        ["rust", "lib"],
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives no workspace project to a workspace whose root manifest is excluded, and reads it once more in its root folder",
    async () => {
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: { "nx.json": pluginEntries({ exclude: ["rust/Cargo.toml"] }) },
      });

      // The first call starts in the folder of the shallowest manifest that
      // the plugin receives and names the workspace root, where the
      // workspace's tasks run cargo.
      expect(metadataFolders(graph.cargoCalls)).toEqual(["rust/crates/api", "rust"]);
      expect(Object.keys(graph.projects).sort()).toEqual(["api", "codegen", "model", "testkit"]);
      expect(edges(graph)).toEqual([
        ["api", "codegen"],
        ["api", "model"],
        ["api", "testkit"],
      ]);
    },
    HARNESS_TIMEOUT,
  );
});

describe("edges to crates with a project behind crates without one", () => {
  // In declared-files, app depends on api. The crates that these cases add
  // under rust/crates are members of rust that nx.json excludes: they have
  // no project, but a report.
  const excluding = (...crates: string[]) =>
    pluginEntries({ exclude: crates.map((crate) => `rust/crates/${crate}/**`) });
  const withEdges = (...added: [string, string][]) =>
    [...expected["declared-files"].edges, ...added].sort(
      (a, b) => compare(a[0], b[0]) || compare(a[1], b[1]),
    );

  it(
    "come through any number of crates without a project, with the kinds that cargo builds",
    async () => {
      // cross dev-depends on relay, which build-depends on bridge, which
      // depends on api and dev-depends on other: cargo builds api for
      // cross's tests, and no crate's dev-dependency but cross's own.
      const graph = await loadFixtureGraph("declared-files", {
        files: {
          "rust/crates/bridge/Cargo.toml": `${crateManifest("bridge")}\n[dependencies]\napi = { path = "../api" }\n\n[dev-dependencies]\nother = { path = "../other" }\n`,
          "rust/crates/bridge/src/lib.rs": "",
          "rust/crates/relay/Cargo.toml": `${crateManifest("relay")}\n[build-dependencies]\nbridge = { path = "../bridge" }\n`,
          "rust/crates/relay/src/lib.rs": "",
          "cross/Cargo.toml": `${crateManifest("cross")}\n[workspace]\n\n[dev-dependencies]\nrelay = { path = "../rust/crates/relay" }\n`,
          "cross/src/lib.rs": "",
          "nx.json": excluding("bridge", "relay"),
        },
      });

      expect(edges(graph)).toEqual(withEdges(["cross", "api"]));
    },
    HARNESS_TIMEOUT,
  );

  it(
    "come from none behind a crate without a report",
    async () => {
      // shim's folder holds .cargo-checksum.json, so no report says that it
      // depends on api: its folder alone is an input of cross.
      const graph = await loadFixtureGraph("declared-files", {
        files: {
          "vendor/shim/Cargo.toml": `${crateManifest("shim")}\n[dependencies]\napi = { path = "../../rust/crates/api" }\n`,
          "vendor/shim/src/lib.rs": "",
          "vendor/shim/.cargo-checksum.json": '{"files":{},"package":null}\n',
          "cross/Cargo.toml": `${crateManifest("cross")}\n[workspace]\n\n[dependencies]\nshim = { path = "../vendor/shim" }\n`,
          "cross/src/lib.rs": "",
        },
      });

      expect(edges(graph)).toEqual(withEdges());
      expect(graph.projects.cross.namedInputs.default).toContain(
        "{workspaceRoot}/vendor/shim/**/*",
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "keep both edges of a cycle through a dev-dependency, which cargo builds, and none to the crate itself",
    async () => {
      // api dev-depends on bridge, which depends on api and on other, which
      // depends on api: cargo builds other and api for api's tests.
      const workspace = FixtureWorkspace.create("declared-files", {
        "rust/crates/bridge/Cargo.toml": `${crateManifest("bridge")}\n[dependencies]\napi = { path = "../api" }\nother = { path = "../other" }\n`,
        "rust/crates/bridge/src/lib.rs": "",
        "rust/crates/api/Cargo.toml": (manifest) =>
          `${manifest}\n[dev-dependencies]\nbridge = { path = "../bridge" }\n`,
        "rust/crates/other/Cargo.toml": (manifest) =>
          `${manifest}\n[dependencies]\napi = { path = "../api" }\n`,
        "nx.json": excluding("bridge"),
      });
      try {
        const graph = await workspace.graph();
        // Nx hashes the `^` inputs over the cycle.
        const hashes = await workspace.hashTasks(["api:test", "other:test"]);

        expect(edges(graph)).toEqual(withEdges(["api", "other"], ["other", "api"]));
        expect(Object.keys(hashes).sort()).toEqual(["api:test", "other:test"]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("a path dependency through a symbolic link", () => {
  it(
    "names the crate at the folder the link leads to, with an edge and no report of its own",
    async () => {
      // The standalone crate cross depends on api through alias, a link to
      // api's folder, which Nx does not walk into.
      const workspace = FixtureWorkspace.create("declared-files", {
        "cross/Cargo.toml": `${crateManifest("cross")}\n[workspace]\n\n[dependencies]\napi = { path = "../alias" }\n`,
        "cross/src/lib.rs": "",
      });
      try {
        symlinkSync("rust/crates/api", join(workspace.root, "alias"));

        const graph = await workspace.graph();
        const affected = await workspace.nx([
          "show",
          "projects",
          "--affected",
          "--files=rust/crates/api/src/lib.rs",
          // Nx prints JSON by itself only where it detects an AI agent.
          "--json",
        ]);

        expect(edges(graph)).toEqual(
          [...expected["declared-files"].edges, ["cross", "api"]].sort(
            (a, b) => compare(a[0], b[0]) || compare(a[1], b[1]),
          ),
        );
        // api reaches cross's key through its edge, not as a folder.
        expect(graph.projects.cross.namedInputs.default).not.toContain(
          "{workspaceRoot}/rust/crates/api/**/*",
        );
        expect(
          workspace.cargoCalls().filter((call) => call.args.join(" ").includes("alias")),
        ).toEqual([]);
        expect(affected.status).toBe(0);
        // The JSON is the last line, after any warning of graph creation.
        expect(JSON.parse(affected.output.trim().split("\n").pop()).sort()).toEqual([
          "api",
          "app",
          "cross",
          "rust",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the workspace project at the root of the Nx workspace", () => {
  const rootPackage = (extra: object = {}) =>
    `${JSON.stringify({ name: "root-pkg", private: true, ...extra })}\n`;

  it.each<[string, FileChanges, string]>([
    [
      "without a root project.json, an nx key or a workspace pattern",
      { "package.json": rootPackage() },
      "cargo-workspace",
    ],
    [
      "with a root project.json that sets a name",
      { "package.json": rootPackage(), "project.json": '{ "name": "repo" }\n' },
      "repo",
    ],
    [
      "with a root project.json without a name",
      { "package.json": rootPackage(), "project.json": "{}\n" },
      "root-pkg",
    ],
    [
      "with an nx key in the root package.json",
      { "package.json": rootPackage({ nx: {} }) },
      "root-pkg",
    ],
    [
      "with a workspace pattern that includes the root",
      { "package.json": rootPackage(), "pnpm-workspace.yaml": "packages:\n  - .\n" },
      "root-pkg",
    ],
  ])(
    "is one project %s, named %s, that depends on every member",
    async (_situation, files, name) => {
      const graph = await loadFixtureGraph("two-workspaces", { files });

      expect(roots(graph)).toEqual({
        app: "crates/app",
        [name]: ".",
        scaffold: "tools/scaffold",
        tools: "tools",
        util: "crates/util",
      });
      expect(edges(graph)).toEqual(
        [
          ["app", "util"],
          [name, "app"],
          [name, "util"],
          ["tools", "scaffold"],
        ].sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1])),
      );
    },
    HARNESS_TIMEOUT,
  );
});

describe("two plugin entries that split a workspace's manifests", () => {
  it.each([
    ["in plugin workers", "true"],
    ["in one process", "false"],
  ])(
    "give the workspace project an edge to every member %s",
    async (_mode, isolation) => {
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: {
          "nx.json": pluginEntries(
            { include: ["rust/Cargo.toml"] },
            { include: ["rust/crates/**"] },
          ),
        },
        env: { NX_ISOLATE_PLUGINS: isolation },
      });

      expect(roots(graph)).toEqual(expected["subfolder-workspace"].projects);
      expect(edges(graph)).toEqual(expected["subfolder-workspace"].edges);
    },
    HARNESS_TIMEOUT,
  );
});

describe("name collisions", () => {
  it(
    "fail graph creation for two crates with one name, naming both manifests and the remedies",
    async () => {
      const error = await loadFixtureGraph("name-collision").then(
        () => undefined,
        (failure: unknown) => failure,
      );

      expect(error).toBeInstanceOf(GraphCreationError);
      const { message, cargoCalls } = error as GraphCreationError;
      // Both workspaces are read before the names collide.
      expect(metadataFolders(cargoCalls).sort()).toEqual(["rust", "tools/api"]);
      expect(message).toContain(
        'nx-rust would give 2 projects the name "api", and Nx needs every project name to be unique',
      );
      expect(message).toContain(
        "- the crate api in rust/crates/api/Cargo.toml: set `name` under [package.metadata.nx] in that manifest, or `namePrefix` under [workspace.metadata.nx] in rust/Cargo.toml for every member of its workspace.",
      );
      // A prefix renames a standalone crate too.
      expect(message).toContain(
        "- the crate api in tools/api/Cargo.toml: set `name` under [package.metadata.nx] in that manifest, or `namePrefix` under [workspace.metadata.nx] in tools/api/Cargo.toml for every member of its workspace.",
      );
      expect(message).toContain("nx-rust never renames a project on its own.");
      expect(message).not.toContain("two entries");
      // Nx reports the duplicate first, as for projects from two entries.
      expect(message.indexOf("defined in multiple locations")).toBeLessThan(
        message.indexOf("nx-rust would give"),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fail graph creation for a workspace project named like a crate",
    async () => {
      const loading = loadFixtureGraph("subfolder-workspace", {
        files: {
          "rust/crates/cli/Cargo.toml": crateManifest("rust"),
          "rust/crates/cli/src/lib.rs": "",
        },
      });

      await expect(loading).rejects.toThrow('would give 2 projects the name "rust"');
      await expect(loading).rejects.toThrow(
        "- the workspace project of the Cargo workspace in rust/Cargo.toml: set `name` under [workspace.metadata.nx.project] in that manifest.",
      );
      await expect(loading).rejects.toThrow("- the crate rust in rust/crates/cli/Cargo.toml");
    },
    HARNESS_TIMEOUT,
  );

  /** A second workspace, with the member ledger, whose root manifest is `manifest`. */
  const secondWorkspace = (manifest: string): FileChanges => {
    const folder = manifest.replace(/\/?Cargo\.toml$/, "");
    return {
      [manifest]: '[workspace]\nmembers = ["crates/*"]\nresolver = "3"\n',
      [`${folder}/crates/ledger/Cargo.toml`]: crateManifest("ledger"),
      [`${folder}/crates/ledger/src/lib.rs`]: "",
    };
  };

  it(
    "fail graph creation for two workspace projects with one name, naming both manifests and the remedy",
    async () => {
      const loading = loadFixtureGraph("nested-folders", {
        files: secondWorkspace("services-billing/Cargo.toml"),
      });

      await expect(loading).rejects.toThrow('would give 2 projects the name "services-billing"');
      for (const manifest of ["services/billing/Cargo.toml", "services-billing/Cargo.toml"]) {
        await expect(loading).rejects.toThrow(
          `- the workspace project of the Cargo workspace in ${manifest}: set \`name\` under [workspace.metadata.nx.project] in that manifest.`,
        );
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fail graph creation with Nx's error for a workspace at the root and one in cargo-workspace/",
    async () => {
      // DES-PROJECT-GRAPH promises the plugin's message here only as best
      // effort, because one project is at the root.
      const loading = loadFixtureGraph("two-workspaces", {
        files: secondWorkspace("cargo-workspace/Cargo.toml"),
      });

      await expect(loading).rejects.toThrow(GraphCreationError);
      await expect(loading).rejects.toThrow(/defined in multiple locations/);
      await expect(loading).rejects.toThrow("  - cargo-workspace\n");
    },
    HARNESS_TIMEOUT,
  );

  it.each([
    ["a workspace project", "rust"],
    ["a crate", "api"],
  ])(
    "leave a collision of %s with a JS project to Nx's own error",
    async (_kind, name) => {
      const loading = loadFixtureGraph("subfolder-workspace", {
        files: { "web/project.json": JSON.stringify({ name }) },
      });

      await expect(loading).rejects.toThrow(GraphCreationError);
      await expect(loading).rejects.toThrow(/defined in multiple locations/);
      await expect(loading).rejects.not.toThrow(/nx-rust would give/);
    },
    HARNESS_TIMEOUT,
  );
});

describe.each([
  ["in plugin workers", "true"],
  ["in one process", "false"],
])("name collisions across two plugin entries %s", (_mode, isolation) => {
  const env = { NX_ISOLATE_PLUGINS: isolation };
  // Each entry receives one of the two crates called api.
  const splitEntries = pluginEntries({ include: ["rust/**"] }, { include: ["tools/**"] });

  it(
    "fail graph creation with Nx's error, followed by the plugin's with both manifests",
    async () => {
      const loading = loadFixtureGraph("name-collision", {
        files: { "nx.json": splitEntries },
        env,
      });

      await expect(loading).rejects.toThrow(GraphCreationError);
      const message = await loading.then(
        () => "",
        (error: Error) => error.message,
      );
      const nxError = message.indexOf("The following projects are defined in multiple locations");
      const pluginError = message.indexOf(
        'nx-rust would give 2 projects the name "api", and Nx needs every project name to be unique',
      );
      expect(nxError).toBeGreaterThanOrEqual(0);
      expect(pluginError).toBeGreaterThan(nxError);
      expect(message).toContain("- the crate api in rust/crates/api/Cargo.toml: set `name`");
      expect(message).toContain("- the crate api in tools/api/Cargo.toml: set `name`");
      expect(message).toContain(
        "The projects come from two entries of @convesoft/nx-rust in nx.json.",
      );
      // Reported by one of the entries only.
      expect(message.match(/threw an error while creating dependencies/g)).toHaveLength(1);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave a name that a project.json gave another entry's crate to Nx's error",
    async () => {
      const loading = loadFixtureGraph("name-collision", {
        files: {
          "nx.json": splitEntries,
          "tools/api/Cargo.toml": (manifest) =>
            manifest.replace('name = "api"', 'name = "toolbox"'),
          "tools/api/project.json": JSON.stringify({ name: "api" }),
        },
        env,
      });

      await expect(loading).rejects.toThrow(/defined in multiple locations/);
      await expect(loading).rejects.not.toThrow(/nx-rust would give/);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "find none between two entries that receive the same manifests",
    async () => {
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: { "nx.json": pluginEntries({}, {}) },
        env,
      });

      expect(roots(graph)).toEqual(expected["subfolder-workspace"].projects);
      expect(edges(graph)).toEqual(expected["subfolder-workspace"].edges);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fail graph creation with Nx's error for two crates with one name that two entries both receive",
    async () => {
      // How often the plugin's message appears here is best effort.
      const loading = loadFixtureGraph("name-collision", {
        files: { "nx.json": pluginEntries({}, { options: {} }) },
        env,
      });

      await expect(loading).rejects.toThrow(GraphCreationError);
      await expect(loading).rejects.toThrow(/defined in multiple locations/);
    },
    HARNESS_TIMEOUT,
  );
});

describe.each([
  ["in plugin workers", "true"],
  ["in one process", "false"],
])("name collisions after renames and with other projects, %s", (_mode, isolation) => {
  const env = { NX_ISOLATE_PLUGINS: isolation };
  const oneEntry = pluginEntries({});
  const twoEntries = pluginEntries({ include: ["rust/**"] }, { include: ["tools/**"] });

  /** The project names of a graph, or the error that graph creation failed with. */
  async function outcome(workspace: FixtureWorkspace): Promise<string[] | string> {
    return workspace.graph(env).then(
      (graph) => Object.keys(graph.projects).sort(),
      (error: Error) => error.message,
    );
  }

  /**
   * The folders that Nx's duplicate-name error names. In these cases
   * DES-PROJECT-GRAPH promises only that graph creation fails with Nx's
   * error, so whether the plugin's message follows is left open.
   */
  function duplicateNameFolders(result: string[] | string): string[] {
    const message = typeof result === "string" ? result : "";
    const lines = message.split("\n");
    const start = lines.findIndex((line) =>
      line.includes("The following projects are defined in multiple locations"),
    );
    const end = lines.findIndex((line, index) => index > start && line === "");
    return start < 0
      ? []
      : lines
          .slice(start + 1, end < 0 ? undefined : end)
          .filter((line) => line.startsWith("  - "))
          .map((line) => line.slice(4))
          .sort();
  }

  // With one entry, the plugin runs in one process in either mode, so the
  // cases of one entry run in one mode only.
  const entries: [string, (nxJson: string) => string][] =
    isolation === "false"
      ? [
          ["in one entry", oneEntry],
          ["in two entries", twoEntries],
        ]
      : [["in two entries", twoEntries]];

  it.each(entries)(
    "follow a name that a project.json gives, %s, and fail again once both crates are called api",
    async (_where, nxJson) => {
      const workspace = FixtureWorkspace.create("name-collision", { "nx.json": nxJson });
      try {
        const collision = 'nx-rust would give 2 projects the name "api"';
        expect(await outcome(workspace)).toContain(collision);

        applyFileChanges(workspace.root, { "tools/api/project.json": '{ "name": "toolbox" }' });
        expect(await outcome(workspace)).toEqual(["api", "rust", "toolbox"]);

        applyFileChanges(workspace.root, {
          "rust/crates/api/project.json": '{ "name": "rust-api" }',
        });
        expect(await outcome(workspace)).toEqual(["rust", "rust-api", "toolbox"]);

        applyFileChanges(workspace.root, { "tools/api/project.json": null });
        expect(await outcome(workspace)).toEqual(["api", "rust", "rust-api"]);

        applyFileChanges(workspace.root, { "rust/crates/api/project.json": null });
        expect(await outcome(workspace)).toContain(collision);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each(entries)(
    "leave a name that a project which is not the plugin's holds too to Nx's error, %s",
    async (_where, nxJson) => {
      const workspace = FixtureWorkspace.create("name-collision", {
        "nx.json": nxJson,
        "web/project.json": '{ "name": "api" }',
      });
      try {
        expect(duplicateNameFolders(await outcome(workspace))).toEqual([
          "rust/crates/api",
          "tools/api",
          "web",
        ]);

        // The plugin's message appears once the other project gives up the name.
        applyFileChanges(workspace.root, { "web/project.json": '{ "name": "web" }' });
        expect(await outcome(workspace)).toContain('nx-rust would give 2 projects the name "api"');
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave two crates that project.json files give one new name to Nx's error",
    async () => {
      const workspace = FixtureWorkspace.create("name-collision", {
        "nx.json": twoEntries,
        "rust/crates/api/project.json": '{ "name": "shared" }',
        "tools/api/project.json": '{ "name": "shared" }',
      });
      try {
        expect(duplicateNameFolders(await outcome(workspace))).toEqual([
          "rust/crates/api",
          "tools/api",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave three crates with one name from three entries to Nx's error",
    async () => {
      const workspace = FixtureWorkspace.create("name-collision", {
        "nx.json": pluginEntries(
          { include: ["rust/**"] },
          { include: ["tools/**"] },
          { include: ["other/**"] },
        ),
        "other/api/Cargo.toml": crateManifest("api"),
        "other/api/src/lib.rs": "",
      });
      try {
        expect(duplicateNameFolders(await outcome(workspace))).toEqual([
          "other/api",
          "rust/crates/api",
          "tools/api",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "report a collision in one entry together with one across entries once only two crates remain",
    async () => {
      // rust/crates/api and other/api are in the first entry, tools/api in the second.
      const workspace = FixtureWorkspace.create("name-collision", {
        "nx.json": pluginEntries({ include: ["rust/**", "other/**"] }, { include: ["tools/**"] }),
        "other/api/Cargo.toml": crateManifest("api"),
        "other/api/src/lib.rs": "",
      });
      try {
        expect(duplicateNameFolders(await outcome(workspace))).toEqual([
          "other/api",
          "rust/crates/api",
          "tools/api",
        ]);

        applyFileChanges(workspace.root, { "other/api/project.json": '{ "name": "other-api" }' });
        const two = await outcome(workspace);
        expect(two).toContain('nx-rust would give 2 projects the name "api"');
        expect(two).toContain("- the crate api in rust/crates/api/Cargo.toml");
        expect(two).toContain("- the crate api in tools/api/Cargo.toml");

        applyFileChanges(workspace.root, { "other/api/project.json": null });
        expect(duplicateNameFolders(await outcome(workspace))).toEqual([
          "other/api",
          "rust/crates/api",
          "tools/api",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

/**
 * Replaces the plugin's entry in a fixture copy's `nx.json`, which the
 * harness has pointed at the plugin's source, with one entry per settings
 * object.
 */
function pluginEntries(...entries: object[]): (nxJson: string) => string {
  return (nxJson) => {
    const config = JSON.parse(nxJson);
    const [first] = config.plugins;
    const plugin = typeof first === "string" ? first : first.plugin;
    return JSON.stringify({ ...config, plugins: entries.map((entry) => ({ plugin, ...entry })) });
  };
}

function crateManifest(name: string): string {
  return `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`;
}
