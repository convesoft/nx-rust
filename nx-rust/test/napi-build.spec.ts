import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { platformArchAbi } from "../src/graph/napi";
import {
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  hackCrateFiles,
  hakariConfiguration,
  packageSpec,
  pathWith,
  runNx,
  StubHakari,
  taskCalls,
  testEnvironment,
  workspaceArgs,
} from "./harness";

// The napi parts of VER-ARTIFACTS, VER-TARGETS and VER-CONFIGURATION, with a
// real cargo, the real @napi-rs/cli of this repository's devDependencies and
// real Nx. In napi-addons, the rust/ workspace has the addons addon-a and
// addon-b, cdylib crates with a build script that calls napi_build::setup()
// and a package.json whose napi setting binaryName names the addon; addon-a
// re-exports core-napi, a library with a #[napi] function, on which the
// ordinary library consumer depends too; plain-cdylib is a cdylib without
// napi. The crates.io packages come from a local registry in the fixture, so
// that cargo needs no network.

/** The folder of the napi CLI that this repository installs. */
const napiCli = realpathSync(dirname(require.resolve("@napi-rs/cli/package.json")));

/** The host's triple, as `rustc -vV` names it. */
const host = /^host: (\S+)$/m.exec(
  execFileSync("rustc", ["-vV"], { env: testEnvironment(), encoding: "utf8" }),
)?.[1] as string;

/** The addon file of `binaryName` on the host. */
const addonFile = (binaryName: string) => `${binaryName}.${platformArchAbi(host)}.node`;

const addonA = "rust/crates/addon-a";
const addonB = "rust/crates/addon-b";

/** Copies the fixture and links the napi CLI into its node_modules. */
function create(...files: (FileChanges | undefined)[]): FixtureWorkspace {
  const workspace = FixtureWorkspace.create("napi-addons", ...files);
  linkCli(workspace);
  return workspace;
}

function linkCli(workspace: FixtureWorkspace, cli = napiCli): void {
  const folder = join(workspace.root, "node_modules", "@napi-rs");
  mkdirSync(folder, { recursive: true });
  symlinkSync(cli, join(folder, "cli"), "dir");
}

function read(workspace: FixtureWorkspace, path: string): string {
  return readFileSync(join(workspace.root, path), "utf8");
}

/** Runs Nx after forgetting the logged cargo calls. */
async function nx(workspace: FixtureWorkspace, args: string[], env: Record<string, string> = {}) {
  workspace.cargo.clear();
  return runNx(workspace, args, env);
}

/** What Node gets from calling `expression` on the addon loaded through the crate's index.js. */
function call(workspace: FixtureWorkspace, crate: string, expression: string): string {
  return execFileSync(
    process.execPath,
    [
      "-e",
      `const m = require(${JSON.stringify(join(workspace.root, crate, "index.js"))}); console.log(JSON.stringify(${expression}))`,
    ],
    { encoding: "utf8" },
  ).trim();
}

/** Fails with the output where Nx failed. */
function expectSuccess(run: { status: number | null; output: string }): void {
  expect({ status: run.status, output: run.status === 0 ? "" : run.output }).toEqual({
    status: 0,
    output: "",
  });
}

/** How Nx marks a task that it restored from the cache. */
const hit = String.raw`\[(local cache|existing outputs match the cache, left as is)\]`;
const restored = (output: string, task: string) =>
  new RegExp(`nx run ${task}\\s+${hit}`).test(output);

