import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cargoMetadataOf } from "../src/graph/collisions";
import { warningsDigest, warningsInputName } from "../src/graph/warnings";
import {
  compareCacheKeys,
  Env,
  FileChanges,
  FixtureGraph,
  FixtureName,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  runNx,
  taskCalls,
  TaskHash,
  withoutColours,
} from "./harness";

// Checks the part of VER-SETUP about "Warnings where they are seen" in
// DES-DIAGNOSTICS: each project's warnings reach its tasks' keys through a
// digest in a named input, so that a task prints the warnings of the graph
// that the command uses, whether it runs or is restored from the cache.

/** The root manifest of patched-workspaces without its [patch] of model, as redirections.spec.ts writes it. */
const withoutModelPatch: FileChanges = {
  "rust/Cargo.toml": (manifest) => manifest.replace(/^model = .*\n/m, ""),
};

/** The warning about a configuration file outside the repository that redirects dependencies. */
const outsideWarning = (config: string) => `nx-rust: ${config} redirects dependencies`;

/** The start of the warning about Cargo's directory of rust inside the repository. */
const unignoredWarning =
  "nx-rust: rust/target, Cargo's build and artifact directory of the Cargo workspace in rust, lies inside the repository";

/**
 * cross-workspace-path where model is no member of the workspace whose
 * folder holds it and has no project, so that cargo refuses its report:
 * server warns with cargo's message, which names files of the repository
 * by their absolute paths.
 */
const unreportedPathDependency: FileChanges = {
  "shared/Cargo.toml": (manifest) => manifest.replace(/members = \[[^\]]*\]/, "members = []"),
  "nx.json": (current) => {
    const nxJson = JSON.parse(current ?? "{}");
    nxJson.plugins = (nxJson.plugins ?? []).map((entry: string | { plugin: string }) =>
      typeof entry === "string"
        ? { plugin: entry, exclude: ["shared/**"] }
        : { ...entry, exclude: ["shared/**"] },
    );
    return JSON.stringify(nxJson);
  },
};

/** The manifest of the crate p, with `package.workspace` naming `workspace` if given. */
const crateP = (workspace?: string) =>
  `[package]\nname = "p"\nversion = "0.1.0"\nedition = "2024"\n${workspace === undefined ? "" : `workspace = "${workspace}"\n`}`;

/**
 * cross-workspace-path where server depends on extra/p/x, a crate in the
 * folder of the crate p, and the plugin gives neither a project. Where p
 * names a missing folder in package.workspace, cargo refuses x's report and
 * builds x all the same, so server warns (EVD-CARGO-UNREPORTED-CRATES). p's
 * manifest is no input of server's tasks.
 */
const belowCrateP: FileChanges = {
  "backend/crates/server/Cargo.toml": (manifest) =>
    `${manifest}x = { path = "../../../extra/p/x" }\n`,
  "extra/p/Cargo.toml": crateP(),
  "extra/p/src/lib.rs": "",
  "extra/p/x/Cargo.toml": '[package]\nname = "x"\nversion = "0.1.0"\nedition = "2024"\n',
  "extra/p/x/src/lib.rs": "",
  "nx.json": (current) => {
    const nxJson = JSON.parse(current ?? "{}");
    nxJson.plugins = (nxJson.plugins ?? []).map((entry: string | { plugin: string }) =>
      typeof entry === "string"
        ? { plugin: entry, exclude: ["extra/**"] }
        : { ...entry, exclude: ["extra/**"] },
    );
    return JSON.stringify(nxJson);
  },
};

/** The warnings in a project's metadata, which its tasks print. */
function warningsOf(graph: FixtureGraph, project: string): string[] {
  return cargoMetadataOf(graph.projects[project])?.warnings ?? [];
}

/** The ids of every task of the graph. */
function allTasks(graph: FixtureGraph): string[] {
  return Object.entries(graph.projects)
    .flatMap(([name, project]) => Object.keys(project.targets ?? {}).map((t) => `${name}:${t}`))
    .sort();
}

/** The inputs whose hashes differ between two hashes of one task. */
function changedInputs(before: TaskHash, after: TaskHash): string[] {
  const nodes = (hash: TaskHash) => (hash.details.nodes ?? {}) as Record<string, string>;
  const keys = new Set([...Object.keys(nodes(before)), ...Object.keys(nodes(after))]);
  return [...keys].filter((key) => nodes(before)[key] !== nodes(after)[key]).sort();
}

