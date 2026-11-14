import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { enabledFeatures, nameRecords } from "../src/executors/build-records";
import type { BuildRecordSource } from "../src/graph/build-records";
import {
  applyFileChanges,
  Env,
  FileChanges,
  FixtureName,
  fixtureNames,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  inFixture,
  linesWith,
  loadFixtureGraph,
  LocalRegistry,
  pinnedToolchainAvailable,
  runNx,
  taskCalls,
  testEnvironment,
} from "./harness";

// Checks VER-BUILD-INPUT-CHECK apart from its batch paragraph, with real Nx
// runs of the plugin's executor and a real cargo, and that the check fails
// the build of no fixture whose crates read only files their inputs cover.
//
// In undeclared-files, reader's build script names shared/proto.txt and the
// folder shared/assets, and its library includes shared/banner.txt; multi's
// binary two includes shared/tool.txt, and three, which requires the
// feature extra, shared/extra.txt; macros (a proc macro) includes
// shared/macro.txt, plain (an rlib) shared/plain.txt, and the binaries cli
// of cola and colb shared/cli.txt. Nothing declares them.

/** The version of this repository's Nx. */
const nxVersion: string = JSON.parse(
  readFileSync(require.resolve("nx/package.json"), "utf8"),
).version;

/** The first line of the check's failure message, without the task. */
const failure = "cargo build read files in the repository that none of the task's inputs covers";

/** How Nx marks a task that it restored from the cache. */
const hit = String.raw`\[(local cache|existing outputs match the cache, left as is)\]`;

function restored(output: string, task: string): boolean {
  return new RegExp(`nx run ${task}\\s+${hit}`).test(output);
}

/** Runs Nx with static output, after forgetting the logged cargo calls. */
function nx(
  workspace: FixtureWorkspace,
  args: string[],
  env: Env = {},
): Promise<{ status: number | null; output: string }> {
  workspace.cargo.clear();
  return runNx(workspace, args, env);
}

/** The arguments of the cargo calls of tasks other than the lockfile task. */
function cargoCalls(workspace: FixtureWorkspace): string[] {
  return taskCalls(workspace).map((call) => call.args.join(" "));
}

/** The files that the failure message lists for a crate, as its lines show them. */
function listedFiles(output: string, crate: string): string[] {
  const lines = output.split("\n").map((line) => line.trim());
  const start = lines.indexOf(`The crate ${crate} read:`);
  if (start === -1) {
    return [];
  }
  const listed: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("- ")) {
      break;
    }
    listed.push(line.slice(2));
  }
  return listed;
}

/** The `fileInputs` line that the failure message shows. */
function shownLine(output: string): string | undefined {
  return /^\s*(fileInputs = \[.*\])\s*$/m.exec(output)?.[1];
}

/** A change that adds `lines` to a crate's `[package.metadata.nx]`, which it lacks. */
function crateTable(...lines: string[]): (manifest: string | undefined) => string {
  return (manifest = "") => `${manifest}\n[package.metadata.nx]\n${lines.join("\n")}\n`;
}

/** reader's own table declaring every file that it reads in the fixture. */
const readerDeclares: FileChanges = {
  "rust/crates/reader/Cargo.toml": crateTable(
    'fileInputs = ["../../../shared/proto.txt", "../../../shared/banner.txt", "../../../shared/assets/**"]',
  ),
};

/** A change to reader's library that also includes `path`, relative to `src`. */
function readerIncludes(path: string): FileChanges {
  return {
    "rust/crates/reader/src/lib.rs": (source = "") =>
      `${source}\npub fn more() -> &'static str {\n    include_str!(${JSON.stringify(path)})\n}\n`,
  };
}

/** The triple that rustc builds for by default here. */
function hostTriple(): string {
  const output = execFileSync("rustc", ["-vV"], { env: testEnvironment(), encoding: "utf8" });
  const host = /^host: (\S+)$/m.exec(output)?.[1];
  if (host === undefined) {
    throw new Error(`rustc -vV names no host:\n${output}`);
  }
  return host;
}

function read(workspace: FixtureWorkspace, path: string): string {
  return readFileSync(join(workspace.root, path), "utf8");
}

