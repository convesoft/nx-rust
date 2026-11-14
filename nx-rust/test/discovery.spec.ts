import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { CreateDependenciesContext, CreateNodesContext } from "@nx/devkit";
import plugin = require("../src");
import { discoverWorkspaces } from "../src/graph/discovery";
import { registrationOf } from "../src/graph/registration";
import {
  CargoCall,
  discoveryProbeEntry,
  FileChanges,
  FixtureName,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  loadFixtureGraph,
  pinnedToolchain,
  pinnedToolchainAvailable,
  ProbeRecord,
  testEnvironment,
  withoutColours,
} from "./harness";

// Checks the discovery part of VER-GRAPH: which workspaces the plugin finds,
// which cargo calls that takes, and how it fails.

/** The `cargo metadata` call of graph creation for `manifest`, started in `cwd`. */
function metadataCall(cwd: string, manifest: string): CargoCall {
  const path = manifest.startsWith("/") ? manifest : `{workspaceRoot}/${manifest}`;
  return {
    cwd,
    args: ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", path],
  };
}

/** The call that reads the workspace whose root manifest is in `root`. */
function workspaceCall(root: string): CargoCall {
  return metadataCall(root, root === "." ? "Cargo.toml" : `${root}/Cargo.toml`);
}

interface Expectation {
  /** The workspace roots in the order the plugin reads them, with the folders of their members. */
  workspaces: [root: string, members: string[]][];
  /** The reports for path dependencies without a project: where cargo starts and the manifest. */
  pathDependencies?: [cwd: string, manifest: string][];
}

const expected: Record<FixtureName, Expectation> = {
  "subfolder-workspace": {
    workspaces: [
      [
        "rust",
        ["rust/crates/api", "rust/crates/codegen", "rust/crates/model", "rust/crates/testkit"],
      ],
    ],
  },
  "two-workspaces": {
    workspaces: [
      [".", ["crates/app", "crates/util"]],
      ["tools", ["tools", "tools/scaffold"]],
    ],
  },
  "standalone-crate": {
    workspaces: [
      ["rust", ["rust/crates/api"]],
      ["tools/xtask", ["tools/xtask"]],
    ],
  },
  "excluded-member": {
    workspaces: [
      ["rust", ["rust/crates/app"]],
      ["rust/crates/legacy", ["rust/crates/legacy"]],
    ],
  },
  "cross-workspace-path": {
    workspaces: [
      ["backend", ["backend/crates/server"]],
      ["shared", ["shared/crates/model"]],
    ],
  },
  // Its nx.json excludes vendor/**, so the vendored crates have no project
  // and are read as path dependencies, from the workspace that uses them.
  "vendored-crate": {
    workspaces: [["rust", ["rust/crates/app", "rust/crates/lib"]]],
    pathDependencies: [
      ["rust", "vendor/parser/Cargo.toml"],
      ["rust", "vendor/lexer/Cargo.toml"],
    ],
  },
  "name-collision": {
    workspaces: [
      ["rust", ["rust/crates/api"]],
      ["tools/api", ["tools/api"]],
    ],
  },
  "dev-dependency-cycle": {
    workspaces: [["rust", ["rust/crates/model", "rust/crates/testkit"]]],
  },
  "different-toolchains": {
    workspaces: [
      ["pinned", ["pinned/crates/pinned-lib"]],
      ["stable", ["stable/crates/stable-lib"]],
    ],
  },
  "mixed-folders": {
    workspaces: [
      [
        "libs/rust",
        [
          "libs/rust/crates/addon",
          "libs/rust/crates/cli",
          "libs/rust/crates/engine",
          "libs/rust/crates/unnamed",
        ],
      ],
    ],
  },
  "nested-folders": {
    workspaces: [
      ["services/billing", ["services/billing/crates/invoice"]],
      ["apps/Billing.API/rust_v2", ["apps/Billing.API/rust_v2/crates/gateway"]],
    ],
  },
  "crate-shapes": {
    workspaces: [
      [
        "rust",
        [
          "rust/crates/cli",
          "rust/crates/core",
          "rust/crates/internal",
          "rust/crates/perf",
          "rust/crates/server",
        ],
      ],
    ],
  },
  // Its nx.json excludes third_party/**, so fork, which rust's [patch]
  // redirects to, has no project and is read from rust, where the
  // redirection applies. model and types have projects.
  "patched-workspaces": {
    workspaces: [
      [
        "rust",
        [
          "rust/crates/api",
          "rust/crates/harness",
          "rust/crates/model",
          "rust/crates/plain",
          "rust/crates/util",
          "rust/crates/viaw",
        ],
      ],
      ["shared", ["shared/crates/types"]],
    ],
    pathDependencies: [["rust", "third_party/fork/Cargo.toml"]],
  },
  "declared-files": {
    workspaces: [["rust", ["rust/crates/api", "rust/crates/app", "rust/crates/other"]]],
  },
  "undeclared-files": {
    workspaces: [
      [
        "rust",
        [
          "rust/crates/base",
          "rust/crates/cola",
          "rust/crates/colb",
          "rust/crates/macros",
          "rust/crates/multi",
          "rust/crates/plain",
          "rust/crates/reader",
        ],
      ],
    ],
  },
};

