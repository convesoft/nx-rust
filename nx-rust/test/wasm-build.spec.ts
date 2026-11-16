import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { libraryRecordNames } from "../src/executors/build-records";
import { cargoArguments } from "../src/executors/command";
import { groupSelection } from "../src/executors/groups";
import type { PreparedTask } from "../src/executors/task";
import {
  type FileChanges,
  findExecutable,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  hackCrateFiles,
  hakariConfiguration,
  lockedWasmBindgen,
  packageSpec,
  pathWith,
  pathWithoutWasmBindgen,
  runNx,
  StubHakari,
  taskCalls,
  testEnvironment,
  testHost,
  wasmBindgenFolder,
  wasmTargetInstalled,
} from "./harness";

// The wasm parts of VER-ARTIFACTS, VER-TARGETS, VER-CONFIGURATION and
// VER-SETUP, with a real cargo, real Nx and, where the machine has them, the
// real wasm-bindgen CLI of the version that the fixture locks and the
// wasm32-unknown-unknown target. In wasm-packages, the rust/ workspace has
// codec, a cdylib that depends on wasm-bindgen and shared and has a feature
// extra that adds an export, codec-b, a cdylib and rlib that does the same,
// and plain-cdylib, a cdylib without wasm-bindgen. The crates.io packages
// come from a local registry in the fixture, so that cargo needs no network.

const codec = "rust/crates/codec";
const codecB = "rust/crates/codec-b";
const triple = "wasm32-unknown-unknown";

