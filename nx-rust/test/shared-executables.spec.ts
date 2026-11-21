import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  expectStatus,
  FileChanges,
  FixtureGraph,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  loadFixtureGraph,
  pluginPackage,
  runNx,
  taskCalls,
  testEnvironment,
  withoutColours,
  withTargetDefaults,
  workspaceArgs,
} from "./harness";

// The checks of VER-CARGO-UNCHANGED about crates whose final artifacts share
// a file name in one artifact directory (DES-OUTPUTS, "Files of one name"),
// with a real cargo and real Nx. In shared-executables, alpha and beta of the
// rust/ workspace both have a binary called cli, alpha with an integration
// test that runs CARGO_BIN_EXE_cli, gamma a binary of its own name, and the
// standalone crate tools a binary called cli in an artifact directory of its
// own, until a configuration at the repository root gives both workspaces one.

/** The warning about alpha and beta in shared-executables as it is. */
const alphaAndBeta =
  "nx-rust: the crates alpha in rust/crates/alpha and beta in rust/crates/beta put executables called cli into Cargo's artifact directory rust/target, where cargo keeps the file of the crate that it wrote last, so that a cached build of one crate could hold another crate's file. The build targets of alpha and beta run uncached, and so does the test target of alpha, whose integration tests or benches run that executable; their other targets stay cached. To cache them, give one of the binaries another name, with the name key of its [[bin]] table in Cargo.toml.";

/** A configuration at the repository root that gives both workspaces the artifact directory `target`. */
const oneArtifactDirectory: FileChanges = {
  ".cargo/config.toml": '[build]\ntarget-dir = "target"\n',
};

/** beta's binary under the name beta, so that only alpha and tools share a name. */
const betaRenamed: FileChanges = {
  "rust/crates/beta/src/bin/cli.rs": null,
  "rust/crates/beta/src/bin/beta.rs": 'fn main() {\n    println!("beta");\n}\n',
};

/** The warning about alpha and tools, whose artifact directories `where` describes. */
const alphaAndTools = (where: string) =>
  `nx-rust: the crates alpha in rust/crates/alpha and tools in tools put executables called cli into ${where} cargo keeps the file of the crate that it wrote last, so that a cached build of one crate could hold another crate's file. The build targets of alpha and tools run uncached, and so does the test target of alpha, whose integration tests or benches run that executable; their other targets stay cached. To cache them, give one of the binaries another name, with the name key of its [[bin]] table in Cargo.toml, or give each Cargo workspace an artifact directory of its own, none inside another, with build.target-dir in its .cargo/config.toml.`;

/**
 * What the warning about artifact directories that lie one inside the other
 * adds, and that about one directory of two workspaces does not
 * (DES-OUTPUTS, "Nested artifact directories").
 */
const firstBuildCanFail =
  'A first build, while these directories do not exist yet, can fail in cargo with "No such file or directory"; run the command again.';

/** Two entries of the plugin in nx.json, one for rust/ and one for tools/. */
const twoEntries: FileChanges = {
  "nx.json": (text) => {
    const config = JSON.parse(text ?? "{}");
    const [entry] = config.plugins;
    const plugin = typeof entry === "string" ? entry : entry.plugin;
    config.plugins = [
      { plugin, include: ["rust/**"] },
      { plugin, include: ["tools/**"] },
    ];
    return JSON.stringify(config);
  },
};

/**
 * The plugin's entry for rust/, and a second installation of the plugin,
 * `node_modules/rust-alias`, registered under that name for tools/
 * ({@link installAlias}).
 */
const aliasEntries: FileChanges = {
  "nx.json": (text) => {
    const config = JSON.parse(text ?? "{}");
    const [entry] = config.plugins;
    const plugin = typeof entry === "string" ? entry : entry.plugin;
    config.plugins = [
      { plugin, include: ["rust/**"] },
      { plugin: "rust-alias", include: ["tools/**"] },
    ];
    return JSON.stringify(config);
  },
};

/**
 * Installs a copy of the compiled plugin that the fixtures load as the
 * package `rust-alias`, as a second installation of the plugin would be:
 * its entry point is another file than the one of the plugin's entry, so
 * that neither installation takes the other's entry for its own.
 */
function installAlias(workspace: FixtureWorkspace): void {
  cpSync(pluginPackage(), join(workspace.root, "node_modules", "rust-alias"), { recursive: true });
}