// The folders that a fixture's nx.json excludes from the plugin.
const excludedFolders: Partial<Record<FixtureName, string[]>> = {
  "vendored-crate": ["vendor"],
  "patched-workspaces": ["third_party"],
};

function expectedCalls({ workspaces, pathDependencies = [] }: Expectation): CargoCall[] {
  return [
    ...workspaces.map(([root]) => workspaceCall(root)),
    ...pathDependencies.map(([cwd, manifest]) => metadataCall(cwd, manifest)),
  ];
}

// Without the toolchain that it pins, cargo fails in different-toolchains/pinned.
const fixtures = (Object.keys(expected) as FixtureName[]).filter(
  (fixture) => fixture !== "different-toolchains" || pinnedToolchainAvailable(),
);

describe("workspace discovery through Nx", () => {
  it.each(fixtures)(
    "reads each workspace of %s with one cargo call",
    async (fixture) => {
      const calls = await loadFixtureGraph(fixture).then(
        (graph) => graph.cargoCalls,
        (error: unknown) => {
          // Its two crates called api fail graph creation once both
          // workspaces are read (graph.spec.ts).
          if (fixture === "name-collision" && error instanceof GraphCreationError) {
            return error.cargoCalls;
          }
          throw error;
        },
      );

      expect(calls).toEqual(expectedCalls(expected[fixture]));
    },
    HARNESS_TIMEOUT,
  );

  it(
    "reads a workspace at the root, one in a subfolder and a standalone crate with one call each",
    async () => {
      const graph = await loadFixtureGraph("two-workspaces", { files: standaloneXtask });

      expect(graph.cargoCalls).toEqual([
        workspaceCall("."),
        workspaceCall("tools"),
        workspaceCall("xtask"),
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "reads a workspace whose root manifest Nx does not hand to the plugin once more in its root folder",
    async () => {
      // The first call starts in the folder of the shallowest manifest that
      // the plugin receives and names the workspace root, where the
      // workspace's tasks run cargo.
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: { "nx.json": pluginEntry({ exclude: ["rust/Cargo.toml"] }) },
      });

      expect(graph.cargoCalls).toEqual([
        metadataCall("rust/crates/api", "rust/crates/api/Cargo.toml"),
        workspaceCall("rust"),
      ]);
      expect(Object.keys(graph.projects).sort()).toEqual(["api", "codegen", "model", "testkit"]);
    },
    HARNESS_TIMEOUT,
  );

  describe("skips crates that Nx does not hand to the plugin", () => {
    // standalone-crate reads tools/xtask without these changes (see above).
    it.each([
      ["ignored by .gitignore", { ".gitignore": "target/\ntools/\n" }],
      ["ignored by .nxignore", { ".nxignore": "tools/xtask\n" }],
      [
        "matched by exclude on the plugin entry",
        { "nx.json": pluginEntry({ exclude: ["tools/**"] }) },
      ],
    ])(
      "a crate %s",
      async (_situation, files: FileChanges) => {
        const graph = await loadFixtureGraph("standalone-crate", { files });

        expect(graph.cargoCalls).toEqual([workspaceCall("rust")]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "reads the vendored crates as standalone crates once they are no longer excluded",
      async () => {
        // The positive control for the exclude in vendored-crate's nx.json.
        const graph = await loadFixtureGraph("vendored-crate", {
          files: { "nx.json": pluginEntry({}) },
        });

        expect(graph.cargoCalls).toEqual([
          workspaceCall("rust"),
          workspaceCall("vendor/lexer"),
          workspaceCall("vendor/parser"),
        ]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "needs no further report for an ignored member that its workspace report covers",
      async () => {
        // api dev-depends on testkit, which then has no project.
        const graph = await loadFixtureGraph("subfolder-workspace", {
          files: { ".nxignore": "rust/crates/testkit\n" },
        });

        expect(graph.cargoCalls).toEqual([workspaceCall("rust")]);
      },
      HARNESS_TIMEOUT,
    );
  });

  it(
    "reads a path dependency outside the repository from the workspace that uses it",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace", {
        // The fixture copy lies in "repo" inside a temporary folder, so this
        // crate lies next to the repository, not in it.
        "../outside/helper/Cargo.toml": crateManifest("helper"),
        "../outside/helper/src/lib.rs": "",
        "rust/crates/model/Cargo.toml": (manifest) =>
          `${manifest}\n[dependencies]\nhelper = { path = "../../../../outside/helper" }\n`,
      });
      try {
        await workspace.graph();

        expect(workspace.cargoCalls()).toEqual([
          workspaceCall("rust"),
          metadataCall("rust", join(dirname(workspace.root), "outside", "helper", "Cargo.toml")),
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "creates the graph offline, with an empty Cargo home, and writes no file",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace", {
        // A registry dependency that no Cargo home holds, and no lockfile.
        "rust/crates/model/Cargo.toml": (manifest) => `${manifest}\n[dependencies]\nserde = "1"\n`,
        "rust/Cargo.lock": null,
      });
      try {
        const cargoHome = join(dirname(workspace.root), "cargo-home");
        mkdirSync(cargoHome);
        const env = { CARGO_HOME: cargoHome, CARGO_NET_OFFLINE: "true" };
        const files = workspace.files();

        await workspace.graph(env);

        expect(workspace.cargoCalls()).toEqual([workspaceCall("rust")]);
        expect(workspace.files()).toEqual(files);
        expect(readdirSync(cargoHome)).toEqual([]);
        // The positive control: a report with dependency resolution fails in
        // the same setting.
        const full = spawnSync("cargo", ["metadata", "--format-version", "1"], {
          cwd: join(workspace.root, "rust"),
          env: testEnvironment(env),
          encoding: "utf8",
        });
        expect(full.status).not.toBe(0);
        expect(full.stderr).toContain("serde");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("failed discovery", () => {
  it(
    "fails graph creation, naming the manifest, when cargo cannot be found",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace");
      try {
        // The positive control: with cargo on PATH, the same workspace is read.
        await workspace.graph();
        expect(workspace.cargoCalls()).toEqual([workspaceCall("rust")]);

        // The harness puts the wrapper's folder first on PATH, so the wrapper
        // goes. Nx starts Node by its full path and needs nothing on PATH.
        rmSync(join(workspace.cargo.binDirectory, "cargo"));
        const empty = join(dirname(workspace.root), "empty");
        mkdirSync(empty);
        const graph = workspace.graph({ PATH: empty });

        await expect(graph).rejects.toThrow(GraphCreationError);
        await expect(graph).rejects.toThrow(
          /could not read the Cargo workspace of rust\/Cargo\.toml: cargo was not found on PATH/,
        );
        await expect(graph).rejects.toThrow(/Install a Rust toolchain or put cargo on PATH/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation with cargo's message when a workspace cannot be read",
    async () => {
      const graph = loadFixtureGraph("two-workspaces", {
        files: { "tools/Cargo.toml": (manifest) => `${manifest}\nnot toml\n` },
      });

      // The root workspace is read, but the graph is not created without tools.
      await expect(graph).rejects.toThrow(GraphCreationError);
      await expect(graph).rejects.toThrow(
        /`cargo metadata` failed for the Cargo workspace of tools\/Cargo\.toml/,
      );
      await expect(graph).rejects.toThrow(/key with no value/);
      await expect(graph).rejects.toThrow(
        /add its path to "exclude" on the @convesoft\/nx-rust entry/,
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation for a crate inside a workspace folder that is no member",
    async () => {
      const loading = loadFixtureGraph("subfolder-workspace", {
        files: { "rust/stray/Cargo.toml": crateManifest("stray"), "rust/stray/src/lib.rs": "" },
      });

      await expect(loading).rejects.toThrow(/the Cargo workspace of rust\/stray\/Cargo\.toml/);
      await expect(loading).rejects.toThrow(/believes it's in a workspace when it's not/);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation when the report of a path dependency fails",
    async () => {
      const loading = loadFixtureGraph("vendored-crate", {
        files: { "vendor/lexer/Cargo.toml": null },
      });

      await expect(loading).rejects.toThrow(
        /`cargo metadata` failed for vendor\/lexer\/Cargo\.toml, a path dependency of vendor\/parser\/Cargo\.toml that has no project of its own/,
      );
    },
    HARNESS_TIMEOUT,
  );

  describe("of a path dependency that cargo builds but does not report", () => {
    // shared lists no members, so cargo builds model for server but refuses
    // to report it, and .nxignore keeps shared from Nx, so model has no
    // project. Reading model's report would lead on to lexer.
    const unreported: FileChanges = {
      "shared/Cargo.toml": (manifest) => manifest.replace('members = ["crates/*"]', "members = []"),
      "shared/crates/model/Cargo.toml": (manifest) =>
        `${manifest}\n[dependencies]\nlexer = { path = "../../../extra/lexer" }\n`,
      "extra/lexer/Cargo.toml": crateManifest("lexer"),
      "extra/lexer/src/lib.rs": "",
      ".nxignore": "shared/\nextra/\n",
    };
    const toolchains: [string, FileChanges][] = [["the default cargo", {}]];
    if (pinnedToolchainAvailable()) {
      toolchains.push([
        `cargo ${pinnedToolchain}`,
        { "backend/rust-toolchain.toml": `[toolchain]\nchannel = "${pinnedToolchain}"\n` },
      ]);
    }

    it.each(toolchains)(
      "goes on with a warning and does not follow the crates behind it, with %s",
      async (_toolchain, toolchain) => {
        const workspace = FixtureWorkspace.create("cross-workspace-path", unreported, toolchain);
        try {
          const graph = await workspace.graph();
          const calls = workspace.cargoCalls();
          const shown = await workspace.nx(["show", "projects"]);

          expect(Object.keys(graph.projects).sort()).toEqual(["backend", "server"]);
          expect(calls).toEqual([
            workspaceCall("backend"),
            metadataCall("backend", "shared/crates/model/Cargo.toml"),
          ]);
          // The executor prints it again at the start of each task of server.
          const warnings: string[] = graph.projects.server.metadata.cargo.warnings;
          const [warning] = warnings.filter((message) => message.includes("`cargo metadata`"));
          expect(warning).toContain(
            "`cargo metadata` failed for shared/crates/model/Cargo.toml, a path dependency of backend/crates/server/Cargo.toml that has no project of its own",
          );
          expect(warning).toContain("believes it's in a workspace when it's not");
          expect(warning).toContain(
            "so it does not follow the crates that this crate depends on by path: the crates that use it take only its own folder into their cache keys, and a change in a crate behind it can leave their keys unchanged.",
          );
          expect(warning).toContain(
            "To have those crates followed, fix what cargo reports, so that `cargo metadata --no-deps --manifest-path shared/crates/model/Cargo.toml` succeeds in backend, or declare their files with fileInputs in the [package.metadata.nx] or [workspace.metadata.nx] table of the crates that use it.",
          );
          expect(graph.projects.backend.metadata.cargo.warnings ?? []).not.toContain(warning);
          // Graph creation prints it once.
          expect(shown.status).toBe(0);
          expect(withoutColours(shown.output).split(warning)).toHaveLength(2);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "fails graph creation when its report fails for another reason",
      async () => {
        // With shared's members kept, model's report reads lexer's manifest,
        // which cargo rejects, as it does when it builds server.
        const loading = loadFixtureGraph("cross-workspace-path", {
          files: {
            ...unreported,
            "shared/Cargo.toml": (manifest) => manifest,
            "extra/lexer/Cargo.toml": "[package\n",
          },
        });

        await expect(loading).rejects.toThrow(
          /`cargo metadata` failed for shared\/crates\/model\/Cargo\.toml, a path dependency of backend\/crates\/server\/Cargo\.toml that has no project of its own/,
        );
        await expect(loading).rejects.toThrow(/extra\/lexer\/Cargo\.toml/);
        await expect(loading).rejects.toThrow(
          "Fix what cargo reports, so that `cargo metadata --no-deps --manifest-path shared/crates/model/Cargo.toml` succeeds in backend.",
        );
      },
      HARNESS_TIMEOUT,
    );
  });
});

// These call the plugin in this process, with the cargo wrapper of a fixture
// copy first on PATH.
describe("discovery in the plugin", () => {
  let workspace: FixtureWorkspace | undefined;
  let savedEnvironment: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnvironment = process.env;
  });

  afterEach(() => {
    process.env = savedEnvironment;
    workspace?.remove();
    workspace = undefined;
  });

  function copy(fixture: FixtureName, files?: FileChanges): FixtureWorkspace {
    workspace = FixtureWorkspace.create(fixture, files);
    process.env = workspace.cargo.environment(testEnvironment());
    return workspace;
  }

  it.each(fixtures)(
    "finds the workspaces of %s with their members",
    async (fixture) => {
      const { root } = copy(fixture);
      const manifests = manifestsIn(root, excludedFolders[fixture] ?? []);

      const discovery = await discoverWorkspaces(manifests, root);

      const { workspaces, pathDependencies = [] } = expected[fixture];
      expect(
        discovery.workspaces.map((found) => [
          found.root,
          found.members.map((member) => relative(root, dirname(member.manifest_path))),
        ]),
      ).toEqual(workspaces);
      expect(discovery.pathDependencyReports.map((report) => report.manifest)).toEqual(
        pathDependencies.map(([, manifest]) => manifest),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "finds a workspace at the root, one in a subfolder and a standalone crate",
    async () => {
      const { root } = copy("two-workspaces", standaloneXtask);

      const discovery = await discoverWorkspaces(manifestsIn(root), root);

      expect(
        discovery.workspaces.map((found) => [found.root, found.members.map((m) => m.name)]),
      ).toEqual([
        [".", ["app", "util"]],
        ["tools", ["tools", "scaffold"]],
        ["xtask", ["xtask"]],
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives no project to a member whose manifest Nx left out, and keeps it in the report",
    async () => {
      const { root } = copy("subfolder-workspace");
      const manifests = manifestsIn(root).filter((manifest) => !manifest.includes("testkit"));

      const discovery = await discoverWorkspaces(manifests, root);

      const [rust] = discovery.workspaces;
      expect(rust.members.map((member) => member.name)).toEqual(["api", "codegen", "model"]);
      expect(rust.report.packages.map((pkg) => pkg.name).sort()).toEqual([
        "api",
        "codegen",
        "model",
        "testkit",
      ]);
      expect(discovery.pathDependencyReports).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "requests the reports afresh for every graph computation and shares them with createDependencies",
    async () => {
      const { root } = copy("two-workspaces");
      const manifests = manifestsIn(root);
      const entry = loadEntry();

      await entry.createNodes[1](manifests, undefined, nodesContext(root));
      const first = registrationOf(entry).graphForDependencies(root).discovery;
      await entry.createNodes[1](manifests, undefined, nodesContext(root));
      const second = registrationOf(entry).graphForDependencies(root).discovery;

      expect(first.workspaces.map((found) => found.root)).toEqual([".", "tools"]);
      expect(second).not.toBe(first);
      expect(workspace.cargoCalls()).toEqual([
        workspaceCall("."),
        workspaceCall("tools"),
        workspaceCall("."),
        workspaceCall("tools"),
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs cargo only in createNodes, once per workspace",
    async () => {
      const { root } = copy("two-workspaces");
      const entry = loadEntry();

      const nodes = await entry.createNodes[1](manifestsIn(root), undefined, nodesContext(root));
      const projects = Object.fromEntries(
        nodes.flatMap(([, result]) =>
          Object.entries(result.projects).map(([projectRoot, project]) => [
            project.name,
            { ...project, root: projectRoot },
          ]),
        ),
      );
      const dependencies = await entry.createDependencies(
        undefined,
        dependenciesContext(root, projects),
      );

      expect(Object.keys(projects).sort()).toEqual([
        "app",
        "cargo-workspace",
        "scaffold",
        "tools",
        "util",
      ]);
      expect(dependencies).toContainEqual({ source: "app", target: "util", type: "implicit" });
      expect(workspace.cargoCalls()).toEqual([workspaceCall("."), workspaceCall("tools")]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "keeps what two entries discovered apart, and reads a workspace they split once",
    async () => {
      const { root } = copy("subfolder-workspace");
      const [rootManifest, ...members] = manifestsIn(root).sort();
      const first = loadEntry();
      const second = loadEntry();

      // As Nx starts them: one after the other, without waiting.
      await Promise.all([
        first.createNodes[1]([rootManifest], undefined, nodesContext(root)),
        second.createNodes[1](members, undefined, nodesContext(root)),
      ]);

      expect(rootManifest).toBe("rust/Cargo.toml");
      expect(seenBy(first, root)).toEqual([["rust", []]]);
      expect(seenBy(second, root)).toEqual([
        [
          "rust",
          ["rust/crates/api", "rust/crates/codegen", "rust/crates/model", "rust/crates/testkit"],
        ],
      ]);
      expect(workspace.cargoCalls()).toEqual([workspaceCall("rust")]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "adds no error of its own in createDependencies when createNodes failed",
    async () => {
      const { root } = copy("subfolder-workspace", {
        "rust/Cargo.toml": (manifest) => `${manifest}\nnot toml\n`,
      });
      const entry = loadEntry();

      await expect(
        entry.createNodes[1](manifestsIn(root), undefined, nodesContext(root)),
      ).rejects.toThrow(/rust\/Cargo\.toml/);

      expect(registrationOf(entry).graphForDependencies(root)).toBeUndefined();
      expect(await entry.createDependencies(undefined, dependenciesContext(root))).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it("refuses createDependencies for a repository that the entry's createNodes has not seen", () => {
    expect(() =>
      loadEntry().createDependencies(undefined, dependenciesContext("/no/such")),
    ).toThrow(/asked for the dependencies before the projects/);
  });

  it("refuses createDependencies that is not called on an entry", () => {
    expect(() =>
      plugin.createDependencies.call(undefined, undefined, dependenciesContext("/x")),
    ).toThrow(/could not tell which of its entries in nx.json/);
  });
});

// Two entries of the plugin in nx.json, with include filters that split the
// manifests between them, through real Nx with and without plugin isolation.
// The probe stands in for the plugin and records what each entry's
// createDependencies sees.
describe.each([
  ["in plugin workers", "true"],
  ["in one process", "false"],
])("two plugin entries %s", (_mode, isolation) => {
  let workspace: FixtureWorkspace | undefined;

  afterEach(() => {
    workspace?.remove();
    workspace = undefined;
  });

  /** Builds the graph with one probe entry per `include` list and returns what the entries saw. */
  async function graphWithEntries(
    fixture: FixtureName,
    includes: string[][],
  ): Promise<{ seen: ProbeRecord[]; calls: CargoCall[] }> {
    workspace = FixtureWorkspace.create(fixture, {
      "nx.json": JSON.stringify({
        plugins: includes.map((include) => ({ plugin: discoveryProbeEntry, include })),
      }),
    });
    const log = join(dirname(workspace.root), "probe.jsonl");
    await workspace.graph({ NX_ISOLATE_PLUGINS: isolation, DISCOVERY_PROBE_LOG: log });
    const seen = readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as ProbeRecord);
    return { seen: sortedByJson(seen), calls: sortedByJson(workspace.cargoCalls()) };
  }

  it(
    "gives each entry's createDependencies what its own createNodes discovered",
    async () => {
      const { seen, calls } = await graphWithEntries("two-workspaces", [
        ["Cargo.toml", "crates/**"],
        ["tools/**"],
      ]);

      expect(seen).toEqual(
        sortedByJson([
          { workspaces: [[".", ["crates/app", "crates/util"]]], pathDependencies: [] },
          { workspaces: [["tools", ["tools", "tools/scaffold"]]], pathDependencies: [] },
        ]),
      );
      expect(calls).toEqual(sortedByJson([workspaceCall("."), workspaceCall("tools")]));
    },
    HARNESS_TIMEOUT,
  );

  it(
    "reads a workspace whose manifests the entries split once per process",
    async () => {
      const { seen, calls } = await graphWithEntries("subfolder-workspace", [
        ["rust/Cargo.toml"],
        ["rust/crates/**"],
      ]);

      expect(seen).toEqual(
        sortedByJson([
          { workspaces: [["rust", []]], pathDependencies: [] },
          {
            workspaces: [
              [
                "rust",
                [
                  "rust/crates/api",
                  "rust/crates/codegen",
                  "rust/crates/model",
                  "rust/crates/testkit",
                ],
              ],
            ],
            pathDependencies: [],
          },
        ]),
      );
      // Isolated plugin workers are separate processes, which cannot share a
      // report, and the second entry reads the workspace once more in its
      // root folder.
      expect(calls).toEqual(
        isolation === "false"
          ? [workspaceCall("rust")]
          : sortedByJson([
              workspaceCall("rust"),
              workspaceCall("rust"),
              metadataCall("rust/crates/api", "rust/crates/api/Cargo.toml"),
            ]),
      );
    },
    HARNESS_TIMEOUT,
  );
});

/** An entry of the plugin as Nx loads it: a copy of the module's properties. */
function loadEntry(): typeof plugin {
  return { ...plugin };
}

/** What an entry's createDependencies sees: the workspace roots with the folders of their members. */
function seenBy(entry: typeof plugin, root: string): [string, string[]][] {
  return registrationOf(entry)
    .graphForDependencies(root)
    .discovery.workspaces.map((found) => [
      found.root,
      found.members.map((member) => relative(root, dirname(member.manifest_path))),
    ]);
}

function sortedByJson<T>(values: T[]): T[] {
  return [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/** Changes to two-workspaces that add `xtask`, a crate outside every workspace. */
const standaloneXtask: FileChanges = {
  // Its own empty [workspace] keeps it out of the root workspace around it.
  "xtask/Cargo.toml": `${crateManifest("xtask")}\n[workspace]\n`,
  "xtask/src/main.rs": "fn main() {}\n",
};

function crateManifest(name: string): string {
  return `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`;
}

/** The `Cargo.toml` files of a fixture copy, as Nx would hand them over, without `skip`. */
function manifestsIn(root: string, skip: string[] = [], folder = ""): string[] {
  return readdirSync(join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
    if (entry.isDirectory()) {
      return ["node_modules", "target", ...skip].includes(path) || entry.name === "target"
        ? []
        : manifestsIn(root, skip, path);
    }
    return entry.name === "Cargo.toml" ? [path] : [];
  });
}

/**
 * Replaces the plugin's entry in a fixture copy's `nx.json`, which the
 * harness has pointed at the plugin's source, with one that has `settings`.
 */
function pluginEntry(settings: { exclude?: string[] }): (nxJson: string) => string {
  return (nxJson) => {
    const config = JSON.parse(nxJson);
    config.plugins = config.plugins.map((entry: string | { plugin: string }) => ({
      plugin: typeof entry === "string" ? entry : entry.plugin,
      ...settings,
    }));
    return JSON.stringify(config);
  };
}

function nodesContext(workspaceRoot: string): CreateNodesContext {
  return { workspaceRoot, nxJsonConfiguration: {} };
}

function dependenciesContext(
  workspaceRoot: string,
  projects: CreateDependenciesContext["projects"] = {},
): CreateDependenciesContext {
  const fileMap = { projectFileMap: {}, nonProjectFiles: [] };
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    projects,
    externalNodes: {},
    fileMap,
    filesToProcess: fileMap,
  };
}
