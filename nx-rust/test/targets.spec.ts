import type { TargetConfiguration } from "@nx/devkit";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  FileChanges,
  FixtureGraph,
  FixtureName,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  loadFixtureGraph,
  testEnvironment,
} from "./harness";

// Checks the parts of VER-TARGETS and VER-CONFIGURATION about which targets
// the plugin infers, how they are configured and named, and that no task
// depends on another, with a real cargo and Nx's own graph creation. What the
// targets run is the executor's (nxr-kmdpgj), and caching.spec.ts checks
// their caching, inputs and outputs.

const crateTargets = ["build", "check", "lint", "test", "fmt-check", "fmt"];
const workspaceTargets = ["doc", "audit", "update"];
/** The workspace project's targets where cargo-deny is configured, in their order. */
const withDeny = ["doc", "audit", "deny", "update"];
const allTargets = [...crateTargets, "bench", "run", ...withDeny];
const cargoExecutor = "@convesoft/nx-rust:cargo";
const runExecutor = "@convesoft/nx-rust:run";
/** The targets that DES-TARGETS caches. */
const cachedTargets = ["build", "check", "lint", "test", "fmt-check", "doc"];
/** The option that carries the plugin's version where no npm node does (DES-PLUGIN-OPTIONS). */
const pluginVersion = {
  pluginVersion: JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")).version,
};

/** Each project's target names, in their order. */
function targetNames(graph: FixtureGraph): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(graph.projects).map(([name, project]) => [
      name,
      Object.keys(project.targets ?? {}),
    ]),
  );
}

/** Sets the options of the plugin's entry in a fixture copy's `nx.json`. */
function pluginOptions(options: object): (nxJson: string) => string {
  return (nxJson) => {
    const config = JSON.parse(nxJson);
    config.plugins = config.plugins.map((entry: string | { plugin: string }) => ({
      plugin: typeof entry === "string" ? entry : entry.plugin,
      options,
    }));
    return JSON.stringify(config);
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

/** The task graph that `nx <args> --graph=<file>` writes, without running a task. */
async function taskGraph(
  workspace: FixtureWorkspace,
  args: string[],
): Promise<{ tasks: string[]; dependencies: Record<string, string[]> }> {
  // Outside the repository, so that Nx does not see it.
  const file = join(workspace.root, "..", "task-graph.json");
  const { status, output } = await workspace.nx([...args, `--graph=${file}`]);
  expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
  const { tasks } = JSON.parse(readFileSync(file, "utf8"));
  return {
    tasks: Object.keys(tasks.tasks).sort(),
    dependencies: {
      ...dependencyIds(tasks.dependencies),
      ...continuous(dependencyIds(tasks.continuousDependencies)),
    },
  };
}

type Dependencies = Record<string, (string | { id: string })[]>;

// Each task's dependencies by task id.
function dependencyIds(dependencies: Dependencies = {}): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(dependencies).map(([task, on]) => [
      task,
      on.map((dependency) => (typeof dependency === "string" ? dependency : dependency.id)).sort(),
    ]),
  );
}

// The continuous dependencies that exist, under keys of their own, so that a
// test that expects none sees them.
function continuous(dependencies: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(dependencies)
      .filter(([, on]) => on.length > 0)
      .map(([task, on]) => [`continuous ${task}`, on]),
  );
}