/** The host's target triple, as `rustc -vV` names it. */
function hostTriple(): string {
  const host = /^host: (.+)$/m.exec(
    execFileSync("rustc", ["-vV"], { env: testEnvironment(), encoding: "utf8" }),
  );
  if (host === null) {
    throw new Error("rustc -vV names no host triple");
  }
  return host[1].trim();
}

/**
 * The artifact directory of tools inside that of rust/, as the folder of the
 * host's triple there, and alpha's build for that triple through its
 * project.json, so that both binaries are written to one path.
 */
const nestedDirectories = (triple: string): FileChanges => ({
  ".cargo/config.toml": '[build]\ntarget-dir = "target"\n',
  "tools/.cargo/config.toml": `[build]\ntarget-dir = "../target/${triple}"\n`,
  "rust/crates/alpha/project.json": JSON.stringify({
    targets: { build: { options: { targetTriple: triple } } },
  }),
});

/** alpha's manifest with its binary called alpha. */
const alphaRenamed = `[package]\nname = "alpha"\nversion = "0.1.0"\nedition = "2024"\n\n[[bin]]\nname = "alpha"\npath = "src/main.rs"\n`;

/** How Nx marks a task that it restored from the cache. */
const hit = String.raw`\[(local cache|existing outputs match the cache, left as is)\]`;

function restored(output: string, task: string): boolean {
  return new RegExp(`nx run ${task}\\s+${hit}`).test(output);
}

/** The warnings that graph creation recorded for a project. */
function warningsOf(graph: FixtureGraph, project: string): unknown[] {
  const cargo = graph.projects[project].metadata?.cargo as { warnings?: unknown[] } | undefined;
  return cargo?.warnings ?? [];
}

/** How many times `text` occurs in `output`. */
function occurrences(output: string, text: string): number {
  return output.split(text).length - 1;
}

/** The cargo calls of tasks since the last {@link nx}, as their arguments, sorted. */
function calls(workspace: FixtureWorkspace): string[] {
  return taskCalls(workspace)
    .map((call) => call.args.join(" "))
    .sort();
}

/** Runs Nx after forgetting the logged cargo calls. */
async function nx(
  workspace: FixtureWorkspace,
  args: string[],
): Promise<{ status: number | null; output: string }> {
  workspace.cargo.clear();
  return runNx(workspace, args);
}

/**
 * The plugin's `cargo build` of a group of crates of one workspace, which
 * selects the whole workspace under workspace-build (DES-UNIFICATION), in a
 * stage of the artifact directory `artifact` (DES-BATCH, "Staged builds").
 */
const buildIn = (artifact: string): string => workspaceArgs("build", [], false, artifact).join(" ");
const build = buildIn("{workspaceRoot}/rust/target");

/** What the executable at `path`, relative to the workspace root, prints. */
function prints(workspace: FixtureWorkspace, path: string): string {
  return execFileSync(join(workspace.root, path), { encoding: "utf8" }).trim();
}

