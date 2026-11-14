import type { NxJsonConfiguration, ProjectConfiguration, TargetConfiguration } from "@nx/devkit";
import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CargoGraph } from "../src/graph/projects";
import {
  describeTargetDefaultChanges,
  findTargetDefaultChanges,
  loadTargetDefaultsInternals,
  targetDefaultsGuide,
} from "../src/graph/target-defaults";
import {
  changedFiles,
  type Env,
  FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  pluginEntry,
  pluginWorkers,
  repositoryFiles,
  withoutColours,
} from "./harness";

// Checks VER-TARGET-DEFAULT-GUARD and the target-default cases of VER-SETUP
// with Nx's own graph creation and a real `nx g`. Every cached crate target
// but fmt-check depends on the workspace's lockfile task, so an entry that
// adds to a crate target's dependsOn keeps that dependency with "...", or it
// replaces it (DES-LOCKFILE-HASHING).

const pluginName = "@convesoft/nx-rust";
const nxVersion: string = require("nx/package.json").version;
const cargoExecutor = "@convesoft/nx-rust:cargo";
const runExecutor = "@convesoft/nx-rust:run";
const lockfileExecutor = "@convesoft/nx-rust:lockfile";
/** The dependency of the crates' cached targets on the lockfile task of `rust`. */
const lockfileTask = { projects: ["directory:rust"], target: "lockfile" };

/** The crates of `subfolder-workspace`, each with its manifest, by name. */
const crates = {
  api: "rust/crates/api/Cargo.toml",
  codegen: "rust/crates/codegen/Cargo.toml",
  model: "rust/crates/model/Cargo.toml",
  testkit: "rust/crates/testkit/Cargo.toml",
};

/** Every crate of `subfolder-workspace`, as the report names a project. */
const allCrates = Object.entries(crates).map(([name, manifest]) => `${name} (${manifest})`);

/**
 * What `output` leaves out of a finding: `change`, what an entry does to
 * which targets, and each of `projects`, each a fact of its own. The reason
 * the report gives for the change, its layout and the order of the projects
 * are left out; DES-DIAGNOSTICS asks the tests for the fact and for what
 * the user can do.
 */
function missingFromReport(output: string, change: string, projects: string[]): string[] {
  return [change, ...projects].filter((fact) => !output.includes(fact));
}

/** A JS project beside the crates, whose `build` and `lint` a target default can reach. */
const web: FileChanges = {
  "web/project.json": JSON.stringify({
    name: "web",
    targets: { build: { executor: "nx:noop" }, lint: { executor: "nx:noop" } },
  }),
};

/**
 * Cargo's configuration of the workspace picks a triple whose folder the
 * plugin cannot name, so that it leaves `build` and `doc` uncached
 * (`DES-OUTPUTS`).
 */
const tripleFromConfiguration: FileChanges = {
  "rust/.cargo/config.toml": '[build]\ntarget = "host-tuple"\n',
};

/** Sets `targetDefaults` in a fixture copy's `nx.json`. */
function targetDefaults(defaults: object): FileChanges {
  return {
    "nx.json": (nxJson) =>
      JSON.stringify({ ...JSON.parse(nxJson ?? "{}"), targetDefaults: defaults }),
  };
}

/**
 * Runs `nx show projects --json` in a copy of `subfolder-workspace` with
 * `files` and the Nx daemon off, and returns what Nx printed besides the
 * list, and the projects where it succeeded.
 */
async function showProjects(
  ...files: FileChanges[]
): Promise<{ status: number | null; output: string; workspace: FixtureWorkspace }> {
  return showProjectsWith({}, ...files);
}

/** {@link showProjects} with the variables `env`. */
async function showProjectsWith(
  env: Env,
  ...files: FileChanges[]
): Promise<{ status: number | null; output: string; workspace: FixtureWorkspace }> {
  const workspace = FixtureWorkspace.create("subfolder-workspace", web, ...files);
  const { status, output } = await workspace.nx(["show", "projects"], env);
  return { status, output: withoutColours(output), workspace };
}

/** Graph creation with `defaults` succeeds; returns its output and the merged projects. */
async function created(
  defaults: object,
  files: FileChanges = {},
): Promise<{ output: string; projects: Record<string, ProjectConfiguration> }> {
  const { status, output, workspace } = await showProjects(targetDefaults(defaults), files);
  try {
    expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
    const { projects } = await workspace.graph();
    return { output, projects };
  } finally {
    workspace.remove();
  }
}

/** Graph creation with `defaults` and the variables `env` fails; returns Nx's output. */
async function failed(defaults: object, files: FileChanges = {}, env: Env = {}): Promise<string> {
  const { status, output, workspace } = await showProjectsWith(
    env,
    targetDefaults(defaults),
    files,
  );
  workspace.remove();
  expect(status).not.toBe(0);
  expect(output).toContain("threw an error while creating dependencies");
  return output;
}

describe("a target default that adds dependencies on other projects' tasks", () => {
  it.each([
    ["the ^ form", "^build", '"^build"'],
    [
      "the object form",
      { target: "build", dependencies: true },
      '{"target":"build","dependencies":true}',
    ],
  ])(
    "in %s creates the graph and warns, naming the entry, the target, each crate and the fixes",
    async (_form, dependency, shown) => {
      const { output, projects } = await created({ build: { dependsOn: ["...", dependency] } });

      expect(projects.api.targets?.build.dependsOn).toEqual([lockfileTask, dependency]);
      expect(output).toContain(
        'The targetDefaults entry "build" in nx.json changes targets that nx-rust infers:',
      );
      expect(
        missingFromReport(output, `It adds ${shown} to the dependsOn of "build"`, allCrates),
      ).toEqual([]);
      expect(output).toContain(`To narrow the entry (${targetDefaultsGuide}), do one of these:`);
      expect(output).toContain(
        `Give the entry a "filter" that leaves these projects out, which needs the entry written as a list: "build": [{ "filter": { "projects": ["!tag:lang:rust"] }, ... }] where the crates carry the tag lang:rust, or a filter on the "executor" of the targets the entry is meant for.`,
      );
      expect(output).toContain(
        `Add an empty entry keyed by the executor of these targets, "${cargoExecutor}": {}.`,
      );
      expect(output).not.toContain('"..."');
    },
    HARNESS_TIMEOUT,
  );
});

