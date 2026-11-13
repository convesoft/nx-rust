import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  CargoWrapper,
  cargoProbeProject,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  installProbeExecutor,
  testEnvironment,
} from "./harness";

describe("cargo wrapper", () => {
  let directory: string;
  let cargo: CargoWrapper;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-cargo-wrapper-")));
    cargo = CargoWrapper.install(join(directory, "wrapper"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it(
    "logs each invocation with its folder and runs the real cargo",
    () => {
      const folder = join(directory, "some folder");
      mkdirSync(folder);

      const version = execFileSync("cargo", ["--version"], {
        cwd: folder,
        env: cargo.environment(testEnvironment()),
        encoding: "utf8",
      });

      expect(version).toMatch(/^cargo \d+\.\d+\.\d+/);
      expect(cargo.calls()).toEqual([{ cwd: folder, args: ["--version"] }]);
      expect(cargo.calls(directory)).toEqual([{ cwd: "some folder", args: ["--version"] }]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "exits as cargo did",
    () => {
      const result = spawnSync("cargo", ["no-such-command"], {
        cwd: directory,
        env: cargo.environment(testEnvironment()),
        encoding: "utf8",
      });

      expect(result.status).toBe(101);
      expect(result.stderr).toContain("no-such-command");
      expect(cargo.calls()).toHaveLength(1);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs the real cargo with its own folder first on PATH, so that cargo runs the matching rustc",
    () => {
      // A rustc that fails, ahead of everything but the wrapper, as a system
      // rustc in Node's folder is for an nx:run-commands task.
      const decoy = join(directory, "decoy");
      mkdirSync(decoy);
      writeFileSync(join(decoy, "rustc"), "#!/bin/sh\necho decoy rustc >&2\nexit 1\n", {
        mode: 0o755,
      });
      const crate = join(directory, "crate");
      mkdirSync(join(crate, "src"), { recursive: true });
      writeFileSync(
        join(crate, "Cargo.toml"),
        '[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n',
      );
      writeFileSync(join(crate, "src", "main.rs"), "fn main() {}\n");
      const env = testEnvironment({
        CARGO_TARGET_DIR: join(directory, "target"),
        CARGO_BUILD_BUILD_DIR: join(directory, "build"),
      });

      const result = spawnSync("cargo", ["build", "--offline"], {
        cwd: crate,
        env: { ...env, PATH: [cargo.binDirectory, decoy, env.PATH].join(delimiter) },
        encoding: "utf8",
      });

      expect(result.stderr).not.toContain("decoy rustc");
      expect(result.status).toBe(0);
    },
    HARNESS_TIMEOUT,
  );
});

// Nx starts cargo in two ways: from an nx:run-commands task, which rebuilds
// PATH with Node's folder ahead of the inherited one, and from an executor
// process, which inherits Nx's PATH, alone or in a batch.
describe("cargo wrapper in a fixture workspace", () => {
  let workspace: FixtureWorkspace;

  beforeAll(() => {
    workspace = FixtureWorkspace.create("subfolder-workspace", {
      "rust/crates/api/project.json": cargoProbeProject("api"),
      "rust/crates/model/project.json": cargoProbeProject("model"),
    });
    installProbeExecutor(workspace.root);
  });

  beforeEach(() => workspace.cargo.clear());

  afterAll(() => workspace?.remove());

  it(
    "logs cargo that an nx:run-commands task starts, ahead of Node's folder",
    async () => {
      const { status, output } = await workspace.nx([
        "run",
        "api:probe-command",
        "--skip-nx-cache",
        "--output-style=static",
      ]);

      expect(status).toBe(0);
      expect(output).toContain(join(workspace.root, "node_modules", ".bin", "cargo"));
      expect(workspace.cargoCalls()).toContainEqual({
        cwd: "rust/crates/api",
        args: ["--version"],
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "logs cargo that an executor starts",
    async () => {
      const { status, output } = await workspace.nx([
        "run",
        "api:probe-executor",
        "--skip-nx-cache",
        "--output-style=static",
      ]);

      expect(status).toBe(0);
      expect(output).toMatch(/cargo \d+\.\d+\.\d+/);
      expect(workspace.cargoCalls()).toContainEqual({
        cwd: "rust/crates/api",
        args: ["--version"],
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "logs cargo that a batched executor starts",
    async () => {
      const { status } = await workspace.nx([
        "run-many",
        "-t",
        "probe-executor",
        "--batch",
        "--skip-nx-cache",
        "--output-style=static",
      ]);

      expect(status).toBe(0);
      const calls = workspace.cargoCalls();
      expect(calls).toContainEqual({ cwd: "rust/crates/api", args: ["-V"] });
      expect(calls).toContainEqual({ cwd: "rust/crates/model", args: ["-V"] });
    },
    HARNESS_TIMEOUT,
  );
});
