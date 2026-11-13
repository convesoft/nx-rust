import type { TargetConfiguration } from "@nx/devkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { environmentVariables, toolchainCommand } from "../src/graph/inputs";
import { listsPackage } from "../src/graph/plugin-package";
import {
  FileChanges,
  FixtureGraph,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  loadFixtureGraph,
  pnpmLockfile,
  withoutColours,
} from "./harness";

// Checks the parts of VER-CACHE-KEYS, VER-CARGO-UNCHANGED and VER-SETUP that
// the graph shows: which targets are cached, their inputs and outputs, and
// the warnings of graph creation. cache-keys.spec.ts checks the keys
// themselves with Nx's hasher.

const pluginVersion: string = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
).version;

const cached = ["build", "check", "lint", "test", "fmt-check"];
const uncached = ["fmt", "bench", "run", "audit", "deny", "update"];

/** The inputs of a target that are files or named inputs, written as strings. */
function fileInputs(target: TargetConfiguration): string[] {
  return (target.inputs ?? []).filter((input): input is string => typeof input === "string");
}

/** The names of the `env` inputs of a target. */
function envInputs(target: TargetConfiguration): string[] {
  return (target.inputs ?? []).flatMap((input) =>
    typeof input === "object" && "env" in input ? [input.env] : [],
  );
}

/** The input objects of one kind. */
function inputsOf(target: TargetConfiguration, kind: string): unknown[] {
  return (target.inputs ?? []).filter((input) => typeof input === "object" && kind in input);
}

/** Every target of every project, as `project:target`. */
function everyTarget(graph: FixtureGraph): [string, TargetConfiguration][] {
  return Object.entries(graph.projects).flatMap(([name, project]) =>
    Object.entries(project.targets ?? {}).map(
      ([target, configuration]): [string, TargetConfiguration] => [
        `${name}:${target}`,
        configuration,
      ],
    ),
  );
}