describe("a target default that fails graph creation", () => {
  it(
    "turns on caching for build, keyed by the target's name, where the plugin leaves build uncached because Cargo's configuration picks a triple that it cannot name",
    async () => {
      // With the plugin in a worker, as in Nx's default mode: the check in
      // createDependencies reads what createNodes recorded.
      const output = await failed(
        { build: { cache: true } },
        tripleFromConfiguration,
        pluginWorkers,
      );

      expect(output).toContain(
        'The targetDefaults entry "build" in nx.json changes targets that nx-rust infers:',
      );
      expect(
        missingFromReport(
          output,
          'It turns on caching for "build", which nx-rust leaves uncached',
          allCrates,
        ),
      ).toEqual([]);
      expect(output).toContain(`To narrow the entry (${targetDefaultsGuide}), do one of these:`);
      expect(output).toContain(`"${cargoExecutor}": {}`);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "turns on caching for fmt, which stays uncached for good",
    async () => {
      const output = await failed({ fmt: { cache: true } });

      expect(
        missingFromReport(
          output,
          'It turns on caching for "fmt", which nx-rust leaves uncached',
          allCrates,
        ),
      ).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "turns on caching keyed by the plugin's executor for exactly the targets that the plugin leaves uncached, and says to remove the field",
    async () => {
      const output = await failed({ [cargoExecutor]: { cache: true } });

      expect(output).toContain(`The targetDefaults entry "${cargoExecutor}" in nx.json changes`);
      expect(
        missingFromReport(
          output,
          'It turns on caching for "fmt", which nx-rust leaves uncached',
          allCrates,
        ),
      ).toEqual([]);
      expect(
        missingFromReport(
          output,
          'It turns on caching for "audit" and "update", which nx-rust leaves uncached',
          ["rust (rust/Cargo.toml)"],
        ),
      ).toEqual([]);
      for (const cached of ["build", "check", "fmt-check", "lint", "test", "doc"]) {
        expect(output).not.toContain(`"${cached}"`);
      }
      expect(output).toContain('Remove "cache" from the entry.');
      expect(output).not.toContain(`"${cargoExecutor}": {}`);
    },
    HARNESS_TIMEOUT,
  );

  it.each([
    ["^build", "^build", '"^build"'],
    [
      "an object",
      { target: "build", dependencies: true },
      '{"target":"build","dependencies":true}',
    ],
  ])(
    "replaces the dependsOn of the crates' targets with %s, losing the dependency on the lockfile task, and also warns about the added dependency",
    async (_form, dependency, shown) => {
      const output = await failed({ build: { dependsOn: [dependency] } });

      expect(output).toContain(
        'The targetDefaults entry "build" in nx.json changes targets that nx-rust infers:',
      );
      expect(
        missingFromReport(
          output,
          'It replaces the dependsOn that nx-rust declares for "build"',
          allCrates,
        ),
      ).toEqual([]);
      expect(output).toContain(`To narrow the entry (${targetDefaultsGuide}), do one of these:`);
      expect(output).toContain(`putting "..." into the entry's "dependsOn" list`);
      expect(
        missingFromReport(output, `It adds ${shown} to the dependsOn of "build"`, allCrates),
      ).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "turns on caching for the lockfile task",
    async () => {
      const output = await failed({ lockfile: { cache: true } });

      expect(
        missingFromReport(
          output,
          'It turns on caching for "lockfile", which nx-rust leaves uncached',
          ["rust (rust/Cargo.toml)"],
        ),
      ).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "turns on caching for run, keyed by the run executor",
    async () => {
      const workspace = FixtureWorkspace.create(
        "crate-shapes",
        targetDefaults({ "@convesoft/nx-rust:run": { cache: true } }),
      );
      try {
        const { status, output } = await workspace.nx(["show", "projects"]);

        expect(status).not.toBe(0);
        expect(withoutColours(output)).toContain(
          'The targetDefaults entry "@convesoft/nx-rust:run" in nx.json changes targets that nx-rust infers:',
        );
        expect(
          missingFromReport(
            withoutColours(output),
            'It turns on caching for "run", which nx-rust leaves uncached',
            ["cli (rust/crates/cli/Cargo.toml)", "server (rust/crates/server/Cargo.toml)"],
          ),
        ).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "replaces the inputs of update, and says to keep them with ...",
    async () => {
      const output = await failed({ update: { inputs: ["default"] } });

      expect(output).toContain(
        'The targetDefaults entry "update" in nx.json changes targets that nx-rust infers:',
      );
      expect(
        missingFromReport(output, 'It replaces the inputs that nx-rust declares for "update"', [
          "rust (rust/Cargo.toml)",
        ]),
      ).toEqual([]);
      expect(output).toContain(
        `Keep what nx-rust declares by putting "..." into the entry's "inputs" list, as in ["...", <your entries>].`,
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    'replaces the inputs of test, and says to keep them with "..."',
    async () => {
      const output = await failed({ test: { inputs: ["default", "^default"] } });

      expect(
        missingFromReport(
          output,
          'It replaces the inputs that nx-rust declares for "test"',
          allCrates,
        ),
      ).toEqual([]);
      expect(output).toContain(`putting "..." into the entry's "inputs" list`);
    },
    HARNESS_TIMEOUT,
  );

  it(
    'replaces the outputs of build on the crates with executables, and says to keep them with "..."; an entry that keeps them is not reported',
    async () => {
      // The crates of subfolder-workspace are libraries, whose build declares no outputs.
      const replaced = FixtureWorkspace.create(
        "crate-shapes",
        targetDefaults({ build: { outputs: ["{projectRoot}/dist"] } }),
      );
      try {
        const { status, output } = await replaced.nx(["show", "projects"]);

        expect(status).not.toBe(0);
        expect(
          missingFromReport(
            withoutColours(output),
            'It replaces the outputs that nx-rust declares for "build"',
            ["cli (rust/crates/cli/Cargo.toml)", "server (rust/crates/server/Cargo.toml)"],
          ),
        ).toEqual([]);
        expect(withoutColours(output)).toContain(`putting "..." into the entry's "outputs" list`);
      } finally {
        replaced.remove();
      }

      const kept = FixtureWorkspace.create(
        "crate-shapes",
        targetDefaults({ build: { outputs: ["...", "{projectRoot}/dist"] } }),
      );
      try {
        const { status, output } = await kept.nx(["show", "projects"]);

        expect(status).toBe(0);
        expect(withoutColours(output)).not.toContain("targetDefaults");
        const outputs = (await kept.graph()).projects.cli.targets?.build.outputs;
        expect(outputs).toContain("{projectRoot}/dist");
        expect(outputs?.length).toBeGreaterThan(1);
      } finally {
        kept.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "replaces inputs through an entry keyed by the executor, naming its element that applies",
    async () => {
      const output = await failed({
        [cargoExecutor]: [{ filter: { projects: ["web"] }, inputs: [] }, { inputs: ["default"] }],
      });

      expect(output).toContain(
        `The targetDefaults entry "${cargoExecutor}" in nx.json (its element 1) changes targets that nx-rust infers:`,
      );
      expect(
        missingFromReport(output, "It replaces the inputs that nx-rust declares for", allCrates),
      ).toEqual([]);
      expect(output).toContain('"test"');
      expect(output).toContain('Remove "inputs" from the entry.');
      expect(output).toContain(
        `Keep what nx-rust declares by putting "..." into the entry's "inputs" list, as in ["...", <your entries>].`,
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "names the elements of a list that apply, and a glob key",
    async () => {
      const output = await failed({
        update: [{ filter: { projects: ["web"] }, cache: true }, { cache: true }],
        "fmt*": { cache: true },
      });

      expect(output).toContain(
        'The targetDefaults entry "update" in nx.json (its element 1) changes targets that nx-rust infers:',
      );
      expect(output).toContain(
        'The targetDefaults entry "fmt*" in nx.json changes targets that nx-rust infers:',
      );
      // fmt-check, which the key matches too, is cached by the plugin.
      expect(output).toContain('It turns on caching for "fmt", which');
    },
    HARNESS_TIMEOUT,
  );

  it(
    "is filtered to the plugin by the name Nx knows it by",
    async () => {
      // The harness loads the plugin by the path of its entry point, so Nx knows it by that path.
      const output = await failed({
        fmt: [{ filter: { plugin: pluginEntry() }, cache: true }],
      });

      expect(output).toContain(
        'The targetDefaults entry "fmt" in nx.json (its element 0) changes targets that nx-rust infers:',
      );
    },
    HARNESS_TIMEOUT,
  );
});

describe("nothing is reported", () => {
  it(
    'for "...", an entry no Rust target matches, a filter that leaves the crates out, or another executor',
    async () => {
      const { output, projects } = await created({
        update: { inputs: ["...", "{workspaceRoot}/.tool-versions"] },
        e2e: { cache: true, dependsOn: ["^build"] },
        build: [{ filter: { projects: ["web"] }, cache: true, dependsOn: ["^build"] }],
        lint: [{ filter: { executor: "nx:noop" }, cache: true }],
        fmt: [{ filter: { plugin: "@nx/js" }, cache: true }],
        test: { executor: "@nx/jest:jest", inputs: ["default"] },
      });

      expect(output).not.toContain("targetDefaults");
      // Nx drops an entry with another executor for the crates' targets.
      expect(projects.api.targets?.test.inputs).toContain("^default");
      expect(projects.api.targets?.fmt.cache).toBe(false);
      // The entries do apply where they are meant to.
      expect(projects.web.targets?.build).toMatchObject({ cache: true, dependsOn: ["^build"] });
      expect(projects.web.targets?.lint.cache).toBe(true);
      expect(projects.api.targets?.build.dependsOn).toEqual([lockfileTask]);
      const workspaceProject = Object.values(projects).find((project) => project.root === "rust");
      expect(workspaceProject?.targets?.update.inputs).toEqual([
        "{projectRoot}/Cargo.lock",
        "{projectRoot}/Cargo.toml",
        { externalDependencies: [] },
        "{workspaceRoot}/.tool-versions",
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "for an entry keyed by the target's name beside an empty one keyed by its executor",
    async () => {
      const { output, projects } = await created({
        build: { cache: true, dependsOn: ["^build"] },
        [cargoExecutor]: {},
      });

      expect(output).not.toContain("targetDefaults");
      expect(projects.web.targets?.build.cache).toBe(true);
      expect(projects.api.targets?.build.dependsOn).toEqual([lockfileTask]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    'for an entry that turns on caching for the targets that the plugin caches itself, or keeps their inputs and outputs with "..."',
    async () => {
      const { output, projects } = await created({
        build: { cache: true, outputs: ["...", "{projectRoot}/dist"] },
        check: { cache: true },
        lint: { cache: true },
        test: { cache: true, inputs: ["...", "{workspaceRoot}/.tool-versions"] },
        "fmt-check": { cache: true },
        doc: { cache: true },
      });

      expect(output).not.toContain("nx-rust");
      expect(projects.api.targets?.build.cache).toBe(true);
      expect(projects.api.targets?.build.outputs).toEqual(["{projectRoot}/dist"]);
      expect(projects.api.targets?.test.inputs).toEqual(
        expect.arrayContaining(["default", "^default", "{workspaceRoot}/.tool-versions"]),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "for a repository without targetDefaults, which gets no warning either",
    async () => {
      const { status, output, workspace } = await showProjects();
      try {
        expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
        expect(output).not.toContain("nx-rust");
        expect(output).not.toContain("targetDefaults");
        const { projects } = await workspace.graph();
        expect(projects.api.targets?.build.cache).toBe(true);
        expect(projects.api.targets?.fmt.cache).toBe(false);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "for a project.json in a crate's folder that turns on caching, where the entry sets only options",
    async () => {
      const { output, projects } = await created(
        { build: { options: { release: false } } },
        { "rust/crates/api/project.json": JSON.stringify({ targets: { build: { cache: true } } }) },
      );

      expect(output).not.toContain("targetDefaults");
      expect(projects.api.targets?.build).toMatchObject({
        cache: true,
        options: { release: false },
      });
    },
    HARNESS_TIMEOUT,
  );
});

describe("the layer that made a change", () => {
  it(
    "is the target default when a project.json supplies the target's executor, which takes the target away from an entry filtered to the plugin",
    async () => {
      const output = await failed(
        {
          [cargoExecutor]: [{ filter: { plugin: pluginEntry() }, options: {} }],
          fmt: { cache: true },
        },
        {
          "rust/crates/api/project.json": JSON.stringify({
            targets: { fmt: { executor: cargoExecutor } },
          }),
        },
      );

      expect(output).toContain(
        'The targetDefaults entry "fmt" in nx.json changes targets that nx-rust infers:',
      );
      expect(
        missingFromReport(output, 'It turns on caching for "fmt", which nx-rust leaves uncached', [
          "api (rust/crates/api/Cargo.toml)",
        ]),
      ).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  // The entry keeps exactly the inputs that the plugin declares for update.
  const harmless = {
    update: {
      inputs: [
        "{projectRoot}/Cargo.lock",
        "{projectRoot}/Cargo.toml",
        { externalDependencies: [] },
      ],
    },
  };

  it.each<[string, FileChanges]>([
    [
      "a project.json",
      { "rust/project.json": JSON.stringify({ targets: { update: { inputs: ["default"] } } }) },
    ],
    [
      "a package.json that Nx reads",
      {
        "package.json": JSON.stringify({ name: "repo", private: true, workspaces: ["rust"] }),
        "rust/package.json": JSON.stringify({
          name: "rust",
          nx: { targets: { update: { inputs: ["default"] } } },
        }),
      },
    ],
  ])(
    "is %s in the folder that replaces the inputs, and the entry that keeps them is not reported",
    async (_file, files) => {
      const { output, projects } = await created(harmless, files);

      expect(output).not.toContain("targetDefaults");
      const workspaceProject = Object.values(projects).find((project) => project.root === "rust");
      expect(workspaceProject?.targets?.update.inputs).toEqual(["default"]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    'is the target default when a project.json in the folder keeps what lies below it with "..."',
    async () => {
      const output = await failed(
        { update: { inputs: ["default"] } },
        {
          "rust/project.json": JSON.stringify({
            targets: { update: { inputs: ["...", "{projectRoot}/extra.toml"] } },
          }),
        },
      );

      expect(
        missingFromReport(output, 'It replaces the inputs that nx-rust declares for "update"', [
          "rust (rust/Cargo.toml)",
        ]),
      ).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );
});

describe("a dependency's projects", () => {
  it(
    "resolve as Nx resolves them: a pattern that matches only the project itself adds no dependency on other projects",
    async () => {
      const { output, projects } = await created({
        build: [
          {
            filter: { projects: ["api"] },
            dependsOn: ["...", { projects: ["api*"], target: "lint" }],
          },
        ],
      });

      expect(output).not.toContain("targetDefaults");
      expect(projects.api.targets?.build.dependsOn).toEqual([
        lockfileTask,
        { projects: ["api*"], target: "lint" },
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "resolve as Nx resolves them: a pattern that matches another project is reported",
    async () => {
      const { output } = await created({
        build: [
          {
            filter: { projects: ["api"] },
            dependsOn: ["...", { projects: ["mod*"], target: "lint" }],
          },
        ],
      });

      expect(
        missingFromReport(
          output,
          'It adds {"projects":["mod*"],"target":"lint"} to the dependsOn of "build"',
          ["api (rust/crates/api/Cargo.toml)"],
        ),
      ).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );
});

describe("combinations", () => {
  it(
    "an entry keyed by the executor and one keyed by the name: Nx takes the executor's, and only it is reported",
    async () => {
      const output = await failed({
        [cargoExecutor]: { cache: true },
        build: { dependsOn: ["^build"] },
      });

      expect(output).toContain(`The targetDefaults entry "${cargoExecutor}" in nx.json changes`);
      expect(output).not.toContain('The targetDefaults entry "build"');
    },
    HARNESS_TIMEOUT,
  );

  it(
    "a target renamed through targetNames: the entry for its new name is reported, the one for its old name is not",
    async () => {
      const { status, output, workspace } = await showProjects({
        "nx.json": (nxJson) => {
          const config = JSON.parse(nxJson ?? "{}");
          return JSON.stringify({
            ...config,
            plugins: config.plugins.map((entry: string | { plugin: string }) => ({
              plugin: typeof entry === "string" ? entry : entry.plugin,
              options: { targetNames: { lint: "clippy" } },
            })),
            targetDefaults: { clippy: { inputs: ["default"] }, lint: { dependsOn: ["^lint"] } },
          });
        },
      });
      workspace.remove();

      expect(status).not.toBe(0);
      expect(
        missingFromReport(
          output,
          'It replaces the inputs that nx-rust declares for "clippy"',
          allCrates,
        ),
      ).toEqual([]);
      expect(output).not.toContain('The targetDefaults entry "lint"');
    },
    HARNESS_TIMEOUT,
  );

  it(
    "a filter on a tag that the crates get from [workspace.metadata.nx], as the guidance narrows an entry: nothing is reported",
    async () => {
      const { output, projects } = await created(
        {
          build: [{ filter: { projects: ["!tag:lang:rust"] }, cache: true, dependsOn: ["^build"] }],
        },
        {
          "rust/Cargo.toml": (manifest) =>
            `${manifest}\n[workspace.metadata.nx]\ntags = ["lang:rust"]\n`,
        },
      );

      expect(output).not.toContain("targetDefaults");
      expect(projects.api.tags).toContain("lang:rust");
      expect(projects.web.targets?.build.cache).toBe(true);
      expect(projects.api.targets?.build.dependsOn).toEqual([lockfileTask]);
    },
    HARNESS_TIMEOUT,
  );

  describe('a targets table in Cargo metadata that keeps the inputs with "..."', () => {
    // The workspace project's update, with one input more than inferred.
    const table: FileChanges = {
      "rust/Cargo.toml": (manifest) =>
        `${manifest}\n[workspace.metadata.nx.project.targets.update]\ninputs = ["...", "{projectRoot}/extra.toml"]\n`,
    };

    it(
      "is part of what the plugin declares: an entry that replaces it is reported",
      async () => {
        const output = await failed({ update: { inputs: ["default"] } }, table);

        expect(
          missingFromReport(output, 'It replaces the inputs that nx-rust declares for "update"', [
            "rust (rust/Cargo.toml)",
          ]),
        ).toEqual([]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      'is not blamed on an entry that keeps it with "..."',
      async () => {
        const { output, projects } = await created(
          { update: { inputs: ["...", "{workspaceRoot}/.tool-versions"] } },
          table,
        );

        expect(output).not.toContain("targetDefaults");
        const workspaceProject = Object.values(projects).find((project) => project.root === "rust");
        expect(workspaceProject?.targets?.update.inputs).toEqual([
          "{projectRoot}/Cargo.lock",
          "{projectRoot}/Cargo.toml",
          { externalDependencies: [] },
          "{projectRoot}/extra.toml",
          "{workspaceRoot}/.tool-versions",
        ]);
      },
      HARNESS_TIMEOUT,
    );
  });

  it(
    'an entry that adds ^build and keeps the rest with "...": a warning',
    async () => {
      const { output, projects } = await created({ build: { dependsOn: ["...", "^build"] } });

      expect(
        missingFromReport(output, 'It adds "^build" to the dependsOn of "build"', allCrates),
      ).toEqual([]);
      expect(projects.api.targets?.build.dependsOn).toEqual([lockfileTask, "^build"]);
    },
    HARNESS_TIMEOUT,
  );
});

/**
 * Another inference plugin, registered after nx-rust, that adds the tag
 * `extra` to api and contributes an `fmt` target with the cargo executor,
 * with `cache: true` if `cache`, as the review of pull request #32 set it up
 * on `build` while the plugin left that uncached.
 */
function otherPlugin(cache: boolean, defaults: object | undefined): FileChanges {
  return {
    "other.cjs": `exports.name = "other";
exports.createNodes = [
  "**/Cargo.toml",
  async (files) =>
    files
      .filter((file) => file === "rust/crates/api/Cargo.toml")
      .map((file) => [file, { projects: { "rust/crates/api": { name: "api", tags: ["extra"], targets: { fmt: ${JSON.stringify({ executor: cargoExecutor, ...(cache ? { cache: true } : {}) })} } } } }]),
];
`,
    "nx.json": (nxJson) => {
      const config = JSON.parse(nxJson ?? "{}");
      return JSON.stringify({
        ...config,
        plugins: [...config.plugins, "./other.cjs"],
        ...(defaults === undefined ? {} : { targetDefaults: defaults }),
      });
    },
  };
}

/** The warning for a change of api's fmt that the plugin cannot attribute. */
const unattributedFmt = [
  'The target "fmt" of the Rust project api (rust/crates/api/Cargo.toml) differs from what nx-rust infers in "cache", and nx-rust cannot tell which configuration changed it: it sees the targetDefaults of nx.json and the project\'s own project.json and package.json, but not, for example, another plugin listed in nx.json.',
  `Run \`nx show target api:fmt --json\` and look under "sourceMap" for the file and entry behind each of these fields. If it is a targetDefaults entry, narrow it as ${targetDefaultsGuide} shows.`,
].join("\n");

describe("a change that the plugin cannot attribute", () => {
  it(
    "where another plugin adds a tag that an entry's filter selects: a warning, not a silent pass",
    async () => {
      const { status, output, workspace } = await showProjects(
        otherPlugin(false, { fmt: [{ filter: { projects: ["tag:extra"] }, cache: true }] }),
      );
      try {
        expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
        expect(output).toContain(unattributedFmt);
        expect(output).not.toContain("The targetDefaults entry");
        // Nx did apply the entry.
        expect((await workspace.graph()).projects.api.targets?.fmt.cache).toBe(true);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "where another plugin caches the target and adds a tag that an entry's filter excludes: a warning, not a failure",
    async () => {
      const { status, output, workspace } = await showProjects(
        otherPlugin(true, {
          fmt: [{ filter: { projects: ["api", "!tag:extra"] }, cache: true }],
        }),
      );
      workspace.remove();

      expect(status).toBe(0);
      expect(output).toContain(unattributedFmt);
      expect(output).not.toContain("The targetDefaults entry");
    },
    HARNESS_TIMEOUT,
  );

  it(
    "where another plugin adds a tag that takes the target away from the executor's entry: a warning for it, not the wrong key",
    async () => {
      const output = await failed(
        {},
        otherPlugin(false, {
          [cargoExecutor]: [{ filter: { projects: ["api", "!tag:extra"] }, cache: true }],
          fmt: { cache: true },
        }),
      );

      expect(output).toContain(unattributedFmt);
      expect(output).not.toContain(`The targetDefaults entry "${cargoExecutor}"`);
      // The other crates have no tag extra, and Nx takes the entry keyed fmt for them.
      expect(
        missingFromReport(output, 'It turns on caching for "fmt", which nx-rust leaves uncached', [
          `codegen (${crates.codegen})`,
          `model (${crates.model})`,
          `testkit (${crates.testkit})`,
        ]),
      ).toEqual([]);
      // No entry is blamed for api: the output names it only in the warning
      // that the plugin cannot tell which configuration changed its fmt.
      const occurrences = (text: string) => output.split(text).length - 1;
      expect(occurrences(`api (${crates.api})`)).toBe(occurrences(unattributedFmt.split("\n")[0]));
    },
    HARNESS_TIMEOUT,
  );

  it(
    "is nothing where another plugin changes a Rust target and targetDefaults is empty",
    async () => {
      const { status, output, workspace } = await showProjects(otherPlugin(true, undefined));
      try {
        expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
        expect(output).not.toContain("nx-rust");
        expect((await workspace.graph()).projects.api.targets?.fmt.cache).toBe(true);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe('object-level "..."', () => {
  it(
    'in the folder\'s project.json, after the inputs it lists: the entry that replaces the inputs is reported, because Nx keeps the value below for a field before "..."',
    async () => {
      const output = await failed(
        { update: { inputs: ["default"] } },
        {
          "rust/project.json": JSON.stringify({
            targets: { update: { inputs: ["local"], "...": true } },
          }),
        },
      );

      expect(
        missingFromReport(output, 'It replaces the inputs that nx-rust declares for "update"', [
          "rust (rust/Cargo.toml)",
        ]),
      ).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "in a later element of an entry's list, after cache: false: Nx keeps cache: true, and the entry is reported",
    async () => {
      const output = await failed({ fmt: [{ cache: true }, { cache: false, "...": true }] });

      expect(output).toContain(
        'The targetDefaults entry "fmt" in nx.json (its elements 0 and 1) changes targets that nx-rust infers:',
      );
      expect(
        missingFromReport(
          output,
          'It turns on caching for "fmt", which nx-rust leaves uncached',
          allCrates,
        ),
      ).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "in a later element of an entry's list, after an empty dependsOn: Nx keeps the dependency, and the entry draws the warning",
    async () => {
      const { output, projects } = await created({
        build: [{ dependsOn: ["...", "^lint"] }, { dependsOn: [], "...": true }],
      });

      expect(projects.api.targets?.build.dependsOn).toEqual([lockfileTask, "^lint"]);
      expect(output).toContain(
        'The targetDefaults entry "build" in nx.json (its elements 0 and 1) changes targets that nx-rust infers:',
      );
      expect(
        missingFromReport(output, 'It adds "^lint" to the dependsOn of "build"', allCrates),
      ).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );
});

describe("init", () => {
  /**
   * Runs `init` in a copy of `subfolder-workspace` whose `nx.json` has only
   * `defaults`, with `files` applied.
   */
  async function init(
    defaults: object,
    files: FileChanges = {},
  ): Promise<{
    status: number | null;
    output: string;
    changed: string[];
    nxJson: Record<string, unknown>;
  }> {
    const workspace = FixtureWorkspace.create(
      "subfolder-workspace",
      { "nx.json": `${JSON.stringify({ targetDefaults: defaults }, null, 2)}\n` },
      files,
    );
    try {
      const before = repositoryFiles(workspace.root);
      const { status, output } = await workspace.nx(["g", `${pluginName}:init`]);
      const after = repositoryFiles(workspace.root);
      return {
        status,
        output: withoutColours(output),
        changed: changedFiles(before, after),
        nxJson: JSON.parse(after.get("nx.json") ?? "null"),
      };
    } finally {
      workspace.remove();
    }
  }

  /** The empty entries that init adds for the plugin's executors. */
  const added = { [cargoExecutor]: {}, [runExecutor]: {}, [lockfileExecutor]: {} };
  /** How init's line names them. */
  const addedNames = `"${cargoExecutor}": {}, "${runExecutor}": {} and "${lockfileExecutor}": {}`;

  /** Init's line about the entries it added. */
  const addedLine = (entries: string) =>
    `Added ${entries} to targetDefaults in nx.json, keyed by the executors of the targets that nx-rust infers.`;
  /** The part of that line that names no entry. */
  const addedAny = "to targetDefaults in nx.json, keyed by the executors";

  it.each<[string, object]>([
    ["turns on caching for fmt", { fmt: { cache: true } }],
    ["turns on caching for build", { build: { cache: true } }],
    ["replaces the inputs of update", { update: { inputs: ["default"] } }],
    [
      "sets caching, ^build and inputs for build",
      {
        build: { cache: true, dependsOn: ["^build"], inputs: ["default", "^default"] },
        lint: { cache: true },
      },
    ],
  ])(
    "adds the empty entries for the plugin's executors and registers the plugin beside an entry keyed by a target name that %s",
    async (_case, defaults) => {
      const { status, output, changed, nxJson } = await init(defaults);

      expect(status).toBe(0);
      expect(changed).toEqual(["nx.json"]);
      // The name-keyed entries stay as they were, ahead of the added ones.
      expect(nxJson).toEqual({ targetDefaults: { ...defaults, ...added }, plugins: [pluginName] });
      expect(Object.keys(nxJson.targetDefaults as object)).toEqual([
        ...Object.keys(defaults),
        cargoExecutor,
        runExecutor,
        lockfileExecutor,
      ]);
      expect(output).toContain(addedLine(addedNames));
      expect(output).toContain(
        `Nx chooses an entry keyed by a target's executor before one keyed by the target's name or a glob, so entries such as "build" or "test" apply to your other projects and not to Rust targets, whose inputs, outputs, caching and dependencies nx-rust declares itself (${targetDefaultsGuide}).`,
      );
      // The check judged nx.json with the added entries, which keep the
      // name-keyed entries away from Rust targets.
      expect(output).not.toContain("changes targets that nx-rust infers");
    },
    HARNESS_TIMEOUT,
  );

  it(
    "adds the empty entries beside entries keyed by other executors only",
    async () => {
      const defaults = {
        "@nx/js:tsc": { cache: true, dependsOn: ["^build"], inputs: ["production", "^production"] },
      };
      const { status, output, nxJson } = await init(defaults);

      expect(status).toBe(0);
      expect(nxJson).toEqual({ targetDefaults: { ...defaults, ...added }, plugins: [pluginName] });
      expect(output).toContain(addedLine(addedNames));
      expect(output).not.toContain("changes targets that nx-rust infers");
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stops with graph creation's message and leaves nx.json unchanged for an entry keyed by the plugin's executor that turns on caching",
    async () => {
      const { status, output, changed } = await init({
        [cargoExecutor]: { cache: true },
        build: { cache: true },
      });

      expect(status).toBe(1);
      expect(output).toContain(
        "nx-rust was not added to nx.json: Nx could not create the project graph with it.",
      );
      expect(output).toContain(
        `The targetDefaults entry "${cargoExecutor}" in nx.json changes targets that nx-rust infers:`,
      );
      expect(
        missingFromReport(
          output,
          'It turns on caching for "fmt", which nx-rust leaves uncached',
          allCrates,
        ),
      ).toEqual([]);
      expect(output).toContain(`To narrow the entry (${targetDefaultsGuide}), do one of these:`);
      // The entry keyed by the executor wins over the one keyed "build".
      expect(output).not.toContain('The targetDefaults entry "build"');
      expect(output).toContain("nx.json is unchanged.");
      expect(output).not.toContain(addedAny);
      expect(changed).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "keeps an entry keyed by the plugin's executor as it is, warns about it and adds only the missing entry",
    async () => {
      const defaults = {
        build: { cache: true },
        [cargoExecutor]: { dependsOn: ["...", "^build"] },
      };
      const { status, output, changed, nxJson } = await init(defaults);

      expect(status).toBe(0);
      expect(changed).toEqual(["nx.json"]);
      expect(nxJson).toEqual({
        targetDefaults: { ...defaults, [runExecutor]: {}, [lockfileExecutor]: {} },
        plugins: [pluginName],
      });
      expect(output).toContain(addedLine(`"${runExecutor}": {} and "${lockfileExecutor}": {}`));
      expect(output).toContain(
        `The targetDefaults entry "${cargoExecutor}" in nx.json changes targets that nx-rust infers:`,
      );
      expect(output).toContain(
        'It adds "^build" to the dependsOn of "build", "check", "fmt", "fmt-check", "lint" and "test"',
      );
      expect(output).toContain(`To narrow the entry (${targetDefaultsGuide}), do one of these:`);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "adds nothing when all three entries are there, and leaves nx.json as it was apart from the plugin entry",
    async () => {
      const defaults = {
        build: { cache: true },
        [runExecutor]: {},
        [lockfileExecutor]: {},
        [cargoExecutor]: {},
      };
      const { status, output, nxJson } = await init(defaults);

      expect(status).toBe(0);
      expect(nxJson).toEqual({ targetDefaults: defaults, plugins: [pluginName] });
      expect(Object.keys(nxJson.targetDefaults as object)).toEqual(Object.keys(defaults));
      expect(output).not.toContain(addedAny);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "stops with the message of another check and writes nothing, also beside an entry keyed by a target name",
    async () => {
      const { status, output, changed } = await init(
        { build: { cache: true } },
        { "rust/crates/api/Cargo.toml": "[package\n" },
      );

      expect(status).toBe(1);
      expect(output).toContain(
        "nx-rust was not added to nx.json: Nx could not create the project graph with it.",
      );
      expect(output).toContain(
        "`cargo metadata` failed for the Cargo workspace of rust/Cargo.toml",
      );
      expect(output).not.toContain("changes targets that nx-rust infers");
      expect(output).not.toContain(addedAny);
      expect(changed).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );
});

describe("the check on a dependency on the lockfile task", () => {
  // The dependency on the workspace's lockfile task as the plugin declares
  // it, on a build with outputs, without a graph computation: the merged
  // targets are as Nx merges them, which the graph tests above show.
  const lockfile = lockfileTask;
  const inferred: Record<string, TargetConfiguration> = {
    build: {
      executor: cargoExecutor,
      cache: true,
      outputs: ["{workspaceRoot}/target/debug/api"],
      dependsOn: [lockfile],
    },
  };
  const graph = {
    projects: [
      {
        name: "api",
        root: "rust/crates/api",
        manifest: crates.api,
        targets: inferred,
        namedInputs: {},
        warnings: [],
        workspace: { rootManifest: "rust/Cargo.toml", configurationWarnings: [] },
        pkg: { name: "api" },
        isWorkspaceProject: false,
        settings: { tags: [], implicitDependencies: [] },
      },
    ],
  } as unknown as CargoGraph;
  const repositoryRoot = join(__dirname, "..", "..");
  const internals = loadTargetDefaultsInternals(repositoryRoot);

  /** What the check finds with `defaults` when Nx merged the targets of api to `merged`. */
  function changes(defaults: Record<string, unknown>, merged: Record<string, TargetConfiguration>) {
    const project: ProjectConfiguration = {
      name: "api",
      root: "rust/crates/api",
      targets: { ...inferred, ...merged },
    };
    const rust: ProjectConfiguration = { name: "rust", root: "rust", targets: {} };
    return findTargetDefaultChanges(
      graph,
      {
        projects: { api: project, rust },
        nxJsonConfiguration: { targetDefaults: defaults } as NxJsonConfiguration,
        workspaceRoot: repositoryRoot,
        fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      },
      pluginName,
      () => internals,
    );
  }

  it("places each warning once on each target it concerns, for the tasks of that target to print", () => {
    const finding = (project: string, target: string) => ({
      change: "adds-dependencies" as const,
      severity: "warning" as const,
      key: "build",
      target,
      executor: "@convesoft/nx-rust:cargo",
      project,
      manifest: `rust/crates/${project}/Cargo.toml`,
      added: ["^build"],
    });
    const unattributed = { target: "fmt", project: "api", manifest: crates.api, fields: ["cache"] };

    const { warnings, placed } = describeTargetDefaultChanges(
      [finding("api", "build"), finding("model", "build"), finding("api", "build")],
      [unattributed],
    );

    expect(warnings).toHaveLength(2);
    expect(placed).toEqual([
      { project: "api", target: "build", warning: warnings[0] },
      { project: "model", target: "build", warning: warnings[0] },
      { project: "api", target: "fmt", warning: warnings[1] },
    ]);
  });

  it("blames no element that Nx drops for naming another executor or a command, and cannot tell who changed the target", async () => {
    const merged = { build: { ...inferred.build, outputs: ["{projectRoot}/dist"] } };

    expect(
      await changes(
        {
          build: [
            { executor: "@nx/js:tsc", outputs: ["{projectRoot}/dist"] },
            { command: "tsc", outputs: ["{projectRoot}/dist"] },
            { options: {} },
          ],
        },
        merged,
      ),
    ).toEqual({
      findings: [],
      unattributed: [
        { target: "build", project: "api", manifest: crates.api, fields: ["outputs"] },
      ],
    });
  });

  it("blames no entry for a change that it does not make, and says that it cannot tell who made it", async () => {
    expect(
      await changes(
        { build: { options: { release: true } } },
        { build: { ...inferred.build, outputs: ["{projectRoot}/dist"], dependsOn: [] } },
      ),
    ).toEqual({
      findings: [],
      unattributed: [
        {
          target: "build",
          project: "api",
          manifest: crates.api,
          fields: ["outputs", "dependsOn"],
        },
      ],
    });
  });
});

describe("an Nx without the parts that the check runs", () => {
  const repositoryRoot = join(__dirname, "..", "..");

  /** What the message says to do. */
  const remedy =
    "Use a supported Nx version, or a version of @convesoft/nx-rust that supports the installed one.";

  it("fails with a message that names the installed Nx, the supported one and what to do", () => {
    const load = (path: string) => (path.endsWith("package.json") ? { version: "24.9.0" } : {});

    expect(() => loadTargetDefaultsInternals(repositoryRoot, load)).toThrow(
      "nx-rust cannot check what the targetDefaults in nx.json do to Rust targets with the installed Nx 24.9.0: createTargetDefaultsResults from nx/src/devkit-internals is not a function.",
    );
    expect(() => loadTargetDefaultsInternals(repositoryRoot, load)).toThrow(
      "This version of @convesoft/nx-rust supports Nx 24.",
    );
    expect(() => loadTargetDefaultsInternals(repositoryRoot, load)).toThrow(remedy);
  });

  it("fails graph creation where an entry changes a Rust target, naming the installed Nx", async () => {
    const workspace = FixtureWorkspace.create(
      "subfolder-workspace",
      targetDefaults({ fmt: { cache: true } }),
    );
    try {
      // A copy of this repository's Nx whose devkit-internals lacks the export.
      workspace.useNx(nxVersion);
      const internalsFile = realpathSync(
        join(workspace.root, "node_modules", "nx", "dist", "src", "devkit-internals.js"),
      );
      const source = readFileSync(internalsFile, "utf8");
      const without = source.replace(
        /^Object\.defineProperty\(exports, "createTargetDefaultsResults".*\n/m,
        "",
      );
      expect(without).not.toBe(source);
      // A hard link to the real file: writing through it would change the real Nx.
      rmSync(internalsFile);
      writeFileSync(internalsFile, without);

      const { status, output } = await workspace.nx(["show", "projects"]);

      expect(status).not.toBe(0);
      expect(withoutColours(output)).toContain(
        `nx-rust cannot check what the targetDefaults in nx.json do to Rust targets with the installed Nx ${nxVersion}: createTargetDefaultsResults from nx/src/devkit-internals is not a function.`,
      );
      expect(withoutColours(output)).toContain(remedy);
    } finally {
      workspace.remove();
    }
  });

  it("does not stop a graph whose targets no entry changes", async () => {
    const workspace = FixtureWorkspace.create(
      "subfolder-workspace",
      targetDefaults({ e2e: { cache: true } }),
    );
    try {
      workspace.useNx(nxVersion);
      const internalsFile = realpathSync(
        join(workspace.root, "node_modules", "nx", "dist", "src", "devkit-internals.js"),
      );
      const source = readFileSync(internalsFile, "utf8");
      rmSync(internalsFile);
      writeFileSync(
        internalsFile,
        source.replace(/^Object\.defineProperty\(exports, "createTargetDefaultsResults".*\n/m, ""),
      );

      expect((await workspace.nx(["show", "projects"])).status).toBe(0);
    } finally {
      workspace.remove();
    }
  });

  it("has them in the installed Nx 24", () => {
    expect(nxVersion).toMatch(/^24\./);
    const internals = loadTargetDefaultsInternals(repositoryRoot);
    expect(typeof internals.createTargetDefaultsResults).toBe("function");
  });
});
