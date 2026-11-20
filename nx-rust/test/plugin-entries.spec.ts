import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CreateDependenciesContext,
  CreateNodesContext,
  CreateNodesResult,
  ProjectConfiguration,
  ProjectGraph,
} from "@nx/devkit";
import plugin = require("../src");
import { registrationOf } from "../src/graph/registration";
import {
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  pluginWorkers,
  testEnvironment,
  workspaceCall,
} from "./harness";

// Checks the part of VER-GRAPH about several entries of the plugin in
// nx.json (DES-DISCOVERY, DES-PROJECT-GRAPH, EVD-NX-24-PLUGIN-ENTRIES):
// each entry's createDependencies and createMetadata find what its own
// createNodes discovered, and where a call cannot be told to be an entry's
// own, the hook fails instead of answering with another entry's projects.

/** The manifests of `two-workspaces` that the first entry receives: the root workspace's. */
const rootManifests = ["Cargo.toml", "crates/app/Cargo.toml", "crates/util/Cargo.toml"];
/** Those that the second entry receives: the workspace in `tools/`. */
const toolsManifests = ["tools/Cargo.toml", "tools/scaffold/Cargo.toml"];

const cannotTell = /nx-rust could not tell which of its entries in nx\.json Nx called/;

// These call the plugin in this process, as Nx's loader does: one copy of
// the module per entry, createNodes as a plain function, and the other hooks
// as methods of the copy, with the entry's options.
describe("entries of the plugin in one process", () => {
  let workspace: FixtureWorkspace | undefined;
  let savedEnvironment: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnvironment = process.env;
    workspace = FixtureWorkspace.create("two-workspaces");
    process.env = workspace.cargo.environment(testEnvironment());
  });

  afterEach(() => {
    process.env = savedEnvironment;
    workspace?.remove();
    workspace = undefined;
  });

  function root(): string {
    if (workspace === undefined) {
      throw new Error("No fixture workspace");
    }
    return workspace.root;
  }

  it("gives each copy of the module a registration of its own", () => {
    const first = loadEntry();
    const second = loadEntry();

    expect(first.createNodes).not.toBe(second.createNodes);
    expect(registrationOf(first)).not.toBe(registrationOf(second));
  });

  it(
    "gives one entry's later hooks what its createNodes found",
    async () => {
      const entry = loadEntry();
      const options = { targetNames: { lint: "clippy" } };

      const projects = await nodes(entry, rootManifests, options);
      const edges = await entry.createDependencies(options, dependenciesContext(root(), projects));

      expect(Object.keys(projects).sort()).toEqual(["app", "cargo-workspace", "util"]);
      expect(Object.keys(projects.app.targets ?? {})).toContain("clippy");
      expect(edgePairs(edges)).toEqual([
        ["app", "util"],
        ["cargo-workspace", "app"],
        ["cargo-workspace", "util"],
      ]);
      expect(entry.createMetadata(emptyGraph, options, { ...nodesContext(root()) })).toEqual({});
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives each of two entries with their own options and manifests what its own createNodes found",
    async () => {
      const first = loadEntry();
      const second = loadEntry();
      const firstOptions = { targetNames: { lint: "clippy" } };
      // An entry without options passes undefined to each of its hooks.
      const secondOptions = undefined;

      // As Nx starts them: in one synchronous loop, in one graph computation.
      const [firstProjects, secondProjects] = await Promise.all([
        nodes(first, rootManifests, firstOptions),
        nodes(second, toolsManifests, secondOptions),
      ]);
      const merged = { ...firstProjects, ...secondProjects };

      expect(Object.keys(firstProjects.app.targets ?? {})).toContain("clippy");
      expect(Object.keys(secondProjects.scaffold.targets ?? {})).toContain("lint");
      expect(
        edgePairs(
          await first.createDependencies(firstOptions, dependenciesContext(root(), merged)),
        ),
      ).toEqual([
        ["app", "util"],
        ["cargo-workspace", "app"],
        ["cargo-workspace", "util"],
      ]);
      expect(
        edgePairs(
          await second.createDependencies(secondOptions, dependenciesContext(root(), merged)),
        ),
      ).toEqual([["tools", "scaffold"]]);
      expect(workspace?.cargoCalls()).toEqual([workspaceCall("."), workspaceCall("tools")]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a hook called on its own, as after destructuring, or on another object",
    async () => {
      const entry = loadEntry();
      await nodes(entry, rootManifests, undefined);
      const { createDependencies, createMetadata } = entry;
      const context = dependenciesContext(root(), {});

      expect(() => createDependencies(undefined, context)).toThrow(cannotTell);
      expect(() => createMetadata(emptyGraph, undefined, nodesContext(root()))).toThrow(cannotTell);
      expect(() =>
        createDependencies.call({ name: "@convesoft/nx-rust" }, undefined, context),
      ).toThrow(/createDependencies for: Nx did not call it as a method of its copy of the plugin/);
      // A copy of the module made without reading the getter anew shares
      // nothing with a registration.
      expect(() =>
        createDependencies.call({ createNodes: [...entry.createNodes] }, undefined, context),
      ).toThrow(cannotTell);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a later hook that gets another entry's options",
    async () => {
      const first = loadEntry();
      const second = loadEntry();
      const firstOptions = { targetNames: { lint: "clippy" } };
      const secondOptions = { targetNames: { lint: "clippy" } };
      await Promise.all([
        nodes(first, rootManifests, firstOptions),
        nodes(second, toolsManifests, secondOptions),
      ]);
      const context = dependenciesContext(root(), {});

      // Equal options of another entry are still another entry's.
      expect(() => first.createDependencies(secondOptions, context)).toThrow(
        /createDependencies for: it got other options than the entry's createNodes/,
      );
      expect(() => second.createMetadata(emptyGraph, firstOptions, nodesContext(root()))).toThrow(
        /createMetadata for: it got other options than the entry's createNodes/,
      );
      expect(() => first.createDependencies(undefined, context)).toThrow(cannotTell);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "answers from the newest of two overlapping graph computations of one entry",
    async () => {
      const entry = loadEntry();
      const options = { targetNames: { lint: "clippy" } };

      // As where the daemon starts a computation before an earlier one has
      // finished, or an isolated plugin worker takes both requests from one
      // read of its socket: the second call starts in the same turn as the
      // first, before the reports of the first computation are let go, and
      // before the first computation's later hooks run.
      const [, newest] = await Promise.all([
        nodes(entry, rootManifests, options),
        nodes(entry, [...rootManifests, ...toolsManifests], options),
      ]);
      const context = dependenciesContext(root(), newest);

      expect(edgePairs(await entry.createDependencies(options, context))).toEqual([
        ["app", "util"],
        ["cargo-workspace", "app"],
        ["cargo-workspace", "util"],
        ["tools", "scaffold"],
      ]);
      expect(entry.createMetadata(emptyGraph, options, nodesContext(root()))).toEqual({});
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails where one copy serves two entries with their own options in turn",
    async () => {
      const shared = loadEntry();

      await nodes(shared, rootManifests, { targetNames: { lint: "clippy" } });

      await expect(
        nodes(shared, toolsManifests, { targetNames: { lint: "clippy" } }),
      ).rejects.toThrow(/createNodes for: it got other options than the entry's earlier call/);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "takes the same options in each graph computation, as Nx passes them",
    async () => {
      const entry = loadEntry();
      const options = { targetNames: { lint: "clippy" } };

      await nodes(entry, rootManifests, options);
      const projects = await nodes(entry, rootManifests, options);

      expect(
        edgePairs(await entry.createDependencies(options, dependenciesContext(root(), projects))),
      ).toContainEqual(["app", "util"]);
    },
    HARNESS_TIMEOUT,
  );

  /** Calls the entry's createNodes and returns its projects, by name. */
  async function nodes(
    entry: typeof plugin,
    manifests: string[],
    options: unknown,
  ): Promise<Record<string, ProjectConfiguration>> {
    const results = await entry.createNodes[1](manifests, options as never, nodesContext(root()));
    return projectsOf(results);
  }
});

// Two entries of the plugin itself in nx.json, with their own options and
// manifests, loaded by Nx's own plugin loader in each of the ways Nx runs
// plugins.
describe.each([
  ["in plugin workers", pluginWorkers],
  ["in one process", { NX_ISOLATE_PLUGINS: "false" }],
  ["with the daemon", { NX_DAEMON: "true" }],
  // The daemon keeps the copies of the module and their options from one
  // graph computation to the next.
  ["with the daemon, in its own process", { NX_DAEMON: "true", NX_ISOLATE_PLUGINS: "false" }],
])("two entries of the plugin %s", (_mode, env: Record<string, string>) => {
  it(
    "give each entry's projects its own options and edges",
    async () => {
      const workspace = FixtureWorkspace.create("two-workspaces", {
        "nx.json": (nxJson) => {
          const config = JSON.parse(nxJson);
          const entry = config.plugins[0];
          const plugin = typeof entry === "string" ? entry : entry.plugin;
          config.plugins = [
            {
              plugin,
              include: ["Cargo.toml", "crates/**"],
              options: { targetNames: { lint: "clippy" } },
            },
            { plugin, include: ["tools/**"], options: { targetNames: { lint: "tools-lint" } } },
          ];
          return JSON.stringify(config);
        },
      });
      try {
        await expectEntriesApart(workspace, env);
        if (env.NX_DAEMON === "true") {
          // A second graph computation of the daemon, which keeps the loaded
          // entries and passes their options again.
          const manifest = join(workspace.root, "tools/Cargo.toml");
          writeFileSync(manifest, `${readFileSync(manifest, "utf8")}# changed\n`);
          await expectEntriesApart(workspace, env);
        }
        // Only the daemon has a log, where it recomputed the graph.
        expect(workspace.daemonLog().includes("recomputing project graph")).toBe(
          env.NX_DAEMON === "true",
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

async function expectEntriesApart(
  workspace: FixtureWorkspace,
  env: Record<string, string>,
): Promise<void> {
  const graph = await workspace.graph(env);
  const lintTargets = Object.fromEntries(
    Object.entries(graph.projects).map(([name, project]) => [
      name,
      Object.keys(project.targets ?? {}).filter(
        (target) => target.endsWith("lint") || target === "clippy",
      ),
    ]),
  );
  expect(lintTargets).toEqual({
    app: ["clippy"],
    util: ["clippy"],
    tools: ["tools-lint"],
    scaffold: ["tools-lint"],
    "cargo-workspace": [],
  });
  expect(graph.dependencies.map(({ source, target }) => [source, target])).toEqual([
    ["app", "util"],
    ["cargo-workspace", "app"],
    ["cargo-workspace", "util"],
    ["tools", "scaffold"],
  ]);
}

/** An entry of the plugin as Nx loads it: a copy of the module's properties. */
function loadEntry(): typeof plugin {
  return { ...plugin };
}

const emptyGraph: ProjectGraph = { nodes: {}, dependencies: {} };

function nodesContext(workspaceRoot: string): CreateNodesContext {
  return { workspaceRoot, nxJsonConfiguration: {} };
}

function dependenciesContext(
  workspaceRoot: string,
  projects: Record<string, ProjectConfiguration>,
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

/** The projects of createNodes results, by name, each with its root. */
function projectsOf(
  results: readonly (readonly [string, CreateNodesResult])[],
): Record<string, ProjectConfiguration> {
  const projects: Record<string, ProjectConfiguration> = {};
  for (const [, result] of results) {
    for (const [root, project] of Object.entries(result.projects ?? {})) {
      projects[project.name ?? root] = { ...project, root } as ProjectConfiguration;
    }
  }
  return projects;
}

function edgePairs(edges: readonly { source: string; target: string }[]): [string, string][] {
  return edges
    .map(({ source, target }): [string, string] => [source, target])
    .sort((a, b) => a.join(" ").localeCompare(b.join(" ")));
}
