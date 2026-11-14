import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CargoCall,
  type Env,
  type FileChanges,
  HARNESS_TIMEOUT,
  inFixture,
  lockfileCalls,
  packageSpec,
  pluginWorkers,
  pnpmLockfile,
  runNx,
  taskCalls,
  withoutColours,
  withTargetDefaults,
} from "./harness";

// The pluginVersion cases of VER-CACHE-KEYS and VER-SETUP: a pluginVersion
// that the plugin did not set fails graph creation where Nx merges it over
// an inferred target, and the task where only the run gives it, before cargo
// runs. Real graph creation and task runs in fixture workspaces, with the
// plugin loaded from its source, which puts its version into pluginVersion
// because Nx has no node for its package there.

const cargoExecutor = "@convesoft/nx-rust:cargo";
const runExecutor = "@convesoft/nx-rust:run";
const lockfileExecutor = "@convesoft/nx-rust:lockfile";
const pluginVersion: string = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
).version;

const reason =
  "Only nx-rust sets this option: it carries the plugin's version into the cache key, and another value would take its place, so that Nx could restore results of another version of the plugin.";

/** The inferred targets of each crate of `subfolder-workspace`, in the order the plugin gives them. */
const crateTargets = '"build", "check", "lint", "test", "fmt-check" and "fmt"';

const options = { options: { pluginVersion: "0.0.0" } };

/** Graph creation in `subfolder-workspace`, with the variables `env`. */
function graphCreation(env: Env = {}) {
  /** Graph creation with `files`; returns its exit status and output. */
  async function showProjects(
    ...files: FileChanges[]
  ): Promise<{ status: number | null; output: string }> {
    let result = { status: null as number | null, output: "" };
    await inFixture("subfolder-workspace", Object.assign({}, ...files), async (workspace) => {
      const { status, output } = await workspace.nx(["show", "projects"], env);
      result = { status, output: withoutColours(output) };
    });
    return result;
  }

  /** Graph creation fails; returns the plugin's message. */
  async function failed(...files: FileChanges[]): Promise<string> {
    const { status, output } = await showProjects(...files);
    expect({
      status,
      failedIn: output.includes("threw an error while creating dependencies"),
    }).toEqual({
      status: 1,
      failedIn: true,
    });
    return output;
  }

  return { showProjects, failed };
}

const { showProjects, failed } = graphCreation();

/**
 * Graph creation with the plugin in a worker, as in Nx's default mode, for
 * one case of each origin: the check in createDependencies reads what
 * createNodes recorded.
 */
const inPluginWorkers = graphCreation(pluginWorkers);