describe("inferred targets", () => {
  it(
    "give each crate shape exactly its targets",
    async () => {
      const graph = await loadFixtureGraph("crate-shapes");

      expect(targetNames(graph)).toEqual({
        // A library with an example: an example is no binary.
        "core-lib": crateTargets,
        cli: [...crateTargets, "run"],
        // Two binaries, one run target.
        server: [...crateTargets, "run"],
        perf: [...crateTargets, "bench"],
        // publish = false: no release target, and there is none on the others yet.
        internal: crateTargets,
        rust: workspaceTargets,
      });
    },
    HARNESS_TIMEOUT,
  );

  it.each<[FixtureName, Record<string, string[]>]>([
    [
      "two-workspaces",
      {
        app: [...crateTargets, "run"],
        "cargo-workspace": workspaceTargets,
        scaffold: crateTargets,
        // The crate of a root manifest is the workspace project.
        tools: [...crateTargets, "run", ...workspaceTargets],
        util: crateTargets,
      },
    ],
    [
      "standalone-crate",
      {
        api: crateTargets,
        rust: workspaceTargets,
        // A workspace of one.
        xtask: [...crateTargets, "run", ...workspaceTargets],
      },
    ],
  ])(
    "give the crate of a root manifest the workspace project's targets as well, in %s",
    async (fixture, expected) => {
      const graph = await loadFixtureGraph(fixture);

      expect(targetNames(graph)).toEqual(expected);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "name the plugin's executors and set the options, caching and scheduling that the designs give",
    async () => {
      const graph = await loadFixtureGraph("crate-shapes", { files: { "rust/deny.toml": "" } });
      const target = (project: string, name: string) => graph.projects[project].targets[name];
      const expected: [project: string, target: string, settings: TargetConfiguration][] = [
        ["core-lib", "build", { executor: cargoExecutor, options: {} }],
        ["core-lib", "check", { executor: cargoExecutor, options: { allTargets: true } }],
        ["core-lib", "lint", { executor: cargoExecutor, options: { allTargets: true } }],
        ["core-lib", "test", { executor: cargoExecutor, options: {} }],
        ["core-lib", "fmt-check", { executor: cargoExecutor, options: {} }],
        ["core-lib", "fmt", { executor: cargoExecutor, options: {} }],
        ["perf", "bench", { executor: cargoExecutor, options: {}, parallelism: false }],
        ["server", "run", { executor: runExecutor, options: {}, continuous: false }],
        ["rust", "doc", { executor: cargoExecutor, options: { noDeps: true } }],
        ["rust", "audit", { executor: cargoExecutor, options: {} }],
        ["rust", "deny", { executor: cargoExecutor, options: {} }],
        ["rust", "update", { executor: cargoExecutor, options: {} }],
      ];

      for (const [project, name, settings] of expected) {
        const configuration = target(project, name);
        expect({ target: `${project}:${name}`, ...configuration }).toMatchObject({
          target: `${project}:${name}`,
          ...settings,
          options: { ...settings.options, ...pluginVersion },
          cache: cachedTargets.includes(name),
          parallelism: settings.parallelism ?? true,
          metadata: {
            description: expect.stringMatching(/\S/),
            technologies: ["cargo"],
            cargo: { target: name },
          },
        });
        expect(configuration.continuous ?? false).toBe(false);
        expect(configuration.dependsOn).toBeUndefined();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "declare the inputs of audit, deny and update",
    async () => {
      const graph = await loadFixtureGraph("crate-shapes", { files: { "rust/deny.toml": "" } });
      const { targets } = graph.projects.rust;

      expect(targets.audit.inputs).toEqual([
        "{projectRoot}/Cargo.lock",
        "{projectRoot}/Cargo.toml",
        "{projectRoot}/.cargo/audit.toml",
      ]);
      expect(targets.deny.inputs).toEqual([
        "{projectRoot}/Cargo.lock",
        "{projectRoot}/Cargo.toml",
        "{projectRoot}/deny.toml",
        "{projectRoot}/.deny.toml",
        "{projectRoot}/.cargo/deny.toml",
        "{workspaceRoot}/rust/crates/cli/Cargo.toml",
        "{workspaceRoot}/rust/crates/core/Cargo.toml",
        "{workspaceRoot}/rust/crates/internal/Cargo.toml",
        "{workspaceRoot}/rust/crates/perf/Cargo.toml",
        "{workspaceRoot}/rust/crates/server/Cargo.toml",
      ]);
      expect(targets.update.inputs).toEqual([
        "{projectRoot}/Cargo.lock",
        "{projectRoot}/Cargo.toml",
      ]);
      // The other targets have those of DES-INPUTS, which caching.spec.ts checks.
      for (const name of ["build", "check", "lint", "test", "fmt-check", "fmt", "run"]) {
        expect(graph.projects.cli.targets[name].inputs?.[0]).toBe("default");
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the deny target", () => {
  it.each(["deny.toml", ".deny.toml", ".cargo/deny.toml"])(
    "exists where %s is in the workspace root",
    async (file) => {
      const graph = await loadFixtureGraph("crate-shapes", { files: { [`rust/${file}`]: "" } });

      expect(Object.keys(graph.projects.rust.targets)).toEqual(withDeny);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "does not exist for a configuration file in a member's folder or above the workspace",
    async () => {
      const graph = await loadFixtureGraph("crate-shapes", {
        files: { "rust/crates/cli/deny.toml": "", "deny.toml": "" },
      });

      expect(Object.keys(graph.projects.rust.targets)).toEqual(workspaceTargets);
      expect(Object.keys(graph.projects.cli.targets)).not.toContain("deny");
    },
    HARNESS_TIMEOUT,
  );

  it(
    "is in the graph whether or not cargo-audit and cargo-deny are installed, like audit",
    async () => {
      // Stand-ins that a lookup on PATH would find.
      const tools = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-tools-")));
      const workspace = FixtureWorkspace.create("crate-shapes", { "rust/deny.toml": "" });
      try {
        for (const tool of ["cargo-audit", "cargo-deny"]) {
          writeFileSync(join(tools, tool), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        }
        const withTools = await workspace.graph({
          PATH: [tools, testEnvironment().PATH].join(delimiter),
        });
        const withoutTools = await workspace.graph();

        expect(targetNames(withTools)).toEqual(targetNames(withoutTools));
        expect(withTools.projects).toEqual(withoutTools.projects);
        expect(targetNames(withoutTools).rust).toEqual(withDeny);
      } finally {
        workspace.remove();
        rmSync(tools, { recursive: true, force: true });
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("nx affected", () => {
  it.each<[string, FileChanges, string, string[]]>([
    ["Cargo.lock", {}, "rust/Cargo.lock", ["rust:audit", "rust:deny", "rust:update"]],
    ["the root manifest", {}, "rust/Cargo.toml", ["rust:audit", "rust:deny", "rust:update"]],
    [
      ".cargo/audit.toml",
      { "rust/.cargo/audit.toml": "" },
      "rust/.cargo/audit.toml",
      ["rust:audit"],
    ],
    ["deny.toml", {}, "rust/deny.toml", ["rust:deny"]],
    [".deny.toml", { "rust/.deny.toml": "" }, "rust/.deny.toml", ["rust:deny"]],
    [".cargo/deny.toml", { "rust/.cargo/deny.toml": "" }, "rust/.cargo/deny.toml", ["rust:deny"]],
    ["a member's manifest", {}, "rust/crates/cli/Cargo.toml", ["rust:deny"]],
    ["a source file", {}, "rust/crates/cli/src/main.rs", []],
  ])(
    "selects the workspace targets that read %s",
    async (_file, files, changed, expected) => {
      const workspace = FixtureWorkspace.create("crate-shapes", { "rust/deny.toml": "" }, files);
      try {
        const { tasks } = await taskGraph(workspace, [
          "affected",
          "-t",
          "audit",
          "deny",
          "update",
          `--files=${changed}`,
        ]);

        expect(tasks).toEqual(expected);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "selects the targets of a workspace at the repository root",
    async () => {
      const workspace = FixtureWorkspace.create("two-workspaces", { "deny.toml": "" });
      try {
        const { tasks } = await taskGraph(workspace, [
          "affected",
          "-t",
          "audit",
          "deny",
          "update",
          "--files=Cargo.lock",
        ]);

        expect(tasks).toEqual([
          "cargo-workspace:audit",
          "cargo-workspace:deny",
          "cargo-workspace:update",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("task dependencies", () => {
  it(
    "are none between Rust tasks, in a workspace whose crates depend on each other",
    async () => {
      const workspace = FixtureWorkspace.create("crate-shapes");
      try {
        const graph = await taskGraph(workspace, ["run-many", "-t", "build", "test", "lint"]);

        const crates = ["cli", "core-lib", "internal", "perf", "server"];
        expect(graph.tasks).toEqual(
          crates.flatMap((crate) => [`${crate}:build`, `${crate}:lint`, `${crate}:test`]),
        );
        expect(graph.dependencies).toEqual(
          Object.fromEntries(graph.tasks.map((task) => [task, []])),
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  describe("with a JS project that depends on a crate", () => {
    // web depends on api, which depends on model, codegen and testkit.
    const web: FileChanges = {
      "web/project.json": JSON.stringify({
        name: "web",
        implicitDependencies: ["api"],
        targets: {
          build: { executor: "nx:noop", dependsOn: ["^build"] },
          lint: { executor: "nx:noop" },
        },
      }),
    };

    it(
      "reach through ^build the build of that crate and no build behind it",
      async () => {
        const workspace = FixtureWorkspace.create("subfolder-workspace", web);
        try {
          const graph = await taskGraph(workspace, ["run", "web:build"]);

          expect(graph.tasks).toEqual(["api:build", "web:build"]);
          expect(graph.dependencies).toEqual({ "api:build": [], "web:build": ["api:build"] });
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "leave the JS project's targets as it declares them",
      async () => {
        const graph = await loadFixtureGraph("subfolder-workspace", { files: web });

        expect(graph.projects.web.targets.build.dependsOn).toEqual(["^build"]);
        expect(graph.projects.web.targets.lint.dependsOn).toBeUndefined();
        expect(Object.keys(graph.projects.web.targets)).toEqual(["build", "lint"]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "run lint for JS projects and crates alike",
      async () => {
        const workspace = FixtureWorkspace.create("subfolder-workspace", web);
        try {
          const graph = await taskGraph(workspace, ["run-many", "-t", "lint"]);

          expect(graph.tasks).toEqual([
            "api:lint",
            "codegen:lint",
            "model:lint",
            "testkit:lint",
            "web:lint",
          ]);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });
});

describe("targetNames", () => {
  it(
    "gives every inferred target the name it asks for and none the default name",
    async () => {
      const renamed = Object.fromEntries(allTargets.map((name) => [name, `cargo-${name}`]));
      const graph = await loadFixtureGraph("crate-shapes", {
        files: { "nx.json": pluginOptions({ targetNames: renamed }), "rust/deny.toml": "" },
      });

      const prefixed = (names: string[]) => names.map((name) => `cargo-${name}`);
      expect(targetNames(graph)).toEqual({
        "core-lib": prefixed(crateTargets),
        cli: prefixed([...crateTargets, "run"]),
        server: prefixed([...crateTargets, "run"]),
        perf: prefixed([...crateTargets, "bench"]),
        internal: prefixed(crateTargets),
        rust: prefixed(withDeny),
      });
      // The executor still learns which target it runs.
      expect(graph.projects.cli.targets["cargo-lint"].metadata.cargo).toEqual({ target: "lint" });
      expect(graph.projects.cli.targets["cargo-run"].executor).toBe(runExecutor);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "keeps the default names of the targets it leaves out",
    async () => {
      const graph = await loadFixtureGraph("crate-shapes", {
        files: { "nx.json": pluginOptions({ targetNames: { lint: "clippy" } }) },
      });

      expect(targetNames(graph)["core-lib"]).toEqual([
        "build",
        "check",
        "clippy",
        "test",
        "fmt-check",
        "fmt",
      ]);
      expect(graph.projects["core-lib"].targets.clippy.options).toEqual({
        allTargets: true,
        ...pluginVersion,
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "lets two targets swap their names",
    async () => {
      const graph = await loadFixtureGraph("crate-shapes", {
        files: { "nx.json": pluginOptions({ targetNames: { lint: "check", check: "lint" } }) },
      });

      expect(graph.projects.cli.targets.lint.metadata.cargo).toEqual({ target: "check" });
      expect(graph.projects.cli.targets.check.metadata.cargo).toEqual({ target: "lint" });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "may give a target the name of one that the same project does not have",
    async () => {
      // cli has a binary and no bench, perf a bench and no binary.
      const graph = await loadFixtureGraph("crate-shapes", {
        files: { "nx.json": pluginOptions({ targetNames: { run: "bench" } }) },
      });

      expect(graph.projects.cli.targets.bench.executor).toBe(runExecutor);
      expect(graph.projects.perf.targets.bench.executor).toBe(cargoExecutor);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation when two targets of a project get one name, naming the project, both targets and the name",
    async () => {
      const message = await graphError("crate-shapes", {
        "nx.json": pluginOptions({ targetNames: { test: "build" } }),
      });

      expect(message).toContain(
        '"targetNames" in the options of the @convesoft/nx-rust entry in nx.json gives two inferred targets of one project the same name',
      );
      expect(message).toContain(
        '- the project "core-lib" (rust/crates/core/Cargo.toml): `build` and `test` would both be called "build"',
      );
      for (const crate of ["cli", "internal", "perf", "server"]) {
        expect(message).toContain(`- the project "${crate}" `);
      }
      // The workspace project has neither target.
      expect(message).not.toContain('the project "rust"');
      expect(message).toContain('Change "targetNames"');
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation when three targets get one name",
    async () => {
      const message = await graphError("crate-shapes", {
        "nx.json": pluginOptions({ targetNames: { test: "build", lint: "build" } }),
      });

      expect(message).toContain(
        '- the project "cli" (rust/crates/cli/Cargo.toml): `build`, `lint` and `test` would all be called "build"',
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation only for the projects where the two targets meet",
    async () => {
      // Only tools, the crate of a root manifest, has both doc and build.
      const message = await graphError("two-workspaces", {
        "nx.json": pluginOptions({ targetNames: { doc: "build" } }),
      });

      expect(message).toContain(
        '- the project "tools" (tools/Cargo.toml): `build` and `doc` would both be called "build"',
      );
      // Nx repeats the plugin's message in its own.
      expect(new Set(message.match(/- the project "[^"]*"/g))).toEqual(
        new Set(['- the project "tools"']),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation for a key that names no inferred target, listing those that can be renamed",
    async () => {
      const message = await graphError("crate-shapes", {
        "nx.json": pluginOptions({ targetNames: { clippy: "lint", lint: "clippy" } }),
      });

      expect(message).toContain(
        '"targetNames" in the options of the @convesoft/nx-rust entry in nx.json names "clippy", which is not the default name of an inferred target. The targets that can be renamed are "build", "check", "lint", "test", "fmt-check", "fmt", "bench", "run", "doc", "audit", "deny" and "update".',
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation naming every such key",
    async () => {
      const message = await graphError("crate-shapes", {
        "nx.json": pluginOptions({ targetNames: { clippy: "lint", "napi-build": "addon" } }),
      });

      expect(message).toContain(
        'names "clippy" and "napi-build", which are not default names of inferred targets.',
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "accepts the name of an inferred target that no project has",
    async () => {
      // subfolder-workspace has no bench target, no binary and no cargo-deny configuration.
      const graph = await loadFixtureGraph("subfolder-workspace", {
        files: {
          "nx.json": pluginOptions({
            targetNames: { bench: "benchmark", run: "start", deny: "licenses" },
          }),
        },
      });

      expect(targetNames(graph).api).toEqual(crateTargets);
      expect(targetNames(graph).rust).toEqual(workspaceTargets);
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, unknown, string]>([
    ["a list", ["lint"], "has to be an object"],
    ["a number for a name", { lint: 1 }, 'gives the target "lint" 1'],
    ["an empty name", { lint: "" }, 'gives the target "lint" ""'],
  ])(
    "fails graph creation when it is %s",
    async (_case, value, expected) => {
      const message = await graphError("crate-shapes", {
        "nx.json": pluginOptions({ targetNames: value }),
      });

      expect(message).toContain(
        `"targetNames" in the options of the @convesoft/nx-rust entry in nx.json ${expected}`,
      );
    },
    HARNESS_TIMEOUT,
  );
});