/** Runs Nx after forgetting the logged cargo calls. */
async function nx(workspace: FixtureWorkspace, args: string[], env: Record<string, string> = {}) {
  workspace.cargo.clear();
  return runNx(workspace, args, env);
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

/** The compile commands of the run, `cargo build` for the wasm triple. */
function wasmCompiles(workspace: FixtureWorkspace): string[][] {
  return taskCalls(workspace)
    .filter((call) => call.args[0] === "build" && call.args.includes(triple))
    .map((call) => call.args);
}

/** The compile of one crate's group of one crate: JSON messages for the library it post-processes. */
function aloneArgs(spec: string, tail: readonly string[] = []): string[] {
  return [
    "build",
    "--lib",
    "--keep-going",
    "--message-format=json",
    "-p",
    spec,
    ...tail,
    "--target",
    triple,
  ];
}

let fakes = 0;

/**
 * A folder with a `rustc` that prints `sysroot` for `--print sysroot` and
 * runs the real rustc otherwise, and, where `cli` is given, a
 * `wasm-bindgen` that prints that version, so that a test decides what the
 * tool checks find, wherever the machine keeps its own.
 */
function fakeTools(workspace: FixtureWorkspace, withTarget: boolean, cli?: string): string {
  fakes += 1;
  const folder = join(workspace.root, "..", `fake-tools-${fakes}`);
  const sysroot = join(folder, "sysroot");
  mkdirSync(join(sysroot, "lib", "rustlib", withTarget ? triple : "x"), { recursive: true });
  const rustc = findExecutable("rustc", testEnvironment().PATH ?? "");
  writeFileSync(
    join(folder, "rustc"),
    `#!/bin/sh\nif [ "$1" = "--print" ] && [ "$2" = "sysroot" ]; then echo '${sysroot}'; exit 0; fi\nexec '${rustc}' "$@"\n`,
  );
  chmodSync(join(folder, "rustc"), 0o755);
  if (cli !== undefined) {
    writeFileSync(join(folder, "wasm-bindgen"), `#!/bin/sh\necho 'wasm-bindgen ${cli}'\n`);
    chmodSync(join(folder, "wasm-bindgen"), 0o755);
  }
  return [folder, pathWithoutWasmBindgen()].join(delimiter);
}

describe("the compile of wasm-build", () => {
  const host = "x86_64-unknown-linux-gnu";
  const task = (fields: Partial<PreparedTask>): PreparedTask =>
    ({
      task: "codec:wasm-build",
      target: "wasm-build",
      options: { jsFlavour: "bundler" },
      binaryArguments: [],
      warnings: [],
      locked: false,
      workspaceRoot: "rust",
      cwd: "/nowhere",
      crate: "codec",
      env: {},
      ...fields,
    }) as PreparedTask;

  it("selects as a build for a triple other than the host's does, under each strategy", () => {
    const select = (fields: Partial<PreparedTask>) => groupSelection(task(fields), () => host);
    // workspace-build cannot build the whole workspace for the triple.
    expect(select({ featureUnification: "workspace-build" })).toEqual({ kind: "alone" });
    // hakari shares a command only where platforms lists the host and the triple.
    expect(select({ featureUnification: "hakari", hakariPlatforms: [host] })).toEqual({
      kind: "alone",
    });
    expect(select({ featureUnification: "hakari", hakariPlatforms: [host, triple] })).toEqual({
      kind: "crates",
    });
    expect(
      select({
        featureUnification: "hakari",
        hakariPlatforms: [host, triple],
        options: { allFeatures: true },
      }),
    ).toEqual({ kind: "alone" });
    // cargo resolves features for the whole workspace, apart from --features.
    expect(select({ featureUnification: "cargo" })).toEqual({ kind: "crates" });
    expect(select({ featureUnification: "cargo", options: { features: ["extra"] } })).toEqual({
      kind: "alone",
    });
    // A feature set of the crate's own options is a group of one crate.
    expect(
      select({ featureUnification: "cargo", hakariPlatforms: [], ownFeatureSet: true }),
    ).toEqual({ kind: "alone" });
  });

  it("builds the library alone for the wasm triple with cargo's JSON messages, also for one crate, and takes no targetTriple", () => {
    const crates = [{ name: "codec", spec: "path+file:///r/codec#0.1.0" }];
    expect(
      cargoArguments(
        { target: "wasm-build", crates, locked: true },
        { jsFlavour: "web", profile: "release", targetTriple: host, features: ["extra"] },
      ),
    ).toEqual([
      "build",
      "--lib",
      "--keep-going",
      "--message-format=json",
      "-p",
      crates[0].spec,
      "--features",
      "extra",
      "--profile",
      "release",
      "--target",
      triple,
      "--locked",
    ]);
    expect(
      cargoArguments(
        { target: "wasm-build", crates, locked: false, workspaceUnification: true },
        {},
      ),
    ).toEqual([
      "build",
      "--lib",
      "--keep-going",
      "--message-format=json",
      "-p",
      crates[0].spec,
      "--target",
      triple,
      "--config",
      'resolver.feature-unification="workspace"',
      "-Zfeature-unification",
    ]);
  });

  it("names the record of a cdylib built for the wasm triple without the lib prefix", () => {
    expect(libraryRecordNames("codec", ["cdylib"], triple)).toEqual(["codec.d"]);
    expect(libraryRecordNames("codec_b", ["cdylib", "rlib"], triple)).toEqual([
      "codec_b.d",
      "libcodec_b.d",
    ]);
    expect(libraryRecordNames("codec", ["rlib"], triple)).toEqual(["libcodec.d"]);
    expect(libraryRecordNames("codec", ["cdylib"], host)).toEqual(["libcodec.d"]);
    expect(libraryRecordNames("codec", ["cdylib"], undefined)).toEqual(["libcodec.d"]);
    // A graph that recorded no crate types.
    expect(libraryRecordNames("codec", undefined, triple)).toEqual(["libcodec.d"]);
  });
});

describe("wasm-build", () => {
  it(
    "exists on the crates that produce a wasm package only, unless artifacts says otherwise, with the package folder as outputs and no inputs, and can be renamed",
    async () => {
      const workspace = FixtureWorkspace.create("wasm-packages", {
        "rust/crates/codec-b/Cargo.toml": (text) =>
          `${text}\n[package.metadata.nx]\nartifacts = []\n`,
        "rust/crates/plain-cdylib/Cargo.toml": (text) =>
          `${text}\n[package.metadata.nx]\nartifacts = ["wasm"]\n`,
      });
      try {
        const { projects } = await workspace.graph();
        const withTarget = (name: string) =>
          Object.keys(projects)
            .filter((project) => projects[project].targets?.[name] !== undefined)
            .sort();
        expect(withTarget("wasm-build")).toEqual(["codec", "plain-cdylib"]);
        expect(withTarget("napi-build")).toEqual([]);
        const target = projects["codec"].targets?.["wasm-build"];
        expect(target).toMatchObject({
          executor: "@convesoft/nx-rust:cargo-outputs",
          cache: true,
          options: { jsFlavour: "bundler" },
          outputs: ["{projectRoot}/pkg"],
          dependsOn: [expect.objectContaining({ target: "lockfile" })],
        });
        expect(target?.configurations).toEqual({ "all-features": { allFeatures: true } });
        expect(target?.inputs).toEqual(
          expect.arrayContaining([
            { env: "RUSTFLAGS" },
            { env: "WASM_BINDGEN_EXTERNREF" },
            { env: "WASM_BINDGEN_ANYREF" },
            { env: "WASM_BINDGEN_MULTI_VALUE" },
            { runtime: expect.stringContaining("wasm-bindgen --version") },
          ]),
        );
        expect(projects["codec"].namedInputs?.default).toContain("!{projectRoot}/pkg/**/*");
        expect(projects["shared"].namedInputs?.default).not.toContain("!{projectRoot}/pkg/**/*");

        workspace.reset({
          "nx.json": (text) => {
            const config = JSON.parse(text ?? "{}");
            const [entry] = config.plugins;
            const plugin = typeof entry === "string" ? entry : entry.plugin;
            config.plugins = [{ plugin, options: { targetNames: { "wasm-build": "wasm" } } }];
            return JSON.stringify(config);
          },
        });
        const renamed = (await workspace.graph()).projects;
        expect(renamed["codec"].targets?.wasm?.metadata?.cargo.target).toBe("wasm-build");
        expect(renamed["codec"].targets?.["wasm-build"]).toBeUndefined();
        expect(renamed["codec-b"].targets?.wasm).toBeDefined();
        expect(renamed["shared"].targets?.wasm).toBeUndefined();
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives no napi crate a wasm-build target",
    async () => {
      const workspace = FixtureWorkspace.create("napi-addons");
      try {
        const { projects } = await workspace.graph();
        expect(
          Object.keys(projects).filter(
            (name) => projects[name].targets?.["wasm-build"] !== undefined,
          ),
        ).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails before cargo without the wasm target, without the wasm-bindgen CLI, and with a CLI of another version than the lockfile's",
    async () => {
      const workspace = FixtureWorkspace.create("wasm-packages");
      try {
        const needs =
          "the wasm-build target of the crate codec in the Cargo workspace in rust needs it.";
        const noTarget = await nx(workspace, ["run", "codec:wasm-build"], {
          PATH: fakeTools(workspace, false, lockedWasmBindgen()),
        });
        expect(noTarget.status).not.toBe(0);
        expect(noTarget.output).toContain(
          `codec:wasm-build: The ${triple} target is not installed, but ${needs} Install it with \`rustup target add ${triple}\`.`,
        );

        const noCli = await nx(workspace, ["run", "codec:wasm-build"], {
          PATH: fakeTools(workspace, true),
        });
        expect(noCli.output).toContain(
          `codec:wasm-build: The wasm-bindgen CLI is not installed, but ${needs}`,
        );
        expect(noCli.status).not.toBe(0);

        const older = await nx(workspace, ["run", "codec:wasm-build"], {
          PATH: fakeTools(workspace, true, "0.2.1"),
        });
        expect(older.status).not.toBe(0);
        expect(older.output).toContain(
          `codec:wasm-build: the wasm-bindgen CLI is 0.2.1, but Cargo.lock locks the wasm-bindgen crate of codec at ${lockedWasmBindgen()}`,
        );
        expect(older.output).toContain(
          `cargo install --locked wasm-bindgen-cli --version ${lockedWasmBindgen()}`,
        );
        expect(wasmCompiles(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "keys each WASM_BINDGEN_ variable on whether it is set, which Nx's env input alone does not tell from an empty value",
    async () => {
      const workspace = FixtureWorkspace.create("wasm-packages");
      try {
        // A CLI that always prints the same version, so that only the variables differ.
        const PATH = fakeTools(workspace, true, lockedWasmBindgen());
        const unset = Object.fromEntries(
          ["WASM_BINDGEN_ANYREF", "WASM_BINDGEN_EXTERNREF", "WASM_BINDGEN_MULTI_VALUE"].map(
            (name) => [name, undefined],
          ),
        );
        const hash = async (task: string, env: Record<string, string | undefined>) =>
          (await workspace.hashTasks([task], { env: { PATH, ...unset, ...env } }))[task].value;
        const none = await hash("codec:wasm-build", {});
        expect(await hash("codec:wasm-build", {})).toBe(none);
        for (const name of Object.keys(unset)) {
          const empty = await hash("codec:wasm-build", { [name]: "" });
          const one = await hash("codec:wasm-build", { [name]: "1" });
          expect({ name, empty: empty !== none, one: one !== none }).toEqual({
            name,
            empty: true,
            one: true,
          });
        }
        // What Nx's env input does alone, here with RUSTFLAGS on build.
        expect(await hash("codec:build", { RUSTFLAGS: "" })).toBe(
          await hash("codec:build", { RUSTFLAGS: undefined }),
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails both crates before cargo where they have one [lib] name",
    async () => {
      const workspace = FixtureWorkspace.create("wasm-packages", {
        "rust/crates/codec-b/Cargo.toml": (text) =>
          `${text}`.replace(
            'crate-type = ["cdylib", "rlib"]',
            'name = "codec"\ncrate-type = ["cdylib", "rlib"]',
          ),
      });
      try {
        const run = await nx(workspace, ["run-many", "-t", "wasm-build"], {
          PATH: fakeTools(workspace, true, lockedWasmBindgen()),
        });
        expect(run.status).not.toBe(0);
        for (const task of ["codec:wasm-build", "codec-b:wasm-build"]) {
          expect(run.output).toContain(
            `${task}: the library of ${task.split(":")[0]} has the file name of another crate's library`,
          );
        }
        expect(wasmCompiles(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

const cli = wasmBindgenFolder();
const target = wasmTargetInstalled();
if (cli === undefined || !target) {
  // eslint-disable-next-line no-console
  console.warn(
    `wasm-build.spec.ts: ${[
      ...(cli === undefined
        ? [
            `no wasm-bindgen CLI ${lockedWasmBindgen()} is on PATH, in the Cargo home's bin or in the folder that NX_RUST_TEST_WASM_BINDGEN names`,
          ]
        : []),
      ...(target ? [] : [`the default toolchain has no ${triple} target`]),
    ].join(", and ")}, so the cases of VER-ARTIFACTS that build a wasm package skip.`,
  );
}

(cli === undefined || !target ? describe.skip : describe)(
  "wasm-build with the wasm-bindgen CLI",
  () => {
    const env = () => ({ PATH: pathWith(cli ?? "") });

    /** What Node gets from `expression` with the package's module loaded as `m`, for each flavour. */
    function load(
      workspace: FixtureWorkspace,
      crate: string,
      module: string,
      flavour: string,
      expression: string,
    ): string {
      const folder = join(workspace.root, crate, "pkg");
      const script =
        flavour === "nodejs"
          ? `const m = require(${JSON.stringify(join(folder, `${module}.js`))}); console.log(JSON.stringify(${expression}));`
          : flavour === "web"
            ? // As a browser loads it: the module's own init with the bytes of the .wasm file.
              `import(${JSON.stringify(join(folder, `${module}.js`))}).then((m) => { m.initSync({ module: require("node:fs").readFileSync(${JSON.stringify(join(folder, `${module}_bg.wasm`))}) }); console.log(JSON.stringify(${expression})); });`
            : `import(${JSON.stringify(join(folder, `${module}.js`))}).then((m) => console.log(JSON.stringify(${expression})));`;
      return execFileSync(process.execPath, ["--no-warnings", "-e", script], {
        encoding: "utf8",
      }).trim();
    }

    it(
      "builds each crate's package with a compile of its own under workspace-build, which Node loads in every JS flavour, and which Nx restores",
      async () => {
        const workspace = FixtureWorkspace.create("wasm-packages");
        try {
          const run = await nx(workspace, ["run-many", "-t", "wasm-build"], env());
          expectSuccess(run);
          const specs = ["codec", "codec-b"].map((crate) =>
            packageSpec(workspace.root, "rust", crate),
          );
          expect(wasmCompiles(workspace).sort()).toEqual(
            specs.map((spec) => aloneArgs(spec)).sort(),
          );
          expect(readdirSync(join(workspace.root, codec, "pkg")).sort()).toEqual([
            "codec.d.ts",
            "codec.js",
            "codec_bg.js",
            "codec_bg.wasm",
            "codec_bg.wasm.d.ts",
          ]);
          expect(load(workspace, codec, "codec", "bundler", "m.encode(3)")).toBe("7");
          expect(load(workspace, codecB, "codec_b", "bundler", "m.greet('wasm')")).toBe(
            '"hello wasm, 4"',
          );

          // A file changed by hand changes no key and comes back from the cache.
          const before = await workspace.hashTasks(["codec:wasm-build"], { env: env() });
          writeFileSync(join(workspace.root, codec, "pkg", "codec.d.ts"), "changed\n");
          const after = await workspace.hashTasks(["codec:wasm-build"], { env: env() });
          expect(after["codec:wasm-build"].value).toBe(before["codec:wasm-build"].value);
          const again = await nx(workspace, ["run-many", "-t", "wasm-build"], env());
          expectSuccess(again);
          expect(restored(again.output, "codec:wasm-build")).toBe(true);
          expect(readFileSync(join(workspace.root, codec, "pkg", "codec.d.ts"), "utf8")).toContain(
            "encode",
          );
          expect(wasmCompiles(workspace)).toEqual([]);

          for (const flavour of ["web", "nodejs"]) {
            const other = await nx(
              workspace,
              ["run", "codec:wasm-build", `--jsFlavour=${flavour}`],
              env(),
            );
            expectSuccess(other);
            expect(restored(other.output, "codec:wasm-build")).toBe(false);
            expect(load(workspace, codec, "codec", flavour, "m.encode(5)")).toBe("11");
          }
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT * 3,
    );

    it(
      "builds the library alone where the crate also has a binary of its name, whose .wasm would replace the library's",
      async () => {
        const workspace = FixtureWorkspace.create("wasm-packages", {
          "rust/crates/codec/Cargo.toml": (text) =>
            `${text}`.replace('crate-type = ["cdylib"]', 'crate-type = ["cdylib", "rlib"]'),
          "rust/crates/codec/src/main.rs": 'fn main() {\n    println!("hello CLI");\n}\n',
        });
        try {
          const run = await nx(workspace, ["run", "codec:wasm-build", "--jsFlavour=nodejs"], env());
          expectSuccess(run);
          const spec = packageSpec(workspace.root, "rust", "codec");
          expect(wasmCompiles(workspace)).toEqual([aloneArgs(spec)]);
          expect(load(workspace, codec, "codec", "nodejs", "m.encode(3)")).toBe("7");
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT * 2,
    );

    it(
      "does not restore the package of an unset WASM_BINDGEN_MULTI_VALUE for an empty one",
      async () => {
        const workspace = FixtureWorkspace.create("wasm-packages");
        try {
          const flags = { ...env(), RUSTFLAGS: "-C strip=symbols" };
          const unset = await nx(workspace, ["run", "codec-b:wasm-build"], flags);
          expectSuccess(unset);
          const before = readFileSync(join(workspace.root, codecB, "pkg", "codec_b_bg.wasm"));
          const empty = await nx(workspace, ["run", "codec-b:wasm-build"], {
            ...flags,
            WASM_BINDGEN_MULTI_VALUE: "",
          });
          expectSuccess(empty);
          expect(restored(empty.output, "codec-b:wasm-build")).toBe(false);
          expect(
            readFileSync(join(workspace.root, codecB, "pkg", "codec_b_bg.wasm")).equals(before),
          ).toBe(false);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT * 2,
    );

    it(
      "writes the package of the crate's feature set, and fails a crate that reads an undeclared file",
      async () => {
        const workspace = FixtureWorkspace.create("wasm-packages");
        try {
          const extra = await nx(
            workspace,
            ["run", "codec:wasm-build", "-c", "all-features"],
            env(),
          );
          expectSuccess(extra);
          const spec = packageSpec(workspace.root, "rust", "codec");
          expect(wasmCompiles(workspace)).toEqual([aloneArgs(spec, ["--all-features"])]);
          expect(readFileSync(join(workspace.root, codec, "pkg", "codec.d.ts"), "utf8")).toContain(
            "encode_extra",
          );
          const plain = await nx(workspace, ["run", "codec:wasm-build"], env());
          expectSuccess(plain);
          expect(
            readFileSync(join(workspace.root, codec, "pkg", "codec.d.ts"), "utf8"),
          ).not.toContain("encode_extra");

          // The record of the .wasm file is codec.d, which the check reads.
          mkdirSync(join(workspace.root, "data"), { recursive: true });
          writeFileSync(join(workspace.root, "data", "banner.txt"), "banner\n");
          const source = join(workspace.root, codec, "src", "lib.rs");
          writeFileSync(
            source,
            `${readFileSync(source, "utf8")}\n#[wasm_bindgen]\npub fn banner() -> String {\n    include_str!("../../../../data/banner.txt").to_string()\n}\n`,
          );
          const undeclared = await nx(workspace, ["run", "codec:wasm-build"], env());
          expect(undeclared.status).not.toBe(0);
          expect(undeclared.output).toContain("data/banner.txt");
          expect(undeclared.output).toContain('fileInputs = ["../../../data/banner.txt"]');
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT * 3,
    );
  },
);

(cli === undefined || !target ? describe.skip : describe)(
  "a JS project that consumes the wasm package",
  () => {
    /** codec enrolled as the package @wasm/codec, and web, which depends on its wasm-build. */
    const consumer = (input: boolean): FileChanges => ({
      "package.json": JSON.stringify({ name: "wasm-root", private: true }),
      "pnpm-workspace.yaml": "packages:\n  - rust/crates/codec\n  - apps/*\n",
      "rust/crates/codec/package.json": JSON.stringify({
        name: "@wasm/codec",
        version: "0.1.0",
        main: "pkg/codec.js",
      }),
      "apps/web/index.js": "module.exports = 1;\n",
      "apps/web/package.json": JSON.stringify({
        name: "web",
        private: true,
        dependencies: { "@wasm/codec": "workspace:*" },
        nx: {
          targets: {
            build: {
              command: "echo web",
              cache: true,
              dependsOn: [{ projects: ["@wasm/codec"], target: "wasm-build" }],
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
      "with the package's files as an input (%s), is restored after a change of RUSTFLAGS alone: %s",
      async (input, hitAfterFlags) => {
        const workspace = FixtureWorkspace.create("wasm-packages", consumer(input));
        const env = { PATH: pathWith(cli ?? "") };
        try {
          const graph = await workspace.graph();
          expect(graph.dependencies).toContainEqual(
            expect.objectContaining({ source: "web", target: "@wasm/codec" }),
          );
          const first = await nx(workspace, ["run", "web:build"], env);
          expectSuccess(first);
          expect(first.output).toMatch(/nx run @wasm\/codec:wasm-build/);
          // Another optimisation level changes the code of the .wasm file.
          const flags = await nx(workspace, ["run", "web:build"], {
            ...env,
            RUSTFLAGS: "-C opt-level=1",
          });
          expectSuccess(flags);
          expect(restored(flags.output, "@wasm/codec:wasm-build")).toBe(false);
          expect(restored(flags.output, "web:build")).toBe(hitAfterFlags);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT * 3,
    );
  },
);

(cli === undefined || !target ? describe.skip : describe)(
  "wasm-build under the hakari strategy",
  () => {
    let stub: StubHakari;
    beforeAll(() => {
      stub = new StubHakari();
    });
    afterAll(() => stub?.remove());

    /** wasm-packages under hakari, with the hack crate hack, on which the wasm crates depend. */
    const hakari = (platforms: string[]): FileChanges => ({
      "rust/.config/hakari.toml": hakariConfiguration("hack", platforms),
      ...hackCrateFiles("rust/crates/hack", "hack", []),
      "rust/crates/codec/Cargo.toml": (text) =>
        `${text}`.replace(
          'shared = { path = "../shared" }',
          'shared = { path = "../shared" }\nhack = { version = "0.1", path = "../hack" }',
        ),
      "rust/crates/codec-b/Cargo.toml": (text) =>
        `${text}`.replace(
          'shared = { path = "../shared" }',
          'shared = { path = "../shared" }\nhack = { version = "0.1", path = "../hack" }',
        ),
    });

    it(
      "shares one compile where platforms lists the wasm triple, and runs one per crate where it does not",
      async () => {
        const host = testHost();
        const env = { PATH: [stub.folder, cli ?? "", testEnvironment().PATH].join(delimiter) };
        const listed = FixtureWorkspace.create("wasm-packages", hakari([host, triple]));
        try {
          const { projects } = await listed.graph();
          expect(projects["codec"].metadata?.cargo.featureUnification).toBe("hakari");
          expect(projects["codec"].targets?.["wasm-build"].dependsOn).toEqual([
            expect.objectContaining({ target: "lockfile" }),
            expect.objectContaining({ target: "hakari-check" }),
          ]);
          const both = await nx(listed, ["run-many", "-t", "wasm-build"], env);
          expectSuccess(both);
          const specs = ["codec", "codec-b"].map((crate) =>
            packageSpec(listed.root, "rust", crate),
          );
          // One command, which selects both crates.
          const compiles = wasmCompiles(listed);
          expect(compiles).toHaveLength(1);
          expect(compiles[0].filter((arg) => !specs.includes(arg))).toEqual([
            "build",
            "--lib",
            "--keep-going",
            "--message-format=json",
            "-p",
            "-p",
            "--target",
            triple,
          ]);
          expect(compiles[0].filter((arg) => specs.includes(arg)).sort()).toEqual(
            [...specs].sort(),
          );
          expect(existsSync(join(listed.root, codecB, "pkg", "codec_b_bg.wasm"))).toBe(true);
        } finally {
          listed.remove();
        }
        const unlisted = FixtureWorkspace.create("wasm-packages", hakari([host]));
        try {
          const each = await nx(unlisted, ["run-many", "-t", "wasm-build"], env);
          expectSuccess(each);
          const specs = ["codec", "codec-b"].map((crate) =>
            packageSpec(unlisted.root, "rust", crate),
          );
          expect(wasmCompiles(unlisted).sort()).toEqual(
            specs.map((spec) => aloneArgs(spec)).sort(),
          );
        } finally {
          unlisted.remove();
        }
      },
      HARNESS_TIMEOUT * 4,
    );
  },
);
