import type { CreateNodesContext } from "@nx/devkit";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import plugin = require("../src");
import type { CargoProject } from "../src/graph/projects";
import { registrationOf } from "../src/graph/registration";
import {
  FileChanges,
  FixtureGraph,
  FixtureName,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  loadFixtureGraph,
  testEnvironment,
  withoutColours,
} from "./harness";

// Checks the parts of VER-CONFIGURATION about the metadata tables and the
// plugin options, other than targetNames (targets.spec.ts), with a real
// cargo and Nx's own graph creation. Settings that take effect only in the
// cargo commands or the cache keys are checked where the plugin places them
// for the issues that build those effects.

const cargoExecutor = "@convesoft/nx-rust:cargo";

describe("per crate and per workspace", () => {
  // The virtual workspace in rust/ with the members api, codegen, model and
  // testkit; web is a JS project that crates can depend on.
  const files: FileChanges = {
    "web/project.json": JSON.stringify({ name: "web" }),
    "rust/Cargo.toml": (manifest) =>
      `${manifest}
[workspace.metadata.nx]
tags = ["lang:rust"]
implicitDependencies = ["web"]

[workspace.metadata.nx.targets.test.options]
features = ["workspace"]
noDefaultFeatures = true

[workspace.metadata.nx.targets.sqlx-prepare]
command = "cargo sqlx prepare"

[workspace.metadata.nx.project]
name = "rust-tools"
tags = ["scope:tooling"]

[workspace.metadata.nx.project.targets.doc.options]
noDeps = false

[workspace.metadata.nx.project.targets.coverage]
command = "cargo llvm-cov"
`,
    "rust/crates/api/Cargo.toml": (manifest) =>
      `${manifest}
[package.metadata.nx]
name = "backend-api"
tags = ["scope:backend", "lang:rust"]
implicitDependencies = ["codegen-js"]

[package.metadata.nx.targets.test.options]
features = ["integration"]

[package.metadata.nx.targets.migrate]
command = "cargo run -p api --bin migrate"
`,
    "codegen-js/project.json": JSON.stringify({ name: "codegen-js" }),
  };
  let graph: FixtureGraph;

  beforeAll(async () => {
    graph = await loadFixtureGraph("subfolder-workspace", { files });
  }, HARNESS_TIMEOUT);

  it("names a crate by its own table and leaves the others' names", () => {
    expect(rootOf(graph, "backend-api")).toBe("rust/crates/api");
    expect(graph.projects.api).toBeUndefined();
    expect(rootOf(graph, "model")).toBe("rust/crates/model");
  });

  it("gives a crate its workspace's tags and its own, and the others the workspace's", () => {
    expect(graph.projects["backend-api"].tags).toEqual(["lang:rust", "scope:backend"]);
    expect(graph.projects.model.tags).toEqual(["lang:rust"]);
  });

  it("adds the implicit dependencies of both tables to a crate", () => {
    expect(graph.projects["backend-api"].implicitDependencies).toEqual(["web", "codegen-js"]);
    expect(graph.projects.model.implicitDependencies).toEqual(["web"]);
    const targetsOf = (source: string) =>
      graph.dependencies.filter((edge) => edge.source === source).map((edge) => edge.target);
    expect(targetsOf("backend-api")).toEqual(
      expect.arrayContaining(["web", "codegen-js", "model"]),
    );
    expect(targetsOf("model")).toEqual(["web"]);
  });

  it("lets a crate's option replace the workspace's and keeps the other options", () => {
    expect(graph.projects["backend-api"].targets.test.options).toEqual({
      features: ["integration"],
      noDefaultFeatures: true,
    });
    expect(graph.projects.model.targets.test.options).toEqual({
      features: ["workspace"],
      noDefaultFeatures: true,
    });
    expect(graph.projects.model.targets.test.executor).toBe(cargoExecutor);
  });

  it("adds extra targets: the workspace's to every member, the crate's to the crate", () => {
    for (const name of ["backend-api", "model", "codegen", "testkit"]) {
      expect(graph.projects[name].targets["sqlx-prepare"]).toMatchObject({
        executor: "nx:run-commands",
        options: { command: "cargo sqlx prepare" },
      });
    }
    expect(graph.projects["backend-api"].targets.migrate).toMatchObject({
      executor: "nx:run-commands",
      options: { command: "cargo run -p api --bin migrate" },
    });
    expect(graph.projects.model.targets.migrate).toBeUndefined();
  });

  it("configures the workspace project with its own table, beside the workspace's tags", () => {
    const project = graph.projects["rust-tools"];
    expect(project.root).toBe("rust");
    expect(graph.projects.rust).toBeUndefined();
    expect(project.tags).toEqual(["lang:rust", "scope:tooling"]);
    expect(project.targets.doc.options).toEqual({ noDeps: false });
    expect(project.targets.coverage).toMatchObject({
      executor: "nx:run-commands",
      options: { command: "cargo llvm-cov" },
    });
    // The workspace table's targets and implicit dependencies are the members'.
    expect(project.targets["sqlx-prepare"]).toBeUndefined();
    expect(project.targets.test).toBeUndefined();
    expect(project.implicitDependencies ?? []).toEqual([]);
  });
});

