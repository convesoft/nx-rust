import type { ProjectGraph } from "@nx/devkit";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCreateTaskGraph,
  loadDevkitInternals,
  loadGetPlugins,
  loadHashPlanInspector,
  loadNxDependency,
  loadNxNative,
  loadNxYargsParser,
  loadPackageJsonPlugin,
  loadProjectJsonPlugin,
  loadProjectNodesManager,
  loadRetrieveWorkspaceFiles,
  loadTaskEnv,
  loadTaskHasher,
  loadWorkspaceContext,
  NxBridgeError,
  readNxDependencyVersion,
  readNxPackageVersion,
  resolveFromRepository,
} from "../src/compatibility/nx-bridge";
import { installedNx } from "../src/compatibility/nx-version";
import { readTaskDotenv } from "../src/executors/dotenv-check";
import { commandRecords, excludesTaskDependencies, parseAsNx } from "../src/executors/nx-command";
import { nxTaskFileParts, NxTaskFilesError } from "../src/executors/nx-task-files";
import {
  nxTaskConfiguration,
  TaskEnvironmentError,
  taskEnvironments,
  withoutUnloadedRootValues,
} from "../src/executors/task-env";
import { checkGraphCreation, UnsupportedNxError } from "../src/generators/init/graph-check";
import { nxSegmentMatcher } from "../src/graph/nx-glob";
import { nxGraphInternals, nxIgnoreRules } from "../src/graph/nx-internals";
import { loadTargetDefaultsInternals } from "../src/graph/target-defaults";
import { filesNxSees, foldersNxSees } from "../src/graph/visibility";
import { pluginPackage } from "./harness/compiled-plugin";

/** Writes a minimal `nx` package under `<base>/node_modules/nx` with the given files. */
function writeFakeNx(
  base: string,
  version: string,
  files: Record<string, string> = {},
  exportsField: Record<string, string> = {
    "./package.json": "./package.json",
    "./src/*": "./dist/src/*.js",
  },
): string {
  const nxDir = join(base, "node_modules", "nx");
  mkdirSync(nxDir, { recursive: true });
  writeFileSync(
    join(nxDir, "package.json"),
    `${JSON.stringify({ name: "nx", version, exports: exportsField }, null, 2)}\n`,
  );
  for (const [rel, content] of Object.entries(files)) {
    const file = join(nxDir, rel);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
  }
  return nxDir;
}

/** Writes a minimal dependency package under `<base>/node_modules/<name>`. */
function writeDependency(base: string, name: string, version: string, mainSource: string): void {
  const pkgDir = join(base, "node_modules", name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    `${JSON.stringify({ name, version, main: "./index.js" }, null, 2)}\n`,
  );
  writeFileSync(join(pkgDir, "index.js"), mainSource);
}