describe("the check of a build's dependency files", () => {
  // Every fixture but the one made to fail, and different-toolchains only
  // where its pinned toolchain is installed.
  const ordinary = fixtureNames.filter(
    (fixture) =>
      fixture !== "undeclared-files" &&
      (fixture !== "different-toolchains" || pinnedToolchainAvailable()),
  );

  // name-collision stops graph creation unless one of its crates gets
  // another project name.
  const renamed: Partial<Record<FixtureName, FileChanges>> = {
    "name-collision": { "tools/api/Cargo.toml": crateTable('name = "tools-api"') },
  };

  it.each(ordinary)(
    "fails no build of the fixture %s, whose crates read only files their inputs cover",
    async (fixture) => {
      await inFixture(fixture, renamed[fixture], async (workspace) => {
        const { status, output } = await nx(workspace, ["run-many", "-t", "build"]);
        expect(output).not.toContain(failure);
        expect(status).toBe(0);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives each crate's build, and no other target, what names the records of its library and binaries",
    async () => {
      const graph = await loadFixtureGraph("undeclared-files");
      const records = (project: string) => {
        const source = graph.projects[project].targets?.build?.metadata?.cargo?.records as
          | BuildRecordSource
          | undefined;
        return source === undefined
          ? undefined
          : {
              ...source,
              binaries: [...source.binaries].sort((a, b) => a.name.localeCompare(b.name)),
            };
      };
      expect(records("multi")).toEqual({
        library: { name: "multi", procMacro: false },
        binaries: [
          { name: "one", requiredFeatures: [] },
          { name: "three", requiredFeatures: ["extra"] },
          { name: "two", requiredFeatures: [] },
        ],
        features: { extra: [], full: ["extra"] },
        optionalDependencies: [],
        shared: [],
      });
      expect(records("macros")).toEqual({
        library: { name: "macros", procMacro: true },
        binaries: [],
        features: {},
        optionalDependencies: [],
        shared: [],
      });
      // The binaries of cola and colb share the name cli.
      expect(records("cola")).toMatchObject({
        library: { name: "cola", procMacro: false },
        binaries: [{ name: "cli", requiredFeatures: [] }],
        shared: ["cli.d"],
      });
      expect(records("colb")).toMatchObject({ binaries: [{ name: "cli" }], shared: ["cli.d"] });
      expect(records("colb")).not.toHaveProperty("library");
      const others = Object.entries(graph.projects).flatMap(([name, project]) =>
        Object.entries(project.targets ?? {})
          .filter(
            ([target, configuration]) =>
              target !== "build" && configuration.metadata?.cargo?.records !== undefined,
          )
          .map(([target]) => `${name}:${target}`),
      );
      expect(others).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a build that read undeclared files, runs and fails again, replays the failure with NX_CACHE_FAILURES, and passes with the line it shows",
    async () => {
      await inFixture("undeclared-files", undefined, async (workspace) => {
        const files = [
          "shared/assets/logo.txt, in the folder shared/assets, which cargo records as a whole",
          "shared/banner.txt",
          "shared/proto.txt",
        ];
        const line =
          'fileInputs = ["../../../shared/assets/logo.txt", "../../../shared/banner.txt", "../../../shared/proto.txt"]';
        const first = await nx(workspace, ["run", "reader:build"]);
        expect(first.status).not.toBe(0);
        expect(first.output).toContain(`reader:build: ${failure}`);
        expect(listedFiles(first.output, "reader")).toEqual(files);
        expect(first.output).toContain(
          "the [package.metadata.nx] table of rust/crates/reader/Cargo.toml",
        );
        expect(shownLine(first.output)).toBe(line);
        expect(first.output).toContain(
          'A pattern for the folder shared/assets, "../../../shared/assets/**", also covers the files that are added to it later.',
        );

        // Nothing is stored, so the next run builds again, compiling nothing.
        const second = await nx(workspace, ["run", "reader:build"]);
        expect(second.status).not.toBe(0);
        expect(cargoCalls(workspace)).toEqual(["build -p reader"]);
        expect(second.output).not.toContain("Compiling");
        expect(listedFiles(second.output, "reader")).toEqual(files);

        // With NX_CACHE_FAILURES, Nx stores the failure and replays it.
        const env = { NX_CACHE_FAILURES: "true" };
        const stored = await nx(workspace, ["run", "reader:build"], env);
        expect(stored.status).not.toBe(0);
        expect(cargoCalls(workspace)).toEqual(["build -p reader"]);
        const replayed = await nx(workspace, ["run", "reader:build"], env);
        expect(replayed.status).not.toBe(0);
        // Nx 24 marks no replayed failure as restored: cargo did not run.
        expect(cargoCalls(workspace)).toEqual([]);
        expect(listedFiles(replayed.output, "reader")).toEqual(files);

        // The line that the message shows covers the files and changes the key.
        applyFileChanges(workspace.root, { "rust/crates/reader/Cargo.toml": crateTable(line) });
        const declared = await nx(workspace, ["run", "reader:build"], env);
        expect(declared.output).not.toContain(failure);
        expect(declared.status).toBe(0);
        expect(cargoCalls(workspace)).toEqual(["build -p reader"]);
        const next = await nx(workspace, ["run", "reader:build"]);
        expect(next.status).toBe(0);
        expect(restored(next.output, "reader:build")).toBe(true);
        expect(cargoCalls(workspace)).toEqual([]);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "passes when the workspace table or a crate that the crate depends on declares the files",
    async () => {
      const declarations: FileChanges[] = [
        {
          "rust/Cargo.toml": (manifest = "") =>
            `${manifest}\n[workspace.metadata.nx]\nfileInputs = ["../shared/**"]\n`,
        },
        { "rust/crates/base/Cargo.toml": crateTable('fileInputs = ["../../../shared/**"]') },
      ];
      for (const declaration of declarations) {
        await inFixture("undeclared-files", declaration, async (workspace) => {
          const { status, output } = await nx(workspace, ["run", "reader:build"]);
          expect(output).not.toContain(failure);
          expect(status).toBe(0);
        });
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "finds an undeclared file with build.dep-info-basedir set, inside and outside the folder it names, and one whose name holds a space",
    async () => {
      // The folder holds the artifact directory, so the record names the
      // artifact relatively.
      await inFixture(
        "undeclared-files",
        {
          ...readerDeclares,
          ...readerIncludes("../../../../shared/with space.txt"),
          "shared/with space.txt": "spaced\n",
          "rust/.cargo/config.toml": '[build]\ndep-info-basedir = ".."\n',
        },
        async (workspace) => {
          const { status, output } = await nx(workspace, ["run", "reader:build"]);
          expect(status).not.toBe(0);
          expect(read(workspace, "rust/target/debug/libreader.d")).toContain(
            "shared/with\\ space.txt",
          );
          expect(read(workspace, "rust/target/debug/libreader.d")).not.toContain(workspace.root);
          expect(listedFiles(output, "reader")).toEqual(["shared/with space.txt"]);
          expect(shownLine(output)).toBe('fileInputs = ["../../../shared/with space.txt"]');
        },
      );
      // The folder lies beside the artifact directory, so the record names
      // the artifact absolutely and the crate's files relatively.
      await inFixture(
        "undeclared-files",
        {
          ...readerDeclares,
          ...readerIncludes("../../notes.txt"),
          "rust/crates/notes.txt": "notes\n",
          "rust/.cargo/config.toml": '[build]\ndep-info-basedir = "crates"\n',
        },
        async (workspace) => {
          const { status, output } = await nx(workspace, ["run", "reader:build"]);
          expect(status).not.toBe(0);
          expect(read(workspace, "rust/target/debug/libreader.d")).toMatch(/ notes\.txt( |$)/m);
          expect(listedFiles(output, "reader")).toEqual(["rust/crates/notes.txt"]);
          expect(shownLine(output)).toBe('fileInputs = ["../notes.txt"]');
        },
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails for a file reached through a symbolic link that only a wildcard for the link covers, and passes with the file or the link declared",
    async () => {
      const declaring = (pattern: string): FileChanges => ({
        ...readerIncludes("../../../../shared/alias.txt"),
        "shared/linked.txt": "linked\n",
        "rust/crates/reader/Cargo.toml": crateTable(
          `fileInputs = ["../../../shared/proto.txt", "../../../shared/banner.txt", "../../../shared/assets/**", ${JSON.stringify(pattern)}]`,
        ),
      });
      const linked = (workspace: FixtureWorkspace) =>
        symlinkSync("linked.txt", join(workspace.root, "shared", "alias.txt"));
      await inFixture(
        "undeclared-files",
        declaring("../../../shared/al*.txt"),
        async (workspace) => {
          linked(workspace);
          const { status, output } = await nx(workspace, ["run", "reader:build"]);
          expect(status).not.toBe(0);
          expect(listedFiles(output, "reader")).toEqual([
            "shared/linked.txt, through the symbolic link shared/alias.txt",
          ]);
          expect(shownLine(output)).toBe('fileInputs = ["../../../shared/linked.txt"]');
        },
      );
      for (const pattern of ["../../../shared/linked.txt", "../../../shared/alias.txt"]) {
        await inFixture("undeclared-files", declaring(pattern), async (workspace) => {
          linked(workspace);
          const { status, output } = await nx(workspace, ["run", "reader:build"]);
          expect(output).not.toContain(failure);
          expect(status).toBe(0);
        });
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails for a crate that is only an rlib, and for the one binary of two that read an undeclared file",
    async () => {
      await inFixture("undeclared-files", undefined, async (workspace) => {
        const plain = await nx(workspace, ["run", "plain:build"]);
        expect(plain.status).not.toBe(0);
        expect(listedFiles(plain.output, "plain")).toEqual(["shared/plain.txt"]);
        const multi = await nx(workspace, ["run", "multi:build"]);
        expect(multi.status).not.toBe(0);
        expect(listedFiles(multi.output, "multi")).toEqual(["shared/tool.txt"]);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "reads no record of a binary whose required feature is off, nor one that a build with another profile or triple left",
    async () => {
      await inFixture(
        "undeclared-files",
        { "rust/crates/multi/Cargo.toml": crateTable('fileInputs = ["../../../shared/tool.txt"]') },
        async (workspace) => {
          const extra = await nx(workspace, ["run", "multi:build", "--features=extra"]);
          expect(extra.status).not.toBe(0);
          expect(listedFiles(extra.output, "multi")).toEqual(["shared/extra.txt"]);
          const without = await nx(workspace, ["run", "multi:build"]);
          expect(without.output).not.toContain(failure);
          expect(without.status).toBe(0);
          expect(read(workspace, "rust/target/debug/three.d")).toContain("shared/extra.txt");
          // full turns extra on through the crate's features.
          const full = await nx(workspace, ["run", "multi:build", "--features=full"]);
          expect(full.status).not.toBe(0);
          expect(listedFiles(full.output, "multi")).toEqual(["shared/extra.txt"]);
        },
      );
      await inFixture("undeclared-files", undefined, async (workspace) => {
        const debug = await nx(workspace, ["run", "plain:build"]);
        expect(debug.status).not.toBe(0);
        // plain now reads a file of its own folder only.
        applyFileChanges(workspace.root, {
          "rust/crates/plain/src/data.txt": "data\n",
          "rust/crates/plain/src/lib.rs":
            'pub fn text() -> &\'static str {\n    include_str!("data.txt").trim_end()\n}\n',
        });
        for (const option of ["--profile=release", `--targetTriple=${hostTriple()}`]) {
          const { status, output } = await nx(workspace, ["run", "plain:build", option]);
          expect(output).not.toContain(failure);
          expect(status).toBe(0);
        }
        expect(read(workspace, "rust/target/debug/libplain.d")).toContain("shared/plain.txt");
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "checks a binary whose required feature names an optional dependency that a feature entry of it turns on, and no stale record where the weak form leaves it off",
    async () => {
      // The review's case: plain's binary requires the implicit feature of
      // its optional dependency base, and reads an undeclared file.
      const files: FileChanges = {
        "rust/crates/base/Cargo.toml": (manifest = "") => `${manifest}\n[features]\nx = []\n`,
        "rust/crates/plain/Cargo.toml": [
          "[package]",
          'name = "plain"',
          'version = "0.1.0"',
          'edition = "2024"',
          "",
          "[dependencies]",
          'base = { path = "../base", optional = true }',
          "",
          "[features]",
          'full = ["base/x"]',
          'weak = ["base?/x"]',
          "",
          "[[bin]]",
          'name = "feature-bin"',
          'path = "src/main.rs"',
          'required-features = ["base"]',
          "",
        ].join("\n"),
        "rust/crates/plain/src/lib.rs": "pub fn ok() {}\n",
        "rust/crates/plain/src/main.rs":
          'fn main() {\n    println!("{}", include_str!("../../../../shared/plain.txt"));\n}\n',
      };
      await inFixture("undeclared-files", files, async (workspace) => {
        for (const features of ["--features=full", "--features=base/x", "--features=base"]) {
          const { status, output } = await nx(workspace, [
            "run",
            "plain:build",
            features,
            "--skip-nx-cache",
          ]);
          expect({ features, status }).toEqual({ features, status: 1 });
          expect({ features, files: listedFiles(output, "plain") }).toEqual({
            features,
            files: ["shared/plain.txt"],
          });
        }
        // The record of the binary that cargo built before is still there.
        const weak = await nx(workspace, [
          "run",
          "plain:build",
          "--features=weak",
          "--skip-nx-cache",
        ]);
        expect(weak.output).not.toContain(failure);
        expect(weak.status).toBe(0);
        expect(read(workspace, "rust/target/debug/feature-bin.d")).toContain("shared/plain.txt");
      });
    },
    HARNESS_TIMEOUT,
  );

  it("turns on the crate's features as cargo resolves them", () => {
    // What cargo 1.100.0 and 1.91.0 built of p's binaries need-a (requires
    // a), need-b (b), need-chain3 (chain3) and need-full (full), with a, b
    // and c optional and only c hidden by dep:c, on 14 November 2026.
    const table = {
      a: ["dep:a"],
      b: ["dep:b"],
      chain1: ["chain2"],
      chain2: ["chain3"],
      chain3: [],
      deep: ["full"],
      default: ["chain1"],
      full: ["a/x"],
      viadep: ["dep:c"],
      weak: ["b?/x"],
    };
    const optional = ["a", "b", "c"];
    const binaries = ["a", "b", "chain3", "full"];
    const built = (selection: Parameters<typeof enabledFeatures>[2]) => {
      const enabled = enabledFeatures("p", table, selection, optional);
      return binaries.filter((required) => enabled.has(required));
    };
    expect(built({})).toEqual(["chain3"]);
    expect(built({ noDefaultFeatures: true })).toEqual([]);
    expect(built({ allFeatures: true })).toEqual(["a", "b", "chain3", "full"]);
    expect(built({ features: ["full"] })).toEqual(["a", "chain3", "full"]);
    expect(built({ features: ["a/x"] })).toEqual(["a", "chain3"]);
    expect(built({ features: ["a"] })).toEqual(["a", "chain3"]);
    expect(built({ features: ["weak"] })).toEqual(["chain3"]);
    expect(built({ features: ["b?/x"] })).toEqual(["chain3"]);
    expect(built({ features: ["weak,b"] })).toEqual(["b", "chain3"]);
    expect(built({ features: ["viadep"] })).toEqual(["chain3"]);
    expect(built({ features: ["deep"], noDefaultFeatures: true })).toEqual(["a", "full"]);
    expect(built({ features: ["p/full"] })).toEqual(["a", "chain3", "full"]);
    expect(built({ features: ["a?/x", "b"] })).toEqual(["b", "chain3"]);
    // A feature named after a dependency that is not optional stays off,
    // as cargo leaves it.
    expect(
      [...enabledFeatures("p", { a: [], full: ["a/x"] }, { features: ["full"] }, [])].sort(),
    ).toEqual(["full"]);
  });

  it(
    "fails for a proc macro without a triple, with the host triple, and with build.target in Cargo's configuration",
    async () => {
      const host = hostTriple();
      await inFixture("undeclared-files", undefined, async (workspace) => {
        for (const args of [[], [`--targetTriple=${host}`]]) {
          const { status, output } = await nx(workspace, ["run", "macros:build", ...args]);
          expect(status).not.toBe(0);
          expect(listedFiles(output, "macros")).toEqual(["shared/macro.txt"]);
        }
        applyFileChanges(workspace.root, {
          "rust/.cargo/config.toml": `[build]\ntarget = ${JSON.stringify(host)}\n`,
        });
        const configured = await nx(workspace, ["run", "macros:build"]);
        expect(configured.status).not.toBe(0);
        expect(listedFiles(configured.output, "macros")).toEqual(["shared/macro.txt"]);
        expect(
          existsSync(join(workspace.root, "rust", "target", host, "debug", "libmacros.d")),
        ).toBe(false);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "reads the records of a custom profile in its own folder, and those of test and bench where cargo writes them",
    async () => {
      await inFixture("undeclared-files", undefined, async (workspace) => {
        for (const profile of ["ctest", "cbench"]) {
          const { status, output } = await nx(workspace, [
            "run",
            "plain:build",
            `--profile=${profile}`,
          ]);
          expect(status).not.toBe(0);
          expect(listedFiles(output, "plain")).toEqual(["shared/plain.txt"]);
          expect(existsSync(join(workspace.root, "rust", "target", profile, "libplain.d"))).toBe(
            true,
          );
        }
        // build refuses test and bench, which put the artifacts in another
        // profile's folder; the names follow cargo all the same.
        const graph = await workspace.graph();
        const records = graph.projects.plain.targets?.build?.metadata?.cargo
          ?.records as BuildRecordSource;
        const artifacts = join(workspace.root, "rust", "target");
        for (const [profile, folder] of [
          ["test", "debug"],
          ["bench", "release"],
        ]) {
          rmSync(artifacts, { recursive: true, force: true });
          execFileSync("cargo", ["build", "-p", "plain", "--profile", profile], {
            cwd: join(workspace.root, "rust"),
            env: testEnvironment(),
            stdio: "pipe",
          });
          const named = nameRecords(
            records,
            "plain",
            { profile },
            {},
            artifacts,
            join(workspace.root, "rust"),
          );
          expect(named).toEqual([
            { path: join(artifacts, folder, "libplain.d"), kind: "library", target: "plain" },
          ]);
          expect(existsSync(named[0].path)).toBe(true);
        }
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "passes for a crate that became a proc macro reading declared files, although the record of its earlier kind names an undeclared one",
    async () => {
      const host = hostTriple();
      await inFixture("undeclared-files", undefined, async (workspace) => {
        const rlib = await nx(workspace, ["run", "plain:build", `--targetTriple=${host}`]);
        expect(rlib.status).not.toBe(0);
        expect(listedFiles(rlib.output, "plain")).toEqual(["shared/plain.txt"]);
        applyFileChanges(workspace.root, {
          "rust/crates/plain/Cargo.toml": (manifest = "") =>
            manifest.replace('crate-type = ["rlib"]', "proc-macro = true"),
          "rust/crates/plain/src/data.txt": "data\n",
          "rust/crates/plain/src/lib.rs": [
            "use proc_macro::TokenStream;",
            "",
            "#[proc_macro]",
            "pub fn text(_input: TokenStream) -> TokenStream {",
            '    format!("{:?}", include_str!("data.txt").trim_end())',
            "        .parse()",
            "        .unwrap()",
            "}",
            "",
          ].join("\n"),
        });
        const procMacro = await nx(workspace, ["run", "plain:build", `--targetTriple=${host}`]);
        expect(procMacro.output).not.toContain(failure);
        expect(procMacro.status).toBe(0);
        expect(read(workspace, `rust/target/${host}/debug/libplain.d`)).toContain(
          "shared/plain.txt",
        );
      });
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, FileChanges, Record<string, string>]>([
    ["CARGO_BUILD_TARGET in the environment of the nx command", {}, { CARGO_BUILD_TARGET: "HOST" }],
    ["build.target in Cargo's configuration", { "rust/.cargo/config.toml": "HOST" }, {}],
  ])(
    "fails a cached build whose record in the folder of the triple that %s picks names an undeclared file",
    async (_case, files, variables) => {
      const host = hostTriple();
      const changes: FileChanges = Object.fromEntries(
        Object.entries(files).map(([path]) => [
          path,
          `[build]\ntarget = ${JSON.stringify(host)}\n`,
        ]),
      );
      const env = Object.fromEntries(Object.entries(variables).map(([name]) => [name, host]));
      await inFixture("undeclared-files", changes, async (workspace) => {
        const graph = await workspace.graph(env);
        expect(graph.projects.plain.targets?.build?.cache).toBe(true);
        const { status, output } = await nx(workspace, ["run", "plain:build"], env);
        expect(status).not.toBe(0);
        expect(listedFiles(output, "plain")).toEqual(["shared/plain.txt"]);
        expect(
          existsSync(join(workspace.root, "rust", "target", host, "debug", "libplain.d")),
        ).toBe(true);
        expect(existsSync(join(workspace.root, "rust", "target", "debug", "libplain.d"))).toBe(
          false,
        );
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "skips records that a triple without a name may have sent to a triple's folder",
    async () => {
      const host = hostTriple();
      await inFixture(
        "undeclared-files",
        { "rust/.cargo/config.toml": '[build]\ntarget = "host-tuple"\n' },
        async (workspace) => {
          const configured = await nx(workspace, ["run", "plain:build"]);
          expect(configured.output).not.toContain(failure);
          expect(configured.status).toBe(0);
          expect(
            existsSync(join(workspace.root, "rust", "target", host, "debug", "libplain.d")),
          ).toBe(true);
          rmSync(join(workspace.root, "rust", ".cargo"), { recursive: true });
          rmSync(join(workspace.root, "rust", "target", host), { recursive: true });
          const plain = await nx(workspace, ["run", "plain:build"]);
          expect(plain.status).not.toBe(0);
          expect(listedFiles(plain.output, "plain")).toEqual(["shared/plain.txt"]);
        },
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "reads no record whose name binaries of two crates share, and still the library's record of either",
    async () => {
      await inFixture("undeclared-files", undefined, async (workspace) => {
        const both = await nx(workspace, ["run-many", "-t", "build", "-p", "cola", "colb"]);
        expect(both.output).not.toContain(failure);
        expect(both.status).toBe(0);
        applyFileChanges(workspace.root, {
          "shared/cola.txt": "cola\n",
          "rust/crates/cola/src/lib.rs":
            'pub fn name() -> &\'static str {\n    include_str!("../../../../shared/cola.txt").trim_end()\n}\n',
        });
        const cola = await nx(workspace, ["run", "cola:build"]);
        expect(cola.status).not.toBe(0);
        expect(listedFiles(cola.output, "cola")).toEqual(["shared/cola.txt"]);
        const colb = await nx(workspace, ["run", "colb:build"]);
        expect(colb.output).not.toContain(failure);
        expect(colb.status).toBe(0);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails nothing for a file generated in OUT_DIR, a path outside the repository and a vendored registry crate",
    async () => {
      const registry = LocalRegistry.create([
        {
          name: "greet",
          version: "0.1.0",
          source: 'pub fn greet() -> &\'static str {\n    "hello"\n}\n',
        },
      ]);
      try {
        await inFixture(
          "undeclared-files",
          {
            "rust/crates/reader/Cargo.toml": (manifest = "") =>
              crateTable(
                'fileInputs = ["../../../shared/proto.txt", "../../../shared/banner.txt", "../../../shared/assets/**"]',
              )(manifest.replace("[dependencies]\n", '[dependencies]\ngreet = "0.1"\n')),
            "rust/crates/reader/build.rs": (source = "") =>
              source.replace(
                'println!("cargo::rerun-if-changed=build.rs");',
                'println!("cargo::rerun-if-changed=build.rs");\n    println!("cargo::rerun-if-changed=../../../../outside.txt");',
              ),
            "rust/crates/reader/src/lib.rs": (source = "") =>
              `${source}\npub fn greeting() -> &'static str {\n    greet::greet()\n}\n`,
          },
          async (workspace) => {
            const outside = join(workspace.root, "..", "outside.txt");
            writeFileSync(outside, "outside\n");
            const env = { CARGO_HOME: registry.cargoHome };
            const tables = execFileSync("cargo", ["vendor", "--respect-source-config", "vendor"], {
              cwd: join(workspace.root, "rust"),
              env: testEnvironment(env),
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
            });
            applyFileChanges(workspace.root, { "rust/.cargo/config.toml": tables });
            const { status, output } = await nx(workspace, ["run", "reader:build"], env);
            expect(output).not.toContain(failure);
            expect(status).toBe(0);
            const record = read(workspace, "rust/target/debug/libreader.d");
            expect(record).toContain("outside.txt");
            expect(record).toMatch(/\/out\/lines\.rs/);
            expect(record).not.toContain("vendor");
          },
        );
      } finally {
        registry.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // The graph names the workspace's usual build directory; the task's cargo
  // uses the one that the dotenv file names (EVD-NX-24-MOVED-ARTIFACT-DIRS).
  it(
    "leaves out a file generated in OUT_DIR in the build directory that a dotenv file of the task names",
    async () => {
      await inFixture(
        "undeclared-files",
        {
          ...readerDeclares,
          ".gitignore": (text = "") => `${text}.env\n/rust/bd/\n`,
          "rust/crates/reader/.env": "CARGO_BUILD_BUILD_DIR=bd\n",
        },
        async (workspace) => {
          const { status, output } = await nx(workspace, ["run", "reader:build"]);
          expect(output).not.toContain(failure);
          expect(status).toBe(0);
          expect(cargoCalls(workspace)).toEqual(["build -p reader"]);
          expect(read(workspace, "rust/target/debug/libreader.d")).toMatch(
            /\/rust\/bd\/\S*\/out\/lines\.rs/,
          );
        },
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "skips Cargo's directories and what Nx ignores in a recorded folder that holds them, and fails for an undeclared file elsewhere in it",
    async () => {
      await inFixture(
        "undeclared-files",
        {
          // Nx then sees the artifact directory, which the check has to skip itself.
          ".gitignore": null,
          "rust/node_modules/pkg/index.js": "module.exports = 1;\n",
          "rust/crates/reader/build.rs": (source = "") =>
            source.replace(
              'println!("cargo::rerun-if-changed=build.rs");',
              'println!("cargo::rerun-if-changed=build.rs");\n    println!("cargo::rerun-if-changed=../..");',
            ),
          // Everything else in rust/: the lockfile and the crates that reader
          // does not depend on, each by its folder, which Nx matches against
          // that project's files.
          "rust/crates/reader/Cargo.toml": crateTable(
            `fileInputs = ${JSON.stringify([
              "../../../shared/**",
              "../../Cargo.lock",
              ...["cola", "colb", "macros", "multi", "plain"].map((crate) => `../${crate}/**`),
            ])}`,
          ),
        },
        async (workspace) => {
          const clean = await nx(workspace, ["run", "reader:build"]);
          expect(clean.output).not.toContain(failure);
          expect(clean.status).toBe(0);
          expect(read(workspace, "rust/target/debug/libreader.d")).toContain("crates/reader/../..");
          // The new file is no input, so the key stays the same and Nx would
          // restore the result: the folder's pattern is what covers it.
          writeFileSync(join(workspace.root, "rust", "notes.txt"), "notes\n");
          const notes = await nx(workspace, ["run", "reader:build", "--skip-nx-cache"]);
          expect(notes.status).not.toBe(0);
          expect(listedFiles(notes.output, "reader")).toEqual([
            "rust/notes.txt, in the folder rust, which cargo records as a whole",
          ]);
          expect(notes.output).toContain('A pattern for the folder rust, "../../**"');
        },
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "skips the check with one warning line where the installed Nx lacks HashPlanInspector, and caches the result",
    async () => {
      await inFixture("undeclared-files", undefined, async (workspace) => {
        // A copy of this repository's Nx whose module of the class exports
        // nothing; nx run itself does not load it.
        workspace.useNx(nxVersion);
        const copy = realpathSync(join(workspace.root, "node_modules", "nx"));
        const module = join(copy, "dist", "src", "hasher", "hash-plan-inspector.js");
        // The file is a hard link to the real one: replace it, never write through it.
        rmSync(module);
        writeFileSync(
          module,
          '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n',
        );
        const first = await nx(workspace, ["run", "reader:build"]);
        expect(first.output).not.toContain(failure);
        expect(first.status).toBe(0);
        expect(
          linesWith(first.output, "the build input check did not run").map((line) => line.trim()),
        ).toEqual([
          "nx-rust: reader:build: the build input check did not run, because the installed Nx lacks HashPlanInspector in nx/src/hasher/hash-plan-inspector, so Nx caches the result without it. Use an Nx version that @convesoft/nx-rust supports, or a version of @convesoft/nx-rust that supports the installed one.",
        ]);
        const next = await nx(workspace, ["run", "reader:build"]);
        expect(next.status).toBe(0);
        expect(restored(next.output, "reader:build")).toBe(true);
        expect(cargoCalls(workspace)).toEqual([]);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leaves check, lint and test alone while the files are undeclared",
    async () => {
      await inFixture("undeclared-files", undefined, async (workspace) => {
        const { status, output } = await nx(workspace, [
          "run-many",
          "-t",
          "check",
          "lint",
          "test",
          "-p",
          "reader",
        ]);
        expect(output).not.toContain(failure);
        expect(status).toBe(0);
      });
    },
    HARNESS_TIMEOUT,
  );
});
