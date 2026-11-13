import type { ProjectConfiguration, TargetConfiguration } from "@nx/devkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CargoGraph } from "../src/graph/projects";
import {
  describeTargetDefaultChanges,
  findTargetDefaultChanges,
  loadTargetDefaultsResolver,
  targetDefaultsGuide,
} from "../src/graph/target-defaults";
import {
  changedFiles,
  FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  pluginSourceEntry,
  repositoryFiles,
  withoutColours,
} from "./harness";

// Checks VER-TARGET-DEFAULT-GUARD and the target-default cases of VER-SETUP
// with Nx's own graph creation and a real `nx g`. The plugin declares no
// outputs and no dependency on the lockfile task yet (nxr-fy4t4k,
// nxr-xq9ava), so those cases run on stand-in inferred values against Nx's
// own resolver.

const pluginName = "@convesoft/nx-rust";
const cargoExecutor = "@convesoft/nx-rust:cargo";

/** The crates of `subfolder-workspace`, each with its manifest, by name. */
const crates = {
  api: "rust/crates/api/Cargo.toml",
  codegen: "rust/crates/codegen/Cargo.toml",
  model: "rust/crates/model/Cargo.toml",
  testkit: "rust/crates/testkit/Cargo.toml",
};

/** Every crate of `subfolder-workspace`, as the report lists projects. */
const allCrates =
  "api (rust/crates/api/Cargo.toml), codegen (rust/crates/codegen/Cargo.toml), model (rust/crates/model/Cargo.toml) and testkit (rust/crates/testkit/Cargo.toml)";

/** A JS project beside the crates, whose `build` and `lint` a target default can reach. */
const web: FileChanges = {
  "web/project.json": JSON.stringify({
    name: "web",
    targets: { build: { executor: "nx:noop" }, lint: { executor: "nx:noop" } },
  }),
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
  const workspace = FixtureWorkspace.create("subfolder-workspace", web, ...files);
  const { status, output } = await workspace.nx(["show", "projects"]);
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

/** Graph creation with `defaults` fails; returns Nx's output. */
async function failed(defaults: object): Promise<string> {
  const { status, output, workspace } = await showProjects(targetDefaults(defaults));
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
      const { output, projects } = await created({ build: { dependsOn: [dependency] } });

      expect(projects.api.targets?.build.dependsOn).toEqual([dependency]);
      expect(output).toContain(
        [
          'The targetDefaults entry "build" in nx.json changes targets that nx-rust infers:',
          `  - It adds ${shown} to the dependsOn of "build", so that the task waits for tasks of other projects. Cargo builds what a crate depends on itself, so these only queue more cargo processes behind its build lock. In ${allCrates}.`,
          `To narrow the entry (${targetDefaultsGuide}), do one of these:`,
          `  - Give the entry a "filter" that leaves these projects out, which needs the entry written as a list: "build": [{ "filter": { "projects": ["!tag:lang:rust"] }, ... }] where the crates carry the tag lang:rust, or a filter on the "executor" of the targets the entry is meant for.`,
          `  - Add an empty entry keyed by the executor of these targets, "${cargoExecutor}": {}. Nx chooses an entry keyed by a target's executor before one keyed by its name.`,
        ].join("\n"),
      );
      expect(output).not.toContain('"..."');
    },
    HARNESS_TIMEOUT,
  );
});

