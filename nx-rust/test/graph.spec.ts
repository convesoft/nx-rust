import {
  applyFileChanges,
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
// cargo and Nx's own graph creation. The cargo calls that creating them
// takes are checked in discovery.spec.ts.

interface ExpectedGraph {
  /** Each project's name with its folder. */
  projects: Record<string, string>;
  /** Each edge as source and target, sorted. */
  edges: [source: string, target: string][];
}

const expected: Record<Exclude<FixtureName, "name-collision">, ExpectedGraph> = {
  // api has a normal dependency on model, a build dependency on codegen and a
  // dev-dependency on testkit.
  "subfolder-workspace": {
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
    projects: { api: "rust/crates/api", rust: "rust", xtask: "tools/xtask" },
    edges: [["rust", "api"]],
  },
  // legacy is excluded from rust/ and so a standalone crate.
  "excluded-member": {
    projects: { app: "rust/crates/app", legacy: "rust/crates/legacy", rust: "rust" },
    edges: [["rust", "app"]],
  },
  // model is one project, in shared/, with an edge from server in backend/.
  "cross-workspace-path": {
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
  // The vendored crates are excluded, so lib has no edge to parser.
  "vendored-crate": {
    projects: { app: "rust/crates/app", lib: "rust/crates/lib", rust: "rust" },
    edges: [
      ["app", "lib"],
      ["rust", "app"],
      ["rust", "lib"],
    ],
  },
  // model dev-depends on testkit, which depends on model: both edges stay.
  "dev-dependency-cycle": {
    projects: { model: "rust/crates/model", rust: "rust", testkit: "rust/crates/testkit" },
    edges: [
      ["model", "testkit"],
      ["rust", "model"],
      ["rust", "testkit"],
      ["testkit", "model"],
    ],
  },
  "different-toolchains": {
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

describe("projects and edges of each fixture", () => {
  it.each(fixtures)(
    "%s has a project per crate and per workspace, with an edge per path dependency",
    async (fixture) => {
      const workspace = FixtureWorkspace.create(fixture);
      try {
        const files = workspace.files();

        const graph = await workspace.graph();

        expect(roots(graph)).toEqual(expected[fixture].projects);
        expect(edges(graph)).toEqual(expected[fixture].edges);
        expect(graph.externalNodes).toEqual({});
        // The plugin writes no file, in a crate or anywhere else.
        expect(workspace.files()).toEqual(files);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "creates its edges as implicit, which Nx does not keep from an earlier graph",
    async () => {
      const graph = await loadFixtureGraph("subfolder-workspace");

      expect(graph.dependencies.map((edge) => edge.type)).toEqual(
        graph.dependencies.map(() => "implicit"),
      );
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
    "gives edges to the vendored crates once they are no longer excluded",
    async () => {
      // The positive control for the exclude in vendored-crate's nx.json.
      const graph = await loadFixtureGraph("vendored-crate", {
        files: { "nx.json": pluginEntries({}) },
      });

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
    "gives no workspace project to a workspace whose root manifest is excluded",
    async () => {
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: { "nx.json": pluginEntries({ exclude: ["rust/Cargo.toml"] }) },
      });

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
      const loading = loadFixtureGraph("name-collision");

      await expect(loading).rejects.toThrow(GraphCreationError);
      const message = await loading.catch((error: Error) => error.message);
      expect(message).toContain(
        'nx-rust would give 2 projects the name "api", and Nx needs every project name to be unique',
      );
      expect(message).toContain(
        "- the crate api in rust/crates/api/Cargo.toml: set `name` under [package.metadata.nx] in that manifest.",
      );
      expect(message).toContain(
        "- the crate api in tools/api/Cargo.toml: set `name` under [package.metadata.nx] in that manifest.",
      );
      expect(message).toContain("nx-rust never renames a project on its own.");
    },
    HARNESS_TIMEOUT,
  );

  it(
    "offer the workspace's prefix for a crate in a workspace of several members",
    async () => {
      // rust/ gets a second member, unlike tools/api, a standalone crate.
      const loading = loadFixtureGraph("name-collision", {
        files: {
          "rust/crates/extra/Cargo.toml": crateManifest("extra"),
          "rust/crates/extra/src/lib.rs": "",
        },
      });

      await expect(loading).rejects.toThrow(
        "- the crate api in rust/crates/api/Cargo.toml: set `name` under [package.metadata.nx] in that manifest, or `namePrefix` under [workspace.metadata.nx] in rust/Cargo.toml for every member of its workspace.",
      );
      await expect(loading).rejects.toThrow(
        "- the crate api in tools/api/Cargo.toml: set `name` under [package.metadata.nx] in that manifest.",
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

  it.each<[string, FixtureName, string, string, string]>([
    [
      "a workspace in services/billing/ and one in services-billing/",
      "nested-folders",
      "services-billing",
      "services/billing/Cargo.toml",
      "services-billing/Cargo.toml",
    ],
    [
      "a workspace at the root and one in cargo-workspace/",
      "two-workspaces",
      "cargo-workspace",
      "Cargo.toml",
      "cargo-workspace/Cargo.toml",
    ],
  ])(
    "fail graph creation for two workspace projects with one name: %s",
    async (_situation, fixture, name, first, second) => {
      const folder = second.replace(/\/Cargo\.toml$/, "");
      const loading = loadFixtureGraph(fixture, {
        files: {
          [second]: '[workspace]\nmembers = ["crates/*"]\nresolver = "3"\n',
          [`${folder}/crates/ledger/Cargo.toml`]: crateManifest("ledger"),
          [`${folder}/crates/ledger/src/lib.rs`]: "",
        },
      });

      await expect(loading).rejects.toThrow(`would give 2 projects the name "${name}"`);
      for (const manifest of [first, second]) {
        await expect(loading).rejects.toThrow(
          `- the workspace project of the Cargo workspace in ${manifest}: set \`name\` under [workspace.metadata.nx.project] in that manifest.`,
        );
      }
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
