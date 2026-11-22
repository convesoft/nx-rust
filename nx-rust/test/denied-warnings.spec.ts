import type { ExecutorContext, ProjectConfiguration } from "@nx/devkit";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { declaredOptionsOf } from "../src/executors/declared-options";
import { type GroupMember, runGroup } from "../src/executors/group-run";
import { formGroups, planGroups } from "../src/executors/groups";
import {
  groupInvocations,
  type PluginExecutor,
  type PreparedTask,
  prepareTask,
} from "../src/executors/task";
import { cargoExecutor, cargoOutputsExecutor, outputsTargets } from "../src/graph/targets";
import {
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  runNx,
  taskOutput,
  testEnvironment,
} from "./harness";

// The denied warnings of VER-BATCHING (DES-BATCH, "Denied warnings"), with a
// real cargo: a command that several crates share passes
// --message-format=json, under which cargo ignores build.warnings
// (EVD-CARGO-TARGET-COMMANDS), so the plugin applies it to each crate. Cargo
// honours the setting from 1.97 on, and CI also runs on 1.91, where every
// case passes as plain cargo does.

const executors: Record<"cargo" | "outputs", PluginExecutor> = {
  cargo: {
    name: cargoExecutor,
    shortName: "cargo",
    declared: declaredOptionsOf(cargoExecutor),
    serves: (target) => !outputsTargets.has(target) && target !== "run" && target !== "lockfile",
  },
  outputs: {
    name: cargoOutputsExecutor,
    shortName: "cargo-outputs",
    declared: declaredOptionsOf(cargoOutputsExecutor),
    serves: (target) => outputsTargets.has(target),
  },
};

interface Prepared extends PreparedTask {
  context: ExecutorContext;
}

/** Prepares the tasks of `target` of `crates` as the batch does. */
async function prepare(
  workspace: FixtureWorkspace,
  target: string,
  crates: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<Prepared[]> {
  const { projects } = await workspace.graph();
  const configurations: Record<string, ProjectConfiguration> = projects;
  return crates.map((crate) => {
    const configured = configurations[crate].targets?.[target];
    const context: ExecutorContext = {
      root: workspace.root,
      cwd: workspace.root,
      isVerbose: false,
      projectName: crate,
      targetName: target,
      target: configured,
      projectsConfigurations: { version: 2, projects: configurations },
      nxJsonConfiguration: {},
      projectGraph: {
        nodes: Object.fromEntries(
          Object.entries(configurations).map(([name, data]) => [name, { name, type: "lib", data }]),
        ),
        dependencies: {},
      },
      taskGraph: { tasks: {}, dependencies: {}, continuousDependencies: {}, roots: [] },
    };
    const executor = outputsTargets.has(target as never) ? executors.outputs : executors.cargo;
    const { records: _records, ...prepared } = prepareTask(
      executor,
      { ...configured?.options },
      context,
      env,
    );
    return { ...prepared, context };
  });
}

/**
 * Forms the tasks' group with sharing on, expects one, and runs it: as one
 * command for the whole workspace where `workspace` is set, as
 * workspace-build plans it, and otherwise selecting each crate with `-p`.
 */
async function runShared(
  workspace: FixtureWorkspace,
  tasks: readonly Prepared[],
  selectsWorkspace: boolean,
): Promise<Record<string, { success: boolean; output: string }>> {
  const planned = selectsWorkspace
    ? planGroups(formGroups(tasks, true), true)
    : formGroups(tasks, true).map((group) => ({
        tasks: group,
        selection: { kind: "crates" as const },
      }));
  expect(planned).toHaveLength(1);
  const [{ tasks: group, selection }] = planned;
  expect(selection.kind).toBe(selectsWorkspace ? "workspace" : "crates");
  const invocations = groupInvocations(group, workspace.root, selection);
  const members: GroupMember[] = group.map((task, index) => {
    const invocation = invocations[index];
    if (typeof invocation === "string") {
      throw new Error(invocation);
    }
    return { prepared: task, invocation, context: (task as Prepared).context };
  });
  const results = await runGroup(members);
  return Object.fromEntries(group.map((task, index) => [task.crate as string, results[index]]));
}

function passed(results: Record<string, { success: boolean }>): string[] {
  return Object.entries(results)
    .filter(([, result]) => result.success)
    .map(([crate]) => crate)
    .sort();
}

/** Whether the cargo of the workspace's Cargo workspace honours `build.warnings`. */
function honoursWarnings(workspace: FixtureWorkspace, env: NodeJS.ProcessEnv): boolean {
  const run = spawnSync("cargo", ["--version"], {
    cwd: join(workspace.root, "rust"),
    env,
    encoding: "utf8",
  });
  const version = /^cargo 1\.(\d+)/.exec(run.stdout ?? "");
  if (version === null) {
    throw new Error(`cargo --version printed ${JSON.stringify(run.stdout)}: ${run.stderr}`);
  }
  return Number(version[1]) >= 97;
}

/** Appends a function with an unused variable to a crate's library. */
function warningIn(crate: string): FileChanges {
  return {
    [`rust/crates/${crate}/src/lib.rs`]: (source) =>
      `${source ?? ""}\npub fn warns_in_${crate}() {\n    let unused = 1;\n}\n`,
  };
}

const denyingConfiguration: FileChanges = {
  "rust/.cargo/config.toml": '[build]\nwarnings = "deny"\n',
};

describe("check and lint under workspace-build with warnings denied", () => {
  it(
    "fail the crate with a warning and the crates that reach it, and no other",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", warningIn("a"));
      try {
        const base = workspace.cargo.environment(testEnvironment());
        const denying = { ...base, CARGO_BUILD_WARNINGS: "deny" };
        const honours = honoursWarnings(workspace, base);
        for (const target of ["check", "lint"]) {
          const results = await runShared(
            workspace,
            await prepare(workspace, target, ["a", "b"], denying),
            true,
          );
          expect(passed(results)).toEqual(honours ? ["b"] : ["a", "b"]);
          expect(
            results.a.output.includes(
              `a:${target}: cargo reported warnings in \`a\`, and warnings are denied: CARGO_BUILD_WARNINGS is deny.`,
            ),
          ).toBe(honours);
        }
        // Allowed warnings fail nothing.
        const allowed = await runShared(
          workspace,
          await prepare(workspace, "check", ["a", "b"], base),
          true,
        );
        expect(passed(allowed)).toEqual(["a", "b"]);
        expect(allowed.a.output).not.toContain("warnings are denied");

        // A warning in a member that both reach fails both; one in a member
        // that neither reaches, which the command still checks, fails none.
        workspace.reset(warningIn("shared"));
        const shared = await runShared(
          workspace,
          await prepare(workspace, "check", ["a", "b"], denying),
          true,
        );
        expect(passed(shared)).toEqual(honours ? [] : ["a", "b"]);
        expect(shared.b.output.includes("cargo reported warnings in `shared`")).toBe(honours);
        workspace.reset(warningIn("d"));
        const unrelated = await runShared(
          workspace,
          await prepare(workspace, "check", ["a", "b"], denying),
          true,
        );
        expect(passed(unrelated)).toEqual(["a", "b"]);
      } finally {
        workspace.remove();
      }
    },
    2 * HARNESS_TIMEOUT,
  );
});

