import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCargoForGraph } from "../src/cargo/run-cargo";
import {
  CargoCallWithEnv,
  CargoWrapper,
  cargoProbeProject,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  installProbeExecutor,
  loadFixtureGraph,
  testEnvironment,
} from "./harness";

// Checks the graph-creation cases of a missing pinned toolchain in VER-SETUP:
// graph creation runs cargo with RUSTUP_AUTO_INSTALL=0, so that rustup fails
// instead of installing a toolchain (ADR-GRAPH-NO-TOOLCHAIN-INSTALL).
//
// Every command that could meet a pin of the missing toolchain runs with the
// harness's RUSTUP_AUTO_INSTALL=0, so that a failure cannot download it. The
// checks that remove the variable from the environment pin nothing that is
// missing.

/** A toolchain that the tests pin and never install. */
const missingToolchain = "1.92.0";

const pin = `[toolchain]\nchannel = "${missingToolchain}"\n`;

/** The toolchains that rustup has, or `undefined` without rustup. */
function installedToolchains(): string[] | undefined {
  const result = spawnSync("rustup", ["toolchain", "list", "--quiet"], {
    cwd: tmpdir(),
    env: testEnvironment(),
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.split("\n").filter((line) => line !== "") : undefined;
}

// Only rustup reads toolchain files, and the checks need missingToolchain to
// be missing. CI has rustup without it.
const toolchains = installedToolchains();
const describeWithRustup =
  process.env.CI ||
  (toolchains !== undefined &&
    !toolchains.some((toolchain) => toolchain.startsWith(`${missingToolchain}-`)))
    ? describe
    : describe.skip;

/** A call of graph creation, as the wrapper records it with the plugin's setting. */
function metadataCall(cwd: string, manifest: string): CargoCallWithEnv {
  return {
    cwd,
    args: [
      "metadata",
      "--format-version",
      "1",
      "--no-deps",
      "--manifest-path",
      `{workspaceRoot}/${manifest}`,
    ],
    env: { RUSTUP_AUTO_INSTALL: "0" },
  };
}

// The vendored-crate fixture reads vendor/parser and vendor/lexer as path
// dependencies without a project, from the workspace in rust/.
const vendoredCrateCalls = [
  metadataCall("rust", "rust/Cargo.toml"),
  metadataCall("rust", "vendor/parser/Cargo.toml"),
  metadataCall("rust", "vendor/lexer/Cargo.toml"),
];

describeWithRustup("graph creation with a pinned toolchain that is not installed", () => {
  it(
    "fails with rustup's message, naming the toolchain and the workspace, and installs nothing",
    async () => {
      const loading = loadFixtureGraph("subfolder-workspace", {
        files: { "rust/rust-toolchain.toml": pin },
      });

      await expect(loading).rejects.toThrow(GraphCreationError);
      await expect(loading).rejects.toThrow(
        /`cargo metadata` failed for the Cargo workspace of rust\/Cargo\.toml/,
      );
      // rustup's message, which names the toolchain with its host triple.
      await expect(loading).rejects.toThrow(/toolchain '1\.92\.0-[^']+' is not installed/);
      expect(installedToolchains()).toEqual(toolchains);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails, naming the root folder, when the folder where a workspace's tasks run cargo pins it and Nx does not hand the root manifest to the plugin",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace", {
        "rust/rust-toolchain.toml": pin,
        // The toolchain of the folder where discovery starts, the
        // shallowest manifest that the plugin receives, is installed.
        "rust/crates/api/rust-toolchain.toml": '[toolchain]\nchannel = "stable"\n',
        "nx.json": (text) => {
          const config = JSON.parse(text);
          config.plugins = config.plugins.map((entry: string | { plugin: string }) => ({
            plugin: typeof entry === "string" ? entry : entry.plugin,
            exclude: ["rust/Cargo.toml"],
          }));
          return JSON.stringify(config);
        },
      });
      try {
        const loading = workspace.graph();

        await expect(loading).rejects.toThrow(
          /`cargo metadata` failed for the Cargo workspace of rust\/crates\/api\/Cargo\.toml/,
        );
        await expect(loading).rejects.toThrow(/toolchain '1\.92\.0-[^']+' is not installed/);
        await expect(loading).rejects.toThrow(/`cargo metadata --no-deps` succeeds in rust\./);
        expect(workspace.cargo.callsWithEnv(workspace.root)).toEqual([
          metadataCall("rust/crates/api", "rust/crates/api/Cargo.toml"),
          metadataCall("rust", "rust/Cargo.toml"),
        ]);
        expect(installedToolchains()).toEqual(toolchains);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "succeeds when only a member and a path dependency pin it, with every cargo call in the workspace's root folder",
    async () => {
      const workspace = FixtureWorkspace.create("vendored-crate", {
        "rust/crates/app/rust-toolchain.toml": pin,
        "vendor/parser/rust-toolchain.toml": pin,
      });
      try {
        // The positive control: in each pinned folder, cargo fails.
        for (const folder of ["rust/crates/app", "vendor/parser"]) {
          const direct = spawnSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
            cwd: join(workspace.root, folder),
            env: testEnvironment(),
            encoding: "utf8",
          });
          expect(direct.status).not.toBe(0);
          expect(direct.stderr).toContain("is not installed");
        }

        const graph = await workspace.graph();

        expect(Object.keys(graph.projects)).toEqual(expect.arrayContaining(["app", "lib"]));
        expect(workspace.cargo.callsWithEnv(workspace.root)).toEqual(vendoredCrateCalls);
        expect(installedToolchains()).toEqual(toolchains);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("RUSTUP_AUTO_INSTALL for graph-time cargo", () => {
  it(
    "is set on every cargo call of graph creation when Nx's environment lacks it, and not on a task's cargo",
    async () => {
      const workspace = FixtureWorkspace.create("vendored-crate", {
        "probe/project.json": cargoProbeProject("probe"),
      });
      try {
        installProbeExecutor(workspace.root);

        const { status, output } = await workspace.nx(
          ["run", "probe:probe-executor", "--skip-nx-cache", "--output-style=static"],
          { RUSTUP_AUTO_INSTALL: undefined },
        );

        expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
        const calls = workspace.cargo.callsWithEnv(workspace.root);
        const taskCalls = calls.filter((call) => call.cwd === "probe");
        // The task's cargo is the positive control that the wrapper records
        // an unset variable.
        expect(taskCalls).toEqual([
          { cwd: "probe", args: ["--version"], env: { RUSTUP_AUTO_INSTALL: null } },
        ]);
        expect(calls.filter((call) => call.cwd !== "probe")).toEqual(vendoredCrateCalls);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "is set for cargo's process only, not in the plugin's",
    async () => {
      const directory = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-run-cargo-")));
      const savedEnvironment = process.env;
      try {
        const cargo = CargoWrapper.install(join(directory, "wrapper"));
        process.env = cargo.environment(testEnvironment({ RUSTUP_AUTO_INSTALL: undefined }));

        const output = await runCargoForGraph(["--version"], directory);

        expect(output).toMatch(/^cargo \d+\.\d+\.\d+/);
        expect(cargo.callsWithEnv(directory)).toEqual([
          { cwd: ".", args: ["--version"], env: { RUSTUP_AUTO_INSTALL: "0" } },
        ]);
        expect(process.env.RUSTUP_AUTO_INSTALL).toBeUndefined();
      } finally {
        process.env = savedEnvironment;
        rmSync(directory, { recursive: true, force: true });
      }
    },
    HARNESS_TIMEOUT,
  );
});