describe("resolveFromRepository", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-rust-bridge-resolve-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("prefers .nx/installation/node_modules/nx over root node_modules/nx", () => {
    const installBase = join(root, ".nx", "installation");
    const installNx = writeFakeNx(installBase, "24.1.0", {
      "dist/src/native.js": "exports.matchGlobPaths = () => [true];\n",
    });
    writeFakeNx(root, "24.0.0", {
      "dist/src/native.js": "exports.matchGlobPaths = () => [false];\n",
    });

    expect(realpathSync(resolveFromRepository("nx/package.json", root))).toBe(
      realpathSync(join(installNx, "package.json")),
    );
    expect(realpathSync(resolveFromRepository("nx/src/native", root))).toBe(
      realpathSync(join(installNx, "dist", "src", "native.js")),
    );
    expect(readNxPackageVersion(root)).toBe("24.1.0");
    expect(installedNx(root)).toEqual({ version: "24.1.0", major: 24 });
  });

  it("resolves from root node_modules/nx when .nx/installation is absent", () => {
    const rootNx = writeFakeNx(root, "24.2.0", {
      "dist/src/native.js": "exports.matchGlobPaths = () => [false];\n",
    });

    expect(realpathSync(resolveFromRepository("nx/package.json", root))).toBe(
      realpathSync(join(rootNx, "package.json")),
    );
    expect(realpathSync(resolveFromRepository("nx/src/native", root))).toBe(
      realpathSync(join(rootNx, "dist", "src", "native.js")),
    );
    expect(readNxPackageVersion(root)).toBe("24.2.0");
  });

  it("falls back to the plugin's own nx when the repository has none installed", () => {
    const pluginNxPackage = realpathSync(resolveFromRepository("nx/package.json"));

    expect(realpathSync(resolveFromRepository("nx/package.json", root))).toBe(pluginNxPackage);
    expect(realpathSync(resolveFromRepository("nx/src/devkit-internals", root))).toBe(
      realpathSync(resolveFromRepository("nx/src/devkit-internals")),
    );
  });

  /**
   * Runs `resolveFromRepository` in a real Node.js process against the compiled
   * bridge, so Node's actual `exports` and `paths` enforcement is exercised
   * without Jest's VM resolver fallback.
   */
  function resolveInNode(
    specifier: string,
    workspaceRoot?: string,
  ): { resolved?: string; code?: string; message?: string } {
    const bridge = join(pluginPackage(), "src", "compatibility", "nx-bridge.js");
    const run = spawnSync(
      process.execPath,
      [
        "-e",
        [
          "const { resolveFromRepository } = require(process.argv[1]);",
          "try {",
          "  const resolved = resolveFromRepository(process.argv[2], process.argv[3] || undefined);",
          "  console.log(JSON.stringify({ resolved }));",
          "} catch (error) {",
          "  console.log(JSON.stringify({ code: error.code, message: error.message }));",
          "}",
        ].join("\n"),
        bridge,
        specifier,
        workspaceRoot ?? "",
      ],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(0);
    return JSON.parse(run.stdout.trim());
  }

  it("does not fall back to the plugin's nx when the repository's nx lacks a private subpath", () => {
    const installBase = join(root, ".nx", "installation");
    writeFakeNx(installBase, "24.9.0", {});

    const result = resolveInNode("nx/src/hasher/hash-plan-inspector", root);
    expect(result.resolved).toBeUndefined();
    expect(result.code).toBe("MODULE_NOT_FOUND");
    expect(result.message).toContain(join(installBase, "node_modules", "nx"));
  });

  it("does not mask non-MODULE_NOT_FOUND errors such as an unreadable package.json or unexported subpath", () => {
    const installBase = join(root, ".nx", "installation");
    const unexportedRoot = mkdtempSync(join(tmpdir(), "nx-rust-bridge-unexported-"));
    try {
      writeFakeNx(unexportedRoot, "24.9.0", {}, { "./package.json": "./package.json" });
      const unexported = resolveInNode("nx/src/devkit-internals", unexportedRoot);
      expect(unexported.resolved).toBeUndefined();
      expect(unexported.code).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
      expect(unexported.message).toContain('not defined by "exports"');

      const installNx = writeFakeNx(installBase, "24.9.0");
      const manifest = join(installNx, "package.json");
      chmodSync(manifest, 0o000);
      try {
        const unreadable = resolveInNode("nx/package.json", root);
        expect(unreadable.resolved).toBeUndefined();
        expect(unreadable.message).toMatch(/EACCES|Cannot read package config/);
      } finally {
        chmodSync(manifest, 0o644);
      }
    } finally {
      rmSync(unexportedRoot, { recursive: true, force: true });
    }
  });
});

