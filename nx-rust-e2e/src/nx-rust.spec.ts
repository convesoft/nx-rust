import { NX_VERSION, workspaceRoot } from "@nx/devkit";
import { execFileSync, execSync, spawnSync } from "child_process";
import { createHash } from "crypto";
import { join, relative, sep } from "path";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import {
  CargoCall,
  CargoWrapper,
  cargoProbeProject,
  changedFiles,
  fakeNxPackage,
  HARNESS_TIMEOUT,
  installFixture,
  installProbeExecutor,
  repositoryFiles,
  testEnvironment,
  withoutColours,
} from "../../nx-rust/test/harness";

const cargoExecutor = "@convesoft/nx-rust:cargo";
const runExecutor = "@convesoft/nx-rust:run";

/** The empty target defaults that init adds for the plugin's executors. */
const executorEntries = { [cargoExecutor]: {}, [runExecutor]: {} };

/** The line with which init says which target defaults it added. */
function addedLine(executors: string[]): string {
  const entries = executors.map((executor) => `"${executor}": {}`).join(" and ");
  return `Added ${entries} to targetDefaults in nx.json, keyed by the executors of the targets that nx-rust infers.`;
}

/** The part of that line that names no entry. */
const addedAny = "to targetDefaults in nx.json, keyed by the executors";

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
      targetDefaults: executorEntries,
    });
    expect(added.output).toContain(addedLine(Object.keys(executorEntries)));
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

  // The suite runs on the Nx that this repository installs, so the range
  // names exactly the majors it has passed on (REQ-COMPATIBILITY).
  it("names the Nx major that the suite runs on, and no other, in its peer dependency range", () => {
    const installed = JSON.parse(
      readFileSync(
        join(projectDirectory, "node_modules", "@convesoft", "nx-rust", "package.json"),
        "utf8",
      ),
    );

    expect(installed.peerDependencies).toEqual({ nx: `^${NX_VERSION.split(".")[0]}` });
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

        // Nx builds the task graph without running a task.
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

    // The installed package reads the Nx majors it supports from its own
    // package.json. A copy of Nx that gives the next major as its version,
    // linked in place of the installed one, shows what it does with a newer
    // Nx; the variable lets it continue.
    describe("with an Nx major newer than its peer dependency range names", () => {
      const major = Number(NX_VERSION.split(".")[0]);
      const newer = `${major + 1}.0.0`;
      const fakeDirectory = join(process.cwd(), "tmp", "nx-newer");
      let link: string;
      let installedNx: string;

      beforeAll(() => {
        link = join(projectDirectory, "node_modules", "nx");
        installedNx = readlinkSync(link);
        rmSync(fakeDirectory, { recursive: true, force: true });
        const copy = fakeNxPackage(fakeDirectory, newer);
        rmSync(link);
        symlinkSync(copy, link, "dir");
      });

      afterAll(() => {
        rmSync(link, { force: true });
        symlinkSync(installedNx, link, "dir");
        rmSync(fakeDirectory, { recursive: true, force: true });
      });

      /** Runs the linked Nx, which pnpm's `nx` command would bypass. */
      function newerNx(env: Record<string, string> = {}) {
        const result = spawnSync(
          process.execPath,
          [
            join(projectDirectory, "node_modules", "nx", "dist", "bin", "nx.js"),
            "show",
            "projects",
          ],
          {
            cwd: projectDirectory,
            env: { ...cargo.environment(testEnvironment()), NX_TUI: "false", ...env },
            encoding: "utf8",
          },
        );
        return {
          status: result.status,
          output: withoutColours(`${result.stdout}${result.stderr}`),
        };
      }

      const untested = `nx-rust has not been checked with Nx ${newer}, which is installed in this repository: this version of @convesoft/nx-rust supports Nx ${major}.`;

      it(
        "stops graph creation, naming the version found and the supported major",
        () => {
          const { status, output } = newerNx();

          expect(status).toBe(1);
          expect(output).toContain(untested);
          expect(output).toContain("NX_RUST_ALLOW_UNSUPPORTED_NX=true");
        },
        HARNESS_TIMEOUT,
      );

      it(
        "continues with a warning when NX_RUST_ALLOW_UNSUPPORTED_NX is true",
        () => {
          const { status, output } = newerNx({ NX_RUST_ALLOW_UNSUPPORTED_NX: "true" });

          expect(status).toBe(0);
          expect(output).toContain(untested);
          expect(output).toContain("It continues because NX_RUST_ALLOW_UNSUPPORTED_NX is true");
          expect(output).toContain("api");
        },
        HARNESS_TIMEOUT,
      );
    });

    // VER-CARGO-UNCHANGED, as far as tasks that run one cargo call each show
    // it: the test project becomes a git repository of its own, with the
    // ignore rules of a real one.
    describe("when Nx runs the inferred targets", () => {
      const crates = ["api", "codegen", "model", "testkit"];
      const rustFolder = () => join(projectDirectory, "rust");
      const git = (...args: string[]) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=nx-rust e2e",
            "-c",
            "user.email=e2e@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
            ...args,
          ],
          { cwd: projectDirectory, encoding: "utf8" },
        );
      // The plain cargo commands that do what `nx run-many -t build test lint` does.
      const plainCargo = () =>
        crates
          .flatMap((crate) => [
            ["build", "-p", crate],
            ["test", "-p", crate],
            ["clippy", "--all-targets", "-p", crate],
          ])
          .map((args) => {
            const result = spawnSync("cargo", args, {
              cwd: rustFolder(),
              env: cargo.environment(testEnvironment()),
              encoding: "utf8",
            });
            return { args, status: result.status, output: `${result.stdout}${result.stderr}` };
          });
      const compiles = /^\s*(Compiling|Checking) /m;

      beforeAll(() => {
        installFixture(projectDirectory, "subfolder-workspace", {
          ".gitignore": "node_modules/\n.nx/cache\n.nx/workspace-data\ntarget/\n",
        });
        cargo.placeIn(join(projectDirectory, "node_modules", ".bin"));
        git("init", "--quiet");
        git("add", "--all");
        git("commit", "--quiet", "--message", "The fixture");
      });

      afterAll(() => rmSync(join(projectDirectory, ".git"), { recursive: true, force: true }));

      it(
        "runs a target through the installed plugin's executor",
        () => {
          const output = withoutColours(
            nx(projectDirectory, cargo, ["run", "api:build", "--output-style=static"]),
          );

          expect(output).toContain("Compiling api v0.1.0");
          expect(output).toContain("Successfully ran target build for project api");
          expect(cargo.calls(projectDirectory)).toEqual([
            readRustWorkspace,
            { cwd: "rust", args: ["build", "-p", "api"] },
          ]);
        },
        HARNESS_TIMEOUT,
      );

      it(
        "ignores options that the executor does not know and says they came from the command line",
        () => {
          // The installed plugin's preTasksExecution hook records the
          // command, and its executor reads the schema beside it.
          const output = withoutColours(
            nx(projectDirectory, cargo, [
              "run",
              "api:build",
              "--output-style=static",
              "--coverage",
              "--allTargets",
            ]),
          );

          expect(output).toContain(
            "api:build: ignoring option `coverage`, passed on the command line.",
          );
          expect(output).toContain(
            "api:build: ignoring option `allTargets`, which this target does not take, passed on the command line.",
          );
          // Words after -- reach the task as positional arguments, which the
          // executor compares with Nx's own parse of the command line.
          const positional = withoutColours(
            nx(projectDirectory, cargo, [
              "run",
              "api:build",
              "--output-style=static",
              "--",
              "3000",
            ]),
          );
          expect(positional).toContain(
            'api:build: ignoring the positional arguments ["3000"] (option `_`), passed on the command line.',
          );
          expect(cargo.calls(projectDirectory)).toEqual([
            readRustWorkspace,
            { cwd: "rust", args: ["build", "-p", "api"] },
            readRustWorkspace,
            { cwd: "rust", args: ["build", "-p", "api"] },
          ]);
        },
        HARNESS_TIMEOUT,
      );

      it(
        "shares its builds with plain cargo in both orders",
        () => {
          // Nx first, then plain cargo, which finds nothing to compile.
          nx(projectDirectory, cargo, ["run-many", "-t", "build", "test", "lint"]);
          for (const result of plainCargo()) {
            expect(result).toEqual({ ...result, status: 0 });
            expect(result.output).not.toMatch(compiles);
          }

          // Plain cargo from scratch, then Nx, whose tasks compile nothing.
          execFileSync("cargo", ["clean"], {
            cwd: rustFolder(),
            env: cargo.environment(testEnvironment()),
          });
          for (const result of plainCargo()) {
            expect(result).toEqual({ ...result, status: 0 });
          }
          cargo.clear();
          const output = withoutColours(
            nx(projectDirectory, cargo, [
              "run-many",
              "-t",
              "build",
              "test",
              "lint",
              "--output-style=static",
            ]),
          );
          expect(output).toContain("Successfully ran targets build, test, lint for 4 projects");
          expect(output).not.toMatch(compiles);
          // Each task ran cargo, which found everything up to date.
          expect(cargo.calls(projectDirectory)).toHaveLength(1 + 3 * crates.length);
        },
        HARNESS_TIMEOUT,
      );

      it(
        "leaves no file changed or new in the repository",
        () => {
          nx(projectDirectory, cargo, [
            "run-many",
            "-t",
            "build",
            "check",
            "lint",
            "test",
            "fmt-check",
            "fmt",
            "doc",
            "update",
          ]);

          expect(git("status", "--porcelain", "--untracked-files=all")).toEqual("");
        },
        HARNESS_TIMEOUT,
      );
    });

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

  // The installed package lays target tables over the inferred targets and
  // compares its entries in nx.json through parts of the installed Nx.
  describe("with settings in Cargo.toml and nx.json", () => {
    beforeAll(() => {
      installFixture(projectDirectory, "subfolder-workspace", {
        "rust/Cargo.toml": (manifest) =>
          `${manifest}\n[workspace.metadata.nx]\nnamePrefix = "be-"\ntags = ["lang:rust"]\n\n[workspace.metadata.nx.targets.test]\ninputs = ["...", { env = "DATABASE_URL" }]\n`,
        "rust/crates/model/Cargo.toml": (manifest) =>
          `${manifest}\n[package.metadata.nx]\nname = "backend"\n`,
      });
    });

    it(
      "names the projects and applies the tables through the installed plugin",
      () => {
        const projects = JSON.parse(nx(projectDirectory, cargo, ["show", "projects", "--json"]));
        const api = JSON.parse(
          nx(projectDirectory, cargo, ["show", "project", "be-api", "--json"]),
        );

        expect([...projects].sort()).toEqual([
          "backend",
          "be-api",
          "be-codegen",
          "be-testkit",
          "rust",
        ]);
        expect(api.tags).toEqual(["lang:rust"]);
        expect(api.targets.test.inputs).toEqual([{ env: "DATABASE_URL" }]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "fails graph creation when two entries give the workspace different test runners",
      () => {
        writeFileSync(
          join(projectDirectory, "nx.json"),
          `${JSON.stringify({
            plugins: [
              {
                plugin: "@convesoft/nx-rust",
                include: ["rust/Cargo.toml", "rust/crates/api/**"],
                options: { testRunner: "nextest" },
              },
              {
                plugin: "@convesoft/nx-rust",
                include: [
                  "rust/crates/model/**",
                  "rust/crates/codegen/**",
                  "rust/crates/testkit/**",
                ],
              },
            ],
          })}\n`,
        );

        const { status, stdout, stderr } = spawnSync("pnpm", ["exec", "nx", "show", "projects"], {
          cwd: projectDirectory,
          env: cargo.environment(testEnvironment()),
          encoding: "utf8",
        });

        expect(status).toBe(1);
        expect(withoutColours(`${stdout}${stderr}`)).toContain(
          'give it different values of "testRunner": plugins[0] sets "nextest"; plugins[1] does not set it, which gives the default "cargo"',
        );
      },
      HARNESS_TIMEOUT,
    );
  });

  // init adds an empty target default for each of the plugin's executors
  // that nx.json lacks, so that entries keyed by a target name or by another
  // executor keep to the JS projects, and leaves every existing entry alone.
  describe("nx add in a repository with targetDefaults", () => {
    /** A JS project beside the crates, with a build that target defaults reach. */
    const web = {
      "web/project.json": `${JSON.stringify({ name: "web", targets: { build: { executor: "nx:noop" } } })}\n`,
    };
    /** A target default keyed by a target name, as JS repositories have it. */
    const buildDefault = {
      build: { cache: true, dependsOn: ["^build"], inputs: ["default", "^default"] },
    };

    /** Installs the fixture with `targetDefaults` in an nx.json without the plugin. */
    function prepare(targetDefaults: object): void {
      installFixture(projectDirectory, "subfolder-workspace", {
        ...web,
        "nx.json": `${JSON.stringify({ targetDefaults }, null, 2)}\n`,
      });
    }

    function nxAdd(): { status: number | null; output: string } {
      const result = spawnSync("pnpm", ["exec", "nx", "add", "@convesoft/nx-rust@e2e"], {
        cwd: projectDirectory,
        env: cargo.environment(testEnvironment()),
        encoding: "utf8",
      });
      return { status: result.status, output: withoutColours(`${result.stdout}${result.stderr}`) };
    }

    const readNxJson = () => readFileSync(join(projectDirectory, "nx.json"), "utf8");
    const show = (project: string) =>
      JSON.parse(nx(projectDirectory, cargo, ["show", "project", project, "--json"])).targets;

    it("adds the entries beside a build default keyed by the target name, which then reaches only the JS project, and adds nothing when run again", () => {
      prepare(buildDefault);

      const first = nxAdd();

      expect(first.status).toBe(0);
      expect(JSON.parse(readNxJson())).toEqual({
        targetDefaults: { ...buildDefault, ...executorEntries },
        plugins: ["@convesoft/nx-rust"],
      });
      expect(first.output).toContain(addedLine(Object.keys(executorEntries)));
      expect(first.output).not.toContain("changes targets that nx-rust infers");
      // The entry keyed "build" reaches the JS project and not the crates.
      expect(show("web").build).toMatchObject(buildDefault.build);
      const api = show("api").build;
      expect(api).not.toHaveProperty("dependsOn");
      expect(api.inputs).not.toEqual(buildDefault.build.inputs);

      // A second nx add finds the plugin and both entries and writes nothing.
      const before = readNxJson();
      const second = nxAdd();

      expect(second.status).toBe(0);
      expect(readNxJson()).toBe(before);
      expect(second.output).not.toContain(addedAny);
    }, 300_000);

    it("adds the entries beside entries keyed by other executors only", () => {
      const defaults = { "@nx/js:tsc": { cache: true, dependsOn: ["^build"] } };
      prepare(defaults);

      const { status, output } = nxAdd();

      expect(status).toBe(0);
      expect(JSON.parse(readNxJson())).toEqual({
        targetDefaults: { ...defaults, ...executorEntries },
        plugins: ["@convesoft/nx-rust"],
      });
      expect(output).toContain(addedLine(Object.keys(executorEntries)));
    }, 300_000);

    it("keeps an entry keyed by the plugin's executor as it is, warns about it and adds the other entry", () => {
      const defaults = { ...buildDefault, [cargoExecutor]: { dependsOn: ["^build"] } };
      prepare(defaults);

      const { status, output } = nxAdd();

      expect(status).toBe(0);
      expect(JSON.parse(readNxJson())).toEqual({
        targetDefaults: { ...defaults, [runExecutor]: {} },
        plugins: ["@convesoft/nx-rust"],
      });
      expect(output).toContain(addedLine([runExecutor]));
      expect(output).toContain(
        `The targetDefaults entry "${cargoExecutor}" in nx.json changes targets that nx-rust infers:`,
      );
      expect(output).not.toContain('The targetDefaults entry "build"');
    }, 300_000);

    it("stops and leaves nx.json unchanged for an entry keyed by the plugin's executor that turns on caching", () => {
      prepare({ ...buildDefault, [cargoExecutor]: { cache: true } });
      const before = readNxJson();

      const { status, output } = nxAdd();

      expect(status).toBe(1);
      expect(output).toContain(
        `The targetDefaults entry "${cargoExecutor}" in nx.json changes targets that nx-rust infers:`,
      );
      expect(output).toContain("nx.json is unchanged.");
      expect(readNxJson()).toBe(before);
    }, 300_000);
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
 * digest of its contents. A `node_modules` folder directly below `directory`
 * is left out: pnpm writes the commands of an installed package's
 * dependencies there, such as those of its peer dependency nx, and the
 * package does not contain it.
 */
function fileDigests(directory: string): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const file = relative(directory, path);
    if (entry.isFile() && !file.startsWith(`node_modules${sep}`)) {
      digests[file] = createHash("sha256").update(readFileSync(path)).digest("hex");
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