describe("target tables over inferred targets", () => {
  it(
    "address a target renamed by targetNames under its new name",
    async () => {
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: {
          "nx.json": pluginOptions({ targetNames: { check: "typecheck" } }),
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}
[package.metadata.nx.targets.typecheck.options]
allTargets = false
`,
        },
      });

      expect(graph.projects.model.targets.typecheck).toMatchObject({
        executor: cargoExecutor,
        options: { allTargets: false },
        metadata: { cargo: { target: "check" } },
      });
      expect(graph.projects.model.targets.check).toBeUndefined();
      expect(graph.projects.api.targets.typecheck.options).toEqual({ allTargets: true });
    },
    HARNESS_TIMEOUT,
  );

  it(
    'keep the inferred inputs where the list has "...", and accept the inferred executor',
    async () => {
      const table = (target: string) => `
[workspace.metadata.nx.project.targets.${target}]
executor = "${cargoExecutor}"
inputs = ["...", { env = "X" }]
`;
      const plain = await loadFixtureGraph("subfolder-workspace");
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: {
          "rust/Cargo.toml": (manifest) => `${manifest}${table("audit")}${table("update")}`,
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}
[package.metadata.nx.targets.test]
executor = "${cargoExecutor}"
inputs = ["...", { env = "X" }]

[package.metadata.nx.targets.check.options]
features = ["extra"]
`,
        },
      });

      for (const target of ["audit", "update"]) {
        const inferred = plain.projects.rust.targets[target];
        expect(inferred.inputs?.length).toBeGreaterThan(0);
        expect(graph.projects.rust.targets[target]).toEqual({
          ...inferred,
          inputs: [...(inferred.inputs ?? []), { env: "X" }],
        });
      }
      const test = plain.projects.model.targets.test;
      expect(graph.projects.model.targets.test).toEqual({
        ...test,
        inputs: [...(test.inputs ?? []), { env: "X" }],
      });
      // An options key replaces only that option.
      expect(graph.projects.model.targets.check.options).toEqual({
        allTargets: true,
        features: ["extra"],
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "make run continuous with readyWhen from the crate's table",
    async () => {
      const graph = await loadFixtureGraph("crate-shapes", {
        files: {
          "rust/crates/server/Cargo.toml": (manifest) =>
            `${manifest}
[package.metadata.nx.targets.run]
continuous = true
readyWhen = { port = 8080 }
`,
        },
      });

      expect(graph.projects.server.targets.run).toMatchObject({
        executor: "@convesoft/nx-rust:run",
        continuous: true,
        readyWhen: { port: 8080 },
      });
      expect(graph.projects.cli.targets.run.continuous).toBe(false);
    },
    HARNESS_TIMEOUT,
  );
});