describe("a pluginVersion that the plugin did not set fails graph creation", () => {
  it(
    "from a targetDefaults entry keyed by the executors, naming the entry and every target it reaches",
    async () => {
      const output = await inPluginWorkers.failed({
        "nx.json": withTargetDefaults({
          [cargoExecutor]: options,
          [runExecutor]: options,
          [lockfileExecutor]: options,
        }),
      });

      expect(output).toContain(
        [
          `The targetDefaults entry "${cargoExecutor}" in nx.json sets the option "pluginVersion" on targets that nx-rust infers. ${reason} Remove it there. It reaches:`,
          `  - api (rust/crates/api/Cargo.toml): ${crateTargets}`,
          `  - codegen (rust/crates/codegen/Cargo.toml): ${crateTargets}`,
          `  - model (rust/crates/model/Cargo.toml): ${crateTargets}`,
          `  - testkit (rust/crates/testkit/Cargo.toml): ${crateTargets}`,
          '  - rust (rust/Cargo.toml): "doc", "audit" and "update"',
        ].join("\n"),
      );
      // The lockfile task carries the plugin's version like every inferred target.
      expect(output).toContain(
        [
          `The targetDefaults entry "${lockfileExecutor}" in nx.json sets the option "pluginVersion" on targets that nx-rust infers. ${reason} Remove it there. It reaches:`,
          '  - rust (rust/Cargo.toml): "lockfile"',
        ].join("\n"),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "from an element of a targetDefaults list and from a configuration, naming the element and the configuration",
    async () => {
      const output = await failed({
        "nx.json": withTargetDefaults({
          test: [
            { filter: { projects: ["api"] }, options: {} },
            { filter: { projects: ["model"] }, configurations: { ci: { pluginVersion: "0.0.0" } } },
          ],
        }),
      });

      expect(output).toContain(
        [
          `The targetDefaults entry "test" in nx.json (its element 1) sets the option "pluginVersion" on targets that nx-rust infers. ${reason} Remove it there. It reaches:`,
          '  - model (rust/crates/model/Cargo.toml): "test" (configuration "ci")',
        ].join("\n"),
      );
      expect(output).not.toContain("api (rust/crates/api/Cargo.toml)");
    },
    HARNESS_TIMEOUT,
  );

  it(
    "from a project.json, naming the file, and from a targetDefaults entry beside it",
    async () => {
      const output = await inPluginWorkers.failed(
        { "nx.json": withTargetDefaults({ test: options }) },
        {
          "rust/crates/api/project.json": JSON.stringify({
            targets: { test: { options: { pluginVersion: "1.0.0" } }, build: options },
          }),
        },
      );

      expect(output).toContain(
        [
          `The file rust/crates/api/project.json sets the option "pluginVersion" on targets that nx-rust infers. ${reason} Remove it there. It reaches:`,
          '  - api (rust/crates/api/Cargo.toml): "build" and "test"',
        ].join("\n"),
      );
      // The project.json's value wins for api:test, and the entry reaches the other crates.
      expect(output).toContain(
        [
          `The targetDefaults entry "test" in nx.json sets the option "pluginVersion" on targets that nx-rust infers. ${reason} Remove it there. It reaches:`,
          '  - codegen (rust/crates/codegen/Cargo.toml): "test"',
          '  - model (rust/crates/model/Cargo.toml): "test"',
          '  - testkit (rust/crates/testkit/Cargo.toml): "test"',
        ].join("\n"),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "from a package.json that the package manager's workspaces list, naming the file",
    async () => {
      const output = await failed({
        "package.json": JSON.stringify({
          name: "repo",
          private: true,
          workspaces: ["rust/crates/*"],
        }),
        "rust/crates/model/package.json": JSON.stringify({
          name: "model-js",
          nx: { name: "model", targets: { lint: options } },
        }),
      });

      expect(output).toContain(
        [
          `The file rust/crates/model/package.json sets the option "pluginVersion" on targets that nx-rust infers. ${reason} Remove it there. It reaches:`,
          '  - model (rust/crates/model/Cargo.toml): "lint"',
        ].join("\n"),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "from another plugin, with the command that shows where it comes from",
    async () => {
      const output = await inPluginWorkers.failed({
        "other.cjs": `exports.name = "other";
exports.createNodes = [
  "**/Cargo.toml",
  async (files) =>
    files
      .filter((file) => file === "rust/crates/api/Cargo.toml")
      .map((file) => [file, { projects: { "rust/crates/api": { targets: { check: ${JSON.stringify({ executor: cargoExecutor, ...options })} } } } }]),
];
`,
        "nx.json": (nxJson) => {
          const config = JSON.parse(nxJson ?? "{}");
          return JSON.stringify({ ...config, plugins: [...config.plugins, "./other.cjs"] });
        },
      });

      expect(output).toContain(
        [
          `These targets that nx-rust infers have the option "pluginVersion", and nx-rust cannot tell which configuration sets it, such as another plugin listed in nx.json. ${reason} For each, run the command given, look under "sourceMap" for the file and entry, and remove it there:`,
          '  - "check" of api (rust/crates/api/Cargo.toml): `nx show target api:check --json`',
        ].join("\n"),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "where Nx has a node for the plugin's package, so that the plugin sets none",
    async () => {
      const output = await failed(
        {
          "package.json": JSON.stringify({
            name: "repo",
            private: true,
            devDependencies: { "@convesoft/nx-rust": "0.0.1", "left-pad": "1.3.0" },
          }),
          "pnpm-lock.yaml": pnpmLockfile("0.0.1"),
          "node_modules/.modules.yaml": "{}\n",
        },
        { "nx.json": withTargetDefaults({ test: options }) },
      );

      expect(output).toContain(
        `The targetDefaults entry "test" in nx.json sets the option "pluginVersion" on targets that nx-rust infers. ${reason} Remove it there. It reaches:\n  - api (rust/crates/api/Cargo.toml): "test"`,
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "but not for the plugin's own value, which a project.json repeats",
    async () => {
      const { status, output } = await showProjects({
        "rust/crates/api/project.json": JSON.stringify({
          targets: { test: { options: { pluginVersion } } },
        }),
      });

      expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
      expect(output).not.toContain("pluginVersion");
    },
    HARNESS_TIMEOUT,
  );
});

describe("a pluginVersion that only the run gives", () => {
  it(
    "fails the task before cargo runs, and the plugin's own value or the words after -- for run do not",
    () =>
      // With the plugin in a worker, as in Nx's default mode.
      inFixture("crate-shapes", undefined, async (workspace) => {
        const failedRun = await runNx(
          workspace,
          ["run", "core-lib:check", "--pluginVersion=0.0.0", "--skip-nx-cache"],
          pluginWorkers,
        );
        expect(failedRun.status).toBe(1);
        expect(failedRun.output).toContain(
          'core-lib:check: this run gives the option "pluginVersion" the value "0.0.0", but only @convesoft/nx-rust sets that option, to carry its version into the cache key. The value comes from the command line, such as --pluginVersion, or from a task that forwards its options to this one: leave it out. The task does not run, so that Nx stores no result for it.',
        );
        expect(taskCalls(workspace)).toEqual([]);

        // The lockfile task, which has an executor of its own, alike.
        workspace.cargo.clear();
        const lockfileRun = await runNx(
          workspace,
          ["run", "rust:lockfile", "--pluginVersion=0.0.0"],
          pluginWorkers,
        );
        expect(lockfileRun.status).toBe(1);
        expect(lockfileRun.output).toContain(
          'rust:lockfile: this run gives the option "pluginVersion" the value "0.0.0", but only @convesoft/nx-rust sets that option',
        );
        expect(lockfileCalls(workspace)).toEqual([]);

        const ownValue = await runNx(
          workspace,
          ["run", "core-lib:check", `--pluginVersion=${pluginVersion}`, "--skip-nx-cache"],
          pluginWorkers,
        );
        expect(ownValue.status).toBe(0);
        expect(taskCalls(workspace)).toEqual<CargoCall[]>([
          {
            cwd: "rust",
            args: ["check", "--all-targets", "-p", packageSpec(workspace.root, "rust", "core-lib")],
          },
        ]);

        workspace.cargo.clear();
        const forwarded = await runNx(
          workspace,
          ["run", "cli:run", "--skip-nx-cache", "--", "--pluginVersion=0.0.0"],
          pluginWorkers,
        );
        expect(forwarded.status).toBe(0);
        expect(taskCalls(workspace)).toEqual<CargoCall[]>([
          {
            cwd: "rust",
            args: [
              "run",
              "-p",
              packageSpec(workspace.root, "rust", "cli"),
              "--",
              "--pluginVersion=0.0.0",
            ],
          },
        ]);
      }),
    HARNESS_TIMEOUT,
  );
});
