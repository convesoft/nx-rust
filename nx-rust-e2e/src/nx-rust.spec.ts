import { NX_VERSION, workspaceRoot } from "@nx/devkit";
import { execFileSync, execSync, spawnSync } from "child_process";
import { createHash } from "crypto";
import { join, relative } from "path";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import {
  CargoCall,
  CargoWrapper,
  cargoProbeProject,
  changedFiles,
  HARNESS_TIMEOUT,
  installFixture,
  installProbeExecutor,
  repositoryFiles,
  testEnvironment,
  withoutColours,
} from "../../nx-rust/test/harness";

/** The cargo call with which graph creation reads the workspace in `rust/` of `subfolder-workspace`. */
const readRustWorkspace: CargoCall = {
  cwd: "rust",
  args: [
    "metadata",
    "--format-version",
    "1",
    "--no-deps",
    "--manifest-path",
    "{workspaceRoot}/rust/Cargo.toml",
  ],
};

describe("@convesoft/nx-rust", () => {
  let projectDirectory: string;
  // Outside the test project, so that Nx does not see the wrapper.
  const wrapperDirectory = join(process.cwd(), "tmp", "cargo-wrapper");
  let cargo: CargoWrapper;
  /** What `nx add` printed, the files it changed and the cargo calls it made. */
  let added: { output: string; changed: string[]; calls: CargoCall[] };

  // This hook shells out synchronously twice, so its budget has to cover both
  // installs on a cold package manager cache. Otherwise work that succeeded
  // still fails on return.
  beforeAll(() => {
    projectDirectory = createTestProject();
    rmSync(wrapperDirectory, { recursive: true, force: true });
    cargo = CargoWrapper.install(wrapperDirectory);

    // A repository with a Cargo workspace that does not know the plugin yet.
    installFixture(projectDirectory, "subfolder-workspace", { "nx.json": "{}\n" });
    const before = repositoryFiles(projectDirectory);

    // The plugin has been built and published to a local registry in the
    // globalSetup. `nx add` installs it from there and runs its init generator.
    const result = spawnSync("pnpm", ["exec", "nx", "add", "@convesoft/nx-rust@e2e"], {
      cwd: projectDirectory,
      env: cargo.environment(testEnvironment()),
      encoding: "utf8",
    });
    const output = withoutColours(`${result.stdout}${result.stderr}`);
    if (result.status !== 0) {
      throw new Error(`nx add exited with status ${result.status}:\n${output}`);
    }
    added = {
      output,
      changed: changedFiles(before, repositoryFiles(projectDirectory)),
      calls: cargo.calls(projectDirectory),
    };
  }, 300_000);

  afterAll(() => {
    rmSync(wrapperDirectory, { recursive: true, force: true });
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

  it("is registered by nx add, which changes no other file than the install's", () => {
    // The install changes the package manager's files: package.json, the
    // lockfile and pnpm-workspace.yaml, where pnpm records build scripts.
    // init writes nx.json and nothing else.
    const installFiles = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
    expect(added.changed.filter((path) => !installFiles.includes(path))).toEqual(["nx.json"]);
    expect(added.changed).toContain("package.json");
    expect(JSON.parse(readFileSync(join(projectDirectory, "nx.json"), "utf8"))).toEqual({
      plugins: ["@convesoft/nx-rust"],
    });
    expect(
      JSON.parse(readFileSync(join(projectDirectory, "package.json"), "utf8")).devDependencies,
    ).toHaveProperty("@convesoft/nx-rust");
    // init checked the workspace as graph creation does, before registering.
    expect(added.calls).toEqual([readRustWorkspace]);
    // Its report: the tools that are missing and not needed, and the build
    // directory inside the repository.
    expect(added.output).toMatch(/Not installed and not needed by your settings: .*cargo-audit/);
    expect(added.output).toContain("  rust: rust/target\n");
    expect(added.output).toContain('build-dir = "{cargo-cache-home}/build/{workspace-path-hash}"');
  });

  // Every run publishes the same version, so a package that an earlier run
  // published, still known to a cache, would install without an error.
  it("installs the plugin that the global setup built", () => {
    const installed = join(projectDirectory, "node_modules", "@convesoft", "nx-rust");
    const built = join(workspaceRoot, "dist", "nx-rust");

    expect(fileDigests(installed)).toEqual(fileDigests(built));
  });

  // The global setup builds the plugin from this project's folder, not from
  // the workspace root, and the package has to look the same either way.
  it("has the README and the licences at the package root", () => {
    const installed = join(projectDirectory, "node_modules", "@convesoft", "nx-rust");
    const sources = {
      "README.md": join(workspaceRoot, "nx-rust", "README.md"),
      "LICENSE-APACHE": join(workspaceRoot, "LICENSE-APACHE"),
      "LICENSE-MIT": join(workspaceRoot, "LICENSE-MIT"),
    };

    for (const [file, source] of Object.entries(sources)) {
      expect(readFileSync(join(installed, file), "utf8")).toEqual(readFileSync(source, "utf8"));
    }
  });

  it(
    "creates a crate with the installed library generator",
    () => {
      cargo.clear();
      const output = nx(projectDirectory, cargo, [
        "g",
        "@convesoft/nx-rust:library",
        "rust/crates/fresh",
      ]);

      expect(output).toContain("Generating @convesoft/nx-rust:library");
      expect(cargo.calls(projectDirectory)).toEqual([
        // Nx creates the graph before it runs the generator.
        readRustWorkspace,
        { cwd: ".", args: ["new", "--vcs", "none", "--lib", "rust/crates/fresh"] },
      ]);
      expect(
        readFileSync(join(projectDirectory, "rust/crates/fresh/Cargo.toml"), "utf8"),
      ).toContain('name = "fresh"');
    },
    HARNESS_TIMEOUT,
  );

  describe("with a fixture", () => {
    beforeAll(() => {
      installFixture(projectDirectory, "subfolder-workspace");
      // Ahead of Node's folder on the PATH that nx:run-commands builds.
      cargo.placeIn(join(projectDirectory, "node_modules", ".bin"));
      installProbeExecutor(projectDirectory);
    });

    beforeEach(() => cargo.clear());

    it(
      "creates the fixture's projects and edges through the installed plugin",
      () => {
        const projects = JSON.parse(nx(projectDirectory, cargo, ["show", "projects", "--json"]));

        // A project per crate and the workspace project, from one cargo call.
        expect([...projects].sort()).toEqual(["api", "codegen", "model", "rust", "testkit"]);
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

        // Outside the test project, like the wrapper.
        const file = join(wrapperDirectory, "graph.json");
        nx(projectDirectory, cargo, ["graph", `--file=${file}`]);
        const dependencies: Record<string, { source: string; target: string }[]> = JSON.parse(
          readFileSync(file, "utf8"),
        ).graph.dependencies;
        const edges = Object.values(dependencies)
          .flat()
          .map((edge) => [edge.source, edge.target]);
        expect(edges).toEqual(
          expect.arrayContaining([
            ["api", "model"],
            ["api", "codegen"],
            ["api", "testkit"],
            ["rust", "api"],
            ["rust", "codegen"],
            ["rust", "model"],
            ["rust", "testkit"],
          ]),
        );
        expect(edges).toHaveLength(7);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "infers the targets through the installed plugin, with no task dependencies",
      () => {
        const show = (project: string) =>
          JSON.parse(nx(projectDirectory, cargo, ["show", "project", project, "--json"])).targets;
        const api = show("api");
        const rust = show("rust");

        expect(Object.keys(api)).toEqual(["build", "check", "lint", "test", "fmt-check", "fmt"]);
        expect(Object.keys(rust)).toEqual(["doc", "audit", "update"]);
        for (const target of [...Object.values(api), ...Object.values(rust)]) {
          expect(target).toMatchObject({ executor: "@convesoft/nx-rust:cargo", cache: false });
          expect(target).not.toHaveProperty("dependsOn");
        }

        // Nx builds the task graph without running a task, which needs no
        // executor yet (nxr-kmdpgj).
        const file = join(wrapperDirectory, "tasks.json");
        nx(projectDirectory, cargo, ["run-many", "-t", "build", "test", "lint", `--graph=${file}`]);
        const { tasks } = JSON.parse(readFileSync(file, "utf8"));
        expect(Object.keys(tasks.tasks)).toHaveLength(12);
        expect(Object.values(tasks.dependencies).flat()).toEqual([]);
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
