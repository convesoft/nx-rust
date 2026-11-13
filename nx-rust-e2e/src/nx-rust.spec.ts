import { NX_VERSION, workspaceRoot } from "@nx/devkit";
import { execFileSync, execSync } from "child_process";
import { createHash } from "crypto";
import { join, relative } from "path";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import {
  CargoWrapper,
  cargoProbeProject,
  HARNESS_TIMEOUT,
  installFixture,
  installProbeExecutor,
  testEnvironment,
} from "../../nx-rust/test/harness";

describe("@convesoft/nx-rust", () => {
  let projectDirectory: string;

  // This hook shells out synchronously twice, so its budget has to cover both
  // installs on a cold package manager cache. Otherwise work that succeeded
  // still fails on return.
  beforeAll(() => {
    projectDirectory = createTestProject();

    // The plugin has been built and published to a local registry in the globalSetup
    // Install the plugin built with the latest source code into the test repo
    execSync(`pnpm add -D --config.frozen-lockfile=false @convesoft/nx-rust@e2e`, {
      cwd: projectDirectory,
      stdio: "inherit",
      env: process.env,
    });
  }, 300_000);

  afterAll(() => {
    if (projectDirectory) {
      // Cleanup the test project
      rmSync(projectDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("should be installed", () => {
    // npm ls will fail if the package is not installed properly
    expect(() =>
      execSync("pnpm ls --depth 100 @convesoft/nx-rust", {
        cwd: projectDirectory,
        stdio: "inherit",
      }),
    ).not.toThrow();
  });

  // Every run publishes the same version, so a package that an earlier run
  // published, still known to a cache, would install without an error.
  it("installs the plugin that the global setup built", () => {
    const installed = join(projectDirectory, "node_modules", "@convesoft", "nx-rust");
    const built = join(workspaceRoot, "dist", "nx-rust");

    expect(fileDigests(installed)).toEqual(fileDigests(built));
  });

  describe("with a fixture", () => {
    // Outside the test project, so that Nx does not see the wrapper.
    const wrapperDirectory = join(process.cwd(), "tmp", "cargo-wrapper");
    let cargo: CargoWrapper;

    beforeAll(() => {
      installFixture(projectDirectory, "subfolder-workspace");
      rmSync(wrapperDirectory, { recursive: true, force: true });
      cargo = CargoWrapper.install(wrapperDirectory);
      // Ahead of Node's folder on the PATH that nx:run-commands builds.
      cargo.placeIn(join(projectDirectory, "node_modules", ".bin"));
      installProbeExecutor(projectDirectory);
    });

    beforeEach(() => cargo.clear());

    afterAll(() => {
      rmSync(wrapperDirectory, { recursive: true, force: true });
    });

    it(
      "reads the fixture's workspace through the installed plugin",
      () => {
        const projects = JSON.parse(nx(projectDirectory, cargo, ["show", "projects", "--json"]));

        // The plugin creates no project yet (nxr-1bv0wm), but it reads the
        // workspace with one cargo call.
        expect(projects).toEqual([]);
        expect(cargo.calls(projectDirectory)).toEqual([
          {
            cwd: "rust",
            args: [
              "metadata",
              "--format-version",
              "1",
              "--no-deps",
              "--manifest-path",
              "{workspaceRoot}/rust/Cargo.toml",
            ],
          },
        ]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "logs the cargo invocations in the fixture",
      () => {
        const metadata = JSON.parse(
          execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
            cwd: join(projectDirectory, "rust"),
            env: cargo.environment(testEnvironment()),
            encoding: "utf8",
          }),
        );

        expect(metadata.packages.map((p: { name: string }) => p.name).sort()).toEqual([
          "api",
          "codegen",
          "model",
          "testkit",
        ]);
        expect(cargo.calls(projectDirectory)).toEqual([
          { cwd: "rust", args: ["metadata", "--no-deps", "--format-version", "1"] },
        ]);
      },
      HARNESS_TIMEOUT,
    );

    // Nx starts cargo in two ways: from an nx:run-commands task, which
    // rebuilds PATH with Node's folder ahead of the inherited one, and from an
    // executor process, which inherits Nx's PATH, alone or in a batch.
    describe("when a task runs cargo", () => {
      beforeAll(() => {
        installFixture(projectDirectory, "subfolder-workspace", {
          "rust/crates/api/project.json": cargoProbeProject("api"),
          "rust/crates/model/project.json": cargoProbeProject("model"),
        });
      });

      it(
        "logs cargo that an nx:run-commands task starts, ahead of Node's folder",
        () => {
          const output = nx(projectDirectory, cargo, [
            "run",
            "api:probe-command",
            "--skip-nx-cache",
            "--output-style=static",
          ]);

          expect(output).toContain(join(projectDirectory, "node_modules", ".bin", "cargo"));
          expect(cargo.calls(projectDirectory)).toContainEqual({
            cwd: "rust/crates/api",
            args: ["--version"],
          });
        },
        HARNESS_TIMEOUT,
      );

      it(
        "logs cargo that an executor starts",
        () => {
          nx(projectDirectory, cargo, ["run", "api:probe-executor", "--skip-nx-cache"]);

          expect(cargo.calls(projectDirectory)).toContainEqual({
            cwd: "rust/crates/api",
            args: ["--version"],
          });
        },
        HARNESS_TIMEOUT,
      );

      it(
        "logs cargo that a batched executor starts",
        () => {
          nx(projectDirectory, cargo, [
            "run-many",
            "-t",
            "probe-executor",
            "--batch",
            "--skip-nx-cache",
          ]);

          const calls = cargo.calls(projectDirectory);
          expect(calls).toContainEqual({ cwd: "rust/crates/api", args: ["-V"] });
          expect(calls).toContainEqual({ cwd: "rust/crates/model", args: ["-V"] });
        },
        HARNESS_TIMEOUT,
      );
    });
  });
});

/**
 * Runs the test project's Nx with the cargo wrapper first on `PATH` and
 * returns its standard output.
 */
function nx(projectDirectory: string, cargo: CargoWrapper, args: string[]): string {
  return execFileSync("pnpm", ["exec", "nx", ...args], {
    cwd: projectDirectory,
    env: cargo.environment(testEnvironment()),
    encoding: "utf8",
  });
}

/**
 * Maps the path of each file below `directory`, relative to it, to the SHA-256
 * digest of its contents.
 */
function fileDigests(directory: string): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      digests[relative(directory, path)] = createHash("sha256")
        .update(readFileSync(path))
        .digest("hex");
    }
  }
  return digests;
}

/**
 * Creates an empty Nx workspace by hand and installs Nx into it.
 *
 * `create-nx-workspace` is not used. It takes another path when it finds a
 * coding agent in the environment, and on that path it runs `git add` and
 * `git commit --amend` in the test project, which lies inside this repository.
 * Written by hand, the workspace is the same for every caller, nothing runs
 * git, and Nx has the version this repository uses instead of the latest one.
 *
 * @returns The directory where the test project was created
 */
function createTestProject() {
  const projectDirectory = join(process.cwd(), "tmp", "test-project");

  // Ensure projectDirectory is empty
  rmSync(projectDirectory, {
    recursive: true,
    force: true,
  });
  mkdirSync(projectDirectory, {
    recursive: true,
  });

  const packageJson = {
    name: "test-project",
    version: "0.0.0",
    private: true,
    devDependencies: { nx: NX_VERSION },
  };
  writeFileSync(
    join(projectDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  writeFileSync(join(projectDirectory, "nx.json"), "{}\n");
  // pnpm refuses to add a package while a build script is neither allowed nor
  // denied, so the one build script of this workspace is decided here.
  writeFileSync(join(projectDirectory, "pnpm-workspace.yaml"), "allowBuilds:\n  nx: true\n");

  // In CI pnpm expects a lockfile, and a new workspace has none.
  execSync("pnpm install --no-frozen-lockfile", {
    cwd: projectDirectory,
    stdio: "inherit",
    env: process.env,
  });
  console.log(`Created test project in "${projectDirectory}"`);

  return projectDirectory;
}