describe("a target default that fails graph creation", () => {
  it(
    "turns on caching for build, keyed by the target's name",
    async () => {
      const output = await failed({ build: { cache: true } });

      expect(output).toContain(
        [
          'The targetDefaults entry "build" in nx.json changes targets that nx-rust infers:',
          `  - It turns on caching for "build", which nx-rust leaves uncached: Nx could restore a result where running the task would give another one. In ${allCrates}.`,
          `To narrow the entry (${targetDefaultsGuide}), do one of these:`,
        ].join("\n"),
      );
      expect(output).toContain(`"${cargoExecutor}": {}`);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "turns on caching for fmt, which stays uncached for good",
    async () => {
      const output = await failed({ fmt: { cache: true } });

      expect(output).toContain(
        `  - It turns on caching for "fmt", which nx-rust leaves uncached: Nx could restore a result where running the task would give another one. In ${allCrates}.`,
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "turns on caching keyed by the plugin's executor, and says to remove the field",
    async () => {
      const output = await failed({ [cargoExecutor]: { cache: true } });

      expect(output).toContain(`The targetDefaults entry "${cargoExecutor}" in nx.json changes`);
      expect(output).toContain(
        `  - It turns on caching for "build", "check", "fmt", "fmt-check", "lint" and "test", which nx-rust leaves uncached: Nx could restore a result where running the task would give another one. In ${allCrates}.`,
      );
      expect(output).toMatch(
        /It turns on caching for "audit", "doc" and "update", which nx-rust leaves uncached: .* In \S+ \(rust\/Cargo\.toml\)\./,
      );
      expect(output).toContain(
        `  - Remove "cache" from the entry. It is keyed by the executor of nx-rust's targets, so it reaches only those.`,
      );
      expect(output).not.toContain(`"${cargoExecutor}": {}`);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "replaces the inputs of update, and says to keep them with ...",
    async () => {
      const output = await failed({ update: { inputs: ["default"] } });

      expect(output).toMatch(
        /The targetDefaults entry "update" in nx\.json changes targets that nx-rust infers:\n {2}- It replaces the inputs that nx-rust declares for "update", so that the cache key and nx affected miss files or settings that the task depends on\. In \S+ \(rust\/Cargo\.toml\)\./,
      );
      expect(output).toContain(
        `  - Keep what nx-rust declares by putting "..." into the entry's "inputs" list, as in ["...", <your entries>].`,
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "names the elements of a list that apply, and a glob key",
    async () => {
      const output = await failed({
        build: [{ filter: { projects: ["web"] }, cache: true }, { cache: true }],
        "fmt*": { cache: true },
      });

      expect(output).toContain(
        'The targetDefaults entry "build" in nx.json (its element 1) changes targets that nx-rust infers:',
      );
      expect(output).toContain(
        'The targetDefaults entry "fmt*" in nx.json changes targets that nx-rust infers:',
      );
      expect(output).toContain('It turns on caching for "fmt" and "fmt-check"');
    },
    HARNESS_TIMEOUT,
  );

  it(
    "is filtered to the plugin by the name Nx knows it by",
    async () => {
      // The harness loads the plugin from its source, so Nx knows it by that path.
      const output = await failed({
        fmt: [{ filter: { plugin: pluginSourceEntry }, cache: true }],
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
        test: { executor: "@nx/jest:jest", cache: true },
      });

      expect(output).not.toContain("targetDefaults");
      // Nx drops an entry with another executor for the crates' targets.
      expect(projects.api.targets?.test.cache).toBe(false);
      expect(projects.api.targets?.fmt.cache).toBe(false);
      // The entries do apply where they are meant to.
      expect(projects.web.targets?.build).toMatchObject({ cache: true, dependsOn: ["^build"] });
      expect(projects.web.targets?.lint.cache).toBe(true);
      expect(projects.api.targets?.build).toMatchObject({ cache: false });
      expect(projects.api.targets?.build.dependsOn).toBeUndefined();
      const workspaceProject = Object.values(projects).find((project) => project.root === "rust");
      expect(workspaceProject?.targets?.update.inputs).toEqual([
        "{projectRoot}/Cargo.lock",
        "{projectRoot}/Cargo.toml",
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
      expect(projects.api.targets?.build.cache).toBe(false);
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

describe("init", () => {
  /** Runs `init` in a copy of `subfolder-workspace` whose `nx.json` has only `defaults`. */
  async function init(defaults: object): Promise<{
    status: number | null;
    output: string;
    changed: string[];
    nxJson: Record<string, unknown>;
  }> {
    const workspace = FixtureWorkspace.create("subfolder-workspace", {
      "nx.json": `${JSON.stringify({ targetDefaults: defaults }, null, 2)}\n`,
    });
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

  it(
    "stops with graph creation's message and leaves nx.json unchanged for an entry that turns on caching",
    async () => {
      const { status, output, changed } = await init({ fmt: { cache: true } });

      expect(status).toBe(1);
      expect(output).toContain(
        "nx-rust was not added to nx.json: Nx could not create the project graph with it.",
      );
      expect(output).toContain(
        `  - It turns on caching for "fmt", which nx-rust leaves uncached: Nx could restore a result where running the task would give another one. In ${allCrates}.`,
      );
      expect(output).toContain("nx.json is unchanged.");
      expect(changed).toEqual([]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "registers the plugin, warns and leaves targetDefaults as they were for an entry that adds ^build",
    async () => {
      const defaults = { build: { dependsOn: ["^build"], cache: false } };
      const { status, output, changed, nxJson } = await init(defaults);

      expect(status).toBe(0);
      expect(output).toContain(
        `  - It adds "^build" to the dependsOn of "build", so that the task waits for tasks of other projects.`,
      );
      expect(output).toContain(`"${cargoExecutor}": {}`);
      expect(changed).toEqual(["nx.json"]);
      expect(nxJson).toEqual({ targetDefaults: defaults, plugins: [pluginName] });
    },
    HARNESS_TIMEOUT,
  );
});

describe("the check on targets the plugin declares more for", () => {
  // Stand-ins for what the plugin will declare: outputs on build, a
  // dependency on the workspace's lockfile task and inputs on test. The
  // merged targets are as Nx merges them, which the graph tests above show
  // for the inputs of update.
  const lockfile = { projects: ["rust"], target: "lockfile" };
  const inferred: Record<string, TargetConfiguration> = {
    build: {
      executor: cargoExecutor,
      cache: true,
      outputs: ["{workspaceRoot}/target/debug/api"],
      dependsOn: [lockfile],
    },
    test: { executor: cargoExecutor, cache: true, inputs: ["crate", "^crate"] },
  };
  const graph = {
    projects: [{ root: "rust/crates/api", manifest: crates.api, targets: inferred }],
  } as unknown as CargoGraph;
  const resolver = loadTargetDefaultsResolver(join(__dirname, "..", ".."));

  function findings(
    defaults: Record<string, unknown>,
    merged: Record<string, TargetConfiguration>,
  ) {
    const project: ProjectConfiguration = {
      name: "api",
      root: "rust/crates/api",
      targets: { ...inferred, ...merged },
    };
    return findTargetDefaultChanges(graph, [project], defaults, pluginName, () => resolver);
  }

  it("reports outputs that an entry replaces, and not those it keeps with ...", () => {
    expect(
      findings(
        { build: { outputs: ["{projectRoot}/dist"] } },
        { build: { ...inferred.build, outputs: ["{projectRoot}/dist"] } },
      ),
    ).toEqual([
      expect.objectContaining({ change: "replaces-outputs", severity: "error", key: "build" }),
    ]);
    expect(
      findings(
        { build: { outputs: ["...", "{projectRoot}/dist"] } },
        {
          build: {
            ...inferred.build,
            outputs: ["{workspaceRoot}/target/debug/api", "{projectRoot}/dist"],
          },
        },
      ),
    ).toEqual([]);
  });

  it("reports a dependsOn that loses the lockfile task as an error, and the added ^build as a warning", () => {
    const found = findings(
      { build: { dependsOn: ["^build"] } },
      { build: { ...inferred.build, dependsOn: ["^build"] } },
    );

    expect(found).toEqual([
      expect.objectContaining({ change: "replaces-dependsOn", severity: "error" }),
      expect.objectContaining({
        change: "adds-dependencies",
        severity: "warning",
        added: ["^build"],
      }),
    ]);
    const { error, warnings } = describeTargetDefaultChanges(found);
    expect(error).toContain(
      `  - It replaces the dependsOn that nx-rust declares for "build", so that the task no longer depends on a task whose output its cache key reads. In api (${crates.api}).`,
    );
    expect(error).toContain(`putting "..." into the entry's "dependsOn" list`);
    expect(warnings).toHaveLength(1);
  });

  it("keeps the lockfile task with ... and only warns about ^build", () => {
    const found = findings(
      { build: { dependsOn: ["...", "^build"] } },
      { build: { ...inferred.build, dependsOn: [lockfile, "^build"] } },
    );

    expect(found).toEqual([expect.objectContaining({ change: "adds-dependencies" })]);
  });

  it("reports inputs replaced through an entry keyed by the executor, with its elements", () => {
    const found = findings(
      { [cargoExecutor]: [{ filter: { projects: ["web"] }, inputs: [] }, { inputs: ["default"] }] },
      { test: { ...inferred.test, inputs: ["default"] } },
    );

    expect(found).toEqual([
      expect.objectContaining({ change: "replaces-inputs", key: cargoExecutor, elements: [1] }),
    ]);
  });

  it("blames no element that Nx drops for naming another executor or a command", () => {
    const merged = { build: { ...inferred.build, outputs: ["{projectRoot}/dist"] } };

    expect(
      findings(
        {
          build: [
            { executor: "@nx/js:tsc", outputs: ["{projectRoot}/dist"] },
            { command: "tsc", outputs: ["{projectRoot}/dist"] },
            { options: {} },
          ],
        },
        merged,
      ),
    ).toEqual([]);
  });

  it("leaves a change alone that the applying entry does not make", () => {
    expect(
      findings(
        { build: { options: { release: true } } },
        { build: { ...inferred.build, outputs: ["{projectRoot}/dist"], dependsOn: [] } },
      ),
    ).toEqual([]);
  });

  it("asks Nx for nothing when no target differs", () => {
    const unused = () => {
      throw new Error("resolver loaded");
    };
    const project: ProjectConfiguration = {
      name: "api",
      root: "rust/crates/api",
      targets: inferred,
    };
    expect(
      findTargetDefaultChanges(graph, [project], { build: { cache: true } }, pluginName, unused),
    ).toEqual([]);
  });
});

describe("an Nx without the resolver for target defaults", () => {
  it("fails with a message that names the installed Nx", () => {
    const load = (path: string) => (path.endsWith("package.json") ? { version: "24.9.0" } : {});

    expect(() => loadTargetDefaultsResolver(join(__dirname, "..", ".."), load)).toThrow(
      "nx-rust cannot check what the targetDefaults in nx.json do to Rust targets with the installed Nx 24.9.0: readTargetDefaultsForTarget from nx/src/devkit-internals is not a function.",
    );
  });

  it("is the one the installed Nx 24 has", () => {
    const nx = readFileSync(require.resolve("nx/package.json"), "utf8");
    expect(JSON.parse(nx).version).toMatch(/^24\./);
    expect(typeof loadTargetDefaultsResolver(join(__dirname, "..", ".."))).toBe("function");
  });
});