describe("names and prefixes", () => {
  it(
    "put namePrefix in front of each member's package name, but not of a name of its own or of the workspace project",
    async () => {
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: {
          "rust/Cargo.toml": (manifest) =>
            `${manifest}\n[workspace.metadata.nx]\nnamePrefix = "be-"\n`,
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx]\nname = "backend"\n`,
        },
      });

      expect(rootsByName(graph)).toEqual({
        "be-api": "rust/crates/api",
        "be-codegen": "rust/crates/codegen",
        "be-testkit": "rust/crates/testkit",
        backend: "rust/crates/model",
        rust: "rust",
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "put namePrefix in front of the crate of a root manifest",
    async () => {
      const graph = await loadFixtureGraph("two-workspaces", {
        files: {
          "tools/Cargo.toml": (manifest) =>
            `${manifest}\n[workspace.metadata.nx]\nnamePrefix = "be-"\n`,
        },
      });

      expect(rootOf(graph, "be-tools")).toBe("tools");
      expect(rootOf(graph, "be-scaffold")).toBe("tools/scaffold");
      expect(rootOf(graph, "app")).toBe("crates/app");
    },
    HARNESS_TIMEOUT,
  );

  it(
    "take the workspace settings of a standalone crate from its own manifest",
    async () => {
      const graph = await loadFixtureGraph("standalone-crate", {
        files: {
          "tools/xtask/Cargo.toml": (manifest) =>
            `${manifest}\n[workspace]\n\n[workspace.metadata.nx]\nnamePrefix = "x-"\ntags = ["tooling"]\n`,
        },
      });

      expect(rootOf(graph, "x-xtask")).toBe("tools/xtask");
      expect(graph.projects["x-xtask"].tags).toEqual(["tooling"]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave the name to a package.json that Nx reads, and keep the tags of both",
    async () => {
      const graph = await loadFixtureGraph("mixed-folders", {
        files: {
          "libs/rust/crates/addon/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx]\nname = "addon-crate"\ntags = ["lang:rust"]\n`,
          "libs/rust/crates/addon/package.json": (json) =>
            JSON.stringify({ ...JSON.parse(json), nx: { tags: ["lang:js"] } }),
        },
      });

      expect(graph.projects["addon-crate"]).toBeUndefined();
      const addon = graph.projects["@mixed/napi-addon"];
      expect(addon.root).toBe("libs/rust/crates/addon");
      expect(addon.tags).toEqual(expect.arrayContaining(["lang:js", "lang:rust"]));
    },
    HARNESS_TIMEOUT,
  );
});