describe("a group that selects its crates with -p, with warnings denied", () => {
  it(
    "fails lint where .cargo/config.toml denies warnings and a crate reaches one, unless CARGO_BUILD_WARNINGS allows them",
    async () => {
      // dep depends on base, which is not in the group; indep depends on neither.
      const workspace = FixtureWorkspace.create(
        "batch-groups",
        warningIn("base"),
        denyingConfiguration,
      );
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const honours = honoursWarnings(workspace, env);
        const results = await runShared(
          workspace,
          await prepare(workspace, "lint", ["dep", "indep"], env),
          false,
        );
        expect(passed(results)).toEqual(honours ? ["indep"] : ["dep", "indep"]);
        expect(
          results.dep.output.includes(
            `dep:lint: cargo reported warnings in \`base\`, and warnings are denied: ${join(workspace.root, "rust", ".cargo", "config.toml")} sets build.warnings = "deny".`,
          ),
        ).toBe(honours);
        const warn = await runShared(
          workspace,
          await prepare(workspace, "lint", ["dep", "indep"], {
            ...env,
            CARGO_BUILD_WARNINGS: "warn",
          }),
          false,
        );
        expect(passed(warn)).toEqual(["dep", "indep"]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a build whose crate depends on a member with a warning, and not one that only dev-depends on it",
    async () => {
      // user depends on breakable, devuser only dev-depends on it.
      const workspace = FixtureWorkspace.create("batch-groups", warningIn("breakable"));
      try {
        const env = workspace.cargo.environment(testEnvironment());
        const honours = honoursWarnings(workspace, env);
        const results = await runShared(
          workspace,
          await prepare(workspace, "build", ["user", "devuser"], {
            ...env,
            CARGO_BUILD_WARNINGS: "deny",
          }),
          false,
        );
        expect(passed(results)).toEqual(honours ? ["devuser"] : ["devuser", "user"]);
        expect(results.user.output.includes("cargo reported warnings in `breakable`")).toBe(
          honours,
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("a task run through Nx with warnings denied", () => {
  it(
    "is not restored from a result that passed with warnings allowed",
    async () => {
      const workspace = FixtureWorkspace.create("workspace-tests", warningIn("a"));
      try {
        const honours = honoursWarnings(workspace, workspace.cargo.environment(testEnvironment()));
        const allowed = await runNx(workspace, ["run", "a:check"]);
        expect(allowed.status).toBe(0);
        const denied = await runNx(workspace, ["run", "a:check"], { CARGO_BUILD_WARNINGS: "deny" });
        const output = taskOutput(denied.output, "a:check");
        expect(output).not.toMatch(/local cache|existing outputs match the cache/);
        expect(denied.status).toBe(honours ? 1 : 0);
        expect(output.includes("cargo reported warnings in `a`, and warnings are denied")).toBe(
          honours,
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