describe("napi-build", () => {
  it(
    "exists on the addon crates only, unless artifacts says otherwise, with the addon's files as outputs and no inputs, and can be renamed",
    async () => {
      const workspace = create({
        "rust/crates/addon-b/Cargo.toml": (text) =>
          `${text}\n[package.metadata.nx]\nartifacts = []\n`,
        "rust/crates/plain-cdylib/Cargo.toml": (text) =>
          `${text}\n[package.metadata.nx]\nartifacts = ["napi"]\n`,
      });
      try {
        const { projects } = await workspace.graph();
        const withTarget = Object.keys(projects)
          .filter((name) => projects[name].targets?.["napi-build"] !== undefined)
          .sort();
        expect(withTarget).toEqual(["addon-a", "plain-cdylib"]);
        const target = projects["addon-a"].targets?.["napi-build"];
        expect(target).toMatchObject({
          executor: "@convesoft/nx-rust:cargo-outputs",
          cache: true,
          outputs: [
            `{projectRoot}/${addonFile("addon-a")}`,
            "{projectRoot}/index.js",
            "{projectRoot}/index.d.ts",
          ],
          dependsOn: [expect.objectContaining({ target: "lockfile" })],
        });
        expect(target?.configurations).toEqual({ "all-features": { allFeatures: true } });
        expect(target?.inputs).toEqual(
          expect.arrayContaining([
            { env: "npm_new_version" },
            { env: "RUSTFLAGS" },
            { runtime: expect.stringContaining("print-napi-cli.js") },
          ]),
        );
        expect(projects["addon-a"].namedInputs?.default).toEqual(
          expect.arrayContaining([
            `!{projectRoot}/${addonFile("addon-a")}`,
            "!{projectRoot}/index.js",
            "!{projectRoot}/index.d.ts",
          ]),
        );
        expect(projects["shared"].namedInputs?.default).not.toContain("!{projectRoot}/index.js");

        workspace.reset({
          "nx.json": (text) => {
            const config = JSON.parse(text ?? "{}");
            const [entry] = config.plugins;
            const plugin = typeof entry === "string" ? entry : entry.plugin;
            config.plugins = [{ plugin, options: { targetNames: { "napi-build": "addon" } } }];
            return JSON.stringify(config);
          },
        });
        const renamed = (await workspace.graph()).projects;
        expect(renamed["addon-a"].targets?.addon?.metadata?.cargo.target).toBe("napi-build");
        expect(renamed["addon-a"].targets?.["napi-build"]).toBeUndefined();
        expect(renamed["shared"].targets?.addon).toBeUndefined();
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "builds two addons in one batch, one cargo build for both, into the files that napi build --platform writes, which Node loads and Nx restores",
    async () => {
      const workspace = create();
      const reference = create();
      try {
        const run = await nx(workspace, ["run-many", "-t", "napi-build"]);
        expectSuccess(run);
        expect(
          taskCalls(workspace)
            .filter((c) => c.args[0] === "build")
            .map((c) => c.args),
        ).toEqual([workspaceArgs("build")]);
        for (const [crate, name] of [
          [addonA, "addon-a"],
          [addonB, "addon-b"],
        ]) {
          expect(existsSync(join(workspace.root, crate, addonFile(name)))).toBe(true);
          // napi build of the CLI itself, in a copy of its own.
          const cli = spawnSync(
            process.execPath,
            [join(napiCli, "dist", "cli.js"), "build", "--platform"],
            { cwd: join(reference.root, crate), env: testEnvironment(), encoding: "utf8" },
          );
          expect({ status: cli.status, stderr: cli.status === 0 ? "" : cli.stderr }).toEqual({
            status: 0,
            stderr: "",
          });
          for (const file of ["index.js", "index.d.ts"]) {
            expect({ crate, file, text: read(workspace, `${crate}/${file}`) }).toEqual({
              crate,
              file,
              text: read(reference, `${crate}/${file}`),
            });
          }
        }
        // The dependency's items, and not the other addon's.
        expect(read(workspace, `${addonA}/index.d.ts`)).toContain("coreFn");
        expect(read(workspace, `${addonA}/index.d.ts`)).not.toContain("sumB");
        expect(read(workspace, `${addonB}/index.d.ts`)).not.toContain("coreFn");
        expect(call(workspace, addonA, "[m.sumA(2, 1), m.coreFn(1)]")).toBe("[5,2]");
        expect(call(workspace, addonB, "m.sumB(3, 1)")).toBe("7");

        // A file changed by hand changes no key and comes back from the cache.
        const before = await workspace.hashTasks(["addon-a:napi-build"]);
        writeFileSync(join(workspace.root, addonA, "index.d.ts"), "changed\n");
        const after = await workspace.hashTasks(["addon-a:napi-build"]);
        expect(after["addon-a:napi-build"].value).toBe(before["addon-a:napi-build"].value);
        const again = await nx(workspace, ["run-many", "-t", "napi-build"]);
        expectSuccess(again);
        expect(restored(again.output, "addon-a:napi-build")).toBe(true);
        expect(read(workspace, `${addonA}/index.d.ts`)).toContain("coreFn");
        expect(taskCalls(workspace).filter((c) => c.args[0] === "build")).toEqual([]);
      } finally {
        workspace.remove();
        reference.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );

  it(
    "runs the build of the workspace and its napi-build in groups of their own, one after the other",
    async () => {
      const workspace = create();
      try {
        const run = await nx(workspace, ["run-many", "-t", "build", "napi-build"]);
        expectSuccess(run);
        expect(
          taskCalls(workspace)
            .filter((c) => c.args[0] === "build")
            .map((c) => c.args),
        ).toEqual([workspaceArgs("build"), workspaceArgs("build")]);
        expect(call(workspace, addonA, "m.sumA(2, 1)")).toBe("5");
        expect(
          existsSync(
            join(
              workspace.root,
              `rust/target/debug/libaddon_b.${process.platform === "darwin" ? "dylib" : "so"}`,
            ),
          ),
        ).toBe(true);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "writes the declarations right again after another feature set and after plain cargo renamed an export, and declares the library's items where it has no task",
    async () => {
      const workspace = create();
      try {
        const extra = await nx(workspace, ["run", "addon-a:napi-build", "-c", "all-features"]);
        expectSuccess(extra);
        expect(read(workspace, `${addonA}/index.d.ts`)).toContain("extraA");
        const plain = await nx(workspace, ["run", "addon-a:napi-build"]);
        expectSuccess(plain);
        expect(read(workspace, `${addonA}/index.d.ts`)).not.toContain("extraA");
        expect(read(workspace, `${addonA}/index.d.ts`)).toContain("coreFn");

        const source = join(workspace.root, "rust/crates/core-napi/src/lib.rs");
        writeFileSync(source, readFileSync(source, "utf8").replace("core_fn", "core_renamed"));
        writeFileSync(
          join(workspace.root, "rust/crates/consumer/src/lib.rs"),
          "pub fn consume(value: i32) -> i32 {\n    core_napi::core_renamed(value)\n}\n",
        );
        execFileSync("cargo", ["build", "--workspace"], {
          cwd: join(workspace.root, "rust"),
          env: testEnvironment(),
          stdio: "ignore",
        });
        const renamed = await nx(workspace, ["run", "addon-a:napi-build"]);
        expectSuccess(renamed);
        const types = read(workspace, `${addonA}/index.d.ts`);
        expect(types).toContain("coreRenamed");
        expect(types).not.toContain("coreFn");
        expect(call(workspace, addonA, "m.coreRenamed(1)")).toBe("2");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );

  it.each([
    ["CARGO_BUILD_TARGET", true],
    ["build.target in Cargo's configuration", false],
  ])(
    "copies the library that cargo reports where %s selects the host triple",
    async (_how, variable) => {
      const workspace = create();
      try {
        const env: Record<string, string> = variable ? { CARGO_BUILD_TARGET: host } : {};
        // A library in the profile's folder without a triple, as plain cargo leaves it.
        execFileSync("cargo", ["build", "--workspace"], {
          cwd: join(workspace.root, "rust"),
          env: testEnvironment({ CARGO_BUILD_TARGET: undefined }),
          stdio: "ignore",
        });
        if (!variable) {
          const config = join(workspace.root, "rust/.cargo/config.toml");
          writeFileSync(config, `${readFileSync(config, "utf8")}\n[build]\ntarget = "${host}"\n`);
        }
        const source = join(workspace.root, addonA, "src/lib.rs");
        writeFileSync(
          source,
          readFileSync(source, "utf8").replace(
            "shared::double(a) + b",
            "shared::double(a) + b + 100",
          ),
        );
        const run = await nx(workspace, ["run", "addon-a:napi-build"], env);
        expectSuccess(run);
        expect(call(workspace, addonA, "m.sumA(2, 1)")).toBe("105");
        expect(
          taskCalls(workspace)
            .filter((c) => c.args[0] === "build")
            .map((c) => c.args),
        ).toEqual([workspaceArgs("build")]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "keys on the header file of the type definitions and refuses one outside the repository",
    async () => {
      const header = (file: string): FileChanges => ({
        "rust/crates/addon-a/package.json": (text) => {
          const json = JSON.parse(text ?? "{}");
          json.napi.dtsHeaderFile = file;
          return JSON.stringify(json, null, 2);
        },
      });
      const workspace = create(header("../../../types/header.d.ts"), {
        "types/header.d.ts": "// first header\n",
      });
      try {
        const { projects } = await workspace.graph();
        expect(projects["addon-a"].targets?.["napi-build"].inputs).toContainEqual({
          fileset: "{workspaceRoot}/types/header.d.ts",
          includeIgnored: true,
        });
        const first = await workspace.hashTasks(["addon-a:napi-build"]);
        writeFileSync(join(workspace.root, "types/header.d.ts"), "// second header\n");
        const second = await workspace.hashTasks(["addon-a:napi-build"]);
        expect(second["addon-a:napi-build"].value).not.toBe(first["addon-a:napi-build"].value);
        const run = await nx(workspace, ["run", "addon-a:napi-build"]);
        expectSuccess(run);
        expect(read(workspace, `${addonA}/index.d.ts`)).toMatch(/^\/\/ second header/);

        workspace.reset(header("../../../../outside.d.ts"));
        linkCli(workspace);
        const outside = await nx(workspace, ["run", "addon-a:napi-build"]);
        expect(outside.status).not.toBe(0);
        expect(outside.output).toContain(
          `addon-a:napi-build: the napi settings in the package.json of addon-a name the dtsHeaderFile ${join(workspace.root, "..", "outside.d.ts")}, which lies outside the repository`,
        );
        expect(taskCalls(workspace).filter((c) => c.args[0] === "build")).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails where the library's last #[napi] item is gone, naming the library",
    async () => {
      const workspace = create({
        "rust/crates/core-napi/src/lib.rs":
          "pub fn core_fn(value: i32) -> i32 {\n    value + 1\n}\n",
      });
      try {
        const run = await nx(workspace, ["run", "addon-a:napi-build", "--skip-nx-cache"]);
        expect(run.status).not.toBe(0);
        expect(run.output).toContain(
          "addon-a:napi-build: core-napi, which the addon is or depends on, uses napi-derive but wrote no type information",
        );
        expect(existsSync(join(workspace.root, addonA, "index.d.ts"))).toBe(false);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails where a library's build script does not call napi_build::setup(), naming the library",
    async () => {
      const workspace = create({
        "rust/crates/helper/Cargo.toml":
          '[package]\nname = "helper"\nversion = "0.1.0"\nedition.workspace = true\nrust-version.workspace = true\n\n[dependencies]\nnapi.workspace = true\nnapi-derive.workspace = true\n\n[build-dependencies]\nnapi-build.workspace = true\n',
        "rust/crates/helper/build.rs": "fn main() {}\n",
        "rust/crates/helper/src/lib.rs":
          "use napi_derive::napi;\n\n#[napi]\npub fn helper_fn() -> i32 {\n    3\n}\n",
        "rust/crates/addon-b/Cargo.toml": (text) =>
          `${text}`.replace(
            'shared = { path = "../shared" }',
            'shared = { path = "../shared" }\nhelper = { path = "../helper" }',
          ),
        "rust/crates/addon-b/src/lib.rs": (text) => `${text}\npub use helper::*;\n`,
      });
      try {
        // The first compile builds the helper, which writes its file once.
        const first = await nx(workspace, ["run", "addon-b:napi-build", "--skip-nx-cache"]);
        expectSuccess(first);
        expect(read(workspace, `${addonB}/index.d.ts`)).toContain("helperFn");
        // Forcing does not reach it after that.
        const second = await nx(workspace, ["run", "addon-b:napi-build", "--skip-nx-cache"]);
        expect(second.status).not.toBe(0);
        expect(second.output).toContain(
          "addon-b:napi-build: helper, which the addon is or depends on, uses napi-derive but wrote no type information",
        );
        expect(second.output).toContain("does not run napi_build::setup()");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails both addons before cargo where they have one [lib] name",
    async () => {
      const workspace = create({
        "rust/crates/addon-b/Cargo.toml": (text) =>
          `${text}`.replace('crate-type = ["cdylib"]', 'name = "addon_a"\ncrate-type = ["cdylib"]'),
      });
      try {
        const run = await nx(workspace, ["run-many", "-t", "napi-build"]);
        expect(run.status).not.toBe(0);
        for (const [task, other] of [
          ["addon-a:napi-build", "addon-b"],
          ["addon-b:napi-build", "addon-a"],
        ]) {
          expect(run.output).toContain(`${task}: the library of`);
          expect(run.output).toMatch(
            new RegExp(`${task}: [^\\n]*libaddon_a\\.so, which ${other} in`),
          );
        }
        expect(
          taskCalls(workspace).filter((c) => c.args[0] === "build" || c.args[0] === "tree"),
        ).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leaves plain cargo to compile again only the napi crates and what depends on them",
    async () => {
      const workspace = create();
      try {
        const rust = join(workspace.root, "rust");
        const env = testEnvironment();
        execFileSync("cargo", ["build", "--workspace"], { cwd: rust, env, stdio: "ignore" });
        expectSuccess(await nx(workspace, ["run-many", "-t", "napi-build"]));
        const json = execFileSync("cargo", ["build", "--workspace", "--message-format=json"], {
          cwd: rust,
          env,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const compiled = json
          .split("\n")
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line))
          .filter((message) => message.reason === "compiler-artifact" && message.fresh === false)
          .map((message) => message.target.name as string)
          .sort();
        expect([...new Set(compiled)]).toEqual(["addon_a", "addon_b", "consumer", "core_napi"]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails before cargo without a supported @napi-rs/cli, for napi-derive 2 and for another triple",
    async () => {
      const workspace = FixtureWorkspace.create("napi-addons");
      try {
        const missing = await nx(workspace, ["run", "addon-a:napi-build"]);
        expect(missing.status).not.toBe(0);
        expect(missing.output).toContain(
          "addon-a:napi-build: The napi CLI is not installed, but the napi-build target of the crate addon-a needs it.",
        );
        // A CLI of an older release.
        const old = join(workspace.root, "..", "old-cli");
        mkdirSync(old, { recursive: true });
        writeFileSync(
          join(old, "package.json"),
          JSON.stringify({ name: "@napi-rs/cli", version: "3.3.0", main: "index.js" }),
        );
        linkCli(workspace, old);
        const older = await nx(workspace, ["run", "addon-a:napi-build"]);
        expect(older.status).not.toBe(0);
        expect(older.output).toContain(
          "addon-a:napi-build: the installed @napi-rs/cli is 3.3.0, but",
        );
        expect(taskCalls(workspace).filter((c) => c.args[0] === "build")).toEqual([]);

        workspace.reset({
          "third_party/napi-derive/Cargo.toml":
            '[package]\nname = "napi-derive"\nversion = "2.16.13"\nedition = "2021"\n\n[lib]\nproc-macro = true\n\n[workspace]\n',
          "third_party/napi-derive/src/lib.rs": "",
          "rust/crates/old-addon/Cargo.toml":
            '[package]\nname = "old-addon"\nversion = "0.1.0"\nedition.workspace = true\nrust-version.workspace = true\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\nnapi.workspace = true\nnapi-derive = { path = "../../../third_party/napi-derive" }\n',
          "rust/crates/old-addon/package.json": JSON.stringify({
            name: "old-addon",
            version: "0.1.0",
          }),
          "rust/crates/old-addon/src/lib.rs": "",
        });
        linkCli(workspace);
        const derive = await nx(workspace, ["run", "old-addon:napi-build"]);
        expect(derive.status).not.toBe(0);
        expect(derive.output).toContain(
          "old-addon:napi-build: old-addon depends on napi-derive 2.16.13, but napi-build builds Node addons of napi-rs 3",
        );

        const triple = await nx(workspace, ["run", "addon-a:napi-build"], {
          CARGO_BUILD_TARGET: "wasm32-unknown-unknown",
        });
        expect(triple.status).not.toBe(0);
        expect(triple.output).toContain(
          `addon-a:napi-build: napi-build builds Node addons for the host, ${host}, only`,
        );
        expect(taskCalls(workspace).filter((c) => c.args[0] === "build")).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );
});

describe("a JS project that consumes the addon", () => {
  /** addon-a enrolled as the package @napi/addon-a, and web, which depends on its napi-build. */
  const consumer = (input: boolean): FileChanges => ({
    "package.json": JSON.stringify({ name: "napi-root", private: true }),
    "pnpm-workspace.yaml": "packages:\n  - rust/crates/addon-a\n  - apps/*\n",
    "apps/web/index.js": "module.exports = 1;\n",
    "apps/web/package.json": JSON.stringify({
      name: "web",
      private: true,
      dependencies: { "@napi/addon-a": "workspace:*" },
      nx: {
        targets: {
          build: {
            command: "echo web",
            cache: true,
            dependsOn: [{ projects: ["@napi/addon-a"], target: "napi-build" }],
            inputs: [
              "default",
              "^default",
              ...(input ? [{ dependentTasksOutputFiles: "**/*" }] : []),
            ],
          },
        },
      },
    }),
  });

  it.each([
    [true, false],
    [false, true],
  ])(
    "with the artifact's files as an input (%s), is restored after a change of RUSTFLAGS alone: %s",
    async (input, hitAfterFlags) => {
      const workspace = create(consumer(input));
      try {
        const graph = await workspace.graph();
        expect(graph.dependencies).toContainEqual(
          expect.objectContaining({ source: "web", target: "@napi/addon-a" }),
        );
        const first = await nx(workspace, ["run", "web:build"]);
        expectSuccess(first);
        expect(first.output).toMatch(/nx run @napi\/addon-a:napi-build/);
        const flags = await nx(workspace, ["run", "web:build"], { RUSTFLAGS: "-C debuginfo=0" });
        expectSuccess(flags);
        expect(restored(flags.output, "@napi/addon-a:napi-build")).toBe(false);
        expect(restored(flags.output, "web:build")).toBe(hitAfterFlags);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );
});

describe("napi-build under the hakari strategy", () => {
  let stub: StubHakari;
  beforeAll(() => {
    stub = new StubHakari();
  });
  afterAll(() => stub?.remove());

  /**
   * napi-addons under hakari: the hack crate hack, which asks napi-derive
   * for its default features as cargo-hakari would unify them, and on which
   * the addons depend; and web, which needs addon-a's napi-build and
   * addon-b's build.
   */
  const hakari: FileChanges = {
    "rust/.config/hakari.toml": hakariConfiguration("hack", [host]),
    ...hackCrateFiles("rust/crates/hack", "hack", ['napi-derive = { version = "3" }']),
    "rust/crates/addon-a/Cargo.toml": (text) =>
      `${text}`.replace(
        'shared = { path = "../shared" }',
        'shared = { path = "../shared" }\nhack = { version = "0.1", path = "../hack" }',
      ),
    "rust/crates/addon-b/Cargo.toml": (text) =>
      `${text}`.replace(
        'shared = { path = "../shared" }',
        'shared = { path = "../shared" }\nhack = { version = "0.1", path = "../hack" }',
      ),
    "apps/web/project.json": JSON.stringify({
      name: "web",
      targets: {
        build: {
          command: "echo web",
          dependsOn: [
            { projects: ["addon-a"], target: "napi-build" },
            { projects: ["addon-b"], target: "build" },
          ],
        },
      },
    }),
  };

  it(
    "selects its crates with -p, waits for hakari-check, leaves out the hack crate, and keeps the stored files of each crate to one command per batch",
    async () => {
      const workspace = create(hakari);
      const env = { PATH: pathWith(stub.folder) };
      try {
        const { projects } = await workspace.graph();
        expect(projects["addon-a"].metadata?.cargo.featureUnification).toBe("hakari");
        expect(projects["addon-a"].targets?.["napi-build"].dependsOn).toEqual([
          expect.objectContaining({ target: "lockfile" }),
          expect.objectContaining({ target: "hakari-check" }),
        ]);

        const both = await nx(workspace, ["run-many", "-t", "napi-build"], env);
        expectSuccess(both);
        const specs = ["addon-a", "addon-b"].map((crate) =>
          packageSpec(workspace.root, "rust", crate),
        );
        expect(
          taskCalls(workspace)
            .filter((c) => c.args[0] === "build")
            .map((c) => c.args),
        ).toEqual([
          ["build", "--keep-going", "--message-format=json", "-p", specs[0], "-p", specs[1]],
        ]);
        expect(call(workspace, addonA, "[m.sumA(2, 1), m.coreFn(1)]")).toBe("[5,2]");
        expect(read(workspace, `${addonB}/index.d.ts`)).toContain("sumB");

        // addon-a's napi-build beside addon-b's build: one batch, two commands.
        const beside = await nx(workspace, ["run", "web:build", "--skip-nx-cache"], env);
        expectSuccess(beside);
        expect(beside.output).toMatch(/Running 2 tasks with @convesoft\/nx-rust:cargo-outputs/);
        expect(
          taskCalls(workspace)
            .filter((c) => c.args[0] === "build")
            .map((c) => c.args)
            .sort(),
        ).toEqual(
          [
            ["build", "--keep-going", "--message-format=json", "-p", specs[0]],
            ["build", "-p", specs[1]],
          ].sort(),
        );

        // A build and a napi-build of one crate: the second in a batch of its own.
        const same = await nx(
          workspace,
          ["run-many", "-t", "build", "napi-build", "-p", "addon-a", "--skip-nx-cache"],
          env,
        );
        expectSuccess(same);
        expect(
          taskCalls(workspace)
            .filter((c) => c.args[0] === "build")
            .map((c) => c.args)
            .sort(),
        ).toEqual(
          [
            ["build", "--keep-going", "--message-format=json", "-p", specs[0]],
            ["build", "-p", specs[0]],
          ].sort(),
        );
        expect(call(workspace, addonA, "m.sumA(2, 1)")).toBe("5");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );
});