describe("name collisions after names and prefixes", () => {
  it(
    "offer namePrefix only for a crate without a name of its own",
    async () => {
      const message = await graphError("name-collision", {
        "rust/crates/api/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx]\nname = "api"\n`,
      });

      expect(message).toContain('nx-rust would give 2 projects the name "api"');
      expect(message).toContain(
        "- the crate api in rust/crates/api/Cargo.toml: change `name` under [package.metadata.nx] in that manifest.",
      );
      expect(message).toContain(
        "- the crate api in tools/api/Cargo.toml: set `name` under [package.metadata.nx] in that manifest, or `namePrefix` under [workspace.metadata.nx] in tools/api/Cargo.toml for every member of its workspace.",
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "name both remedies where a prefix makes the collision",
    async () => {
      const message = await graphError("subfolder-workspace", {
        "rust/Cargo.toml": (manifest) =>
          `${manifest}\n[workspace.metadata.nx]\nnamePrefix = "be-"\n`,
        "rust/crates/model/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx]\nname = "be-api"\n`,
      });

      expect(message).toContain('nx-rust would give 2 projects the name "be-api"');
      expect(message).toContain(
        "- the crate api in rust/crates/api/Cargo.toml: set `name` under [package.metadata.nx] in that manifest, or `namePrefix` under [workspace.metadata.nx] in rust/Cargo.toml for every member of its workspace.",
      );
      expect(message).toContain(
        "- the crate model in rust/crates/model/Cargo.toml: change `name` under [package.metadata.nx] in that manifest.",
      );
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, FileChanges, Record<string, string>]>([
    [
      "a name",
      {
        "tools/api/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx]\nname = "tool-api"\n`,
      },
      { api: "rust/crates/api", "tool-api": "tools/api", rust: "rust" },
    ],
    [
      "a prefix",
      {
        "rust/Cargo.toml": (manifest) =>
          `${manifest}\n[workspace.metadata.nx]\nnamePrefix = "rust-"\n`,
      },
      { "rust-api": "rust/crates/api", api: "tools/api", rust: "rust" },
    ],
    [
      "the name of the workspace project",
      {
        "rust/Cargo.toml": (manifest) =>
          `${manifest}\n[workspace.metadata.nx.project]\nname = "rust-workspace"\n`,
        "rust/crates/api/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx]\nname = "rust"\n`,
        "tools/api/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx]\nname = "tool-api"\n`,
      },
      { rust: "rust/crates/api", "tool-api": "tools/api", "rust-workspace": "rust" },
    ],
  ])(
    "are resolved with %s",
    async (_setting, files, expected) => {
      const graph = await loadFixtureGraph("name-collision", { files });

      expect(rootsByName(graph)).toEqual(expected);
    },
    HARNESS_TIMEOUT,
  );
});

describe("graph-creation errors", () => {
  it.each<[string, FixtureName, FileChanges, string[]]>([
    [
      "an unknown key in a package table",
      "subfolder-workspace",
      { "rust/crates/api/Cargo.toml": appendTo('[package.metadata.nx]\nnamePrefix = "x-"') },
      [
        'rust/crates/api/Cargo.toml: nx-rust does not know the key "namePrefix" in [package.metadata.nx].',
        '"namePrefix" can be set in [workspace.metadata.nx] of a workspace\'s root manifest.',
      ],
    ],
    [
      "a misspelt key in a workspace table",
      "subfolder-workspace",
      { "rust/Cargo.toml": appendTo('[workspace.metadata.nx]\ntestrunner = "nextest"') },
      [
        'rust/Cargo.toml: nx-rust does not know the key "testrunner" in [workspace.metadata.nx]. Did you mean "testRunner"?',
      ],
    ],
    [
      "a key of an Nx project in a workspace table",
      "subfolder-workspace",
      { "rust/Cargo.toml": appendTo('[workspace.metadata.nx]\nroot = "rust"') },
      ['rust/Cargo.toml: nx-rust does not know the key "root" in [workspace.metadata.nx].'],
    ],
    [
      "an unknown key in the project table",
      "subfolder-workspace",
      {
        "rust/Cargo.toml": appendTo(
          '[workspace.metadata.nx.project]\nimplicitDependencies = ["web"]',
        ),
      },
      [
        'rust/Cargo.toml: nx-rust does not know the key "implicitDependencies" in [workspace.metadata.nx.project].',
        'The keys it knows there are "name", "tags" and "targets".',
      ],
    ],
    [
      "an unknown key in the plugin options",
      "subfolder-workspace",
      { "nx.json": pluginOptions({ testrunner: "nextest", namePrefix: "x-" }) },
      [
        'nx.json: nx-rust does not know the key "testrunner" in the options of the @convesoft/nx-rust entry. Did you mean "testRunner"?',
        'nx.json: nx-rust does not know the key "namePrefix" in the options of the @convesoft/nx-rust entry.',
      ],
    ],
    [
      "an invalid value",
      "subfolder-workspace",
      {
        "nx.json": pluginOptions({ testRunner: "jest" }),
      },
      [
        'nx.json: "testRunner" in the options of the @convesoft/nx-rust entry has to be "cargo" or "nextest", not "jest".',
      ],
    ],
    [
      "tags that are no list",
      "subfolder-workspace",
      { "rust/crates/model/Cargo.toml": appendTo('[package.metadata.nx]\ntags = "core"') },
      [
        'rust/crates/model/Cargo.toml: "tags" in [package.metadata.nx] has to be a list of tags, each a string that is not empty, not "core".',
      ],
    ],
    [
      'inputs without "..." on an inferred target',
      "subfolder-workspace",
      {
        "rust/crates/model/Cargo.toml": appendTo(
          '[package.metadata.nx.targets.test]\ninputs = [{ env = "X" }]',
        ),
      },
      [
        'rust/crates/model/Cargo.toml: [package.metadata.nx.targets.test] sets "inputs" without "..." on the inferred target "test".',
      ],
    ],
    [
      'inputs without "..." in a workspace table, once for every member',
      "subfolder-workspace",
      { "rust/Cargo.toml": appendTo('[workspace.metadata.nx.targets.lint]\ninputs = ["default"]') },
      [
        'rust/Cargo.toml: [workspace.metadata.nx.targets.lint] sets "inputs" without "..." on the inferred target "lint".',
      ],
    ],
    [
      "a different executor on an inferred target",
      "subfolder-workspace",
      {
        "rust/crates/model/Cargo.toml": appendTo(
          '[package.metadata.nx.targets.build]\nexecutor = "nx:run-commands"',
        ),
      },
      [
        'rust/crates/model/Cargo.toml: [package.metadata.nx.targets.build] sets "executor" to "nx:run-commands" on the inferred target "build", which runs "@convesoft/nx-rust:cargo".',
      ],
    ],
    [
      "a command on an inferred target",
      "subfolder-workspace",
      {
        "rust/Cargo.toml": appendTo(
          '[workspace.metadata.nx.project.targets.doc]\ncommand = "cargo doc"',
        ),
      },
      [
        'rust/Cargo.toml: [workspace.metadata.nx.project.targets.doc] sets "command" on the inferred target "doc".',
      ],
    ],
    [
      "affectedTests = true among the options of test, without the setting",
      "subfolder-workspace",
      {
        "rust/crates/model/Cargo.toml": appendTo(
          "[package.metadata.nx.targets.test.options]\naffectedTests = true",
        ),
      },
      [
        'rust/crates/model/Cargo.toml: [package.metadata.nx.targets.test.options] sets "affectedTests" to true, but the Cargo workspace in rust/Cargo.toml does not use the selection of affected tests',
      ],
    ],
    [
      "affectedTests = true in a configuration of test, without the setting",
      "subfolder-workspace",
      {
        "rust/Cargo.toml": appendTo(
          "[workspace.metadata.nx.targets.test.configurations.ci]\naffectedTests = true",
        ),
      },
      [
        'rust/Cargo.toml: [workspace.metadata.nx.targets.test.configurations.ci] sets "affectedTests" to true',
      ],
    ],
    [
      "implicitDependencies entries starting with !, naming a Cargo dependency and naming none",
      "subfolder-workspace",
      {
        "rust/crates/api/Cargo.toml": appendTo(
          '[package.metadata.nx]\nimplicitDependencies = ["!model", "!nothing"]',
        ),
      },
      [
        'rust/crates/api/Cargo.toml: "implicitDependencies" in [package.metadata.nx] has the entries "!model" and "!nothing", but the key only adds dependencies, so an entry starting with "!" is an error, whatever it names.',
      ],
    ],
    [
      "a project table in a root manifest that defines a crate",
      "two-workspaces",
      { "tools/Cargo.toml": appendTo('[workspace.metadata.nx.project]\nname = "toolbox"') },
      [
        "tools/Cargo.toml: [workspace.metadata.nx.project] configures the workspace project, but this root manifest defines a crate, which is the workspace project. Move its settings to [package.metadata.nx] in tools/Cargo.toml.",
      ],
    ],
  ])(
    "for %s",
    async (_case, fixture, files, expected) => {
      const message = await graphError(fixture, files);

      for (const text of expected) {
        expect(message).toContain(text);
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "names a workspace table's problem once, though every member has the table",
    async () => {
      const message = await graphError("subfolder-workspace", {
        "rust/Cargo.toml": appendTo('[workspace.metadata.nx.targets.lint]\ninputs = ["default"]'),
      });

      // Nx repeats a plugin's error once in its summary; four members would give eight.
      expect(message.split('[workspace.metadata.nx.targets.lint] sets "inputs"').length - 1).toBe(
        2,
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "accepts affectedTests = true on test where the workspace uses selection",
    async () => {
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: {
          "rust/Cargo.toml": appendTo("[workspace.metadata.nx]\naffectedTests = true"),
          "rust/crates/model/Cargo.toml": appendTo(
            "[package.metadata.nx.targets.test.options]\naffectedTests = true",
          ),
        },
      });

      expect(graph.projects.model.targets.test.options).toEqual({ affectedTests: true });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails for affectedTests = true on test from targetDefaults, without the setting",
    async () => {
      const message = await graphError("subfolder-workspace", {
        "nx.json": (json) =>
          JSON.stringify({
            ...JSON.parse(json),
            targetDefaults: { test: { options: { affectedTests: true } } },
          }),
      });

      expect(message).toContain(
        'The target "test" of the project "model" (rust/crates/model/Cargo.toml) sets "affectedTests" to true among its options, but the Cargo workspace in rust/Cargo.toml does not use the selection of affected tests',
      );
    },
    HARNESS_TIMEOUT,
  );
});

describe("settings that take effect later, as the plugin places them", () => {
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

  /** The projects that one entry's createNodes creates for `fixture`, by the name the plugin gives them. */
  async function projects(
    fixture: FixtureName,
    options: object,
    files: FileChanges,
  ): Promise<Record<string, CargoProject>> {
    workspace = FixtureWorkspace.create(fixture, files);
    process.env = workspace.cargo.environment(testEnvironment());
    const entry = { ...plugin };
    const context: CreateNodesContext = { workspaceRoot: workspace.root, nxJsonConfiguration: {} };
    await entry.createNodes[1](manifestsIn(workspace.root), options, context);
    const graph = registrationOf(entry).graphForDependencies(workspace.root);
    return Object.fromEntries((graph?.projects ?? []).map((project) => [project.name, project]));
  }

  it(
    "take a workspace's per-workspace settings from its table, and elsewhere from the plugin options",
    async () => {
      const found = await projects(
        "two-workspaces",
        { testRunner: "nextest", affectedTests: true, featureUnification: "cargo", locked: true },
        {
          "tools/Cargo.toml": appendTo(
            '[workspace.metadata.nx]\ntestRunner = "cargo"\naffectedTests = false\nfeatureUnification = "workspace-build"',
          ),
        },
      );

      expect(found.app.settings.workspace).toMatchObject({
        rootManifest: "Cargo.toml",
        testRunner: "nextest",
        affectedTests: true,
        featureUnification: "cargo",
        locked: true,
        setInTable: [],
      });
      expect(found.scaffold.settings.workspace).toMatchObject({
        rootManifest: "tools/Cargo.toml",
        testRunner: "cargo",
        affectedTests: false,
        featureUnification: "workspace-build",
        locked: true,
        setInTable: ["testRunner", "affectedTests", "featureUnification"],
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "use the defaults where nothing sets them",
    async () => {
      const found = await projects("subfolder-workspace", {}, {});

      expect(found.api.settings).toEqual({
        workspace: {
          rootManifest: "rust/Cargo.toml",
          locked: false,
          testRunner: "cargo",
          affectedTests: false,
          featureUnification: undefined,
          setInTable: [],
          namePrefix: undefined,
          tags: [],
          implicitDependencies: [],
          envInputs: [],
          runtimeInputs: [],
          fileInputs: [],
        },
        name: undefined,
        tags: [],
        implicitDependencies: [],
        envInputs: [],
        runtimeInputs: [],
        fileInputs: [],
        artifacts: undefined,
        targets: [],
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "add up the inputs of every level that has them, for the crate that sets them",
    async () => {
      const found = await projects(
        "subfolder-workspace",
        { envInputs: ["PLUGIN_VAR"], runtimeInputs: ["plugin --version"] },
        {
          "rust/Cargo.toml": appendTo(
            '[workspace.metadata.nx]\nenvInputs = ["WORKSPACE_VAR"]\nruntimeInputs = ["workspace --version"]\nfileInputs = ["../proto/**/*.proto"]',
          ),
          "rust/crates/api/Cargo.toml": appendTo(
            '[package.metadata.nx]\nenvInputs = ["CRATE_VAR", "PLUGIN_VAR"]\nruntimeInputs = ["crate --version"]\nfileInputs = ["../../../schema.sql"]\nartifacts = ["napi"]',
          ),
        },
      );

      expect(found.api.settings).toMatchObject({
        envInputs: ["PLUGIN_VAR", "WORKSPACE_VAR", "CRATE_VAR"],
        runtimeInputs: ["plugin --version", "workspace --version", "crate --version"],
        fileInputs: [
          { pattern: "../proto/**/*.proto", manifest: "rust/Cargo.toml" },
          { pattern: "../../../schema.sql", manifest: "rust/crates/api/Cargo.toml" },
        ],
        artifacts: ["napi"],
      });
      expect(found.model.settings).toMatchObject({
        envInputs: ["PLUGIN_VAR", "WORKSPACE_VAR"],
        runtimeInputs: ["plugin --version", "workspace --version"],
        fileInputs: [{ pattern: "../proto/**/*.proto", manifest: "rust/Cargo.toml" }],
        artifacts: undefined,
      });
      // The workspace project has no crate of its own; the workspace's lists are on its workspace.
      expect(found.rust.settings).toMatchObject({
        envInputs: [],
        runtimeInputs: [],
        fileInputs: [],
        workspace: {
          envInputs: ["PLUGIN_VAR", "WORKSPACE_VAR"],
          runtimeInputs: ["plugin --version", "workspace --version"],
          fileInputs: [{ pattern: "../proto/**/*.proto", manifest: "rust/Cargo.toml" }],
        },
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "read an empty artifacts list as none",
    async () => {
      const found = await projects(
        "subfolder-workspace",
        {},
        {
          "rust/crates/model/Cargo.toml": appendTo("[package.metadata.nx]\nartifacts = []"),
        },
      );

      expect(found.model.settings.artifacts).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );
});

describe("several entries of the plugin", () => {
  // The members api and model, with the root manifest in the first entry.
  const split = (first: object, second: object) =>
    pluginEntries(
      { include: ["rust/Cargo.toml", "rust/crates/api/**"], ...first },
      {
        include: ["rust/crates/model/**", "rust/crates/codegen/**", "rust/crates/testkit/**"],
        ...second,
      },
    );

  describe.each<[string, Record<string, string>]>([
    ["with plugin isolation", { NX_ISOLATE_PLUGINS: "true" }],
    ["without plugin isolation", { NX_ISOLATE_PLUGINS: "false" }],
    ["through the Nx daemon", { NX_DAEMON: "true" }],
  ])("%s", (_mode, env) => {
    it(
      "fail for different values of each per-workspace setting, naming the workspace, the setting and both entries",
      async () => {
        const workspace = FixtureWorkspace.create("subfolder-workspace", {
          "nx.json": split(
            { options: { testRunner: "cargo", affectedTests: true, featureUnification: "hakari" } },
            {
              options: { testRunner: "nextest", affectedTests: false, featureUnification: "cargo" },
            },
          ),
        });
        try {
          const { status, output } = await workspace.nx(["show", "projects"], env);
          const text = withoutColours(output);

          expect(status).toBe(1);
          for (const [setting, first, second] of [
            ["testRunner", '"cargo"', '"nextest"'],
            ["affectedTests", "true", "false"],
            ["featureUnification", '"hakari"', '"cargo"'],
          ]) {
            expect(text).toContain(
              `the entries plugins[0], plugins[1] of @convesoft/nx-rust in nx.json receive manifests of the Cargo workspace in rust/, but give it different values of "${setting}": plugins[0] sets ${first}; plugins[1] sets ${second}.`,
            );
          }
          expect(text).toContain(
            "Give these entries the same value, or set testRunner under [workspace.metadata.nx] in rust/Cargo.toml",
          );
        } finally {
          if (env.NX_DAEMON === "true") {
            await workspace.nx(["daemon", "--stop"], env);
          }
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });

  it.each<[string, (nxJson: string) => string, string]>([
    [
      "an entry without the setting beside one with a value other than the default",
      split({}, { options: { testRunner: "nextest" } }),
      'plugins[0] does not set it, which gives the default "cargo"; plugins[1] sets "nextest"',
    ],
    [
      "an entry without featureUnification beside one with cargo, which is never the default",
      split({ options: { featureUnification: "cargo" } }, {}),
      'plugins[0] sets "cargo"; plugins[1] does not set it, which gives the default strategy, never "cargo"',
    ],
    [
      "a plain string entry beside an object entry with a value other than the default",
      (json) => {
        const [first] = JSON.parse(json).plugins;
        const plugin = typeof first === "string" ? first : first.plugin;
        return JSON.stringify({
          plugins: [plugin, { plugin, options: { affectedTests: true } }],
        });
      },
      "plugins[0] names the plugin without options, which gives the default false; plugins[1] sets true",
    ],
  ])(
    "fail for %s",
    async (_case, nxJson, expected) => {
      const loading = loadFixtureGraph("subfolder-workspace", { files: { "nx.json": nxJson } });

      await expect(loading).rejects.toThrow(expected);
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, (nxJson: string) => string]>([
    [
      "an entry without the setting beside one with the default",
      split({}, { options: { testRunner: "cargo" } }),
    ],
    [
      "an entry without featureUnification beside one with workspace-build, in a workspace without cargo-hakari",
      split({}, { options: { featureUnification: "workspace-build" } }),
    ],
    [
      "equal values",
      split({ options: { testRunner: "nextest" } }, { options: { testRunner: "nextest" } }),
    ],
    [
      "two identical object entries",
      pluginEntries({ options: { testRunner: "nextest" } }, { options: { testRunner: "nextest" } }),
    ],
  ])(
    "pass for %s",
    async (_case, nxJson) => {
      const graph = await loadFixtureGraph("subfolder-workspace", { files: { "nx.json": nxJson } });

      expect(Object.keys(graph.projects).sort()).toEqual([
        "api",
        "codegen",
        "model",
        "rust",
        "testkit",
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "accept different values where the workspace table sets the setting",
    async () => {
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: {
          "nx.json": split(
            { options: { testRunner: "cargo" } },
            { options: { testRunner: "nextest" } },
          ),
          "rust/Cargo.toml": appendTo('[workspace.metadata.nx]\ntestRunner = "nextest"'),
        },
      });

      expect(Object.keys(graph.projects).sort()).toEqual([
        "api",
        "codegen",
        "model",
        "rust",
        "testkit",
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave alone entries that receive manifests of different workspaces",
    async () => {
      const graph = await loadFixtureGraph("two-workspaces", {
        files: {
          "nx.json": pluginEntries(
            { include: ["Cargo.toml", "crates/**"], options: { testRunner: "cargo" } },
            { include: ["tools/**"], options: { testRunner: "nextest" } },
          ),
        },
      });

      expect(Object.keys(graph.projects).sort()).toEqual([
        "app",
        "cargo-workspace",
        "scaffold",
        "tools",
        "util",
      ]);
    },
    HARNESS_TIMEOUT,
  );
});

/** The root of the project called `name`. */
function rootOf(graph: FixtureGraph, name: string): string | undefined {
  return graph.projects[name]?.root;
}

/** Every project's root, by name. */
function rootsByName(graph: FixtureGraph): Record<string, string> {
  return Object.fromEntries(
    Object.entries(graph.projects).map(([name, project]) => [name, project.root]),
  );
}

/** Appends `text` to a manifest. */
function appendTo(text: string): (manifest: string) => string {
  return (manifest) => `${manifest}\n${text}\n`;
}

/** Sets the options of the plugin's entry in a fixture copy's `nx.json`. */
function pluginOptions(options: object): (nxJson: string) => string {
  return pluginEntries({ options });
}

/** Replaces the plugin's entries with one entry per argument, each naming the plugin under test. */
function pluginEntries(...entries: object[]): (nxJson: string) => string {
  return (nxJson) => {
    const config = JSON.parse(nxJson);
    const [first] = config.plugins;
    const plugin = typeof first === "string" ? first : first.plugin;
    return JSON.stringify({ ...config, plugins: entries.map((entry) => ({ plugin, ...entry })) });
  };
}

/** The message that graph creation fails with. */
async function graphError(fixture: FixtureName, files: FileChanges): Promise<string> {
  return loadFixtureGraph(fixture, { files }).then(
    () => {
      throw new Error("Graph creation succeeded");
    },
    (error: Error) => {
      expect(error).toBeInstanceOf(GraphCreationError);
      return error.message;
    },
  );
}

/** The manifests below `root`, relative to it, outside `node_modules` and `target`. */
function manifestsIn(root: string, folder = ""): string[] {
  return readdirSync(join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
    if (entry.isDirectory()) {
      return ["node_modules", "target", ".nx"].includes(entry.name) ? [] : manifestsIn(root, path);
    }
    return entry.name === "Cargo.toml" ? [path] : [];
  });
}