describe("caching", () => {
  it(
    "caches build, check, lint, test, fmt-check and the workspace's doc, and no other target",
    async () => {
      const graph = await loadFixtureGraph("crate-shapes", { files: { "rust/deny.toml": "" } });

      for (const [task, target] of everyTarget(graph)) {
        const name = task.split(":")[1];
        expect({ task, cache: target.cache }).toEqual({
          task,
          cache: cached.includes(name) || name === "doc",
        });
        expect(uncached.includes(name) || cached.includes(name) || name === "doc").toBe(true);
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "declares the inputs of DES-INPUTS on a member crate",
    async () => {
      const graph = await loadFixtureGraph("subfolder-workspace");
      const { api } = graph.projects;

      // The workspace's root manifest, whose fields the crate inherits,
      // reaches the crates that depend on it through the named input.
      expect(api.namedInputs).toEqual({
        default: ["{projectRoot}/**/*", "{workspaceRoot}/rust/Cargo.toml"],
      });
      const workspaceFiles = ["rust/crates", "rust", ""].flatMap((folder) =>
        ["rust-toolchain.toml", "rust-toolchain", ".cargo/config.toml", ".cargo/config"].map(
          (file) => `{workspaceRoot}/${folder === "" ? "" : `${folder}/`}${file}`,
        ),
      );
      // The other members' manifests, under the workspace-build strategy.
      const members = ["codegen", "model", "testkit"].map(
        (crate) => `{workspaceRoot}/rust/crates/${crate}/Cargo.toml`,
      );
      expect(fileInputs(api.targets.test)).toEqual([
        "default",
        "^default",
        ...workspaceFiles,
        ...members,
      ]);
      expect(fileInputs(api.targets.lint)).toEqual([
        "default",
        "^default",
        ...workspaceFiles,
        ...members,
        ...["rust/crates", "rust", ""].flatMap((folder) =>
          ["clippy.toml", ".clippy.toml"].map(
            (file) => `{workspaceRoot}/${folder === "" ? "" : `${folder}/`}${file}`,
          ),
        ),
      ]);
      for (const name of ["fmt-check", "fmt"]) {
        expect(fileInputs(api.targets[name])).toEqual([
          "default",
          "^default",
          ...workspaceFiles,
          ...members,
          ...["rust/crates", "rust", ""].flatMap((folder) =>
            ["rustfmt.toml", ".rustfmt.toml"].map(
              (file) => `{workspaceRoot}/${folder === "" ? "" : `${folder}/`}${file}`,
            ),
          ),
        ]);
      }

      const lockfile = { fileset: "{workspaceRoot}/rust/Cargo.lock", includeIgnored: true };
      for (const name of ["build", "check", "lint", "test"]) {
        expect(inputsOf(api.targets[name], "fileset")).toEqual([lockfile]);
      }
      for (const name of ["fmt-check", "fmt"]) {
        expect(inputsOf(api.targets[name], "fileset")).toEqual([]);
      }

      expect(envInputs(api.targets.build)).toEqual([
        ...environmentVariables,
        "CARGO_BUILD_WARNINGS",
      ]);
      expect(envInputs(api.targets.lint)).toEqual([
        ...environmentVariables,
        "CARGO_BUILD_WARNINGS",
        "CLIPPY_CONF_DIR",
      ]);
      expect(envInputs(api.targets["fmt-check"])).toEqual([...environmentVariables]);

      for (const name of ["build", "check", "lint", "test", "fmt-check", "fmt"]) {
        expect(inputsOf(api.targets[name], "runtime")).toEqual([
          { runtime: toolchainCommand("rust") },
        ]);
        expect(inputsOf(api.targets[name], "externalDependencies")).toEqual([
          { externalDependencies: [] },
        ]);
      }
      expect(toolchainCommand("rust")).toBe(
        "{ cd './rust' && RUSTUP_AUTO_INSTALL=0 rustc -Vv 2>/dev/null || od -An -N16 -tx1 /dev/urandom; }; env | grep -E '^CARGO_(PROFILE|TARGET)_' | grep -v '^CARGO_TARGET_DIR=' | LC_ALL=C sort; true",
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives bench and run the inputs of the targets that compile, so that nx affected selects them",
    async () => {
      const graph = await loadFixtureGraph("crate-shapes");

      for (const [project, name] of [
        ["perf", "bench"],
        ["cli", "run"],
      ]) {
        const target = graph.projects[project].targets[name];
        expect(target.cache).toBe(false);
        expect(target.inputs).toEqual(graph.projects[project].targets.build.inputs);
        expect(envInputs(target)).toContain("CARGO_BUILD_WARNINGS");
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leaves the workspace's Cargo.lock out of the files of the crate at the workspace root",
    async () => {
      const graph = await loadFixtureGraph("standalone-crate");

      expect(graph.projects.xtask.namedInputs).toEqual({
        default: ["{projectRoot}/**/*", "!{projectRoot}/Cargo.lock"],
      });
      // It reaches the targets of its own workspace as a file of their own.
      expect(inputsOf(graph.projects.xtask.targets.test, "fileset")).toEqual([
        { fileset: "{workspaceRoot}/tools/xtask/Cargo.lock", includeIgnored: true },
      ]);
      // The root manifest is among the crate's files.
      expect(fileInputs(graph.projects.xtask.targets.test)).not.toContain(
        "{workspaceRoot}/tools/xtask/Cargo.toml",
      );
      expect(graph.projects.rust.namedInputs).toEqual({
        default: ["{projectRoot}/**/*", "!{projectRoot}/Cargo.lock"],
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives a crate the folders of the path dependencies without a project that it reaches",
    async () => {
      const graph = await loadFixtureGraph("vendored-crate");

      // lib reaches parser directly and lexer through it.
      expect(graph.projects.lib.namedInputs).toEqual({
        default: [
          "{projectRoot}/**/*",
          "{workspaceRoot}/rust/Cargo.toml",
          "{workspaceRoot}/vendor/parser/**/*",
          "{workspaceRoot}/vendor/lexer/**/*",
        ],
      });
      // app reaches them through lib, whose input it hashes with ^default.
      expect(graph.projects.app.namedInputs).toEqual({
        default: ["{projectRoot}/**/*", "{workspaceRoot}/rust/Cargo.toml"],
      });
      expect(graph.projects.lib.metadata.cargo.warnings).toBeUndefined();
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives a member the folders of the redirected crates it may use without an edge",
    async () => {
      const graph = await loadFixtureGraph("patched-workspaces");
      const fork = "{workspaceRoot}/third_party/fork/**/*";
      const model = "{workspaceRoot}/rust/crates/model/**/*";

      // fork has no project: like a path dependency without one, in the named input.
      for (const member of ["api", "viaw", "util", "harness", "model"]) {
        expect({ member, named: graph.projects[member].namedInputs.default }).toEqual({
          member,
          named: expect.arrayContaining([fork]),
        });
      }
      // util may use model, which reaches util, so util has no edge to it.
      expect(fileInputs(graph.projects.util.targets.test)).toContain(model);
      expect(fileInputs(graph.projects.api.targets.test)).not.toContain(model);
      // plain has no registry or git dependency.
      expect(graph.projects.plain.namedInputs).toEqual({
        default: ["{projectRoot}/**/*", "{workspaceRoot}/rust/Cargo.toml"],
      });
      expect(fileInputs(graph.projects.plain.targets.test)).not.toContain(model);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "warns about a redirected crate without a project whose files Nx cannot see",
    async () => {
      const graph = await loadFixtureGraph("patched-workspaces", {
        files: { ".gitignore": (text) => `${text}third_party/\n` },
      });

      expect(graph.projects.api.metadata.cargo.warnings).toEqual([
        expect.stringMatching(
          /the crate "api" \(rust\/crates\/api\/Cargo.toml\) may use, through a \[patch\], \[replace\] or paths entry of its workspace, "fork" in third_party\/fork, which has no Nx project and whose files Nx cannot see/,
        ),
      ]);
      expect(graph.projects.api.namedInputs.default).not.toContain(
        "{workspaceRoot}/third_party/fork/**/*",
      );
      expect(graph.projects.plain.metadata.cargo.warnings).toBeUndefined();
    },
    HARNESS_TIMEOUT,
  );

  describe("with a path dependency whose files Nx cannot see", () => {
    const ignored: FileChanges = { ".gitignore": (text) => `${text ?? ""}vendor/\n` };
    const outside: FileChanges = {
      "rust/crates/lib/Cargo.toml": (manifest) =>
        manifest.replace(
          /\[dependencies\][^[]*/,
          '[dependencies]\nfar = { path = "../../../../far" }\n',
        ),
      "../far/Cargo.toml": '[package]\nname = "far"\nversion = "0.1.0"\nedition = "2024"\n',
      "../far/src/lib.rs": "",
    };

    it(
      "warns when the graph is created, naming the crate and the dependency, and gives no fileset for it",
      async () => {
        for (const [files, reason, folder] of [
          [ignored, ".gitignore or .nxignore leaves it out", "vendor/parser"],
          [outside, "it lies outside the repository", "/far"],
        ] as const) {
          const workspace = FixtureWorkspace.create("vendored-crate", files);
          try {
            const graph = await workspace.graph();
            const warnings: string[] = graph.projects.lib.metadata.cargo.warnings;
            expect(warnings).toEqual(
              expect.arrayContaining([
                expect.stringMatching(
                  new RegExp(
                    `the crate "lib" \\(rust/crates/lib/Cargo.toml\\) depends by path on "(parser|far)" in \\S*${folder}, .*${reason.replace(/[.]/g, "\\.")}`,
                  ),
                ),
              ]),
            );
            expect(graph.projects.lib.namedInputs.default).toEqual(
              expect.not.arrayContaining([expect.stringContaining(folder)]),
            );
            // app depends on lib, not on the crates behind it.
            expect(graph.projects.app.metadata.cargo.warnings).toBeUndefined();

            const { status, output } = await workspace.nx(["show", "projects"]);
            expect(status).toBe(0);
            expect(withoutColours(output)).toContain(warnings[0]);
          } finally {
            workspace.remove();
          }
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "is printed by init (VER-SETUP)",
      async () => {
        const workspace = FixtureWorkspace.create("vendored-crate", ignored, { "nx.json": "{}\n" });
        try {
          const { status, output } = await workspace.nx(["g", "@convesoft/nx-rust:init"]);

          expect(status).toBe(0);
          expect(withoutColours(output)).toMatch(
            /the crate "lib" \(rust\/crates\/lib\/Cargo.toml\) depends by path on "parser" in vendor\/parser, which has no Nx project and whose files Nx cannot see/,
          );
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });

  describe("outputs", () => {
    it(
      "name the final artifacts of build for the task's triple and profile, and the doc folder",
      async () => {
        const graph = await loadFixtureGraph("crate-shapes", {
          files: {
            "rust/crates/core/Cargo.toml": (manifest) =>
              `${manifest}\n[lib]\ncrate-type = ["cdylib", "staticlib", "rlib"]\n`,
          },
        });
        const folder =
          "{workspaceRoot}/rust/target/{options.targetTriple ?? .}/{options.profile ?? debug}";

        expect(graph.projects.cli.targets.build.outputs).toEqual([`${folder}/cli`]);
        expect([...graph.projects.server.targets.build.outputs].sort()).toEqual([
          `${folder}/migrate`,
          `${folder}/server`,
        ]);
        expect(graph.projects["core-lib"].targets.build.outputs).toEqual([
          `${folder}/libcore_lib.so`,
          `${folder}/libcore_lib.dylib`,
          `${folder}/libcore_lib.a`,
        ]);
        // An rlib is Cargo's own.
        expect(graph.projects.internal.targets.build.outputs).toEqual([]);
        expect(graph.projects.rust.targets.doc.outputs).toEqual([
          "{workspaceRoot}/rust/target/{options.targetTriple ?? .}/doc",
        ]);
        const others = everyTarget(graph).filter(
          ([task]) => !task.endsWith(":build") && !task.endsWith(":doc"),
        );
        expect(others.length).toBeGreaterThan(0);
        for (const [task, target] of others) {
          expect({ task, outputs: target.outputs }).toEqual({ task, outputs: [] });
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "never name a path inside a build directory apart from the artifact directory",
      async () => {
        const graph = await loadFixtureGraph("crate-shapes", {
          files: {
            "rust/.cargo/config.toml":
              '[build]\nbuild-dir = "{cargo-cache-home}/build/{workspace-path-hash}"\n',
          },
        });

        for (const [task, target] of everyTarget(graph)) {
          for (const output of target.outputs ?? []) {
            expect({ task, output }).toEqual({
              task,
              output: expect.stringMatching(/^\{workspaceRoot\}\/rust\/target\/\{options/),
            });
            expect(output).not.toMatch(/\/(deps|build|incremental|\.fingerprint)\//);
          }
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "leave build and doc uncached, and say so, when the artifact directory lies outside the repository",
      async () => {
        const workspace = FixtureWorkspace.create("subfolder-workspace");
        try {
          const env = { CARGO_TARGET_DIR: join(workspace.root, "..", "target-outside") };
          const graph = await workspace.graph(env);
          const { api, rust } = graph.projects;

          expect(api.targets.build).toMatchObject({ cache: false, outputs: [] });
          expect(rust.targets.doc).toMatchObject({ cache: false, outputs: [] });
          // The executor reads why, to fail a task that the configuration caches anyway.
          for (const target of [api.targets.build, rust.targets.doc]) {
            expect(target.metadata.cargo.uncached).toMatch(/artifact directory lies outside/);
          }
          expect(api.targets.check.metadata.cargo.uncached).toBeUndefined();
          for (const name of ["check", "lint", "test", "fmt-check"]) {
            expect(api.targets[name].cache).toBe(true);
          }
          const [warning] = api.metadata.cargo.warnings;
          expect(warning).toMatch(
            /artifact directory of the Cargo workspace in rust is .*target-outside, outside the repository/,
          );
          expect(rust.metadata.cargo.warnings).toEqual([warning]);
          const { output } = await workspace.nx(["show", "projects"], env);
          expect(withoutColours(output)).toContain(warning);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "leave build and doc uncached, and say so, where Cargo's configuration chooses the triple",
      async () => {
        const graph = await loadFixtureGraph("crate-shapes", {
          files: { "rust/.cargo/config.toml": '[build]\ntarget = "x86_64-unknown-linux-gnu"\n' },
        });
        const { cli, rust } = graph.projects;

        for (const target of [cli.targets.build, rust.targets.doc]) {
          expect(target).toMatchObject({ cache: false, outputs: [] });
          expect(target.metadata.cargo.uncached).toMatch(
            /build.target in .*rust\/.cargo\/config.toml chooses the target triple/,
          );
        }
        for (const name of ["check", "lint", "test", "fmt-check"]) {
          expect(cli.targets[name].cache).toBe(true);
        }
        expect(cli.metadata.cargo.warnings).toEqual([
          expect.stringMatching(
            /rust\/.cargo\/config.toml sets build.target for the Cargo workspace in rust, .*targetTriple/,
          ),
        ]);

        // A triple in the crate's table names the folder again.
        const named = await loadFixtureGraph("crate-shapes", {
          files: {
            "rust/.cargo/config.toml": '[build]\ntarget = "x86_64-unknown-linux-gnu"\n',
            "rust/crates/cli/Cargo.toml": (manifest) =>
              `${manifest}\n[package.metadata.nx.targets.build.options]\ntargetTriple = "x86_64-unknown-linux-gnu"\n`,
          },
        });
        expect(named.projects.cli.targets.build).toMatchObject({
          cache: true,
          options: { targetTriple: "x86_64-unknown-linux-gnu" },
        });
        expect(named.projects["core-lib"].targets.build.cache).toBe(false);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "leave doc uncached, and say so, when two workspaces share one artifact directory",
      async () => {
        const workspace = FixtureWorkspace.create("two-workspaces", {
          ".cargo/config.toml": '[build]\ntarget-dir = "target"\n',
        });
        try {
          const graph = await workspace.graph();

          for (const project of ["cargo-workspace", "tools"]) {
            expect(graph.projects[project].targets.doc).toMatchObject({
              cache: false,
              outputs: [],
            });
            expect(graph.projects[project].metadata.cargo.warnings).toEqual([
              expect.stringMatching(/shares Cargo's artifact directory target with/),
            ]);
          }
          expect(graph.projects.scaffold.targets.build).toMatchObject({
            cache: true,
            outputs: [],
          });
          expect(graph.projects.app.targets.build.outputs).toEqual([
            "{workspaceRoot}/target/{options.targetTriple ?? .}/{options.profile ?? debug}/app",
          ]);
          expect(graph.projects.app.targets.test.cache).toBe(true);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });

  describe("the plugin's version", () => {
    it(
      "goes into the option pluginVersion of every target where Nx has no node for the package",
      async () => {
        const graph = await loadFixtureGraph("crate-shapes", { files: { "rust/deny.toml": "" } });

        for (const [task, target] of everyTarget(graph)) {
          expect({ task, version: target.options.pluginVersion }).toEqual({
            task,
            version: pluginVersion,
          });
        }
      },
      HARNESS_TIMEOUT,
    );

    // A root package.json and a pnpm lockfile that lists the plugin, which
    // Nx's JS plugin turns into npm nodes.
    const installed: FileChanges = {
      "package.json": JSON.stringify({
        name: "repo",
        private: true,
        devDependencies: { "@convesoft/nx-rust": pluginVersion, "left-pad": "1.3.0" },
      }),
      "pnpm-lock.yaml": pnpmLockfile(pluginVersion),
      // Nx refuses a pnpm lockfile without the file that pnpm's install writes.
      "node_modules/.modules.yaml": "{}\n",
    };

    it(
      "is the plugin's npm node where the JS lockfile lists the package",
      async () => {
        const graph = await loadFixtureGraph("subfolder-workspace", { files: installed });

        for (const [task, target] of everyTarget(graph)) {
          expect({ task, version: target.options.pluginVersion }).toEqual({
            task,
            version: undefined,
          });
        }
        // audit and update keep the inputs of DES-WORKSPACE-TARGETS.
        const withInputs = everyTarget(graph).filter(
          ([task]) => task !== "rust:audit" && task !== "rust:update",
        );
        for (const [task, target] of withInputs) {
          expect({ task, plugin: inputsOf(target, "externalDependencies") }).toEqual({
            task,
            plugin: [{ externalDependencies: ["@convesoft/nx-rust"] }],
          });
        }
        expect(graph.externalNodes).toHaveProperty(["npm:@convesoft/nx-rust"]);
      },
      HARNESS_TIMEOUT,
    );

    it.each<[string, FileChanges]>([
      [
        "Nx's lockfile analysis is off",
        {
          ...installed,
          "nx.json": (text) =>
            JSON.stringify({
              ...JSON.parse(text),
              pluginsConfig: { "@nx/js": { analyzeLockfile: false } },
            }),
        },
      ],
      [
        "the lockfile is ignored",
        { ...installed, ".gitignore": (text) => `${text}pnpm-lock.yaml\n` },
      ],
      [
        "the lockfile lists another package only",
        { ...installed, "pnpm-lock.yaml": pnpmLockfile(null) },
      ],
    ])(
      "is the option pluginVersion where %s",
      async (_case, files) => {
        const graph = await loadFixtureGraph("subfolder-workspace", { files });

        expect(graph.projects.api.targets.test.options.pluginVersion).toBe(pluginVersion);
        expect(inputsOf(graph.projects.api.targets.test, "externalDependencies")).toEqual([
          { externalDependencies: [] },
        ]);
      },
      HARNESS_TIMEOUT,
    );

    it("is read from each kind of lockfile that lists the package with a registry version", () => {
      const name = "@convesoft/nx-rust";
      expect(listsPackage("pnpm-lock.yaml", pnpmLockfile("1.2.3"), name)).toBe(true);
      expect(
        listsPackage("pnpm-lock.yaml", "packages:\n  /@convesoft/nx-rust@1.2.3:\n", name),
      ).toBe(true);
      expect(
        listsPackage("pnpm-lock.yaml", "packages:\n  /@convesoft/nx-rust/1.2.3:\n", name),
      ).toBe(true);
      expect(
        listsPackage(
          "pnpm-lock.yaml",
          "importers:\n  .:\n    devDependencies:\n      '@convesoft/nx-rust':\n        specifier: link:../nx-rust\n        version: link:../nx-rust\n",
          name,
        ),
      ).toBe(false);
      expect(
        listsPackage(
          "package-lock.json",
          JSON.stringify({ packages: { "node_modules/@convesoft/nx-rust": { version: "1.2.3" } } }),
          name,
        ),
      ).toBe(true);
      expect(
        listsPackage(
          "package-lock.json",
          JSON.stringify({
            packages: { "node_modules/@convesoft/nx-rust": { resolved: "nx-rust", link: true } },
          }),
          name,
        ),
      ).toBe(false);
      expect(
        listsPackage(
          "package-lock.json",
          JSON.stringify({ packages: { "node_modules/a/node_modules/@convesoft/nx-rust": {} } }),
          name,
        ),
      ).toBe(false);
      expect(
        listsPackage("yarn.lock", '"@convesoft/nx-rust@^1.2.3":\n  version "1.2.3"\n', name),
      ).toBe(true);
      expect(listsPackage("yarn.lock", '"@convesoft/nx-rust@npm:1.2.3":\n', name)).toBe(true);
      expect(listsPackage("yarn.lock", '"@convesoft/nx-rust@workspace:nx-rust":\n', name)).toBe(
        false,
      );
      expect(
        listsPackage("bun.lock", '"@convesoft/nx-rust": ["@convesoft/nx-rust@1.2.3"]', name),
      ).toBe(false);
    });
  });
});
