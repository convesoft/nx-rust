// The module object itself, which the harness calls through.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { dirname, join } from "node:path";
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

  it("removes its socket folder once the process that listens there has removed its socket", async () => {
    if (testRunSocketFolder() === undefined) {
      // Nx keeps the sockets in its own folder, which the copy leaves alone.
      return;
    }
    const mkdtemp = jest.spyOn(fs, "mkdtempSync");
    const workspace = FixtureWorkspace.create("standalone-crate");
    const sockets = mkdtemp.mock.results
      .map((result) => result.value as string)
      .find((folder) => folder.startsWith(`${testRunSocketFolder()}/`));
    folders = [dirname(workspace.root), sockets];
    // Stands in for a plugin worker whose `nx` command has ended: it
    // removes its socket a moment later, and fails where it is gone.
    const socket = join(sockets, "p1-0-00000000.sock");
    fs.writeFileSync(socket, "");
    const worker = spawn(
      process.execPath,
      ["-e", `setTimeout(() => require("node:fs").unlinkSync(${JSON.stringify(socket)}), 300)`],
      { stdio: "ignore" },
    );
    const exited = new Promise<number | null>((resolve) => worker.on("exit", resolve));

    workspace.remove();

    expect(fs.existsSync(sockets)).toBe(false);
    expect(await exited).toBe(0);
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
        const agentInCi = await withOuterEnvironment(
          { ...agentInGitHubActions(summary), NO_COLOR: "1" },
          () => observe(workspace),
        );

        // Plain names without `--json` and nothing else, and the task's
        // output in the default style, with a `> nx run` line outside any
        // log group.
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
        expect(asked.run.status).toBe(0);
        expect(asked.run.lines).not.toContain("hello");
        expect(asked.static.lines.filter((line) => line.includes("nx run"))).toEqual([
          expect.stringMatching(/^::group::.* > nx run hello:greet$/),
        ]);
        expect(fs.existsSync(summary)).toBe(true);
      }),
    HARNESS_TIMEOUT,
  );
});

/**
 * What a test sees in `workspace` of `nx show projects` and of the task
 * `hello:greet`, run in the default output style and in the static one: the
 * exit status and the lines of the output, without colours and with each
 * duration replaced by `<duration>`.
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
    const text = withoutColours(output).replace(/\d+(\.\d+)?(ms|s|m)\b/g, "<duration>");
    seen[name] = { status, lines: text.trim().split("\n") };
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
