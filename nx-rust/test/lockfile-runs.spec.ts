import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyFileChanges,
  Env,
  FileChanges,
  FixtureName,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  holdCargo,
  LocalRegistry,
  lockfileCalls,
  pnpmLockfile,
  runNx,
  taskCalls,
  testEnvironment,
} from "./harness";

// Runs of the lockfile task with a real cargo and real Nx runs: the
// end-to-end paragraph of VER-CACHE-KEYS, the lockfile checks of VER-TARGETS
// and VER-SETUP, and the post-check of DES-LOCKFILE-HASHING. The external
// crates come from a local registry (lockfile-keys.spec.ts).

let registry: LocalRegistry;
/** The environment of every command: the registry's Cargo home. */
const env: Env = {};

beforeAll(() => {
  registry = LocalRegistry.create([
    // value() tells a test which version cargo built.
    { name: "zzlib", version: "1.0.0", source: 'pub fn value() -> &\'static str { "1.0.0" }\n' },
    { name: "zzlib", version: "1.0.1", source: 'pub fn value() -> &\'static str { "1.0.1" }\n' },
    { name: "yylib", version: "1.0.0" },
    { name: "yylib", version: "1.0.1" },
  ]);
  env.CARGO_HOME = registry.cargoHome;
}, HARNESS_TIMEOUT);

afterAll(() => registry?.remove());

/** How Nx marks a task that it restored from the cache. */
const hit = String.raw`\[(local cache|existing outputs match the cache, left as is)\]`;

function restored(output: string, task: string): boolean {
  return new RegExp(`nx run ${task}\\s+${hit}`).test(output);
}

/** The tasks that ran, by the cargo calls they made, as `<cwd>: <args>`, sorted. */
function ran(workspace: FixtureWorkspace): string[] {
  return taskCalls(workspace)
    .map((call) => `${call.cwd}: ${call.args.join(" ")}`)
    .sort();
}

/** A change that adds dependency lines to a manifest's `[dependencies]`, which it may lack. */
function dependencies(...lines: string[]): (manifest: string | undefined) => string {
  return (manifest = "") =>
    manifest.includes("\n[dependencies]\n")
      ? manifest.replace("\n[dependencies]\n", `\n[dependencies]\n${lines.join("\n")}\n`)
      : `${manifest}\n[dependencies]\n${lines.join("\n")}\n`;
}

/** Runs cargo in a folder of the workspace, with the registry's Cargo home and nothing logged. */
function cargo(workspace: FixtureWorkspace, folder: string, ...args: string[]): void {
  execFileSync("cargo", args, {
    cwd: join(workspace.root, folder),
    env: testEnvironment(env),
    stdio: "pipe",
  });
}

function read(workspace: FixtureWorkspace, path: string): string {
  return readFileSync(join(workspace.root, path), "utf8");
}

/** Runs Nx with the registry's Cargo home, after forgetting the logged cargo calls. */
async function nx(
  workspace: FixtureWorkspace,
  args: string[],
  extra: Env = {},
): Promise<{ status: number | null; output: string }> {
  workspace.cargo.clear();
  return runNx(workspace, args, { ...env, ...extra });
}

/** A copy of `fixture` whose `Cargo.lock` cargo has brought up to date with the changes. */
async function locked(
  fixture: FixtureName,
  files: FileChanges,
  folders: string[],
): Promise<FixtureWorkspace> {
  const workspace = FixtureWorkspace.create(fixture, files);
  for (const folder of folders) {
    cargo(workspace, folder, "generate-lockfile");
    // The index is fetched; the second call needs no fetch.
    cargo(workspace, folder, "update", "-p", "zzlib", "--precise", "1.0.0", "--offline");
  }
  return workspace;
}

/** subfolder-workspace with model on zzlib and testkit on yylib, both locked. */
function subfolder(): Promise<FixtureWorkspace> {
  return locked(
    "subfolder-workspace",
    {
      "rust/crates/model/Cargo.toml": dependencies('zzlib = "1"'),
      "rust/crates/testkit/Cargo.toml": dependencies('yylib = "1"'),
    },
    ["rust"],
  );
}

/** Runs git in the workspace with an identity of its own and no signing, and expects it to pass. */
function git(workspace: FixtureWorkspace, ...args: string[]): void {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=nx-rust",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: workspace.root, encoding: "utf8" },
  );
  expect({ args, status: result.status, stderr: result.stderr }).toEqual({
    args,
    status: 0,
    stderr: expect.any(String),
  });
}