describe("resolution from .nx/installation across migrated callers", () => {
  let root: string;
  let installBase: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-rust-bridge-callers-"));
    installBase = join(root, ".nx", "installation");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves nx/package.json and yargs-parser from .nx/installation in nx-command", () => {
    writeFakeNx(installBase, "24.3.0");
    writeDependency(
      installBase,
      "yargs-parser",
      "21.1.1",
      'module.exports = (args) => ({ _: ["from-installation", ...args], excludeTaskDependencies: true });\n',
    );
    writeFakeNx(root, "24.0.0");
    writeDependency(
      root,
      "yargs-parser",
      "21.1.1",
      'module.exports = (args) => ({ _: ["from-root", ...args], excludeTaskDependencies: false });\n',
    );

    expect(parseAsNx(["--foo"], root)).toEqual({
      _: ["from-installation", "--foo"],
      excludeTaskDependencies: true,
    });
    expect(excludesTaskDependencies(["run", "a:check"], root)).toBe(true);
    expect(commandRecords(["run", "a:check"], "cmd", root).NX_RUST_RUN_ID).not.toBe("");

    // Without .nx/installation, root node_modules/nx wins.
    const rootOnly = mkdtempSync(join(tmpdir(), "nx-rust-bridge-root-yargs-"));
    try {
      writeFakeNx(rootOnly, "24.0.0");
      writeDependency(
        rootOnly,
        "yargs-parser",
        "21.1.1",
        'module.exports = (args) => ({ _: ["from-root-only", ...args], excludeTaskDependencies: false });\n',
      );
      expect(parseAsNx(["--bar"], rootOnly)).toEqual({
        _: ["from-root-only", "--bar"],
        excludeTaskDependencies: false,
      });
      expect(excludesTaskDependencies(["run", "a:check"], rootOnly)).toBe(false);
    } finally {
      rmSync(rootOnly, { recursive: true, force: true });
    }
  });

  it("loads visibility, nx-glob, nx-internals, target-defaults, nx-task-files, task-env, dotenv-check and graph-check from .nx/installation", async () => {
    writeFakeNx(installBase, "24.4.0", {
      "dist/src/devkit-internals.js": [
        "exports.mergeTargetConfigurations = (t) => ({ ...t, fromInstallation: true });",
        'exports.findMatchingConfigFiles = () => ["from-installation/Cargo.toml"];',
        "exports.createGitIgnoreChecker = () => ({ isIgnoredDirectory: (d) => d === 'ignored-by-install' });",
        "exports.createTargetDefaultsResults = () => [];",
        "exports.findMatchingTargetNames = (pattern, names) => names.filter((n) => n === pattern);",
        "exports.expandDependencyConfigSyntaxSugar = (entry) => entry;",
        "exports.normalizeDependencyConfigProjects = () => ({ target: 'build', dependencies: false });",
        "exports.LoadedNxPlugin = () => {};",
        "",
      ].join("\n"),
      "dist/src/project-graph/utils/retrieve-workspace-files.js":
        'exports.retrieveProjectConfigurationPaths = async () => ["from-installation/Cargo.toml"];\n',
      "dist/src/project-graph/utils/project-configuration/project-nodes-manager.js":
        "exports.mergeProjectConfigurationIntoRootMap = () => {};\n",
      "dist/src/plugins/package-json.js":
        'exports.createNodes = ["**/package.json", async () => []];\n',
      "dist/src/plugins/project-json/build-nodes/project-json.js":
        'exports.ProjectJsonProjectsPlugin = { createNodes: ["**/project.json", async () => []] };\n',
      "dist/src/utils/workspace-context.js": [
        'exports.globWithWorkspaceContext = async () => ["seen/a.rs"];',
        'exports.globWithWorkspaceContextSync = () => ["seen/a.rs"];',
        "",
      ].join("\n"),
      "dist/src/native.js":
        "exports.matchGlobPaths = (_globs, paths) => paths.map((p) => p.startsWith('match-install/'));\n",
      "dist/src/hasher/hash-plan-inspector.js":
        "exports.HashPlanInspector = class { async init() {} inspectTaskInputs() { return {}; } };\n",
      "dist/src/tasks-runner/task-env.js": [
        'exports.getEnvFilesForTask = () => [".env.install"];',
        "exports.unloadDotEnvFile = (_file, env) => { delete env.UNLOADED_BY_INSTALL; };",
        "exports.getTaskSpecificEnv = () => ({ FROM_INSTALL: 'yes' });",
        "exports.getEnvVariablesForTask = (_task, env) => ({ ...env });",
        "",
      ].join("\n"),
      "dist/src/tasks-runner/create-task-graph.js":
        'exports.ProcessTasks = class { resolveConfiguration() { return "install-config"; } };\n',
    });
    writeDependency(
      installBase,
      "dotenv",
      "16.4.7",
      'exports.parse = () => ({ PARSED_BY_INSTALL: "1" });\n',
    );
    writeFileSync(join(root, ".env.install"), "PARSED_BY_INSTALL=1\n");

    // visibility.ts
    expect(await filesNxSees(root, ["seen/a.rs", "hidden/b.rs"])).toEqual(new Set(["seen/a.rs"]));
    expect(await foldersNxSees(root, ["seen", "hidden"])).toEqual(new Set(["seen"]));

    // nx-glob.ts
    const matcher = nxSegmentMatcher(root);
    expect(matcher("*", "match-install")).toBe(true);
    expect(matcher("*", "other")).toBe(false);

    // nx-internals.ts
    const graphInternals = nxGraphInternals(root);
    expect(
      graphInternals.mergeTargetConfigurations(
        {},
        undefined,
        undefined,
        undefined,
        undefined,
        false,
      ),
    ).toEqual({ fromInstallation: true });
    expect(graphInternals.findMatchingConfigFiles([], undefined, undefined)).toEqual([
      "from-installation/Cargo.toml",
    ]);
    expect(await graphInternals.pluginFiles(root, "**/Cargo.toml", undefined, undefined)).toEqual([
      "from-installation/Cargo.toml",
    ]);
    const ignores = nxIgnoreRules(root);
    expect(ignores?.("ignored-by-install")).toBe(true);
    expect(ignores?.("kept")).toBe(false);

    // target-defaults.ts
    const targetDefaults = loadTargetDefaultsInternals(root);
    expect(targetDefaults.keyMayApply("build", "build", undefined)).toBe(true);
    expect(targetDefaults.normaliseDependency("build", "app", { nodes: {} })).toEqual({
      target: "build",
      dependencies: false,
    });

    // nx-task-files.ts
    const parts = nxTaskFileParts(root);
    expect(parts.glob(root, ["**/*"])).toEqual(["seen/a.rs"]);

    // task-env.ts & dotenv-check.ts
    expect(withoutUnloadedRootValues({ UNLOADED_BY_INSTALL: "1", KEPT: "2" }, root)).toEqual({
      KEPT: "2",
    });
    const fakeGraph = {
      nodes: { app: { name: "app", type: "app", data: { root: "app" } } },
      dependencies: {},
    } as unknown as ProjectGraph;
    const envOf = taskEnvironments(root, fakeGraph);
    expect(
      envOf({
        id: "app:build",
        target: { project: "app", target: "build" },
        overrides: {},
        outputs: [],
        parallelism: true,
        cache: false,
        projectRoot: "app",
      }).FROM_INSTALL,
    ).toBe("yes");
    expect(nxTaskConfiguration(root, fakeGraph, "app", "build", undefined)).toBe("install-config");
    const dotenv = readTaskDotenv(
      { id: "app:build", projectRoot: "app", target: { project: "app", target: "build" } },
      fakeGraph,
      root,
    );
    expect(dotenv.raw).toEqual({ PARSED_BY_INSTALL: "1" });

    // graph-check.ts: LoadedNxPlugin is an arrow function (no prototype), so it
    // must fail with UnsupportedNxError naming the .nx/installation version 24.4.0.
    await expect(checkGraphCreation({ plugins: [] }, root)).rejects.toThrow(UnsupportedNxError);
    await expect(checkGraphCreation({ plugins: [] }, root)).rejects.toThrow(
      "nx-rust cannot check this repository with the installed Nx 24.4.0: LoadedNxPlugin from nx/src/devkit-internals is not a constructor.",
    );
  });
});