/** Runs `task`, api:fmt-check by default, and says whether it ran cargo and printed `warning`. */
async function fmtCheck(
  workspace: FixtureWorkspace,
  env: Env,
  warning: string,
  task = "api:fmt-check",
) {
  const calls = taskCalls(workspace).length;
  const { status, output } = await runNx(workspace, ["run", task], env);
  expect({ status, output }).toEqual({ status: 0, output });
  return { ran: taskCalls(workspace).length > calls, warned: output.includes(warning) };
}

/**
 * Runs `task`, api:fmt-check by default, in the states of one cause and
 * returns what the task did in each ({@link followsTheCause}).
 */
async function stepsOfCause(
  workspace: FixtureWorkspace,
  env: Env,
  warning: string,
  cause: { add: () => void; remove: () => void },
  task = "api:fmt-check",
): Promise<{ ran: boolean; warned: boolean }[]> {
  const steps: { ran: boolean; warned: boolean }[] = [];
  const step = async (change?: () => void) => {
    change?.();
    steps.push(await fmtCheck(workspace, env, warning, task));
  };
  await step(cause.remove);
  await step(cause.add);
  await step();
  await step(cause.remove);
  const reset = await runNx(workspace, ["reset"], env);
  if (reset.status !== 0) {
    throw new Error(`nx reset failed:\n${reset.output}`);
  }
  await step(cause.add);
  await step(cause.remove);
  await step();
  await step(cause.add);
  return steps;
}

/**
 * What the task does in the states of {@link stepsOfCause}: cached without
 * the warning, adding the cause makes it run and warn, and a hit replays
 * the warning; removing the cause gives the key without the warning again,
 * whose result from before comes back without it. After `nx reset`, with
 * the cause there from the start, removing it makes the task run without
 * the warning, and adding it again restores the result with the warning.
 */
const followsTheCause = [
  { ran: true, warned: false },
  { ran: true, warned: true },
  { ran: false, warned: true },
  { ran: false, warned: false },
  { ran: true, warned: true },
  { ran: true, warned: false },
  { ran: false, warned: false },
  { ran: false, warned: true },
];

describe("the digest of a project's warnings", () => {
  it("writes the paths inside the repository relative to its root, so that two checkouts get one digest", () => {
    const message = (root: string) =>
      `nx-rust: \`cargo metadata\` failed for ${root}/shared/crates/model/Cargo.toml in ${root}: error.`;

    expect(warningsDigest([message("/work/a/repo")], "/work/a/repo")).toBe(
      warningsDigest([message("/home/b/checkout")], "/home/b/checkout"),
    );
    expect(warningsDigest([message("/work/a/repo")], "/work/a/repo")).toBe(
      warningsDigest(
        ["nx-rust: `cargo metadata` failed for shared/crates/model/Cargo.toml in .: error."],
        "/elsewhere",
      ),
    );
  });

  it("keeps a path outside the repository, which names the cause", () => {
    expect(warningsDigest([outsideWarning("/home/a/.cargo/config.toml")], "/work/repo")).not.toBe(
      warningsDigest([outsideWarning("/home/b/.cargo/config.toml")], "/work/repo"),
    );
  });

  it("leaves a folder alone that only begins or ends like the repository root", () => {
    for (const path of ["/work/repo-old/Cargo.toml", "/old/work/repo/Cargo.toml"]) {
      expect({ path, digest: warningsDigest([`nx-rust: ${path}`], "/work/repo") }).not.toEqual({
        path,
        digest: warningsDigest(["nx-rust: Cargo.toml"], "/work/repo"),
      });
    }
  });

  it("depends on neither the order of the warnings nor their repetition", () => {
    expect(warningsDigest(["b", "a", "b"], "/work/repo")).toBe(
      warningsDigest(["a", "b"], "/work/repo"),
    );
    expect(warningsDigest(["a"], "/work/repo")).not.toBe(warningsDigest(["a", "b"], "/work/repo"));
  });
});

