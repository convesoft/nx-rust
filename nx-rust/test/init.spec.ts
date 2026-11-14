import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CargoWorkspace } from "../src/graph/discovery";
import type { GraphCheck } from "../src/generators/init/graph-check";
import { initReport, suggestedBuildDirSetting } from "../src/generators/init/report";
import {
  cargoDenyConfigurationFiles,
  optionalTools,
  wasmTriple,
} from "../src/tools/optional-tools";
import {
  CargoCall,
  changedFiles,
  FileChanges,
  FixtureName,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  repositoryFiles,
  testEnvironment,
  ToolFolders,
  withoutColours,
} from "./harness";

// Checks the parts of VER-SETUP about `init`. An Nx or Cargo release that the
// machine does not have is faked where the plugin reads its version, as in
// compatibility.spec.ts.

const pluginName = "@convesoft/nx-rust";

/** The names of every tool of init's table, in its order. */
const allTools = optionalTools.map((tool) => tool.name);

/** A repository that does not know the plugin yet. */
const unregistered: FileChanges = { "nx.json": "{}\n" };

/** The empty `targetDefaults` entries that init adds for the plugin's executors. */
const executorEntries = {
  "@convesoft/nx-rust:cargo": {},
  "@convesoft/nx-rust:run": {},
  "@convesoft/nx-rust:lockfile": {},
};

/** `nx.json` after init in a repository that did not know the plugin. */
const registeredNxJson = { plugins: [pluginName], targetDefaults: executorEntries };

/** The call that reads the workspace whose root manifest is in `root`. */
function workspaceCall(root: string): CargoCall {
  return {
    cwd: root,
    args: [
      "metadata",
      "--format-version",
      "1",
      "--no-deps",
      "--manifest-path",
      `{workspaceRoot}/${root === "." ? "" : `${root}/`}Cargo.toml`,
    ],
  };
}

/**
 * Runs `init` in a copy of `fixture` without plugin entry, with no tool
 * installed.
 *
 * @param setup `env` adds variables to the run; `prepare` changes the
 *   workspace before it.
 */
async function runInit(
  fixture: FixtureName,
  files: FileChanges = {},
  test: (
    workspace: FixtureWorkspace,
    result: { status: number | null; output: string; changed: string[] },
  ) => void | Promise<void>,
  args: string[] = [],
  setup: {
    env?: Record<string, string>;
    prepare?: (workspace: FixtureWorkspace) => void;
  } = {},
): Promise<void> {
  const workspace = FixtureWorkspace.create(fixture, unregistered, files);
  const tools = new ToolFolders();
  try {
    setup.prepare?.(workspace);
    const before = repositoryFiles(workspace.root);
    const { status, output } = await workspace.nx(["g", `${pluginName}:init`, ...args], {
      ...tools.env(),
      ...setup.env,
    });
    const changed = changedFiles(before, repositoryFiles(workspace.root));
    await test(workspace, { status, output: withoutColours(output), changed });
  } finally {
    tools.remove();
    workspace.remove();
  }
}

/** The one line of tools that are missing and that nothing needs, or `undefined`. */
function notNeededLine(output: string): string | undefined {
  return output.split("\n").find((line) => line.includes("not needed by your settings"));
}

