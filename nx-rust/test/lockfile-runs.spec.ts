import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyFileChanges,
  Env,
  FileChanges,
  FixtureName,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  LocalRegistry,
  lockfileCalls,
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
    { name: "zzlib", version: "1.0.0" },
    { name: "zzlib", version: "1.0.1" },
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
    cargo(workspace, folder, "update", "-p", "zzlib", "--precise", "1.0.0");
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
        expect(lockfileCalls(workspace)).toEqual([{ cwd: "rust", args: ["update", "--workspace"] }]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each([
    ["a manifest edited so that the lockfile is stale", "edited"],
    ["Cargo.lock missing", "missing"],
  ])(
    "updates or creates the lockfile with %s as cargo build would, and runs the crates whose dependencies changed",
    async (_case, change) => {
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
        if (change === "edited") {
          // model shares zzlib with codegen, and api depends on both. Under
          // the workspace-build strategy every member's key also holds
          // codegen's manifest, so testkit runs too.
          expect(ran(workspace)).toEqual([
            "rust: check --all-targets -p api",
            "rust: check --all-targets -p codegen",
            "rust: check --all-targets -p model",
            "rust: check --all-targets -p testkit",
          ]);
        } else {
          // Cargo locks the newest zzlib, which model and api use, and the
          // same yylib; codegen and testkit keep their digests.
          expect(ran(workspace)).toEqual([
            "rust: check --all-targets -p api",
            "rust: check --all-targets -p model",
          ]);
          expect(restored(run.output, "codegen:check")).toBe(true);
          expect(restored(run.output, "testkit:check")).toBe(true);
        }
        for (const task of ["api:check", "model:check"]) {
          expect(restored(run.output, task)).toBe(false);
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
  it(
    "selects the cached targets of that workspace's crates and none of the other workspace, runs those whose dependencies changed and restores the others",
    async () => {
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
      const git = (...args: string[]) =>
        spawnSync(
          "git",
          ["-c", "user.name=nx-rust", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args],
          { cwd: workspace.root, encoding: "utf8" },
        );
      try {
        expect(git("init", "--quiet").status).toBe(0);
        expect(git("add", "--all").status).toBe(0);
        expect(git("commit", "--quiet", "--message", "The fixture").status).toBe(0);
        expect((await nx(workspace, ["run-many", "-t", "test"])).status).toBe(0);
        cargo(workspace, ".", "update", "-p", "zzlib", "--precise", "1.0.1");
        expect(git("commit", "--quiet", "--all", "--message", "Bump zzlib").status).toBe(0);

        const run = await nx(workspace, ["affected", "-t", "test", "--base=HEAD~1", "--head=HEAD"]);

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
        expect(first.output).toContain(
          "api:check: Cargo.lock changed while the task ran: the locked dependencies of api now have the digest",
        );
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