describe("crates whose artifacts share a file name in one artifact directory", () => {
  it(
    "leave both builds and the test that runs the executable uncached, with a warning that names the crates and the file, while their other targets and the other crates stay cached",
    async () => {
      const graph = await loadFixtureGraph("shared-executables");
      const { alpha, beta, gamma, tools } = graph.projects;

      for (const project of [alpha, beta]) {
        expect(project.targets?.build).toMatchObject({ cache: false, outputs: [] });
        for (const name of ["check", "lint", "fmt-check"]) {
          expect({ name, cache: project.targets?.[name].cache }).toEqual({ name, cache: true });
        }
      }
      expect(alpha.targets?.build.metadata?.cargo.uncached).toBe(
        "files that its build writes can lie at the paths of files that other crates write, in the same artifact directory or in one inside the other, where cargo keeps the file that it wrote last, so that a stored result could hold another crate's file: cli, which beta in rust/crates/beta writes too",
      );
      expect(beta.targets?.build.metadata?.cargo.uncached).toMatch(
        /: cli, which alpha in rust\/crates\/alpha writes too$/,
      );
      // alpha's integration test runs the file that beta's build replaces.
      expect(alpha.targets?.test.cache).toBe(false);
      expect(alpha.targets?.test.metadata?.cargo.uncached).toBe(
        "its integration tests or benches run its executables as CARGO_BIN_EXE_<name>, which can lie at the paths of files that other crates write, in the same artifact directory or in one inside the other, so that the tests could run another crate's executable: cli, which beta in rust/crates/beta writes too",
      );
      expect(beta.targets?.test.cache).toBe(true);
      // The test still waits for the build, uncached as both are (ADR-TEST-AFTER-BUILD).
      expect(alpha.targets?.test.dependsOn).toContainEqual({ target: "build" });
      expect(alpha.targets?.test.metadata?.cargo.waitsForBuild).toBe(true);

      expect(warningsOf(graph, "alpha")).toEqual([alphaAndBeta]);
      expect(warningsOf(graph, "beta")).toEqual([alphaAndBeta]);
      expect(gamma.targets?.build).toMatchObject({
        cache: true,
        outputs: [
          "{workspaceRoot}/rust/target/{options.targetTriple ?? .}/{options.profile ?? debug}/gamma",
        ],
      });
      // tools writes its cli into an artifact directory of its own.
      expect(tools.targets?.build.cache).toBe(true);
      expect(warningsOf(graph, "gamma")).toEqual([]);
      expect(warningsOf(graph, "tools")).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave the builds of crates of two workspaces with one artifact directory uncached in the same way",
    async () => {
      const graph = await loadFixtureGraph("shared-executables", {
        files: { ...oneArtifactDirectory, ...betaRenamed },
      });
      const { alpha, beta, gamma, tools } = graph.projects;
      const warning = alphaAndTools("Cargo's artifact directory target, where");

      for (const project of [alpha, tools]) {
        expect(project.targets?.build).toMatchObject({ cache: false, outputs: [] });
      }
      expect(alpha.targets?.test.cache).toBe(false);
      expect(tools.targets?.test.cache).toBe(true);
      expect(warningsOf(graph, "alpha")).toContain(warning);
      expect(warningsOf(graph, "tools")).toContain(warning);
      const folder =
        "{workspaceRoot}/target/{options.targetTriple ?? .}/{options.profile ?? debug}";
      expect(beta.targets?.build).toMatchObject({ cache: true, outputs: [`${folder}/beta`] });
      expect(gamma.targets?.build).toMatchObject({ cache: true, outputs: [`${folder}/gamma`] });
      for (const project of ["beta", "gamma"]) {
        expect(warningsOf(graph, project)).not.toContain(warning);
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each([
    ["with plugin isolation", "true"],
    ["without plugin isolation", "false"],
  ])(
    "leave the builds of crates that two entries of the plugin receive uncached where their workspaces have one artifact directory, and doc too, %s",
    async (_case, isolation) => {
      const graph = await loadFixtureGraph("shared-executables", {
        files: { ...twoEntries, ...oneArtifactDirectory, ...betaRenamed },
        env: { NX_ISOLATE_PLUGINS: isolation },
      });
      const { alpha, beta, gamma, rust, tools } = graph.projects;
      const warning = alphaAndTools("Cargo's artifact directory target, where");

      for (const project of [alpha, tools]) {
        expect(project.targets?.build).toMatchObject({ cache: false, outputs: [] });
      }
      expect(alpha.targets?.test.cache).toBe(false);
      // Each entry reaches the same verdict, with the same warning.
      expect(warningsOf(graph, "alpha")).toContain(warning);
      expect(warningsOf(graph, "tools")).toContain(warning);
      for (const project of [beta, gamma]) {
        expect(project.targets?.build.cache).toBe(true);
      }
      // A restored doc folder of one would delete the other's pages.
      for (const project of [rust, tools]) {
        expect(project.targets?.doc).toMatchObject({ cache: false, outputs: [] });
      }
      expect(warningsOf(graph, "rust")).toEqual([
        expect.stringContaining(
          "nx-rust: the Cargo workspace in rust shares Cargo's artifact directory target with the Cargo workspace in tools.",
        ),
      ]);
      // Commands that create one directory together do not make each other
      // fail (EVD-CARGO-NESTED-DIRECTORY-CREATION), so its warning does not
      // say that they can.
      for (const project of ["rust", "tools"]) {
        expect({ project, warnings: warningsOf(graph, project) }).toEqual({
          project,
          warnings: expect.not.arrayContaining([expect.stringContaining(firstBuildCanFail)]),
        });
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each([
    ["with plugin isolation", "true"],
    ["without plugin isolation", "false"],
  ])(
    "leave the builds uncached where one workspace's artifact directory lies inside another's, so that a triple's folder of one is the other, %s",
    async (_case, isolation) => {
      const triple = hostTriple();
      const graph = await loadFixtureGraph("shared-executables", {
        files: { ...nestedDirectories(triple), ...betaRenamed },
        env: { NX_ISOLATE_PLUGINS: isolation },
      });
      const { alpha, beta, gamma, rust, tools } = graph.projects;
      const warning = alphaAndTools(
        `Cargo's artifact directories target and target/${triple}, which lie one inside the other, so that the folders of a triple or a profile in one can be those of the other, and where`,
      );

      for (const project of [alpha, tools]) {
        expect(project.targets?.build).toMatchObject({ cache: false, outputs: [] });
      }
      expect(alpha.targets?.test.cache).toBe(false);
      expect(warningsOf(graph, "alpha")).toContain(warning);
      expect(warningsOf(graph, "tools")).toContain(warning);
      for (const project of [beta, gamma]) {
        expect(project.targets?.build.cache).toBe(true);
      }
      for (const project of [rust, tools]) {
        expect(project.targets?.doc).toMatchObject({ cache: false, outputs: [] });
      }
      const uncachedDoc =
        "so that the folders of a triple or a profile in one can be those of the other. Its doc target runs uncached, because restoring one workspace's doc folder from the cache could delete or replace files of the others; its other targets stay cached. To cache it, give each workspace an artifact directory of its own, none inside another, with build.target-dir in its .cargo/config.toml.";
      expect(warningsOf(graph, "tools")).toContain(
        `nx-rust: Cargo's artifact directory target/${triple} of the Cargo workspace in tools lies inside target, that of the Cargo workspace in rust, ${uncachedDoc} ${firstBuildCanFail}`,
      );
      expect(warningsOf(graph, "rust")).toContain(
        `nx-rust: Cargo's artifact directory target of the Cargo workspace in rust holds target/${triple}, that of the Cargo workspace in tools, ${uncachedDoc} ${firstBuildCanFail}`,
      );
    },
    HARNESS_TIMEOUT,
  );

  it.each([
    ["lie one inside the other, that a first build can fail", "artifacts/inner", 2],
    ["are one, nothing about a first build", "artifacts", 0],
  ])(
    "warn, where the artifact directories of two workspaces outside the repository %s",
    async (_case, inner, notes) => {
      const workspace = FixtureWorkspace.create("shared-executables", betaRenamed);
      try {
        // Beside the copy, so that removing the workspace removes them too.
        const outer = join(workspace.root, "..", "artifacts");
        const tools = join(workspace.root, "..", inner);
        for (const [folder, directory] of [
          ["rust", outer],
          ["tools", tools],
        ]) {
          mkdirSync(join(workspace.root, folder, ".cargo"));
          writeFileSync(
            join(workspace.root, folder, ".cargo", "config.toml"),
            `[build]\ntarget-dir = ${JSON.stringify(directory)}\n`,
          );
        }
        const outside = (folder: string, directory: string) =>
          `nx-rust: Cargo's artifact directory of the Cargo workspace in ${folder} is ${directory}, outside the repository, where Nx cannot store files. Its build and doc targets run uncached, and its other targets stay cached. To cache them, set build.target-dir in a .cargo/config.toml of the workspace to a folder inside the repository, or unset CARGO_TARGET_DIR.`;
        const expected =
          notes > 0
            ? {
                rust: `${outside("rust", outer)} The directory holds ${tools}, that of the Cargo workspace in tools. ${firstBuildCanFail}`,
                tools: `${outside("tools", tools)} The directory lies inside ${outer}, that of the Cargo workspace in rust. ${firstBuildCanFail}`,
              }
            : { rust: outside("rust", outer), tools: outside("tools", tools) };

        const graph = await workspace.graph();
        for (const project of ["rust", "tools"] as const) {
          expect({ project, warnings: warningsOf(graph, project) }).toEqual({
            project,
            warnings: expect.arrayContaining([expected[project]]),
          });
        }
        // Graph creation prints each workspace's warning once, and a task of
        // the workspace prints it again (DES-DIAGNOSTICS).
        const shown = await workspace.nx(["show", "projects"]);
        expectStatus(shown, 0);
        expect(occurrences(withoutColours(shown.output), firstBuildCanFail)).toBe(notes);
        const check = await nx(workspace, ["run", "tools:check"]);
        expectStatus(check, 0);
        expect(check.output.slice(check.output.indexOf("> nx run tools:check"))).toContain(
          expected.tools,
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each([
    ["with plugin isolation", "true"],
    ["without plugin isolation", "false"],
  ])(
    "print the warning about crates of two entries of the plugin once, from the first entry, %s",
    async (_case, isolation) => {
      const workspace = FixtureWorkspace.create(
        "shared-executables",
        twoEntries,
        oneArtifactDirectory,
        betaRenamed,
      );
      const env = { NX_ISOLATE_PLUGINS: isolation, NX_DAEMON: "false" };
      const warning = alphaAndTools("Cargo's artifact directory target, where");
      try {
        const shown = await workspace.nx(["show", "projects"], env);
        expectStatus(shown, 0);
        // Both entries find it; the first by its place prints it.
        expect(occurrences(withoutColours(shown.output), warning)).toBe(1);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // Two library crates added to the rust/ workspace; graph creation reads
  // their reports only, so they compile nothing.
  const libraries = (left: string, right: string, sources: FileChanges = {}): FileChanges => ({
    "rust/crates/left/Cargo.toml": `[package]\nname = "left"\nversion = "0.1.0"\nedition = "2024"\n\n${left}\n`,
    "rust/crates/left/src/lib.rs": "",
    "rust/crates/right/Cargo.toml": `[package]\nname = "right"\nversion = "0.1.0"\nedition = "2024"\n\n${right}\n`,
    "rust/crates/right/src/lib.rs": "",
    ...sources,
  });
  const lib = (name: string, types: string) => `[lib]\nname = "${name}"\ncrate-type = [${types}]`;

  it.each<[string, FileChanges, string[], string | undefined]>([
    [
      "two cdylib files",
      libraries(lib("shared", '"cdylib"'), lib("shared", '"cdylib", "rlib"')),
      ["left", "right"],
      "the crates left in rust/crates/left and right in rust/crates/right put library files called libshared.so, libshared.dylib on macOS into Cargo's artifact directory rust/target, where cargo keeps the file of the crate that it wrote last, so that a cached build of one crate could hold another crate's file. The build targets of left and right run uncached; their other targets stay cached. To cache them, give one of the libraries another name, with the name key of its [lib] table in Cargo.toml.",
    ],
    [
      "two staticlib files",
      libraries(lib("st", '"staticlib"'), lib("st", '"staticlib"')),
      ["left", "right"],
      "put library files called libst.a into",
    ],
    [
      "a cdylib file whose name a package name with - gives, and one that [lib] gives",
      {
        ...libraries(lib("my_addon", '"cdylib"'), ""),
        "rust/crates/right/Cargo.toml": `[package]\nname = "my-addon"\nversion = "0.1.0"\nedition = "2024"\n\n[lib]\ncrate-type = ["cdylib"]\n`,
      },
      ["left", "my-addon"],
      "put library files called libmy_addon.so, libmy_addon.dylib on macOS into",
    ],
    [
      "a cdylib and a dylib, whose file build does not declare",
      libraries(lib("dynl", '"cdylib"'), lib("dynl", '"dylib"')),
      ["left"],
      "The build target of left runs uncached; their other targets stay cached.",
    ],
    [
      "a cdylib and a proc macro",
      libraries(lib("pmx", '"cdylib"'), '[lib]\nname = "pmx"\nproc-macro = true'),
      ["left"],
      "the crates left in rust/crates/left and right in rust/crates/right put library files called libpmx.so, libpmx.dylib on macOS into",
    ],
    [
      "binaries whose names differ in case only",
      {
        "rust/crates/beta/src/bin/cli.rs": null,
        "rust/crates/beta/src/bin/Cli.rs": 'fn main() {\n    println!("beta");\n}\n',
      },
      ["alpha", "beta"],
      "put executables called Cli and cli, which a file system that ignores case, as macOS's does by default, takes for one file, into Cargo's artifact directory rust/target",
    ],
    [
      "a cdylib and an rlib, whose files differ",
      libraries(lib("shared", '"cdylib"'), lib("shared", '"rlib"')),
      [],
      undefined,
    ],
    [
      "examples of one name, which build does not declare",
      {
        ...libraries("", ""),
        "rust/crates/left/examples/demo.rs": "fn main() {}\n",
        "rust/crates/right/examples/demo.rs": "fn main() {}\n",
      },
      [],
      undefined,
    ],
    [
      "two binaries of one crate whose names differ in case only, which its own command writes",
      { "rust/crates/gamma/src/bin/Gamma.rs": "fn main() {}\n" },
      [],
      undefined,
    ],
  ])(
    "count %s",
    async (_case, files, uncached, warning) => {
      const graph = await loadFixtureGraph("shared-executables", {
        files: { ...betaRenamed, ...files },
      });
      const crates = ["alpha", "beta", "gamma", "left", "right", "my-addon"].filter(
        (name) => graph.projects[name] !== undefined,
      );

      expect(crates.filter((name) => graph.projects[name].targets?.build.cache === false)).toEqual(
        uncached,
      );
      // Every warning of these crates is the one of the row, and there is
      // one exactly where the row expects it.
      const warnings = crates.flatMap((name) => warningsOf(graph, name) as string[]);
      expect(warnings.filter((text) => warning !== undefined && text.includes(warning))).toEqual(
        warnings,
      );
      expect(warnings.length > 0).toBe(warning !== undefined);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "run both builds in every run and restore neither, while the other crate's build is restored, and a test that waits for its build runs both each time",
    async () => {
      const workspace = FixtureWorkspace.create("shared-executables");
      try {
        const first = await nx(workspace, ["run-many", "-t", "build"]);
        expectStatus(first, 0);
        // Graph creation prints the warning once; the tasks of alpha and
        // beta print it again (DES-DIAGNOSTICS).
        expect(
          occurrences(first.output.slice(0, first.output.indexOf("> nx run ")), alphaAndBeta),
        ).toBe(1);
        // The uncached builds of alpha and beta wait for no lockfile task,
        // so they form a batch and a group of their own before gamma's.
        expect(calls(workspace)).toEqual([build, build, buildIn("{workspaceRoot}/tools/target")]);

        const second = await nx(workspace, ["run-many", "-t", "build"]);
        expectStatus(second, 0);
        expect(calls(workspace)).toEqual([build]);
        expect(restored(second.output, "gamma:build")).toBe(true);
        expect(restored(second.output, "tools:build")).toBe(true);
        expect(restored(second.output, "alpha:build")).toBe(false);
        expect(restored(second.output, "beta:build")).toBe(false);

        // Without the file, alpha's build runs cargo, which builds the whole
        // workspace into its stage, where the file is that of whichever crate
        // cargo wrote last, and alpha's build moves it; neither build is
        // stored.
        rmSync(join(workspace.root, "rust/target/debug/cli"));
        const alone = await nx(workspace, ["run", "alpha:build"]);
        expectStatus(alone, 0);
        expect(calls(workspace)).toEqual([build]);
        expect(prints(workspace, "rust/target/debug/cli")).toMatch(/^(alpha|beta)$/);

        for (const run of ["first", "second"]) {
          const test = await nx(workspace, ["run", "alpha:test"]);
          expectStatus(test, 0, `The ${run} run of alpha:test`);
          expect({
            run,
            calls: [...new Set(taskCalls(workspace).map((call) => call.args[0]))],
          }).toEqual({ run, calls: ["build", "test"] });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "run the builds of crates of two workspaces with one artifact directory in every run",
    async () => {
      const workspace = FixtureWorkspace.create(
        "shared-executables",
        oneArtifactDirectory,
        betaRenamed,
      );
      try {
        const first = await nx(workspace, ["run-many", "-t", "build"]);
        expectStatus(first, 0);
        const second = await nx(workspace, ["run-many", "-t", "build"]);
        expectStatus(second, 0);
        const shared = buildIn("{workspaceRoot}/target");
        expect(calls(workspace)).toEqual([shared, shared]);
        for (const task of ["beta:build", "gamma:build"]) {
          expect({ task, restored: restored(second.output, task) }).toEqual({
            task,
            restored: true,
          });
        }
        // Each crate's build leaves its own file.
        expect(prints(workspace, "target/debug/cli")).toMatch(/^(alpha|tools)$/);
        rmSync(join(workspace.root, "target/debug/cli"));
        const alone = await nx(workspace, ["run", "tools:build"]);
        expectStatus(alone, 0);
        expect(calls(workspace)).toEqual([shared]);
        expect(prints(workspace, "target/debug/cli")).toBe("tools");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it.each<
    [
      string,
      (triple: string) => FileChanges,
      (triple: string) => string,
      string[],
      number,
      (triple: string) => string[],
    ]
  >([
    [
      "two entries of the plugin receive workspaces with one artifact directory",
      () => ({ ...twoEntries, ...oneArtifactDirectory }),
      () => "target/debug/cli",
      [],
      0,
      () => ["{workspaceRoot}/target", "{workspaceRoot}/target"],
    ],
    [
      "one workspace's artifact directory is the folder of a triple in another's",
      nestedDirectories,
      (triple) => `target/${triple}/debug/cli`,
      // Two cargo commands that create these directories at once can fail
      // in cargo itself, before either takes its build lock: rust's renames
      // its new target onto the empty one that tools' has just made for its
      // own folder inside it (EVD-CARGO-NESTED-DIRECTORY-CREATION). The
      // plugin says so in its warning and leaves the rest to a second run or
      // to --parallel=1 on a first one (DES-OUTPUTS, "Nested artifact
      // directories"), so the first run, the only one that creates them,
      // runs its tasks one at a time.
      ["--parallel=1"],
      2,
      (triple) => ["{workspaceRoot}/target", `{workspaceRoot}/target/${triple}`],
    ],
  ])(
    "run both builds in every run and restore neither where %s",
    async (_case, files, executable, firstRun, firstBuildNotes, artifacts) => {
      const triple = hostTriple();
      const workspace = FixtureWorkspace.create("shared-executables", files(triple), betaRenamed);
      try {
        const first = await nx(workspace, ["run-many", "-t", "build", ...firstRun]);
        expectStatus(first, 0);
        // Both crates wrote one file.
        expect(prints(workspace, executable(triple))).toMatch(/^(alpha|tools)$/);

        const second = await nx(workspace, ["run-many", "-t", "build"]);
        expectStatus(second, 0);
        // alpha's build names the triple of its project.json where it has one.
        expect(calls(workspace).map((call) => call.replace(/ --target [^-\s]\S*/, ""))).toEqual(
          artifacts(triple).map(buildIn),
        );
        for (const task of ["alpha:build", "tools:build"]) {
          expect({ task, restored: restored(second.output, task) }).toEqual({
            task,
            restored: false,
          });
        }
        expect(restored(second.output, "gamma:build")).toBe(true);

        // Without the file, each build runs cargo, which writes its own.
        for (const crate of ["alpha", "tools"]) {
          rmSync(join(workspace.root, executable(triple)));
          const alone = await nx(workspace, ["run", `${crate}:build`]);
          expectStatus(alone, 0, `${crate}:build`);
          expect({ crate, ran: calls(workspace).length }).toEqual({ crate, ran: 1 });
          expect(prints(workspace, executable(triple))).toBe(crate);
        }
        // Graph creation printed the warning once, whichever entry held it.
        const warned = first.output.slice(0, first.output.indexOf("> nx run "));
        expect(occurrences(warned, "put executables called cli into")).toBe(1);
        // Where the directories nest, the warnings of both workspaces say
        // that a first build can fail, and their tasks print them again
        // (DES-DIAGNOSTICS); where they are one, none does.
        expect(occurrences(warned, firstBuildCanFail)).toBe(firstBuildNotes);
        const byTasks = occurrences(first.output, firstBuildCanFail) - firstBuildNotes;
        expect(byTasks > 0).toBe(firstBuildNotes > 0);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fail a cached build and test before cargo runs where another installation of the plugin, registered under another name, creates a crate that writes a file of the same name, and run the other builds",
    async () => {
      const workspace = FixtureWorkspace.create(
        "shared-executables",
        oneArtifactDirectory,
        betaRenamed,
        aliasEntries,
      );
      try {
        installAlias(workspace);
        // Neither installation takes the other's entry for its own, so
        // graph creation leaves both builds cached.
        const graph = await workspace.graph();
        expect(graph.projects.alpha.targets?.build.cache).toBe(true);
        expect(graph.projects.tools.targets?.build.cache).toBe(true);

        const build = await nx(workspace, ["run", "alpha:build"]);
        expectStatus(build, 1);
        expect(build.output).toContain(
          "alpha:build: tools:build writes cli into the same artifact directory, target, where cargo keeps one file for both crates, that of the one it built last, so that a result stored for alpha:build could hold the other crate's file.\n@convesoft/nx-rust left alpha:build cached because it did not see tools:build when it created the graph, as where another installation of the plugin, registered in nx.json under another name, creates it. The task does not run, so that Nx stores no result for it.\nGive one of the binaries another name, with the name key of its [[bin]] table in Cargo.toml, or for a library of its [lib] table, or register both Cargo workspaces through one installation of the plugin, which then leaves both builds uncached.",
        );
        expect(calls(workspace)).toEqual([]);
        // A task of a batch runs the same check before any cargo call.
        const batched = await nx(workspace, ["run", "alpha:build", "--batch"]);
        expect(batched.status).toBe(1);
        expect(batched.output).toContain(
          "alpha:build: tools:build writes cli into the same artifact directory, target, where cargo keeps one file for both crates",
        );
        expect(calls(workspace)).toEqual([]);

        // alpha's integration test runs that file too; tools' build fails
        // the same way, as its installation sees alpha's.
        const test = await nx(workspace, ["run", "alpha:test", "--exclude-task-dependencies"]);
        expectStatus(test, 1);
        expect(test.output).toContain(
          "alpha:test: tools:build writes cli into the same artifact directory, target, where cargo keeps one file for both crates, that of the one it built last, so that the tests could run the other crate's executable.",
        );
        const tools = await nx(workspace, ["run", "tools:build"]);
        expectStatus(tools, 1);
        expect(tools.output).toContain("tools:build: alpha:build writes cli into");
        expect(calls(workspace)).toEqual([]);

        // A crate without such a file builds, and its result is stored.
        const gamma = await nx(workspace, ["run-many", "-t", "build", "-p", "beta", "gamma"]);
        expectStatus(gamma, 0);
        const again = await nx(workspace, ["run-many", "-t", "build", "-p", "beta", "gamma"]);
        expectStatus(again, 0);
        expect(calls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "cache both builds again, without the warning, once one binary is renamed",
    async () => {
      const workspace = FixtureWorkspace.create("shared-executables");
      try {
        const before = await workspace.graph();
        expect(before.projects.alpha.targets?.build.cache).toBe(false);
        writeFileSync(join(workspace.root, "rust/crates/alpha/Cargo.toml"), alphaRenamed);
        const first = await nx(workspace, ["run-many", "-t", "build"]);
        expectStatus(first, 0);
        const second = await nx(workspace, ["run-many", "-t", "build"]);
        expectStatus(second, 0);
        expect(calls(workspace)).toEqual([]);
        for (const task of ["alpha:build", "beta:build", "gamma:build"]) {
          expect({ task, restored: restored(second.output, task) }).toEqual({
            task,
            restored: true,
          });
        }
        expect(first.output).not.toContain("put executables called");
        expect(second.output).not.toContain("put executables called");
        const graph = await workspace.graph();
        expect(graph.projects.alpha.targets?.test.cache).toBe(true);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fail a task whose project.json caches such a build before cargo runs, and graph creation for a targetDefaults entry that does",
    async () => {
      const workspace = FixtureWorkspace.create("shared-executables", {
        "rust/crates/alpha/project.json": JSON.stringify({ targets: { build: { cache: true } } }),
      });
      try {
        const run = await nx(workspace, ["run", "alpha:build"]);
        expectStatus(run, 1);
        expect(run.output).toContain(
          `alpha:build: the configuration of this target sets "cache": true, but @convesoft/nx-rust leaves \`build\` uncached in this project, because files that its build writes can lie at the paths of files that other crates write`,
        );
        expect(calls(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }

      const defaults = loadFixtureGraph("shared-executables", {
        files: { "nx.json": withTargetDefaults({ build: { cache: true } }) },
      });
      await expect(defaults).rejects.toThrow(GraphCreationError);
      await expect(defaults).rejects.toThrow(
        /It turns on caching for "build", which nx-rust leaves uncached: .* In alpha \(rust\/crates\/alpha\/Cargo\.toml\) and beta \(rust\/crates\/beta\/Cargo\.toml\)\./,
      );
    },
    HARNESS_TIMEOUT * 2,
  );
});