describe("the named input of a project's warnings", () => {
  it.each<FixtureName>(["two-workspaces", "subfolder-workspace"])(
    "is absent from the projects of %s, which have no warnings, so that their keys stay as they are without it",
    async (fixture) => {
      const workspace = FixtureWorkspace.create(fixture);
      try {
        const graph = await workspace.graph();

        for (const [name, project] of Object.entries(graph.projects)) {
          expect({ name, warnings: warningsOf(graph, name) }).toEqual({ name, warnings: [] });
          expect({ name, inputs: Object.keys(project.namedInputs ?? {}) }).toEqual({
            name,
            inputs: ["default"],
          });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "holds the digest of the warnings that the project's tasks print, and only on projects that have warnings",
    async () => {
      const workspace = FixtureWorkspace.create("cross-workspace-path", unreportedPathDependency);
      try {
        const graph = await workspace.graph();
        const warnings = warningsOf(graph, "server");

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(join(workspace.root, "shared"));
        expect(graph.projects.server.namedInputs?.[warningsInputName]).toEqual([
          { runtime: `echo ${warningsDigest(warnings, workspace.root)}` },
        ]);
        for (const [name, project] of Object.entries(graph.projects).filter(
          ([n]) => n !== "server",
        )) {
          expect({ name, inputs: Object.keys(project.namedInputs ?? {}) }).toEqual({
            name,
            inputs: ["default"],
          });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the keys of a project's tasks", () => {
  it(
    "change with the project's warnings, through the project's configuration",
    async () => {
      // Without target/ in .gitignore, every project of rust warns about
      // rust/target. Nx hashes .gitignore into every key itself.
      const outcomes = await compareCacheKeys({
        change: "a .gitignore that leaves rust/target to Nx",
        fixture: "patched-workspaces",
        base: { files: withoutModelPatch },
        after: { files: { ".gitignore": "" } },
        keys: { "api:fmt-check": "must differ", "model:fmt-check": "must differ" },
      });

      for (const { task, before, after, holds } of outcomes) {
        expect({ task, holds }).toEqual({ task, holds: true });
        expect({ task, changed: changedInputs(before, after) }).toEqual({
          task,
          changed: expect.arrayContaining([`${task.split(":")[0]}:ProjectConfiguration`]),
        });
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "change with a [patch] that the Cargo home's configuration adds only through the edges it gives, not through its warning",
    async () => {
      const cargoHome = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cargo-home-"));
      try {
        const config = join(cargoHome, "config.toml");
        const outcomes = await compareCacheKeys({
          change: "a [patch] of model in the Cargo home's config.toml",
          fixture: "patched-workspaces",
          base: { files: withoutModelPatch, env: { CARGO_HOME: cargoHome } },
          before: { prepare: () => rmSync(config, { force: true }) },
          after: {
            prepare: (workspace) =>
              writeFileSync(
                config,
                `[patch.crates-io]\nmodel = { path = "${workspace.root}/rust/crates/model" }\n`,
              ),
          },
          // api gets an edge to model; plain and types use no redirected
          // crate, and the warning about the file reaches no key.
          keys: {
            "api:check": "must differ",
            "plain:check": "must not differ",
            "plain:fmt-check": "must not differ",
            "types:fmt-check": "must not differ",
            "rust:lockfile": "must not differ",
          },
        });

        for (const { task, holds } of outcomes) {
          expect({ task, holds }).toEqual({ task, holds: true });
        }
      } finally {
        rmSync(cargoHome, { recursive: true, force: true });
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "are the same in two checkouts, one with and one without a Cargo home whose configuration sets [build]",
    async () => {
      const homes = [0, 1].map(() =>
        mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cargo-home-")),
      );
      writeFileSync(
        join(homes[1], "config.toml"),
        '[build]\nrustflags = ["--cfg", "nx_rust_flag"]\n',
      );
      const checkouts = homes.map(() =>
        FixtureWorkspace.create("patched-workspaces", withoutModelPatch),
      );
      try {
        const graphs = await Promise.all(
          checkouts.map((checkout, index) => checkout.graph({ CARGO_HOME: homes[index] })),
        );
        const shown = await checkouts[1].nx(["show", "projects"], { CARGO_HOME: homes[1] });
        const tasks = allTasks(graphs[0]);
        const [one, two] = [
          await checkouts[0].hashTasks(tasks, { env: { CARGO_HOME: homes[0] } }),
          await checkouts[1].hashTasks(tasks, { env: { CARGO_HOME: homes[1] } }),
        ];

        // The second checkout warns, and its keys are those of the first.
        expect(shown.output).toContain(`nx-rust: ${join(homes[1], "config.toml")} sets [build]`);
        expect(allTasks(graphs[1])).toEqual(tasks);
        for (const task of tasks) {
          expect({ task, hash: one[task].value }).toEqual({ task, hash: two[task].value });
        }
      } finally {
        checkouts.forEach((checkout) => checkout.remove());
        homes.forEach((home) => rmSync(home, { recursive: true, force: true }));
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "change with the warning about a path dependency whose report cargo refuses, through the project's configuration alone",
    async () => {
      const outcomes = await compareCacheKeys({
        change: "a missing folder in package.workspace of the crate above a path dependency",
        fixture: "cross-workspace-path",
        base: { files: belowCrateP },
        after: { files: { "extra/p/Cargo.toml": crateP("../missing") } },
        keys: { "server:fmt-check": "must differ", "server:build": "must differ" },
      });

      for (const { task, before, after, holds } of outcomes) {
        expect({ task, holds }).toEqual({ task, holds: true });
        expect({ task, changed: changedInputs(before, after) }).toEqual({
          task,
          changed: ["server:ProjectConfiguration"],
        });
      }
    },
    HARNESS_TIMEOUT,
  );

  /**
   * subfolder-workspace whose Cargo directory is `rust/link/../target`,
   * where `rust/link` leads to `deep/child`: the warning names `deep/target`
   * and, in brackets, the path as cargo reports it, which is absolute.
   */
  const throughLink: FileChanges = {
    ".gitignore": null,
    "rust/.cargo/config.toml": '[build]\ntarget-dir = "link/../target"\n',
  };
  const makeLink = (root: string) => {
    mkdirSync(join(root, "deep", "child"), { recursive: true });
    symlinkSync("../deep/child", join(root, "rust", "link"));
  };

  // Each case: whether the projects warn, whether the warnings' texts differ
  // between the checkouts, and what to do in a checkout once it exists.
  // Every row has all six values: Jest would take a missing last one for a
  // done callback.
  it.each<[string, FixtureName, FileChanges, boolean, boolean, ((root: string) => void) | null]>([
    ["without warnings", "subfolder-workspace", {}, false, false, null],
    [
      "with a warning that names files of the repository by their absolute paths",
      "cross-workspace-path",
      unreportedPathDependency,
      true,
      true,
      null,
    ],
    [
      "with a warning about a folder outside both checkouts",
      "subfolder-workspace",
      {},
      true,
      false,
      null,
    ],
    [
      "with a warning that names, in brackets, the path through a link inside the repository by its absolute path",
      "subfolder-workspace",
      throughLink,
      true,
      true,
      makeLink,
    ],
  ])(
    "are the same in two checkouts of one repository in different folders, %s",
    async (_case, fixture, files, warns, textsDiffer, prepare) => {
      // The third case: an artifact directory outside the repository, named
      // by its absolute path, which is the same for both checkouts.
      const outside =
        _case.includes("outside") &&
        mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "shared-target-"));
      const env: Env = outside ? { CARGO_TARGET_DIR: outside } : {};
      const first = FixtureWorkspace.create(fixture, files);
      const second = FixtureWorkspace.create(fixture, files);
      try {
        prepare?.(first.root);
        prepare?.(second.root);
        expect(first.root).not.toBe(second.root);
        const graphs = [await first.graph(env), await second.graph(env)];
        const warnings = graphs.map((graph) =>
          Object.keys(graph.projects).flatMap((name) => warningsOf(graph, name)),
        );
        expect(warnings.map((list) => list.length > 0)).toEqual([warns, warns]);
        // Where the texts differ, the digests still agree.
        expect(JSON.stringify(warnings[0]) !== JSON.stringify(warnings[1])).toBe(textsDiffer);
        expect(
          warnings[0].some((warning) =>
            warning.includes(`(reached through ${first.root}/rust/link/../target)`),
          ),
        ).toBe(prepare === makeLink);
        const tasks = allTasks(graphs[0]);
        const [one, two] = [
          await first.hashTasks(tasks, { env }),
          await second.hashTasks(tasks, { env }),
        ];

        for (const task of tasks) {
          expect({ task, hash: one[task].value }).toEqual({ task, hash: two[task].value });
        }
      } finally {
        first.remove();
        second.remove();
        if (outside) {
          rmSync(outside, { recursive: true, force: true });
        }
      }
    },
    HARNESS_TIMEOUT * 2,
  );
});

describe("a task's output", () => {
  it(
    "shows the warning about Cargo's directory that Nx does not ignore when the graph has it, whether the task runs or is restored, without the daemon",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces", withoutModelPatch);
      const gitignore = join(workspace.root, ".gitignore");
      try {
        const steps = await stepsOfCause(workspace, {}, unignoredWarning, {
          add: () => writeFileSync(gitignore, ""),
          remove: () => writeFileSync(gitignore, "target/\n"),
        });

        expect(steps).toEqual(followsTheCause);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );

  it(
    "shows the warning about a path dependency whose report cargo refuses when the graph has it, whether the task runs or is restored, without the daemon",
    async () => {
      const workspace = FixtureWorkspace.create("cross-workspace-path", belowCrateP);
      const manifest = join(workspace.root, "extra", "p", "Cargo.toml");
      try {
        const steps = await stepsOfCause(
          workspace,
          {},
          "nx-rust: `cargo metadata` failed for extra/p/x/Cargo.toml",
          {
            add: () => writeFileSync(manifest, crateP("../missing")),
            remove: () => writeFileSync(manifest, crateP()),
          },
          "server:fmt-check",
        );

        expect(steps).toEqual(followsTheCause);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );
});

// The warning about Cargo configuration that Nx does not hash
// (DES-DIAGNOSTICS, RISK-HOST-ENVIRONMENT): every task of the projects of
// the workspace concerned prints it, and no key holds it, so that a
// machine's Cargo home gives no keys of its own.
describe("the warning about Cargo configuration that Nx does not hash", () => {
  /** The output of `task` alone, after its header and below what graph creation printed. */
  const ownOutput = (output: string, task: string) => {
    const header = output.indexOf(`> nx run ${task}`);
    const next = output.indexOf("> nx run ", header + 1);
    return header < 0 ? "" : output.slice(header, next < 0 ? undefined : next);
  };
  const guide = '(see "Cargo configuration that Nx does not hash" in the nx-rust caching guide)';
  const remedy = `run \`nx reset\` after each change to it; --skip-nx-cache covers only the command it is given to ${guide}.`;
  const ignoredWarning =
    "nx-rust: rust/.cargo/config.toml sets [env] for the Cargo workspace in rust, but an ignore rule leaves it out of the files that Nx reads, so Nx does not hash it, and a result cached before a change to it can be restored afterwards.";
  /** patched-workspaces where plain's library reads FLAVOUR, which an ignored file's [env] sets. */
  const ignoredEnv: FileChanges = {
    ".gitignore": "target/\nrust/.cargo/\n",
    "rust/.cargo/config.toml": '[env]\nFLAVOUR = "a"\n',
    "rust/crates/plain/src/lib.rs": 'pub const FLAVOUR: &str = env!("FLAVOUR");\n',
  };

  it.each([
    ["CI=false", "false"],
    ["CI=true", "true"],
  ])(
    "is in the output of nx run plain:build with the Nx daemon and the default output style, %s, which hides the lockfile task's",
    async (_ci, ci) => {
      const workspace = FixtureWorkspace.create("patched-workspaces", ignoredEnv);
      const env: Env = { NX_DAEMON: "true", CI: ci };
      try {
        // The second run restores plain:build and replays what it printed.
        for (const run of ["runs", "restored"]) {
          const { status, output } = await workspace.nx(["run", "plain:build"], env);
          const plain = withoutColours(output);
          expect({
            run,
            status,
            shown: ownOutput(plain, "plain:build").includes(ignoredWarning),
          }).toEqual({
            run,
            status: 0,
            shown: true,
          });
        }
      } finally {
        await workspace.nx(["daemon", "--stop"], env);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "is printed by every task of the workspace where a .cargo/config.toml that .gitignore leaves out sets [env], while a build cached before a change to it is restored until nx reset",
    async () => {
      // plain's library reads FLAVOUR, which the ignored file's [env] sets.
      const workspace = FixtureWorkspace.create("patched-workspaces", ignoredEnv);
      const config = join(workspace.root, "rust", ".cargo", "config.toml");
      const texts = [ignoredWarning, `Stop ignoring it to have Nx hash it, or ${remedy}`];
      // Runs plain:build and says whether it ran cargo and what printed the warning.
      const build = async (args: string[] = []) => {
        const calls = taskCalls(workspace).length;
        const { status, output } = await runNx(workspace, ["run", "plain:build", ...args]);
        return {
          status,
          ran: taskCalls(workspace).length > calls,
          lockfile: texts.every((text) => ownOutput(output, "rust:lockfile").includes(text)),
          build: texts.every((text) => ownOutput(output, "plain:build").includes(text)),
        };
      };
      try {
        const first = await build();
        writeFileSync(config, '[env]\nFLAVOUR = "b"\n');
        const changed = await build();
        const skipped = await build(["--skip-nx-cache"]);
        const afterSkipped = await build();
        const reset = await runNx(workspace, ["reset"]);
        const afterReset = await build();

        expect(first).toEqual({ status: 0, ran: true, lockfile: true, build: true });
        // The accepted risk that the warning names: the key ignores the file,
        // and Nx stores nothing of a run with --skip-nx-cache.
        expect(changed).toEqual({ status: 0, ran: false, lockfile: true, build: true });
        expect(skipped).toEqual({ status: 0, ran: true, lockfile: true, build: true });
        expect(afterSkipped).toEqual({ status: 0, ran: false, lockfile: true, build: true });
        expect(reset.status).toBe(0);
        expect(afterReset).toEqual({ status: 0, ran: true, lockfile: true, build: true });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it.each<[string, FileChanges, (home: string) => string | null, string | null]>([
    [
      "a .cargo/config.toml that .gitignore leaves out and that sets only [alias]",
      {
        ".gitignore": "target/\nrust/.cargo/\n",
        "rust/.cargo/config.toml": '[alias]\nb = "build"\n',
      },
      () => null,
      null,
    ],
    [
      "the Cargo home's config.toml that sets [build] rustflags",
      {},
      () => '[build]\nrustflags = ["--cfg", "nx_rust_flag"]\n',
      "[build]",
    ],
    ["the Cargo home's config.toml that sets only [net]", {}, () => "[net]\nretry = 3\n", null],
  ])(
    "for %s",
    async (_case, files, homeConfig, tables) => {
      const workspace = FixtureWorkspace.create("patched-workspaces", files);
      const cargoHome = join(dirname(workspace.root), "cargo-home");
      mkdirSync(cargoHome);
      const content = homeConfig(cargoHome);
      if (content !== null) {
        writeFileSync(join(cargoHome, "config.toml"), content);
      }
      const env: Env = { CARGO_HOME: cargoHome };
      try {
        const graph = await workspace.graph(env);
        const tasks = allTasks(graph);
        const without = await workspace.hashTasks(tasks, {
          env: { CARGO_HOME: dirname(cargoHome) },
        });
        const withIt = await workspace.hashTasks(tasks, { env });
        const shown = await runNx(workspace, ["show", "projects"], env);
        const task = await runNx(workspace, ["run", "api:fmt-check"], env);

        expect({ shown: shown.status, task: task.status }).toEqual({ shown: 0, task: 0 });
        // What graph creation and a task of a crate print: the warning and
        // its remedy for [build], nothing for the others, and never the
        // remedy for an ignored file.
        const warning = `nx-rust: ${join(cargoHome, "config.toml")} sets ${tables} for the Cargo workspaces in rust and shared, but lies outside the repository, so Nx does not hash it, and a result cached before a change to it can be restored afterwards.`;
        const printed = (output: string) => ({
          warning: output.includes(warning),
          remedy: output.includes(`R${remedy.slice(1)}`),
          any: output.includes("Nx does not hash it"),
          ignored: output.includes("Stop ignoring it"),
        });
        const warns = tables !== null;
        const expected = { warning: warns, remedy: warns, any: warns, ignored: false };
        expect(printed(shown.output)).toEqual(expected);
        expect(printed(ownOutput(task.output, "api:fmt-check"))).toEqual(expected);
        // No key holds the file or its warning.
        for (const task of tasks) {
          expect({ task, hash: withIt[task].value }).toEqual({ task, hash: without[task].value });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );
});

// The warnings that createDependencies finds, once Nx has merged the
// projects (DES-TARGET-DEFAULT-GUARD): createMetadata gives them to the
// targets they concern, and the key follows their cause. Checks the last
// paragraph of VER-TARGET-DEFAULT-GUARD and its part of VER-SETUP.
describe("a task's output of the warnings about targetDefaults", () => {
  /** The start of the warning for the entry keyed fmt-check. */
  const entryWarning =
    'The targetDefaults entry "fmt-check" in nx.json changes targets that nx-rust infers:';

  /** An entry keyed fmt-check that adds the fmt-check tasks of the crates' dependencies. */
  const addsDependencies = { "fmt-check": { dependsOn: ["...", "^fmt-check"] } };

  /** nx.json with `targetDefaults`, or without any for `undefined`. */
  const nxJsonWith =
    (targetDefaults: object | undefined, extra: object = {}) =>
    (current: string | undefined) => {
      const { targetDefaults: _dropped, ...config } = JSON.parse(current ?? "{}");
      return JSON.stringify({
        ...config,
        ...extra,
        ...(targetDefaults === undefined ? {} : { targetDefaults }),
      });
    };

  /** The paragraph of a warning in `output`: the line that starts it and its lines of items. */
  function paragraph(output: string, start: string): string {
    const lines = output.split("\n");
    const first = lines.findIndex((line) => line.startsWith(start));
    expect(first).toBeGreaterThanOrEqual(0);
    let last = first + 1;
    while (last < lines.length && /^( {2}- |To narrow the entry)/.test(lines[last])) {
      last++;
    }
    return lines.slice(first, last).join("\n");
  }

  /** How often `text` occurs in `output`. */
  const occurrences = (output: string, text: string) => output.split(text).length - 1;

  it(
    "repeats the warning for an entry that adds other projects' tasks once at the start of each task of a target it changes, with the text that graph creation prints, also with the daemon on",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces", {
        ...withoutModelPatch,
        "nx.json": nxJsonWith(addsDependencies),
      });
      const daemon: Env = { NX_DAEMON: "true" };
      try {
        const shown = await runNx(workspace, ["show", "projects"]);
        expect(shown.status).toBe(0);
        const warning = paragraph(shown.output, entryWarning);
        expect(warning).toContain("api (rust/crates/api/Cargo.toml)");

        const task = await runNx(
          workspace,
          ["run", "api:fmt-check", "--exclude-task-dependencies"],
          daemon,
        );
        const other = await runNx(workspace, ["run", "api:fmt"], daemon);

        expect({ status: task.status, count: occurrences(task.output, warning) }).toEqual({
          status: 0,
          count: 1,
        });
        expect({ status: other.status, warned: other.output.includes(entryWarning) }).toEqual({
          status: 0,
          warned: false,
        });
        expect(workspace.daemonLog()).toContain(warning);
      } finally {
        await workspace.nx(["daemon", "--stop"], daemon);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "makes a cached task of the target run again and print the warning when the entry appears, and run or come back without it once the entry is gone",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces", withoutModelPatch);
      const nxJson = join(workspace.root, "nx.json");
      const original = readFileSync(nxJson, "utf8");
      try {
        const steps = await stepsOfCause(workspace, {}, entryWarning, {
          add: () => writeFileSync(nxJson, nxJsonWith(addsDependencies)(original)),
          remove: () => writeFileSync(nxJson, original),
        });

        expect(steps).toEqual(followsTheCause);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );

  it.each<[string, object, "must differ" | "must not differ"]>([
    ["one that adds other projects' tasks", addsDependencies, "must differ"],
    [
      "one that adds only the project's own tasks, which draws no warning",
      { "fmt-check": { dependsOn: ["...", "check"] } },
      "must not differ",
    ],
  ])(
    "follow an entry from a file that nx.json extends, which Nx does not hash, through the projects' configuration: %s",
    async (_case, targetDefaults, verdict) => {
      const outcomes = await compareCacheKeys({
        change: "an entry in base.json, which nx.json extends",
        fixture: "patched-workspaces",
        base: {
          files: {
            ...withoutModelPatch,
            "nx.json": nxJsonWith(undefined, { extends: "./base.json" }),
          },
        },
        before: { files: { "base.json": "{}\n" } },
        after: { files: { "base.json": JSON.stringify({ targetDefaults }) } },
        keys: { "api:fmt-check": verdict, "plain:fmt-check": verdict },
      });

      for (const { task, holds, before, after } of outcomes) {
        const changed = changedInputs(before, after);
        expect({ task, holds }).toEqual({ task, holds: true });
        expect({
          task,
          other: changed.filter((input) => !input.endsWith(":ProjectConfiguration")),
        }).toEqual({
          task,
          other: [],
        });
      }
    },
    HARNESS_TIMEOUT,
  );

  /** A plugin, listed after nx-rust, that gives api the tag `extra`. */
  const tagger = `exports.name = "tagger";
exports.createNodes = [
  "**/Cargo.toml",
  async (files) =>
    files
      .filter((file) => file === "rust/crates/api/Cargo.toml")
      .map((file) => [file, { projects: { "rust/crates/api": { tags: ["extra"] } } }]),
];
`;

  /** An entry filtered to the tag `extra` that adds the fmt-check tasks of the dependencies. */
  const taggedEntry = {
    "fmt-check": [{ filter: { projects: ["tag:extra"] }, dependsOn: ["...", "^fmt-check"] }],
  };

  /**
   * patched-workspaces with `tagger` and an `nx.json` that extends
   * `base.json`, which holds `targetDefaults`, where Nx hashes no change.
   */
  const extendedWithTagger = (plugins: boolean): FileChanges => ({
    ...withoutModelPatch,
    ...(plugins ? { "tagger.cjs": tagger } : {}),
    "base.json": "{}\n",
    "nx.json": (current) => {
      const config = JSON.parse(nxJsonWith(undefined, { extends: "./base.json" })(current));
      return JSON.stringify({
        ...config,
        plugins: [...config.plugins, ...(plugins ? ["./tagger.cjs"] : [])],
      });
    },
  });

  /** The start of the warning that the plugin cannot tell which configuration changed api's fmt-check. */
  const unattributedFmtCheck =
    'The target "fmt-check" of the Rust project api (rust/crates/api/Cargo.toml) differs from what nx-rust infers in "dependsOn", and nx-rust cannot tell which configuration changed it';

  it(
    "makes a cached task run again with and without the warning when an entry from a file that nx.json extends, filtered to a tag that another plugin gives, appears and goes away",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces", extendedWithTagger(true));
      const base = join(workspace.root, "base.json");
      try {
        const steps = await stepsOfCause(workspace, {}, unattributedFmtCheck, {
          add: () => writeFileSync(base, JSON.stringify({ targetDefaults: taggedEntry })),
          remove: () => writeFileSync(base, "{}\n"),
        });

        expect(steps).toEqual(followsTheCause);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 3,
  );

  it.each<[string, boolean]>([
    ["where another plugin gives the tag to api", true],
    ["where no plugin gives the tag, at the cost of a run without a warning", false],
  ])(
    "count an entry from a file that nx.json extends, filtered to a tag, for every crate with a target of its key, %s",
    async (_case, plugins) => {
      const outcomes = await compareCacheKeys({
        change: "an entry filtered to tag:extra in base.json",
        fixture: "patched-workspaces",
        base: { files: extendedWithTagger(plugins) },
        after: { files: { "base.json": JSON.stringify({ targetDefaults: taggedEntry }) } },
        // The input reaches every task of a crate with fmt-check, and no
        // task of the workspace project, which has none.
        keys: {
          "api:fmt-check": "must differ",
          "api:check": "must differ",
          "plain:fmt-check": "must differ",
          "rust:lockfile": "must not differ",
        },
      });

      for (const { task, holds, before, after } of outcomes) {
        const changed = changedInputs(before, after);
        expect({ task, holds }).toEqual({ task, holds: true });
        expect({
          task,
          other: changed.filter((input) => !input.endsWith(":ProjectConfiguration")),
        }).toEqual({ task, other: [] });
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "repeats the warning for a target that changed where the plugin cannot tell why at the start of the target's tasks, also with the daemon on",
    async () => {
      // Another plugin tags api, and an entry filtered to the tag adds
      // dependencies to its fmt-check: the plugin's rebuild of the target,
      // which does not see the tag, does not give what Nx merged.
      const workspace = FixtureWorkspace.create("patched-workspaces", {
        ...withoutModelPatch,
        "tagger.cjs": `exports.name = "tagger";
exports.createNodes = [
  "**/Cargo.toml",
  async (files) =>
    files
      .filter((file) => file === "rust/crates/api/Cargo.toml")
      .map((file) => [file, { projects: { "rust/crates/api": { tags: ["extra"] } } }]),
];
`,
        "nx.json": (current) => {
          const config = JSON.parse(
            nxJsonWith({
              "fmt-check": [
                { filter: { projects: ["tag:extra"] }, dependsOn: ["...", "^fmt-check"] },
              ],
            })(current),
          );
          return JSON.stringify({ ...config, plugins: [...config.plugins, "./tagger.cjs"] });
        },
      });
      const warning = [
        'The target "fmt-check" of the Rust project api (rust/crates/api/Cargo.toml) differs from what nx-rust infers in "dependsOn", and nx-rust cannot tell which configuration changed it',
        'Run `nx show target api:fmt-check --json` and look under "sourceMap"',
      ];
      const daemon: Env = { NX_DAEMON: "true" };
      try {
        const shown = await runNx(workspace, ["show", "projects"]);
        const task = await runNx(
          workspace,
          ["run", "api:fmt-check", "--exclude-task-dependencies"],
          daemon,
        );
        const other = await runNx(workspace, ["run", "plain:fmt-check"], daemon);

        expect(shown.status).toBe(0);
        for (const part of warning) {
          expect({ part, shown: occurrences(shown.output, part) }).toEqual({ part, shown: 1 });
          expect({ part, task: occurrences(task.output, part) }).toEqual({ part, task: 1 });
          expect({ part, other: occurrences(other.output, part) }).toEqual({ part, other: 0 });
        }
        expect([task.status, other.status]).toEqual([0, 0]);
      } finally {
        await workspace.nx(["daemon", "--stop"], daemon);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );
});