describe("init", () => {
  it("declares no options", () => {
    const schema = JSON.parse(
      readFileSync(join(__dirname, "..", "src", "generators", "init", "schema.json"), "utf8"),
    );
    expect(schema.properties).toEqual({});
  });

  it("is the init generator that nx add runs", () => {
    const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    const generators = JSON.parse(
      readFileSync(join(__dirname, "..", packageJson.generators), "utf8"),
    );
    expect(Object.keys(generators.generators).sort()).toEqual(["binary", "init", "library"]);
  });

  it(
    "registers the plugin and adds the executors' target defaults in nx.json, and changes no other file",
    () =>
      runInit("subfolder-workspace", {}, (workspace, { status, output, changed }) => {
        expect(status).toBe(0);
        expect(changed).toEqual(["nx.json"]);
        expect(JSON.parse(readFileSync(join(workspace.root, "nx.json"), "utf8"))).toEqual(
          registeredNxJson,
        );
        expect(output).toContain(
          'Added "@convesoft/nx-rust:cargo": {}, "@convesoft/nx-rust:run": {} and "@convesoft/nx-rust:lockfile": {} to targetDefaults in nx.json',
        );
        // Its check read the workspace as graph creation does.
        expect(workspace.cargoCalls()).toEqual([workspaceCall("rust")]);
        // No tool is installed and none is needed.
        expect(notNeededLine(output)).toBe(
          `Not installed and not needed by your settings: ${allTools.join(", ")}. A task that runs one of them fails and says how to get it.`,
        );
        // The build directory of rust/ is rust/target, inside the repository.
        expect(output).toContain("Cargo keeps the build directory");
        expect(output).toContain("  rust: rust/target\n");
        for (const line of suggestedBuildDirSetting) {
          expect(output).toContain(`  ${line}\n`);
        }
        expect(output).toContain("nx-rust does not write this setting.");
        expect(output).not.toContain("has no Cargo.toml");
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "names every workspace whose build directory is inside the repository",
    () =>
      runInit("standalone-crate", {}, (_workspace, { status, output }) => {
        expect(status).toBe(0);
        expect(output).toContain("  rust: rust/target\n");
        expect(output).toContain("  tools/xtask: tools/xtask/target\n");
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "names no workspace whose build directory Cargo keeps outside the repository",
    async () => {
      const outside = mkdtempSync(join(tmpdir(), "nx-rust-build-dir-"));
      try {
        await runInit(
          "subfolder-workspace",
          { "rust/.cargo/config.toml": `[build]\nbuild-dir = ${JSON.stringify(outside)}\n` },
          (_workspace, { status, output, changed }) => {
            expect(status).toBe(0);
            expect(changed).toEqual(["nx.json"]);
            expect(output).not.toContain("Cargo keeps the build directory");
          },
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "prints graph creation's warning about a Cargo directory inside the repository that Nx does not ignore",
    () =>
      // Without .gitignore, nothing leaves rust/target out (cargo-directories.spec.ts).
      runInit(
        "subfolder-workspace",
        { ".gitignore": null },
        (_workspace, { status, output, changed }) => {
          const warning =
            "nx-rust: rust/target, Cargo's build and artifact directory of the Cargo workspace in rust, lies inside the repository, and no .gitignore or .nxignore leaves it out of the files that Nx reads.";

          expect(status).toBe(0);
          expect(changed).toEqual(["nx.json"]);
          expect(output.split(warning)).toHaveLength(2);
          expect(output).toContain(
            "Add the line /rust/target/ to the .gitignore at the repository root.",
          );
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "warns about cargo-deny where a workspace root has a cargo-deny configuration file",
    () =>
      runInit("subfolder-workspace", { "rust/deny.toml": "" }, (_workspace, { status, output }) => {
        expect(status).toBe(0);
        expect(output).toContain(
          "cargo-deny is not installed, but the deny target that rust/deny.toml gives the Cargo workspace in rust needs it. Install it with `cargo install --locked cargo-deny`",
        );
        expect(notNeededLine(output)).not.toContain("cargo-deny");
        // cargo-audit stays on the line: no setting asks for audit.
        expect(notNeededLine(output)).toContain("cargo-audit");
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "leaves an existing entry with its options and the executors' target defaults as they are and reports again",
    async () => {
      const nxJson = `${JSON.stringify(
        {
          plugins: [
            {
              plugin: pluginName,
              exclude: ["tools/**"],
              options: { targetNames: { test: "unit-test" } },
            },
          ],
          namedInputs: { default: ["{projectRoot}/**/*"] },
          targetDefaults: { build: { cache: true }, ...executorEntries },
        },
        null,
        4,
      )}\n`;
      // The harness cannot load the plugin by its package name, which only
      // the end-to-end suite installs, so Nx skips the graph it would create
      // before the generator; init's own check still runs.
      await runInit(
        "subfolder-workspace",
        { "nx.json": nxJson },
        (workspace, { status, output, changed }) => {
          expect(status).toBe(0);
          expect(changed).toEqual([]);
          expect(readFileSync(join(workspace.root, "nx.json"), "utf8")).toBe(nxJson);
          expect(workspace.cargoCalls()).toEqual([workspaceCall("rust")]);
          expect(notNeededLine(output)).toContain("cargo-audit");
          expect(output).toContain("  rust: rust/target\n");
        },
        ["--skipProjectGraph"],
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "adds only the missing executors' target defaults where the plugin is registered already",
    async () => {
      const plugins = [{ plugin: pluginName, options: { targetNames: { test: "unit-test" } } }];
      const targetDefaults = {
        build: { cache: true },
        "@convesoft/nx-rust:run": {},
        "@convesoft/nx-rust:lockfile": {},
      };
      await runInit(
        "subfolder-workspace",
        { "nx.json": `${JSON.stringify({ plugins, targetDefaults }, null, 2)}\n` },
        (workspace, { status, output, changed }) => {
          expect(status).toBe(0);
          expect(changed).toEqual(["nx.json"]);
          expect(JSON.parse(readFileSync(join(workspace.root, "nx.json"), "utf8"))).toEqual({
            plugins,
            targetDefaults: { ...targetDefaults, "@convesoft/nx-rust:cargo": {} },
          });
          expect(output).toContain(
            'Added "@convesoft/nx-rust:cargo": {} to targetDefaults in nx.json',
          );
        },
        ["--skipProjectGraph"],
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "writes the combined target defaults into nx.json where only the file it extends has them",
    () =>
      runInit(
        "subfolder-workspace",
        {
          "nx.json": `${JSON.stringify({ extends: "./nx-base.json" })}\n`,
          "nx-base.json": `${JSON.stringify({ targetDefaults: { build: { cache: true } } })}\n`,
        },
        (workspace, { status, changed }) => {
          expect(status).toBe(0);
          expect(changed).toEqual(["nx.json"]);
          expect(JSON.parse(readFileSync(join(workspace.root, "nx.json"), "utf8"))).toEqual({
            extends: "./nx-base.json",
            plugins: [pluginName],
            targetDefaults: { build: { cache: true }, ...executorEntries },
          });
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "changes nothing with --dry-run and still reports",
    () =>
      runInit(
        "subfolder-workspace",
        {},
        (_workspace, { status, output, changed }) => {
          expect(status).toBe(0);
          expect(changed).toEqual([]);
          expect(output).toContain("UPDATE nx.json");
          expect(notNeededLine(output)).toContain("cargo-audit");
        },
        ["--dry-run"],
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "registers the plugin, runs no cargo and says how to create a crate where there is no Cargo.toml",
    () =>
      runInit("subfolder-workspace", { rust: null }, async (workspace, { status, output }) => {
        expect(status).toBe(0);
        expect(JSON.parse(readFileSync(join(workspace.root, "nx.json"), "utf8"))).toEqual(
          registeredNxJson,
        );
        expect(workspace.cargoCalls()).toEqual([]);
        expect(output).toContain("The repository has no Cargo.toml yet.");
        expect(output).toContain(`nx g ${pluginName}:library <directory>`);
        expect(output).not.toContain("Cargo keeps the build directory");

        // The positive control: following that advice in the same setting
        // runs cargo, and the log shows it.
        const created = await workspace.nx(
          ["g", `${pluginName}:library`, "crates/first", "--skipProjectGraph"],
          {},
        );
        expect(created.status).toBe(0);
        expect(workspace.cargoCalls()).toEqual([
          { cwd: ".", args: ["new", "--vcs", "none", "--lib", "crates/first"] },
        ]);
      }),
    HARNESS_TIMEOUT,
  );

  it.each([
    ["with a Cargo workspace", {}],
    ["without a Cargo.toml", { rust: null }],
  ])(
    "registers the plugin and warns once with a newer Nx major and NX_RUST_ALLOW_UNSUPPORTED_NX=true, %s",
    (_case, files: FileChanges) => {
      const installedMajor = Number(require("nx/package.json").version.split(".")[0]);
      const newerNx = `${installedMajor + 1}.0.0`;
      return runInit(
        "subfolder-workspace",
        files,
        (workspace, { status, output, changed }) => {
          expect(status).toBe(0);
          expect(changed).toEqual(["nx.json"]);
          expect(JSON.parse(readFileSync(join(workspace.root, "nx.json"), "utf8"))).toEqual(
            registeredNxJson,
          );
          const warning = `nx-rust has not been checked with Nx ${newerNx}, which is installed in this repository: this version of ${pluginName} supports Nx ${installedMajor}.`;
          expect(output.split(warning)).toHaveLength(2);
          expect(output).toContain(
            `It continues because NX_RUST_ALLOW_UNSUPPORTED_NX is true, but nobody has checked its cache keys and batching on Nx ${installedMajor + 1}.`,
          );
        },
        [],
        {
          prepare: (workspace) => workspace.useNx(newerNx),
          env: { NX_RUST_ALLOW_UNSUPPORTED_NX: "true" },
        },
      );
    },
    HARNESS_TIMEOUT,
  );

  describe("when graph creation would fail", () => {
    it(
      "stops with graph creation's message and changes nothing when cargo cannot be found",
      async () => {
        const workspace = FixtureWorkspace.create("subfolder-workspace", unregistered);
        try {
          // The harness puts the wrapper's folder first on PATH, so the
          // wrapper goes. Nx starts Node by its full path and needs nothing
          // on PATH.
          rmSync(join(workspace.cargo.binDirectory, "cargo"));
          const empty = join(workspace.root, "..", "empty");
          mkdirSync(empty);
          const before = repositoryFiles(workspace.root);

          const result = await workspace.nx(["g", `${pluginName}:init`], { PATH: empty });
          const { status } = result;
          const output = withoutColours(result.output);

          expect(status).toBe(1);
          expect(output).toContain(
            "nx-rust was not added to nx.json: Nx could not create the project graph with it.",
          );
          expect(output).toMatch(
            /could not read the Cargo workspace of rust\/Cargo\.toml: cargo was not found on PATH/,
          );
          expect(output).toContain("Install a Rust toolchain or put cargo on PATH");
          expect(output).toContain(
            `nx.json is unchanged. Fix the problem above and run \`nx add ${pluginName}\` again.`,
          );
          expect(changedFiles(before, repositoryFiles(workspace.root))).toEqual([]);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );

    /** Checks that init stopped with `message` and wrote nothing. */
    function expectStopped(
      result: { status: number | null; output: string; changed: string[] },
      ...messages: string[]
    ): void {
      expect(result.status).toBe(1);
      expect(result.output).toContain(
        "nx-rust was not added to nx.json: Nx could not create the project graph with it.",
      );
      for (const message of messages) {
        expect(result.output).toContain(message);
      }
      expect(result.output).toContain(
        `nx.json is unchanged. Fix the problem above and run \`nx add ${pluginName}\` again.`,
      );
      expect(result.changed).toEqual([]);
    }

    const installedMajor = Number(require("nx/package.json").version.split(".")[0]);
    const newerNx = `${installedMajor + 1}.0.0`;
    const olderNx = `${installedMajor - 1}.4.2`;
    const untested = `nx-rust has not been checked with Nx ${newerNx}, which is installed in this repository: this version of ${pluginName} supports Nx ${installedMajor}.`;

    it.each([
      ["with a Cargo workspace", {}],
      ["without a Cargo.toml", { rust: null }],
    ])(
      "stops with an Nx major newer than the supported ones, %s",
      (_case, files: FileChanges) =>
        runInit(
          "subfolder-workspace",
          files,
          (workspace, result) => {
            expectStopped(
              result,
              untested,
              `set NX_RUST_ALLOW_UNSUPPORTED_NX=true to try this one with Nx ${installedMajor + 1}`,
            );
            expect(workspace.cargoCalls()).toEqual([]);
          },
          [],
          { prepare: (workspace) => workspace.useNx(newerNx) },
        ),
      HARNESS_TIMEOUT,
    );

    it.each([
      ["with a Cargo workspace", {}],
      ["without a Cargo.toml", { rust: null }],
    ])(
      "stops with an Nx major older than the supported ones, %s, whatever NX_RUST_ALLOW_UNSUPPORTED_NX says",
      (_case, files: FileChanges) =>
        runInit(
          "subfolder-workspace",
          files,
          (workspace, result) => {
            expectStopped(
              result,
              `nx-rust does not support Nx ${olderNx}, which is installed in this repository: this version of ${pluginName} supports Nx ${installedMajor}.`,
              "NX_RUST_ALLOW_UNSUPPORTED_NX applies only to Nx majors newer than the supported ones.",
            );
            expect(workspace.cargoCalls()).toEqual([]);
          },
          [],
          {
            prepare: (workspace) => workspace.useNx(olderNx),
            env: { NX_RUST_ALLOW_UNSUPPORTED_NX: "true" },
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "stops when the version of the installed Nx cannot be read",
      () =>
        runInit(
          "subfolder-workspace",
          {},
          (workspace, result) => {
            expectStopped(
              result,
              '/nx-not-a-version/node_modules/nx/package.json gives the version "not-a-version".',
              `This version of ${pluginName} supports Nx ${installedMajor}. Reinstall nx, or install a supported version of it, then run the command again.`,
            );
            expect(workspace.cargoCalls()).toEqual([]);
          },
          [],
          { prepare: (workspace) => workspace.useNx("not-a-version") },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "stops with the version found and the version required when Cargo is older than 1.91",
      () =>
        runInit(
          "subfolder-workspace",
          {},
          (workspace, result) => {
            expectStopped(
              result,
              "nx-rust needs Cargo 1.91 or later, but the cargo that reads the Cargo workspace of rust/Cargo.toml is cargo 1.90.0 (0000000 2025-01-01).",
            );
            expect(workspace.cargoCalls()).toEqual([
              workspaceCall("rust"),
              { cwd: "rust", args: ["--version"] },
            ]);
          },
          [],
          { env: { NX_RUST_TEST_CARGO_VERSION: "1.90.0" } },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "stops when a workspace pins a toolchain that is not installed, and installs none",
      async () => {
        // A custom toolchain name, which rustup cannot download in any case.
        const toolchain = "nx-rust-missing-toolchain";
        const toolchains = () =>
          spawnSync("rustup", ["toolchain", "list"], { env: testEnvironment(), encoding: "utf8" })
            .stdout;
        const before = toolchains();
        await runInit(
          "subfolder-workspace",
          { "rust/rust-toolchain.toml": `[toolchain]\nchannel = "${toolchain}"\n` },
          (_workspace, result) =>
            expectStopped(
              result,
              "`cargo metadata` failed for the Cargo workspace of rust/Cargo.toml",
              `toolchain '${toolchain}'`,
              "is not installed",
              "Fix what cargo reports, so that `cargo metadata --no-deps` succeeds in rust.",
            ),
        );
        expect(toolchains()).toBe(before);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "stops with the messages of Nx and of the plugin when two crates get one project name",
      () =>
        runInit("name-collision", {}, (workspace, result) => {
          expectStopped(
            result,
            // Nx's own error, from merging the projects.
            "The following projects are defined in multiple locations:",
            // The plugin's, from createDependencies, as graph creation gives it.
            `The "${pluginName}" plugin threw an error while creating dependencies: nx-rust would give 2 projects the name "api", and Nx needs every project name to be unique:`,
            "- the crate api in rust/crates/api/Cargo.toml: set `name` under [package.metadata.nx] in that manifest",
            "- the crate api in tools/api/Cargo.toml: set `name` under [package.metadata.nx] in that manifest",
          );
          // One report per workspace, as graph creation reads them.
          expect(workspace.cargoCalls()).toEqual([
            workspaceCall("rust"),
            workspaceCall("tools/api"),
          ]);
        }),
      HARNESS_TIMEOUT,
    );

    // The positive control: with the projects of Nx's own plugins merged in,
    // as graph creation merges them, the name that a project.json gives one
    // of the crates ends the collision.
    it(
      "registers the plugin when a project.json gives one of two such crates another name",
      () =>
        runInit(
          "name-collision",
          { "tools/api/project.json": '{ "name": "toolbox" }\n' },
          (_workspace, { status, output, changed }) => {
            expect(status).toBe(0);
            expect(output).not.toContain("nx-rust would give");
            expect(changed).toEqual(["nx.json"]);
          },
        ),
      HARNESS_TIMEOUT,
    );

    /** `nx.json` with one entry of the plugin per argument, as a second run finds it. */
    const registered = (...entries: object[]): FileChanges => ({
      "nx.json": `${JSON.stringify({
        plugins: entries.map((entry) => ({ plugin: pluginName, ...entry })),
      })}\n`,
    });

    // The problems in the options of the plugin's entries, which only an
    // nx.json that registers the plugin can have.
    it.each<[string, FileChanges, string[]]>([
      [
        "targetNames that give two targets of a project one name",
        registered({ options: { targetNames: { test: "build" } } }),
        [
          `"targetNames" in the options of the ${pluginName} entry in nx.json gives two inferred targets of one project the same name`,
          'Change "targetNames" so that every inferred target keeps a name of its own.',
        ],
      ],
      [
        "a key of targetNames that is not the default name of an inferred target",
        registered({ options: { targetNames: { clippy: "lint" } } }),
        [
          `"targetNames" in the options of the ${pluginName} entry in nx.json names "clippy", which is not the default name of an inferred target.`,
          'The targets that can be renamed are "build", "check", "lint",',
        ],
      ],
      [
        "a value of targetNames that is no target name",
        registered({ options: { targetNames: { test: "" } } }),
        [
          `"targetNames" in the options of the ${pluginName} entry in nx.json gives the target "test" "", but a target name has to be a string that is not empty.`,
        ],
      ],
      [
        "an option that nx-rust does not know",
        registered({ options: { namePrefix: "rust-" } }),
        [
          `nx.json: nx-rust does not know the key "namePrefix" in the options of the ${pluginName} entry.`,
          '"namePrefix" can be set in [workspace.metadata.nx] of a workspace\'s root manifest.',
        ],
      ],
      [
        "locked that is neither true nor false",
        registered({ options: { locked: "yes" } }),
        [
          `"locked" in the options of the ${pluginName} entry in nx.json is "yes", but it has to be true or false.`,
        ],
      ],
      [
        "two entries that give one workspace different values of a per-workspace setting",
        registered(
          {
            include: ["rust/Cargo.toml", "rust/crates/api/**"],
            options: { testRunner: "nextest" },
          },
          { include: ["rust/crates/model/**", "rust/crates/codegen/**", "rust/crates/testkit/**"] },
        ),
        [
          `nx-rust: the entries plugins[0], plugins[1] of ${pluginName} in nx.json receive manifests of the Cargo workspace in rust/, but give it different values of "testRunner": plugins[0] sets "nextest"; plugins[1] does not set it, which gives the default "cargo".`,
          '"testRunner" holds for a whole workspace. Give these entries the same value, or set testRunner under [workspace.metadata.nx] in rust/Cargo.toml, which wins over the plugin options.',
        ],
      ],
    ])(
      "stops a run on an nx.json that registers the plugin with %s, and writes nothing",
      (_case, files, messages) =>
        runInit(
          "subfolder-workspace",
          files,
          (_workspace, { status, output, changed }) => {
            expect(status).toBe(1);
            expect(output).toContain(
              "Nx cannot create the project graph with nx-rust as nx.json registers it.",
            );
            for (const message of messages) {
              expect(output).toContain(message);
            }
            expect(output).toContain("nx.json is unchanged.");
            expect(changed).toEqual([]);
          },
          // As above: the harness cannot load the registered plugin by name.
          ["--skipProjectGraph"],
        ),
      HARNESS_TIMEOUT,
    );

    // A case for each problem of DES-DIAGNOSTICS that stops graph creation
    // and that changed files bring about in a repository that does not
    // register the plugin yet, in subfolder-workspace unless a case names
    // another fixture; each checks the remedy as well. The problems in the
    // options of the plugin's entries are in the table above, a targetDefaults
    // entry that turns on caching is in target-defaults.spec.ts, and the
    // others have tests of their own here.
    it.each<[string, FileChanges, string | string[], FixtureName?]>([
      [
        "a configuration file that cargo reads and that is no valid TOML",
        { "rust/.cargo/config.toml": "paths = [\n" },
        [
          "`cargo metadata` failed for the Cargo workspace of rust/Cargo.toml",
          "rust/.cargo/config.toml",
          "Fix what cargo reports, so that `cargo metadata --no-deps` succeeds in rust.",
        ],
      ],
      [
        "a crate that gets the name of its workspace's workspace project",
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx]\nname = "rust"\n`,
        },
        [
          // Nx's own error, from merging the projects, then the plugin's.
          "The following projects are defined in multiple locations:",
          'nx-rust would give 2 projects the name "rust", and Nx needs every project name to be unique:',
          "- the crate model in rust/crates/model/Cargo.toml: change `name` under [package.metadata.nx] in that manifest.",
          "- the workspace project of the Cargo workspace in rust/Cargo.toml: set `name` under [workspace.metadata.nx.project] in that manifest.",
        ],
      ],
      [
        "a project table in a root manifest that defines a crate",
        {
          "tools/Cargo.toml": (manifest) =>
            `${manifest}\n[workspace.metadata.nx.project]\nname = "toolbox"\n`,
        },
        "tools/Cargo.toml: [workspace.metadata.nx.project] configures the workspace project, but this root manifest defines a crate, which is the workspace project. Move its settings to [package.metadata.nx] in tools/Cargo.toml.",
        "two-workspaces",
      ],
      [
        "an unknown key in a metadata table",
        {
          "rust/Cargo.toml": (manifest) =>
            `${manifest}\n[workspace.metadata.nx]\ntestrunner = "nextest"\n`,
        },
        'rust/Cargo.toml: nx-rust does not know the key "testrunner" in [workspace.metadata.nx]. Did you mean "testRunner"?',
      ],
      [
        "an unknown key in the project table of a workspace table",
        {
          "rust/Cargo.toml": (manifest) =>
            `${manifest}\n[workspace.metadata.nx.project]\nimplicitDependencies = ["web"]\n`,
        },
        [
          'rust/Cargo.toml: nx-rust does not know the key "implicitDependencies" in [workspace.metadata.nx.project].',
          'The keys it knows there are "name", "tags" and "targets".',
        ],
      ],
      [
        "a different executor on an inferred target",
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx.targets.build]\nexecutor = "nx:run-commands"\n`,
        },
        [
          'rust/crates/model/Cargo.toml: [package.metadata.nx.targets.build] sets "executor" to "nx:run-commands" on the inferred target "build", which runs "@convesoft/nx-rust:cargo".',
          "To run something else, define a target under a name of its own.",
        ],
      ],
      [
        "a command on an inferred target",
        {
          "rust/Cargo.toml": (manifest) =>
            `${manifest}\n[workspace.metadata.nx.project.targets.doc]\ncommand = "cargo doc"\n`,
        },
        [
          'rust/Cargo.toml: [workspace.metadata.nx.project.targets.doc] sets "command" on the inferred target "doc".',
          "To run another command, define a target under a name of its own.",
        ],
      ],
      [
        "affectedTests = true among the options of test, without the setting",
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx.targets.test.options]\naffectedTests = true\n`,
        },
        [
          'rust/crates/model/Cargo.toml: [package.metadata.nx.targets.test.options] sets "affectedTests" to true, but the Cargo workspace in rust/Cargo.toml does not use the selection of affected tests',
          "Remove it, or turn selection on with affectedTests = true under [workspace.metadata.nx] in rust/Cargo.toml.",
        ],
      ],
      [
        "an implicitDependencies entry starting with !",
        {
          "rust/crates/api/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx]\nimplicitDependencies = ["!model"]\n`,
        },
        'rust/crates/api/Cargo.toml: "implicitDependencies" in [package.metadata.nx] has the entry "!model", but the key only adds dependencies, so an entry starting with "!" is an error, whatever it names. Remove it; nx-rust keeps the edge of every Cargo dependency.',
      ],
      [
        'inputs without "..." on an inferred target',
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx.targets.test]\ninputs = ["default"]\n`,
        },
        'rust/crates/model/Cargo.toml: [package.metadata.nx.targets.test] sets "inputs" without "..." on the inferred target "test". The list would replace the inferred inputs, and the cache key would lose the toolchain, the environment and the files of the crate\'s dependencies. Put "..." where the inferred inputs belong, such as inputs = ["...", { env = "DATABASE_URL" }].',
      ],
      [
        "a key under the options of a target table that the executor does not know",
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx.targets.test.configurations.ci]\ncoverage = true\n`,
        },
        [
          'rust/crates/model/Cargo.toml: [package.metadata.nx.targets.test.configurations.ci] sets the option "coverage", which @convesoft/nx-rust:cargo, the executor of the inferred target "test", does not know.',
          'The options that "test" takes are "features", "allFeatures", "noDefaultFeatures", "profile" and "affectedTests".',
        ],
      ],
      [
        "an option in a target table that the target does not take",
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx.targets.test.options]\ntargetTriple = "x86_64-unknown-linux-gnu"\n`,
        },
        [
          'rust/crates/model/Cargo.toml: [package.metadata.nx.targets.test.options] sets the option "targetTriple", which the inferred target "test" does not take.',
          'The options that "test" takes are "features", "allFeatures", "noDefaultFeatures", "profile" and "affectedTests".',
        ],
      ],
      [
        "pluginVersion in a target table",
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx.targets.build.options]\npluginVersion = "0.0.0"\n`,
        },
        'rust/crates/model/Cargo.toml: [package.metadata.nx.targets.build.options] sets the option "pluginVersion", which only the plugin sets: it carries the plugin\'s version into the cache key, and a value set by hand would replace it, so that Nx could restore results of another version of the plugin. Remove it.',
      ],
      [
        "pluginVersion in a project.json beside a crate",
        {
          "rust/crates/model/project.json": JSON.stringify({
            targets: { build: { options: { pluginVersion: "0.0.0" } } },
          }),
        },
        'The file rust/crates/model/project.json sets the option "pluginVersion" on targets that nx-rust infers. Only nx-rust sets this option: it carries the plugin\'s version into the cache key, and another value would take its place, so that Nx could restore results of another version of the plugin. Remove it there. It reaches:\n  - model (rust/crates/model/Cargo.toml): "build"',
      ],
      [
        "pluginVersion in a targetDefaults entry keyed by the plugin's executor",
        {
          "nx.json": `${JSON.stringify({
            targetDefaults: { [`${pluginName}:cargo`]: { options: { pluginVersion: "0.0.0" } } },
          })}\n`,
        },
        `The targetDefaults entry "${pluginName}:cargo" in nx.json sets the option "pluginVersion" on targets that nx-rust infers. Only nx-rust sets this option: it carries the plugin's version into the cache key, and another value would take its place, so that Nx could restore results of another version of the plugin. Remove it there. It reaches:`,
      ],
      [
        "a targetDefaults entry keyed by the plugin's executor that replaces the inputs of its targets",
        {
          "nx.json": `${JSON.stringify({
            targetDefaults: { [`${pluginName}:cargo`]: { inputs: ["default"] } },
          })}\n`,
        },
        [
          `The targetDefaults entry "${pluginName}:cargo" in nx.json changes targets that nx-rust infers:`,
          "  - It replaces the inputs that nx-rust declares for",
          `  - Keep what nx-rust declares by putting "..." into the entry's "inputs" list, as in ["...", <your entries>].`,
        ],
      ],
      [
        "a fileInputs pattern that resolves into Cargo's directories",
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx]\nfileInputs = ["../../target/debug/model.d"]\n`,
        },
        'rust/crates/model/Cargo.toml: the fileInputs pattern "../../target/debug/model.d" resolves into rust/target, Cargo\'s build and artifact directory of the Cargo workspace in rust. Cargo writes the files there; declare the files that they are made from instead.',
      ],
      [
        "a fileInputs pattern that resolves outside the repository",
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx]\nfileInputs = ["../../../../outside.txt"]\n`,
        },
        "outside.txt, outside the repository, whose files Nx does not track. To key the crate's tasks on such files, add a command to runtimeInputs",
      ],
      [
        "a fileInputs pattern that names files in the folder of another plugin's project below where it starts",
        {
          "rust/crates/api/web/project.json": JSON.stringify({ name: "web" }),
          "rust/crates/api/web/index.js": "export {};\n",
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx]\nfileInputs = ["../api/**"]\n`,
        },
        [
          'rust/crates/model/Cargo.toml: the fileInputs pattern "../api/**" of the crate model names files in rust/crates/api/web, the folder of the project "web", which Nx would leave out of the cache keys.',
          'Add "../api/web/**" beside it in the fileInputs of rust/crates/model/Cargo.toml, or narrow the pattern so that it does not reach rust/crates/api/web.',
        ],
      ],
      [
        "a fileInputs pattern with a .. segment after a glob character",
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx]\nfileInputs = ["../*/../model/README.md"]\n`,
        },
        'rust/crates/model/Cargo.toml: the fileInputs pattern "../*/../model/README.md" has a ".." segment after a glob character, so that nx-rust cannot tell which folder it reaches, and Nx cannot hash it. Put every ".." before the first glob character, such as "*", "?" or "{".',
      ],
      ...(
        [
          ['options = "broken"', 'has to be a table, not "broken".'],
          ["outputs = 3", "has to be a list of strings, not 3."],
          ['continuous = "false"', 'has to be true or false, not "false".'],
        ] as const
      ).map(([field, expected]): [string, FileChanges, string] => [
        `a target field of another type than Nx gives it, ${field}`,
        {
          "rust/crates/model/Cargo.toml": (manifest) =>
            `${manifest}\n[package.metadata.nx.targets.build]\n${field}\n`,
        },
        `rust/crates/model/Cargo.toml: "${field.split(" ")[0]}" in [package.metadata.nx.targets.build] ${expected}`,
      ]),
    ])(
      "stops with graph creation's message for %s",
      (_case, files, messages, fixture = "subfolder-workspace") =>
        runInit(fixture, files, (_workspace, result) => {
          expectStopped(result, ...[messages].flat());
          expect(result.output).toContain(
            "nx-rust was not added to nx.json: Nx could not create the project graph with it.",
          );
        }),
      HARNESS_TIMEOUT,
    );

    it(
      "stops with cargo's message and changes nothing when cargo metadata fails on a root manifest that is no valid TOML",
      () =>
        runInit(
          "two-workspaces",
          { "tools/Cargo.toml": (manifest) => `${manifest}\nnot toml\n` },
          (_workspace, { status, output, changed }) => {
            expect(status).toBe(1);
            expect(output).toContain("nx-rust was not added to nx.json");
            expect(output).toContain(
              "`cargo metadata` failed for the Cargo workspace of tools/Cargo.toml",
            );
            expect(output).toContain("cargo exited with status 101");
            expect(output).toContain(
              "Fix what cargo reports, so that `cargo metadata --no-deps` succeeds in tools.",
            );
            expect(output).toContain("nx.json is unchanged.");
            expect(changed).toEqual([]);
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "stops a second run on an nx.json that lists the plugin without the executors' entries, and writes nothing",
      () =>
        runInit(
          "subfolder-workspace",
          {
            "nx.json": `${JSON.stringify({ plugins: [pluginName] })}\n`,
            "rust/crates/api/Cargo.toml": "[package\n",
          },
          (workspace, { status, output, changed }) => {
            expect(status).toBe(1);
            expect(output).toContain(
              "Nx cannot create the project graph with nx-rust as nx.json registers it.",
            );
            expect(output).toContain(
              "`cargo metadata` failed for the Cargo workspace of rust/Cargo.toml",
            );
            expect(output).toContain("nx.json is unchanged.");
            expect(output).not.toContain("to targetDefaults in nx.json");
            expect(changed).toEqual([]);
            expect(workspace.cargoCalls()).toEqual([workspaceCall("rust")]);
          },
          // As above: the harness cannot load the registered plugin by name.
          ["--skipProjectGraph"],
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "stops with Nx's error when a crate has the name of a JS project in another folder",
      () =>
        runInit(
          "subfolder-workspace",
          { "web/project.json": '{ "name": "api" }\n' },
          (_workspace, result) => {
            expectStopped(result, "The following projects are defined in multiple locations:");
            expect(result.output).toContain("  - web");
            expect(result.output).toContain("  - rust/crates/api");
          },
        ),
      HARNESS_TIMEOUT,
    );
  });
});

describe("init's report of tools", () => {
  let tools: ToolFolders;
  let root: string;

  beforeEach(() => {
    tools = new ToolFolders();
    root = join(tools.base, "repo");
    mkdirSync(join(root, "rust"), { recursive: true });
  });

  afterEach(() => tools.remove());

  /** The report for a repository with one workspace in `rust`, whose files `files` adds. */
  function report(files: string[] = [], env: Record<string, string> = tools.env()) {
    for (const file of files) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), "");
    }
    const workspace = { root: "rust", report: {}, members: [] } as unknown as CargoWorkspace;
    const check: GraphCheck = { manifests: ["rust/Cargo.toml"], workspaces: [workspace] };
    return initReport(check, root, env);
  }

  it("lists every missing tool that nothing needs on one line", () => {
    const { warnings, info } = report();

    expect(warnings).toEqual([]);
    expect(info).toEqual([
      `Not installed and not needed by your settings: ${allTools.join(", ")}. A task that runs one of them fails and says how to get it.`,
    ]);
  });

  it.each(cargoDenyConfigurationFiles)(
    "warns that cargo-deny is missing where the workspace root has %s",
    (file) => {
      const { warnings, info } = report([`rust/${file}`]);

      expect(warnings).toEqual([
        `cargo-deny is not installed, but the deny target that rust/${file} gives the Cargo workspace in rust needs it. Install it with \`cargo install --locked cargo-deny\` (https://crates.io/crates/cargo-deny).`,
      ]);
      expect(info[0]).not.toContain("cargo-deny");
    },
  );

  it("counts a cargo-deny configuration file only in a workspace root", () => {
    const { warnings, info } = report(["deny.toml", "rust/crates/api/deny.toml"]);

    expect(warnings).toEqual([]);
    expect(info[0]).toContain("cargo-deny");
  });

  it("finds cargo subcommands in the Cargo home and on PATH", () => {
    tools.install(join(tools.cargoHome, "bin"), "cargo-audit");
    tools.install(tools.path, "cargo-deny");
    tools.install(tools.path, "cargo-nextest");

    const { warnings, info } = report(["rust/deny.toml"]);

    expect(warnings).toEqual([]);
    expect(info[0]).not.toMatch(/cargo-audit|cargo-deny|cargo-nextest/);
    expect(info[0]).toContain("cargo-affected");
  });

  it("finds the napi CLI in the repository's node_modules/.bin", () => {
    tools.install(join(root, "node_modules", ".bin"), "napi");

    expect(report().info[0]).not.toContain("napi");
  });

  it("finds the wasm target in the sysroot of the repository's rustc", () => {
    const sysroot = join(tools.base, "sysroot");
    mkdirSync(join(sysroot, "lib", "rustlib", wasmTriple), { recursive: true });
    tools.install(tools.path, "rustc", sysroot);
    tools.install(tools.path, "wasm-bindgen");

    expect(report().info[0]).not.toMatch(/wasm/);
  });

  it("says nothing about tools when all are installed", () => {
    for (const name of [
      "cargo-nextest",
      "cargo-affected",
      "cargo-hakari",
      "cargo-audit",
      "cargo-deny",
      "wasm-bindgen",
      "napi",
    ]) {
      tools.install(tools.path, name);
    }
    const sysroot = join(tools.base, "sysroot");
    mkdirSync(join(sysroot, "lib", "rustlib", wasmTriple), { recursive: true });
    tools.install(tools.path, "rustc", sysroot);

    expect(report(["rust/deny.toml"])).toEqual({ warnings: [], info: [] });
  });
});

describe("init's list of build directories inside the repository", () => {
  // Cargo writes to the folder that the system reaches through the path that
  // it reports, which decides and names the directory (DES-DIAGNOSTICS).
  let tools: ToolFolders;
  let root: string;

  beforeEach(() => {
    tools = new ToolFolders();
    root = join(realpathSync(tools.base), "repo");
    mkdirSync(join(root, "rust"), { recursive: true });
  });

  afterEach(() => tools.remove());

  /** The lines that list a build directory for the workspace in rust, whose report gives `directory`. */
  function listed(directory: string): string[] {
    const workspace = {
      root: "rust",
      report: { build_directory: directory },
      members: [],
    } as unknown as CargoWorkspace;
    const check: GraphCheck = { manifests: ["rust/Cargo.toml"], workspaces: [workspace] };
    return initReport(check, root, tools.env())
      .info.flatMap((text) => text.split("\n"))
      .filter((line) => line.startsWith("  rust: "));
  }

  it("lists the folder as the path names it where no link is on the way", () => {
    expect(listed(`${root}/rust/target`)).toEqual(["  rust: rust/target"]);
  });

  it("does not list a directory that a link inside the repository leads outside", () => {
    symlinkSync("../../outside", join(root, "rust", "out"));

    expect(listed(`${root}/rust/out`)).toEqual([]);
  });

  it("lists the folder inside the repository that a link outside it leads to", () => {
    const link = join(dirname(root), "outside-link");
    symlinkSync(join(root, "rust", "out"), link);

    expect(listed(`${root}/rust/../../outside-link`)).toEqual([
      `  rust: rust/out (reached through ${link})`,
    ]);
  });

  it("lists the folder inside the repository that a link leads to, not the one that the path names as text", () => {
    mkdirSync(join(root, "deep", "child"), { recursive: true });
    symlinkSync("../deep/child", join(root, "rust", "link"));

    expect(listed(`${root}/rust/link/../target`)).toEqual([
      "  rust: deep/target (reached through rust/link/../target)",
    ]);
  });
});

describe("init with an Nx whose internals differ", () => {
  // The modules through which init runs graph creation. Each test replaces
  // them for one run of the generator, the way a later Nx release could
  // change them.
  const internalsPath = require.resolve("nx/src/devkit-internals");
  const pluginsPath = require.resolve("nx/src/project-graph/plugins/get-plugins");
  const filesPath = require.resolve("nx/src/project-graph/utils/retrieve-workspace-files");
  const nxVersion: string = require("nx/package.json").version;
  let workspace: FixtureWorkspace;

  beforeEach(() => {
    workspace = FixtureWorkspace.create("subfolder-workspace", unregistered);
  });

  afterEach(() => {
    for (const path of [internalsPath, pluginsPath, filesPath]) {
      jest.dontMock(path);
    }
    jest.resetModules();
    workspace.remove();
  });

  type Change = (module: Record<string, unknown>) => Record<string, unknown>;

  // The real internals cannot run here, because Nx in this process knows
  // only this repository's files; the nx g tests above and the end-to-end
  // suite run them. Stand-ins of the expected shape run each entry's
  // createNodes on no files, load no other plugin and find no files, which
  // lets init register the plugin.
  const working: Required<Record<"internals" | "plugins" | "files", Change>> = {
    internals: (internals) => ({
      ...internals,
      retrieveProjectConfigurations: async (
        plugins: { specifiedPlugins: { createNodes: [string, Function] }[] },
        workspaceRoot: string,
        nxJson: unknown,
      ) => {
        for (const plugin of plugins.specifiedPlugins) {
          await plugin.createNodes[1]([], { nxJsonConfiguration: nxJson, workspaceRoot });
        }
        return { projects: {}, projectRootMap: {}, matchingProjectFiles: [] };
      },
    }),
    plugins: (plugins) => ({
      ...plugins,
      getPluginsSeparated: async () => ({ specifiedPlugins: [], defaultPlugins: [] }),
    }),
    files: (files) => ({
      ...files,
      retrieveWorkspaceFiles: async () => ({
        fileMap: { projectFileMap: {}, nonProjectFiles: [] },
        rustReferences: {},
      }),
    }),
  };

  /**
   * Runs init on the fixture with Nx's internals as `changes` make them, on
   * top of the working stand-ins, and returns its error and changes: those
   * in Nx's file tree, which Nx writes only after a generator that
   * succeeds, and the files that changed on disk during the run.
   */
  async function initWith(
    changes: Partial<Record<"internals" | "plugins" | "files", Change>> = {},
  ): Promise<{ error: unknown; changed: string[] }> {
    jest.resetModules();
    for (const [key, path] of [
      ["internals", internalsPath],
      ["plugins", pluginsPath],
      ["files", filesPath],
    ] as const) {
      const actual = jest.requireActual(path);
      jest.doMock(path, () =>
        (changes[key] ?? ((m: Record<string, unknown>) => m))(working[key]({ ...actual })),
      );
    }
    const { initGenerator } = require("../src/generators/init/init");
    const { FsTree } = require("nx/src/generators/tree");
    const tree = new FsTree(workspace.root, false);
    const before = repositoryFiles(workspace.root);
    const error = await initGenerator(tree, {}).then(
      () => undefined,
      (e: unknown) => e,
    );
    const inTree: string[] = tree.listChanges().map((change: { path: string }) => change.path);
    const onDisk = changedFiles(before, repositoryFiles(workspace.root));
    return { error, changed: [...new Set([...inTree, ...onDisk])].sort() };
  }

  /** The error for `detail`, as init words it. */
  function expectUnsupportedNx(error: unknown, detail: string): void {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(
      "nx-rust was not added to nx.json: it could not check the project graph.",
    );
    expect(message).toContain(
      `nx-rust cannot check this repository with the installed Nx ${nxVersion}: ${detail}.`,
    );
    // From the peer dependency range on nx in the package.
    expect(message).toContain("This version of @convesoft/nx-rust supports Nx 24.");
    expect(message).toContain(
      `Use a supported Nx version, or a version of @convesoft/nx-rust that supports the installed Nx ${nxVersion}.`,
    );
    expect(message).toContain("nx.json is unchanged.");
  }

  // The positive control.
  it(
    "registers the plugin when the internals are there and their results have the expected shape",
    async () => {
      const { error, changed } = await initWith();

      expect(error).toBeUndefined();
      expect(changed).toEqual(["nx.json"]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stops before writing when LoadedNxPlugin is missing",
    async () => {
      const { error, changed } = await initWith({
        internals: (internals) => ({ ...internals, LoadedNxPlugin: undefined }),
      });

      expectUnsupportedNx(
        error,
        "LoadedNxPlugin from nx/src/devkit-internals is not a constructor",
      );
      expect(changed).toEqual([]);
      expect(workspace.cargoCalls()).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stops before writing when retrieveProjectConfigurations is missing",
    async () => {
      const { error, changed } = await initWith({
        internals: (internals) => ({ ...internals, retrieveProjectConfigurations: undefined }),
      });

      expectUnsupportedNx(
        error,
        "retrieveProjectConfigurations from nx/src/devkit-internals is not a function",
      );
      expect(changed).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stops before writing when the project configurations have another shape",
    async () => {
      const { error, changed } = await initWith({
        internals: (internals) => ({
          ...internals,
          retrieveProjectConfigurations: async () => ({ projects: {} }),
        }),
      });

      expectUnsupportedNx(
        error,
        "the result of retrieveProjectConfigurations from nx/src/devkit-internals has no matchingProjectFiles list of file paths",
      );
      expect(changed).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stops before writing when the project configurations have no projectRootMap",
    async () => {
      const { error, changed } = await initWith({
        internals: (internals) => ({
          ...internals,
          retrieveProjectConfigurations: async () => ({ projects: {}, matchingProjectFiles: [] }),
        }),
      });

      expectUnsupportedNx(
        error,
        "the result of retrieveProjectConfigurations from nx/src/devkit-internals has no projects and projectRootMap by project root",
      );
      expect(changed).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stops before writing when Nx's plugin loader is missing",
    async () => {
      const { error, changed } = await initWith({
        plugins: (plugins) => ({ ...plugins, getPluginsSeparated: undefined }),
      });

      expectUnsupportedNx(
        error,
        "getPluginsSeparated from nx/src/project-graph/plugins/get-plugins is not a function",
      );
      expect(changed).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stops before writing when Nx's plugin loader returns another shape",
    async () => {
      const { error, changed } = await initWith({
        plugins: (plugins) => ({ ...plugins, getPluginsSeparated: async () => [] }),
      });

      expectUnsupportedNx(
        error,
        "the result of getPluginsSeparated from nx/src/project-graph/plugins/get-plugins is not one specified plugin per entry and a list of default plugins",
      );
      expect(changed).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stops before writing when the files of the repository cannot be read",
    async () => {
      const { error, changed } = await initWith({
        files: (files) => ({ ...files, retrieveWorkspaceFiles: undefined }),
      });

      expectUnsupportedNx(
        error,
        "retrieveWorkspaceFiles from nx/src/project-graph/utils/retrieve-workspace-files is not a function",
      );
      expect(changed).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stops before writing when the files of the repository come in another shape",
    async () => {
      const { error, changed } = await initWith({
        files: (files) => ({ ...files, retrieveWorkspaceFiles: async () => ({ fileMap: {} }) }),
      });

      expectUnsupportedNx(
        error,
        "the result of retrieveWorkspaceFiles from nx/src/project-graph/utils/retrieve-workspace-files has no fileMap with projectFileMap and nonProjectFiles",
      );
      expect(changed).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );
});
