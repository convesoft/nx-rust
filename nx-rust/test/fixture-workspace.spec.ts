// The module object itself, which the harness calls through.
import fs from "node:fs";
import { join } from "node:path";
import {
  agentVariables,
  Env,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  inFixture,
  testRunSocketFolder,
  withoutColours,
} from "./harness";

describe("fixture workspace", () => {
  let folders: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    // Whatever the test found, leave nothing behind.
    for (const folder of folders) {
      fs.rmSync(folder, { recursive: true, force: true });
    }
    folders = [];
  });

  it("removes its temporary folders when it cannot be created", () => {
    // Records the folders that `create` makes, and still makes them: the
    // copy's, and where the test run has a socket folder, one for its sockets.
    const mkdtemp = jest.spyOn(fs, "mkdtempSync");

    expect(() =>
      FixtureWorkspace.create("subfolder-workspace", {
        "rust/Cargo.toml": () => {
          throw new Error("a broken change");
        },
      }),
    ).toThrow("a broken change");

    folders = mkdtemp.mock.results.map((result) => result.value as string);
    expect(folders).toHaveLength(testRunSocketFolder() === undefined ? 1 : 2);
    expect(folders.filter((folder) => fs.existsSync(folder))).toEqual([]);
  });

  it(
    "has a daemon that installs no other Nx",
    () =>
      // The daemon asks its start-up questions also in CI, where Nx would
      // skip them, because the test environment sets `CI=false`.
      inFixture("standalone-crate", undefined, async (workspace) => {
        const env = { NX_DAEMON: "true" };
        try {
          const result = await workspace.nx(["show", "projects", "--json"], env);

          expect(result.status).toBe(0);
        } finally {
          await workspace.nx(["daemon", "--stop"], env);
        }
        const log = workspace.daemonLog();
        // The daemon asked, and the installed Nx answered.
        expect(log).toContain("[AI-AGENTS]: Using local implementation");
        expect(log).not.toContain("[LATEST-NX]");
      }),
    HARNESS_TIMEOUT,
  );
});

describe("the environment of fixture commands", () => {
  // A project without a crate, whose task runs no cargo.
  const hello = {
    "hello/project.json": JSON.stringify({
      name: "hello",
      targets: { greet: { command: "echo hello" } },
    }),
  };
  const projects = ["api", "hello", "rust", "xtask"];

  it(
    "gives Nx the same behaviour whatever the outer environment holds",
    () =>
      inFixture("standalone-crate", hello, async (workspace) => {
        const summary = join(workspace.root, "..", "step-summary.md");

        const plain = await withOuterEnvironment(noAgentOutsideCi(), () => observe(workspace));
        const agentInCi = await withOuterEnvironment(agentInGitHubActions(summary), () =>
          observe(workspace),
        );

        // Plain names without `--json`, and the task's output in the default
        // style, with a `> nx run` line outside any log group.
        expect(plain.shown.status).toBe(0);
        expect([...plain.shown.lines].sort()).toEqual(projects);
        for (const run of [plain.run, plain.static]) {
          expect(run.status).toBe(0);
          expect(run.lines).toContain("> nx run hello:greet");
          expect(run.lines).toContain("hello");
        }
        expect(agentInCi).toEqual(plain);
        // Nothing went to the job's summary page.
        expect(fs.existsSync(summary)).toBe(false);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "lets a test ask for an agent in GitHub Actions itself",
    () =>
      inFixture("standalone-crate", hello, async (workspace) => {
        const summary = join(workspace.root, "..", "step-summary.md");

        const asked = await withOuterEnvironment(noAgentOutsideCi(), () =>
          observe(workspace, agentInGitHubActions(summary)),
        );

        // JSON without `--json`, the summary style, which prints no task
        // output, a log group, and a performance report on the summary page.
        expect(asked.shown.status).toBe(0);
        expect(JSON.parse(asked.shown.lines.join("\n")).sort()).toEqual(projects);
        expect(asked.run).toEqual({ status: 0, lines: [] });
        expect(asked.static.lines[0]).toMatch(/^::group::.* > nx run hello:greet$/);
        expect(fs.existsSync(summary)).toBe(true);
      }),
    HARNESS_TIMEOUT,
  );
});

/**
 * What a test sees in `workspace` of `nx show projects` and of the task
 * `hello:greet`, run in the default output style and in the static one: the
 * exit status and the lines that name a project, without colours.
 */
async function observe(workspace: FixtureWorkspace, env: Env = {}) {
  const commands = {
    shown: ["show", "projects"],
    run: ["run", "hello:greet"],
    static: ["run", "hello:greet", "--output-style=static"],
  };
  const seen = {} as Record<keyof typeof commands, { status: number | null; lines: string[] }>;
  for (const name of Object.keys(commands) as (keyof typeof commands)[]) {
    const { status, output } = await workspace.nx(commands[name], env);
    const lines = withoutColours(output).split("\n");
    seen[name] = {
      status,
      lines: lines.filter((line) => /api|hello|rust|xtask/.test(line)),
    };
  }
  return seen;
}

/** The variables of a session without an AI agent outside CI, as they are absent. */
function noAgentOutsideCi(): Env {
  return Object.fromEntries(
    [...agentVariables, "PAGER", "CI", "GITHUB_ACTIONS", "GITHUB_STEP_SUMMARY"].map((name) => [
      name,
      undefined,
    ]),
  );
}

/**
 * The variables of an AI agent's session in GitHub Actions, each with a value
 * from which Nx concludes that it runs there, and the job's summary page.
 */
function agentInGitHubActions(summary: string): Env {
  return {
    ...Object.fromEntries(agentVariables.map((name) => [name, "1"])),
    SUPERSET_AGENT_ID: "codex",
    PAGER: "head -n 10000 | cat",
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_STEP_SUMMARY: summary,
  };
}

/**
 * Runs `action` with `variables` set in the environment of the test process,
 * which the harness hands on to the commands it runs; `undefined` removes a
 * variable. The environment is restored afterwards.
 */
async function withOuterEnvironment<T>(variables: Env, action: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(variables).map((name) => [name, process.env[name]]));
  setVariables(variables);
  try {
    return await action();
  } finally {
    setVariables(saved);
  }
}

function setVariables(variables: Env): void {
  for (const [name, value] of Object.entries(variables)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