/** Commits every file that Git does not ignore, in a repository that the first call creates. */
function commitAll(workspace: FixtureWorkspace, message: string): void {
  if (!existsSync(join(workspace.root, ".git"))) {
    git(workspace, "init", "--quiet");
  }
  git(workspace, "add", "--all");
  git(workspace, "commit", "--quiet", "--message", message);
}

const digestFolder = (workspace: FixtureWorkspace) =>
  join(workspace.root, ".nx", "workspace-data", "nx-rust", "lockfile", "rust");

describe("the lockfile task", () => {
  it(
    "runs once per run, in the workspace root, before any other cargo call, also after nx reset, and leaves a current lockfile as it is",
    async () => {
      const workspace = await subfolder();
      try {
        const lockfile = read(workspace, "rust/Cargo.lock");
        for (const extra of [{}, { NX_RUST_LOCKED: "true" }]) {
          const run = await nx(workspace, ["run-many", "-t", "test", "check"], extra);

          expect(run.status).toBe(0);
          const calls = workspace.cargoCalls().filter((call) => call.args[0] !== "metadata");
          expect(calls[0]).toEqual({
            cwd: "rust",
            args: ["update", "--workspace", ...(extra.NX_RUST_LOCKED ? ["--locked"] : [])],
          });
          expect(lockfileCalls(workspace)).toHaveLength(1);
          expect(read(workspace, "rust/Cargo.lock")).toBe(lockfile);
        }
        expect((await nx(workspace, ["reset"])).status).toBe(0);
        const afterReset = await nx(workspace, ["run", "api:test"]);
        expect(afterReset.status).toBe(0);
        expect(lockfileCalls(workspace)).toEqual([
          { cwd: "rust", args: ["update", "--workspace"] },
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each([
    [
      "a manifest edited so that the lockfile is stale",
      "edited",
      // model shares zzlib with codegen, and api depends on both. Under the
      // workspace-build strategy every member's key also holds codegen's
      // manifest, so testkit runs too.
      ["api", "codegen", "model", "testkit"],
    ],
    [
      "Cargo.lock missing",
      "missing",
      // Cargo locks the newest zzlib, which model and api use, and the same
      // yylib; codegen and testkit keep their digests and are restored.
      ["api", "model"],
    ],
  ])(
    "updates or creates the lockfile with %s as cargo build would, and runs the crates whose dependencies changed",
    async (_case, change, running) => {
      const workspace = await subfolder();
      const plain = await subfolder();
      try {
        expect((await nx(workspace, ["run-many", "-t", "check"])).status).toBe(0);
        const stale = (copy: FixtureWorkspace) =>
          change === "edited"
            ? applyFileChanges(copy.root, {
                "rust/crates/codegen/Cargo.toml": dependencies('zzlib = "=1.0.1"'),
              })
            : rmSync(join(copy.root, "rust", "Cargo.lock"));
        stale(workspace);
        stale(plain);
        cargo(plain, "rust", "build", "--workspace");

        const run = await nx(workspace, ["run-many", "-t", "check"]);

        expect(run.status).toBe(0);
        expect(read(workspace, "rust/Cargo.lock")).toBe(read(plain, "rust/Cargo.lock"));
        expect(ran(workspace)).toEqual(
          running.map((crate) => `rust: check --all-targets -p ${crate}`),
        );
        for (const crate of ["api", "codegen", "model", "testkit"]) {
          expect({ crate, restored: restored(run.output, `${crate}:check`) }).toEqual({
            crate,
            restored: !running.includes(crate),
          });
        }
      } finally {
        workspace.remove();
        plain.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each([
    ["stale", "edited"],
    ["missing", "missing"],
  ])(
    "fails in locked mode with cargo's message on a %s lockfile, changes nothing and runs no crate task",
    async (_case, change) => {
      const workspace = await subfolder();
      try {
        if (change === "edited") {
          applyFileChanges(workspace.root, {
            "rust/crates/codegen/Cargo.toml": dependencies('zzlib = "=1.0.1"'),
          });
        } else {
          rmSync(join(workspace.root, "rust", "Cargo.lock"));
        }
        const before = existsSync(join(workspace.root, "rust", "Cargo.lock"))
          ? read(workspace, "rust/Cargo.lock")
          : undefined;

        const run = await nx(workspace, ["run-many", "-t", "check", "test"], {
          NX_RUST_LOCKED: "true",
        });

        expect(run.status).toBe(1);
        expect(run.output).toMatch(/--locked/);
        expect(run.output).toContain("Cargo.lock");
        expect(run.output).toContain("rust:lockfile");
        expect(lockfileCalls(workspace)).toEqual([
          { cwd: "rust", args: ["update", "--workspace", "--locked"] },
        ]);
        expect(taskCalls(workspace)).toEqual([]);
        expect(
          existsSync(join(workspace.root, "rust", "Cargo.lock"))
            ? read(workspace, "rust/Cargo.lock")
            : undefined,
        ).toBe(before);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "is not a dependency of fmt and fmt-check, which leave a stale lockfile as it is",
    async () => {
      const workspace = await subfolder();
      try {
        applyFileChanges(workspace.root, {
          "rust/crates/codegen/Cargo.toml": dependencies('zzlib = "=1.0.1"'),
        });
        const lockfile = read(workspace, "rust/Cargo.lock");

        const run = await nx(workspace, ["run-many", "-t", "fmt", "fmt-check", "-p", "model"]);

        expect(run.status).toBe(0);
        expect(lockfileCalls(workspace)).toEqual([]);
        // The positive control: both ran cargo.
        expect(ran(workspace)).toEqual(["rust: fmt --check -p model", "rust: fmt -p model"]);
        expect(read(workspace, "rust/Cargo.lock")).toBe(lockfile);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "writes correct digests again after the digest folder is deleted or a digest overwritten, and every crate task is restored",
    async () => {
      const workspace = await subfolder();
      try {
        expect((await nx(workspace, ["run-many", "-t", "check"])).status).toBe(0);
        const digests = Object.fromEntries(
          ["api", "codegen", "model", "testkit"].map((name) => [
            name,
            readFileSync(join(digestFolder(workspace), `${name}.digest`), "utf8"),
          ]),
        );
        for (const damage of [
          () => rmSync(digestFolder(workspace), { recursive: true }),
          () => writeFileSync(join(digestFolder(workspace), "model.digest"), "0\n"),
        ]) {
          damage();
          const run = await nx(workspace, ["run-many", "-t", "check"]);

          expect(run.status).toBe(0);
          expect(ran(workspace)).toEqual([]);
          for (const name of Object.keys(digests)) {
            expect(readFileSync(join(digestFolder(workspace), `${name}.digest`), "utf8")).toBe(
              digests[name],
            );
            expect(restored(run.output, `${name}:check`)).toBe(true);
          }
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("nx affected after a change to Cargo.lock", () => {
  it.each<[string, Env]>([
    ["without the daemon", {}],
    ["with the daemon", { NX_DAEMON: "true" }],
  ])(
    "selects the cached targets of that workspace's crates and none of the other workspace, runs those whose dependencies changed and restores the others, %s",
    async (_case, daemon) => {
      // app, in the workspace at the root, depends on util and on zzlib;
      // tools and scaffold form the other workspace.
      const workspace = await locked(
        "two-workspaces",
        {
          "crates/app/Cargo.toml": dependencies('zzlib = "1"'),
          "tools/scaffold/Cargo.toml": dependencies('zzlib = "1"'),
          ".gitignore": "node_modules/\n.nx/\ntarget/\n",
        },
        [".", "tools"],
      );
      try {
        commitAll(workspace, "The fixture");
        expect((await nx(workspace, ["run-many", "-t", "test"], daemon)).status).toBe(0);
        cargo(workspace, ".", "update", "-p", "zzlib", "--precise", "1.0.1");
        commitAll(workspace, "Bump zzlib");

        const run = await nx(
          workspace,
          ["affected", "-t", "test", "--base=HEAD~1", "--head=HEAD"],
          daemon,
        );

        expect(run.status).toBe(0);
        expect(run.output).toContain("nx run cargo-workspace:lockfile");
        for (const task of ["app:test", "util:test"]) {
          expect(run.output).toContain(`nx run ${task}`);
        }
        for (const task of ["tools:test", "scaffold:test", "tools:lockfile"]) {
          expect(run.output).not.toContain(`nx run ${task}`);
        }
        expect(ran(workspace)).toEqual([".: test -p app"]);
        expect(restored(run.output, "util:test")).toBe(true);
      } finally {
        if (daemon.NX_DAEMON === "true") {
          await workspace.nx(["daemon", "--stop"], { ...env, ...daemon });
        }
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("nx affected after a change to the JS lockfile", () => {
  // two-workspaces has a workspace at the repository root, whose workspace
  // project cargo-workspace lies there, and one in tools/. By workspace
  // folder: the test tasks of its crates and its lockfile task.
  const workspaces: Record<string, { tests: string[]; lockfile: string }> = {
    ".": { tests: ["app:test", "util:test"], lockfile: "cargo-workspace:lockfile" },
    tools: { tests: ["scaffold:test", "tools:test"], lockfile: "tools:lockfile" },
  };
  const tasksOf = (folders: string[]) =>
    folders.flatMap((folder) => [...workspaces[folder].tests, workspaces[folder].lockfile]).sort();

  /**
   * A root package.json and a pnpm lockfile, as in a repository that installs
   * JS packages: with the plugin's package at `version`, for which Nx then
   * has a node, or without it for `null`. `leftPad` is the integrity of
   * left-pad, which the plugin does not depend on.
   */
  function jsPackages(version: string | null, leftPad?: string): FileChanges {
    return {
      "package.json": JSON.stringify({
        name: "repo",
        private: true,
        devDependencies: {
          ...(version === null ? {} : { "@convesoft/nx-rust": version }),
          "left-pad": "1.3.0",
        },
      }),
      "pnpm-lock.yaml": pnpmLockfile(version, { leftPad }),
      "node_modules/.modules.yaml": "{}\n",
    };
  }

  /** Sets projectsAffectedByDependencyUpdates of Nx's JS plugin to auto in nx.json. */
  const auto: FileChanges = {
    "nx.json": (text) =>
      JSON.stringify({
        ...JSON.parse(text ?? "{}"),
        pluginsConfig: { "@nx/js": { projectsAffectedByDependencyUpdates: "auto" } },
      }),
  };

  /** The tasks that a run with static output started or restored, sorted. */
  function tasksIn(output: string): string[] {
    return [...output.matchAll(/^> nx run (\S+)/gm)].map((match) => match[1]).sort();
  }

  it.each<[string, string | null, "auto" | undefined, string[]]>([
    [
      "every Rust task where the Rust targets name the plugin's package, under Nx's default projectsAffectedByDependencyUpdates of all",
      "0.0.1",
      undefined,
      [".", "tools"],
    ],
    // Nx counts the JS lockfile as configuration of the project at the
    // repository root, whose lockfile task the crates there depend on.
    [
      "only the tasks of the workspace at the repository root where the Rust targets declare externalDependencies: [], under Nx's default of all",
      null,
      undefined,
      ["."],
    ],
    [
      "only the tasks of the workspace at the repository root where the Rust targets declare externalDependencies: [], with auto",
      null,
      "auto",
      ["."],
    ],
    [
      "only the tasks of the workspace at the repository root where the Rust targets name the plugin's package, with auto",
      "0.0.1",
      "auto",
      ["."],
    ],
  ])(
    "selects %s, restores the crate tasks and runs the lockfile tasks",
    async (_case, version, setting, selected) => {
      const workspace = FixtureWorkspace.create(
        "two-workspaces",
        { ".gitignore": "node_modules/\n.nx/\ntarget/\n" },
        setting === "auto" ? auto : {},
        jsPackages(version),
      );
      try {
        // The premise: whether the Rust targets name the plugin's package.
        const plugin = version === null ? [] : ["@convesoft/nx-rust"];
        const { projects } = await workspace.graph();
        for (const task of tasksOf([".", "tools"])) {
          const [project, target] = task.split(":");
          expect({ task, inputs: projects[project].targets?.[target].inputs }).toEqual({
            task,
            inputs: expect.arrayContaining([{ externalDependencies: plugin }]),
          });
        }
        commitAll(workspace, "The fixture");
        const first = await nx(workspace, ["run-many", "-t", "test"]);
        expect(first.status).toBe(0);
        expect(tasksIn(first.output)).toEqual(tasksOf([".", "tools"]));
        // A commit that changes only the integrity of left-pad in pnpm-lock.yaml.
        applyFileChanges(workspace.root, jsPackages(version, `sha512-${"9".repeat(86)}==`));
        commitAll(workspace, "Update left-pad");

        const run = await nx(workspace, ["affected", "-t", "test", "--base=HEAD~1", "--head=HEAD"]);

        expect(run.status).toBe(0);
        expect(tasksIn(run.output)).toEqual(tasksOf(selected));
        for (const task of selected.flatMap((folder) => workspaces[folder].tests)) {
          expect({ task, restored: restored(run.output, task) }).toEqual({ task, restored: true });
        }
        expect(ran(workspace)).toEqual([]);
        // The lockfile tasks are not cached, and run with a current lockfile.
        expect(
          lockfileCalls(workspace)
            .map((call) => call.cwd)
            .sort(),
        ).toEqual(selected);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the check after cargo's call", () => {
  it(
    "fails a task whose crate's digest no longer matches, because a manifest changed while the run went on, and Nx stores nothing for it",
    async () => {
      const workspace = await subfolder();
      try {
        // edit, which runs after the lockfile task and before api's check,
        // gives testkit, which api dev-depends on, a newer zzlib.
        const testkit = join(workspace.root, "rust", "crates", "testkit", "Cargo.toml");
        applyFileChanges(workspace.root, {
          "tools/edit/project.json": JSON.stringify({
            name: "edit",
            targets: {
              edit: {
                command: `node -e ${JSON.stringify(`require("fs").appendFileSync(${JSON.stringify(testkit)}, "zzlib = \\"=1.0.1\\"\\n")`)}`,
                dependsOn: [{ projects: ["rust"], target: "lockfile" }],
              },
            },
          }),
          "rust/crates/api/project.json": JSON.stringify({
            targets: { check: { dependsOn: ["...", "edit:edit"] } },
          }),
        });

        const first = await nx(workspace, ["run", "api:check"]);

        expect(first.status).toBe(1);
        expect(first.output).toContain("api:check: the locked dependencies of api had the digest");
        expect(ran(workspace)).toEqual(["rust: check --all-targets -p api"]);

        // The next run keys api on the new digest and stores it.
        rmSync(join(workspace.root, "rust", "crates", "api", "project.json"));
        const second = await nx(workspace, ["run", "api:check"]);
        expect(second.status).toBe(0);
        expect(restored(second.output, "api:check")).toBe(false);
        const third = await nx(workspace, ["run", "api:check"]);
        expect(restored(third.output, "api:check")).toBe(true);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs the crates' targets that would read a digest uncached, with a warning, where Nx hands the workspace's root manifest to no entry of the plugin",
    async () => {
      const workspace = await subfolder();
      try {
        // Nx hands the plugin the members' manifests and not the root manifest.
        applyFileChanges(workspace.root, {
          "nx.json": (text) =>
            JSON.stringify({
              ...JSON.parse(text ?? "{}"),
              plugins: JSON.parse(text ?? "{}").plugins.map(
                (entry: string | { plugin: string }) => ({
                  plugin: typeof entry === "string" ? entry : entry.plugin,
                  exclude: ["rust/Cargo.toml"],
                }),
              ),
            }),
        });
        const warning =
          "nx-rust: Nx hands the root manifest rust/Cargo.toml of the Cargo workspace in rust to no entry of @convesoft/nx-rust";

        for (const run of [1, 2]) {
          const result = await nx(workspace, ["run", "model:check"]);

          // The task runs, also the second time, and repeats the warning.
          expect({ run, status: result.status }).toEqual({ run, status: 0 });
          expect(ran(workspace)).toEqual(["rust: check --all-targets -p model"]);
          expect(lockfileCalls(workspace)).toEqual([]);
          expect(result.output).toContain(warning);
          expect(restored(result.output, "model:check")).toBe(false);
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a task whose key holds another lockfile's digest because another nx command rewrote the digests meanwhile, and Nx stores nothing for it",
    async () => {
      // The reviewer's race: model's test passes only with zzlib 1.0.1, and
      // the lockfile locks 1.0.0 when Nx computes the task's key.
      const workspace = await subfolder();
      const hold = holdCargo("test");
      try {
        applyFileChanges(workspace.root, {
          "rust/crates/model/src/lib.rs": (source = "") =>
            `${source}\n#[test]\nfn version_probe() {\n    assert_eq!(zzlib::value(), "1.0.1");\n}\n`,
        });
        const lockfile = read(workspace, "rust/Cargo.lock");
        const first = nx(workspace, ["run", "model:test"], hold.env);
        await hold.held();
        // Meanwhile the lockfile moves to 1.0.1, and another command's
        // lockfile task writes the digests of that.
        cargo(workspace, "rust", "update", "-p", "zzlib", "--precise", "1.0.1");
        const other = await runNx(workspace, ["run", "rust:lockfile"], env);
        expect(other.status).toBe(0);
        hold.release();
        const raced = await first;

        // Cargo built 1.0.1, which the key does not describe.
        expect(raced.status).toBe(1);
        expect(raced.output).toContain("test version_probe ... ok");
        expect(raced.output).toContain(
          "model:test: the locked dependencies of model had the digest",
        );
        expect(raced.output).toContain("through another nx command that ran at the same time");

        // Back on 1.0.0, the task runs again, and fails as plain cargo does.
        writeFileSync(join(workspace.root, "rust", "Cargo.lock"), lockfile);
        const again = await nx(workspace, ["run", "model:test"]);
        expect(restored(again.output, "model:test")).toBe(false);
        expect(again.status).toBe(1);
        expect(again.output).toContain("version_probe");
      } finally {
        hold.release();
        hold.remove();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "passes the tasks of two nx commands that run at the same time on an unchanged lockfile, and removes each command's private digests when it ends",
    async () => {
      const workspace = await subfolder();
      const hold = holdCargo("check");
      try {
        const first = nx(workspace, ["run", "model:check"], hold.env);
        await hold.held();
        const second = await runNx(workspace, ["run", "api:check"], env);
        expect(second.status).toBe(0);
        hold.release();
        const held = await first;

        expect(held.status).toBe(0);
        expect(held.output).not.toContain("changed while the run went on");
        // Both results were stored.
        for (const task of ["model:check", "api:check"]) {
          const repeat = await nx(workspace, ["run", task]);
          expect({ task, restored: restored(repeat.output, task) }).toEqual({
            task,
            restored: true,
          });
        }
        const commands = join(digestFolder(workspace), "commands");
        expect(existsSync(commands) ? readdirSync(commands) : []).toEqual([]);
      } finally {
        hold.release();
        hold.remove();
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a task before cargo runs where a project.json takes away its dependency on the lockfile task",
    async () => {
      const workspace = await subfolder();
      try {
        applyFileChanges(workspace.root, {
          "rust/crates/model/project.json": JSON.stringify({
            targets: { check: { dependsOn: [] } },
          }),
        });

        const run = await nx(workspace, ["run", "model:check"]);

        expect(run.status).toBe(1);
        expect(run.output).toContain(
          "model:check: this task does not depend on the lockfile task of its Cargo workspace, in rust, so its cache key holds no digest",
        );
        expect(ran(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("a run that excludes task dependencies", () => {
  it.each<[string, Env]>([
    ["without the daemon", {}],
    ["with the daemon", { NX_DAEMON: "true" }],
  ])(
    "runs every cached crate task that depends on the lockfile task, also with the files of an earlier run, and a normal run then restores its own results, %s",
    async (_case, daemon) => {
      const workspace = await subfolder();
      try {
        const first = await nx(workspace, ["run-many", "-t", "check", "-p", "model"], daemon);
        expect(first.status).toBe(0);
        expect(ran(workspace)).toEqual(["rust: check --all-targets -p model"]);

        for (const flag of [
          ["run", "model:check", "--exclude-task-dependencies"],
          ["run-many", "-t", "check", "-p", "model", "--excludeTaskDependencies"],
          [
            "affected",
            "-t",
            "check",
            "--files=rust/crates/model/src/lib.rs",
            "--exclude=api",
            "--exclude-task-dependencies=true",
          ],
          ["run", "model:check", "--exclude-task-dependencies"],
        ]) {
          const run = await nx(workspace, flag, daemon);

          expect({ flag, status: run.status }).toEqual({ flag, status: 0 });
          expect({ flag, ran: ran(workspace) }).toEqual({
            flag,
            ran: ["rust: check --all-targets -p model"],
          });
          expect(lockfileCalls(workspace)).toEqual([]);
        }
        // After a change to Cargo.lock that model's files do not show.
        cargo(workspace, "rust", "update", "-p", "zzlib", "--precise", "1.0.1");
        const excluded = await nx(
          workspace,
          ["run", "model:check", "--exclude-task-dependencies"],
          daemon,
        );
        expect(ran(workspace)).toEqual(["rust: check --all-targets -p model"]);
        expect(excluded.status).toBe(0);
        cargo(workspace, "rust", "update", "-p", "zzlib", "--precise", "1.0.0");

        // --no-exclude-task-dependencies is a normal run, which restores the first one.
        for (const args of [
          ["run", "model:check"],
          ["run", "model:check", "--no-exclude-task-dependencies"],
        ]) {
          const normal = await nx(workspace, args, daemon);
          expect(normal.status).toBe(0);
          expect(restored(normal.output, "model:check")).toBe(true);
          expect(lockfileCalls(workspace)).toHaveLength(1);
        }
      } finally {
        if (daemon.NX_DAEMON === "true") {
          await workspace.nx(["daemon", "--stop"], { ...env, ...daemon });
        }
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );
});