describe("bridge shape checks for missing or changed internal exports", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-rust-bridge-shapes-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports missing or non-function exports across every private module loader", () => {
    writeFakeNx(root, "24.9.0", {
      "dist/src/devkit-internals.js":
        'exports.LoadedNxPlugin = () => {};\nexports.mergeTargetConfigurations = "nope";\nexports.ProcessDependenciesError = 123;\n',
      "dist/src/project-graph/plugins/get-plugins.js": "exports.getPluginsSeparated = null;\n",
      "dist/src/project-graph/utils/retrieve-workspace-files.js":
        "exports.retrieveWorkspaceFiles = 42;\n",
      "dist/src/project-graph/utils/project-configuration/project-nodes-manager.js":
        "exports.mergeProjectConfigurationIntoRootMap = {};\n",
      "dist/src/plugins/package-json.js": 'exports.createNodes = ["**/package.json", null];\n',
      "dist/src/plugins/project-json/build-nodes/project-json.js":
        "exports.ProjectJsonProjectsPlugin = {};\n",
      "dist/src/utils/workspace-context.js": "exports.globWithWorkspaceContextSync = false;\n",
      "dist/src/native.js": "exports.matchGlobPaths = [];\n",
      "dist/src/hasher/hash-plan-inspector.js": "exports.HashPlanInspector = {};\n",
      "dist/src/hasher/task-hasher.js":
        "exports.getInputs = () => {};\nexports.getNamedInputs = () => {};\nexports.expandSingleProjectInputs = () => {};\n",
      "dist/src/tasks-runner/task-env.js": "exports.getTaskSpecificEnv = () => {};\n",
      "dist/src/tasks-runner/create-task-graph.js": "exports.ProcessTasks = class {};\n",
    });

    const expectBridgeExportError = (
      fn: () => unknown,
      module: string,
      exportName: string,
      expected: "function" | "constructor" | "createNodes",
    ) => {
      let caught: unknown;
      try {
        fn();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NxBridgeError);
      expect((caught as NxBridgeError).failure).toEqual({
        kind: "export",
        module,
        exportName,
        expected,
      });
    };

    expectBridgeExportError(
      () => loadDevkitInternals(root, ["LoadedNxPlugin"]),
      "nx/src/devkit-internals",
      "LoadedNxPlugin",
      "constructor",
    );
    expectBridgeExportError(
      () => loadDevkitInternals(root, ["mergeTargetConfigurations"]),
      "nx/src/devkit-internals",
      "mergeTargetConfigurations",
      "function",
    );
    // Optional non-function exports are omitted rather than throwing.
    expect(loadDevkitInternals(root, [], { optional: ["ProcessDependenciesError"] })).toEqual({});

    expectBridgeExportError(
      () => loadGetPlugins(root),
      "nx/src/project-graph/plugins/get-plugins",
      "getPluginsSeparated",
      "function",
    );
    expectBridgeExportError(
      () => loadRetrieveWorkspaceFiles(root, ["retrieveWorkspaceFiles"]),
      "nx/src/project-graph/utils/retrieve-workspace-files",
      "retrieveWorkspaceFiles",
      "function",
    );
    expectBridgeExportError(
      () => loadProjectNodesManager(root),
      "nx/src/project-graph/utils/project-configuration/project-nodes-manager",
      "mergeProjectConfigurationIntoRootMap",
      "function",
    );
    expectBridgeExportError(
      () => loadPackageJsonPlugin(root),
      "nx/src/plugins/package-json",
      "createNodes",
      "createNodes",
    );
    expectBridgeExportError(
      () => loadProjectJsonPlugin(root),
      "nx/src/plugins/project-json/build-nodes/project-json",
      "createNodes",
      "createNodes",
    );
    expectBridgeExportError(
      () => loadWorkspaceContext(root, ["globWithWorkspaceContextSync"]),
      "nx/src/utils/workspace-context",
      "globWithWorkspaceContextSync",
      "function",
    );
    expectBridgeExportError(
      () => loadNxNative(root),
      "nx/src/native",
      "matchGlobPaths",
      "function",
    );
    expectBridgeExportError(
      () => loadHashPlanInspector(root),
      "nx/src/hasher/hash-plan-inspector",
      "HashPlanInspector",
      "function",
    );
    expectBridgeExportError(
      () => loadTaskHasher(root),
      "nx/src/hasher/task-hasher",
      "expandNamedInput",
      "function",
    );
    expectBridgeExportError(
      () => loadTaskEnv(root, ["getTaskSpecificEnv", "getEnvVariablesForTask"]),
      "nx/src/tasks-runner/task-env",
      "getEnvVariablesForTask",
      "function",
    );
    expectBridgeExportError(
      () => loadCreateTaskGraph(root),
      "nx/src/tasks-runner/create-task-graph",
      "ProcessTasks.resolveConfiguration",
      "function",
    );

    // Caller error wrapping stays unchanged.
    expect(() => nxTaskFileParts(root)).toThrow(NxTaskFilesError);
    expect(() => nxTaskFileParts(root)).toThrow(
      "the installed Nx lacks HashPlanInspector in nx/src/hasher/hash-plan-inspector",
    );
    expect(() => taskEnvironments(root, { nodes: {}, dependencies: {} })).toThrow(
      TaskEnvironmentError,
    );
    expect(() => taskEnvironments(root, { nodes: {}, dependencies: {} })).toThrow(
      "the installed Nx lacks getEnvVariablesForTask in nx/src/tasks-runner/task-env",
    );
    expect(() =>
      nxTaskConfiguration(root, { nodes: {}, dependencies: {} }, "a", "b", undefined),
    ).toThrow(
      "the installed Nx lacks ProcessTasks.resolveConfiguration in nx/src/tasks-runner/create-task-graph",
    );
  });

  it("reports missing or invalid nx dependencies through loadNxYargsParser, loadNxDependency and readNxDependencyVersion", () => {
    const nxDir = writeFakeNx(root, "24.9.0", {
      "dist/src/tasks-runner/task-env.js": "exports.getEnvFilesForTask = () => [];\n",
    });
    const taskEnvFile = join(nxDir, "dist", "src", "tasks-runner", "task-env.js");

    writeDependency(root, "yargs-parser", "21.1.1", "module.exports = { notAFunction: true };\n");
    expect(() => loadNxYargsParser(root)).toThrow(NxBridgeError);

    writeDependency(root, "dotenv-expand", "12.0.3", "exports.expand = () => ({});\n");
    expect(readNxDependencyVersion(taskEnvFile, "dotenv-expand")).toBe("12.0.3");
    expect(typeof loadNxDependency(taskEnvFile, "dotenv-expand").expand).toBe("function");

    expect(readNxDependencyVersion(taskEnvFile, "does-not-exist-pkg")).toBeUndefined();
    expect(() => loadNxDependency(taskEnvFile, "does-not-exist-pkg")).toThrow(NxBridgeError);
  });
});
