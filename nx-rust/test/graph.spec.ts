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
  "crate-shapes": {
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
  // harness keeps its edge, which closes a cycle.
  "patched-workspaces": {
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
    "gives each project its manifest, workspace, package name and the plugin's name in its metadata",
    async () => {
      const graph = await loadFixtureGraph("mixed-folders");

      expect(graph.projects["rust-engine"].metadata.cargo).toEqual({
        projectName: "engine",
        manifest: "libs/rust/crates/engine/Cargo.toml",
        workspaceManifest: "libs/rust/Cargo.toml",
        packageName: "engine",
      });
      expect(graph.projects["libs-rust"].metadata.cargo).toEqual({
        projectName: "libs-rust",
        manifest: "libs/rust/Cargo.toml",
        workspaceManifest: "libs/rust/Cargo.toml",
      });
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
      const message = await loading.then(
        () => "",
        (error: Error) => error.message,
      );
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

  it.each<[string, FixtureName, string, string, string]>([
    [
      "a workspace in services/billing/ and one in services-billing/",
      "nested-folders",
      "services-billing",
      "services/billing/Cargo.toml",
      "services-billing/Cargo.toml",
    ],
    // DES-PROJECT-GRAPH promises the plugin's message here only as best
    // effort, because one project is at the root; this guards today's message.
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

  /** The folders that Nx's duplicate-name error names, and whether the plugin's message follows. */
  function duplicateNameError(result: string[] | string): {
    folders: string[];
    pluginMessage: boolean;
  } {
    const message = typeof result === "string" ? result : "";
    const lines = message.split("\n");
    const start = lines.findIndex((line) =>
      line.includes("The following projects are defined in multiple locations"),
    );
    const end = lines.findIndex((line, index) => index > start && line === "");
    const folders =
      start < 0
        ? []
        : lines
            .slice(start + 1, end < 0 ? undefined : end)
            .filter((line) => line.startsWith("  - "))
            .map((line) => line.slice(4))
            .sort();
    return { folders, pluginMessage: message.includes("nx-rust would give") };
  }

  /**
   * Nx's error alone, naming `folders`. In these cases DES-PROJECT-GRAPH
   * promises only that graph creation fails with Nx's error; that the
   * plugin's message is absent guards today's behaviour.
   */
  function nxErrorAlone(...folders: string[]) {
    return { folders: folders.sort(), pluginMessage: false };
  }

  it.each([
    ["in one entry", oneEntry],
    ["in two entries", twoEntries],
  ])(
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

  it.each([
    ["in one entry", oneEntry],
    ["in two entries", twoEntries],
  ])(
    "leave a name that a project which is not the plugin's holds too to Nx's error alone, %s",
    async (_where, nxJson) => {
      const workspace = FixtureWorkspace.create("name-collision", {
        "nx.json": nxJson,
        "web/project.json": '{ "name": "api" }',
      });
      try {
        expect(duplicateNameError(await outcome(workspace))).toEqual(
          nxErrorAlone("rust/crates/api", "tools/api", "web"),
        );

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
    "leave two crates that project.json files give one new name to Nx's error alone",
    async () => {
      const workspace = FixtureWorkspace.create("name-collision", {
        "nx.json": twoEntries,
        "rust/crates/api/project.json": '{ "name": "shared" }',
        "tools/api/project.json": '{ "name": "shared" }',
      });
      try {
        expect(duplicateNameError(await outcome(workspace))).toEqual(
          nxErrorAlone("rust/crates/api", "tools/api"),
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave three crates with one name from three entries to Nx's error alone",
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
        expect(duplicateNameError(await outcome(workspace))).toEqual(
          nxErrorAlone("rust/crates/api", "tools/api", "other/api"),
        );
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
        expect(duplicateNameError(await outcome(workspace))).toEqual(
          nxErrorAlone("rust/crates/api", "tools/api", "other/api"),
        );

        applyFileChanges(workspace.root, { "other/api/project.json": '{ "name": "other-api" }' });
        const two = await outcome(workspace);
        expect(two).toContain('nx-rust would give 2 projects the name "api"');
        expect(two).toContain("- the crate api in rust/crates/api/Cargo.toml");
        expect(two).toContain("- the crate api in tools/api/Cargo.toml");

        applyFileChanges(workspace.root, { "other/api/project.json": null });
        expect(duplicateNameError(await outcome(workspace))).toEqual(
          nxErrorAlone("rust/crates/api", "tools/api", "other/api"),
        );
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
