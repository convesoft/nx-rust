import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { missingToolMessage, optionalTools } from "../src/tools/optional-tools";
import {
  cargoHakariFolder,
  composed,
  type Env,
  type FileChanges,
  findExecutable,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  hakariConfiguration,
  hakariWorkspace,
  holdCargo,
  packageSpec,
  pathWith,
  runNx,
  StubHakari,
  taskCalls,
  testEnvironment,
  testHost,
  type ThirdPartyRepository,
  thirdPartyRepository,
  ToolFolders,
} from "./harness";

// The run-time part of VER-BATCHING's hakari and cargo cases, and the post-check
// of DES-LOCKFILE-HASHING under hakari, with a real cargo and real Nx runs in
// a workspace whose third-party crate x comes from a git repository on disk
// (`hakariWorkspace` in the harness). The crates' tasks depend on
// hakari-check, which runs a stub cargo-hakari that succeeds wherever the
// drift check is not the point; the drift cases need the real cargo-hakari
// and skip without it.

const host = testHost();
const musl = "x86_64-unknown-linux-musl";
/** Whether the toolchain of the tests' environment has the standard library of `musl`. */
const muslInstalled = (() => {
  const sysroot = spawnSync("rustc", ["--print", "sysroot"], {
    env: testEnvironment(),
    encoding: "utf8",
  }).stdout?.trim();
  return sysroot !== undefined && existsSync(join(sysroot, "lib", "rustlib", musl));
})();
if (!muslInstalled) {
  // eslint-disable-next-line no-console
  console.warn(
    `hakari-runs.spec.ts: the toolchain has no ${musl} target, so the case of a non-host triple skips.`,
  );
}
let repository: ThirdPartyRepository;
let stub: StubHakari;

beforeAll(() => {
  repository = thirdPartyRepository();
  stub = new StubHakari();
});

afterAll(() => {
  repository?.remove();
  stub?.remove();
});

/** How Nx marks a task that it restored from the cache. */
const hit = String.raw`\[(local cache|existing outputs match the cache, left as is)\]`;

function restored(output: string, task: string): boolean {
  return new RegExp(`nx run ${task}\\s+${hit}`).test(output);
}

/** A copy of the fixture with the hakari workspace in `hakari/`, its lockfile generated. */
function hakariCopy(changes: FileChanges = {}): FixtureWorkspace {
  const workspace = FixtureWorkspace.create(
    "subfolder-workspace",
    composed(hakariWorkspace("hakari", repository, host), changes),
  );
  try {
    cargo(workspace, "generate-lockfile");
  } catch (error) {
    workspace.remove();
    throw error;
  }
  return workspace;
}

function cargo(workspace: FixtureWorkspace, ...args: string[]): string {
  return execFileSync("cargo", args, {
    cwd: join(workspace.root, "hakari"),
    env: testEnvironment(),
    encoding: "utf8",
    stdio: "pipe",
  });
}

/** Runs Nx with `hakari` on PATH, the stub's unless a test gives another, after forgetting the logged calls. */
async function nx(
  workspace: FixtureWorkspace,
  args: string[],
  extra: Env = {},
): Promise<{ status: number | null; output: string }> {
  workspace.cargo.clear();
  return runNx(workspace, args, { PATH: pathWith(stub.folder), ...extra });
}

/** The cargo calls of the crates' tasks in `hakari/`, each as its arguments with the crates' specifications as names. */
function ran(workspace: FixtureWorkspace): string[] {
  const specs = new Map(
    ["a", "b", "workspace-hack"].map((name) => [packageSpec(workspace.root, "hakari", name), name]),
  );
  return taskCalls(workspace)
    .filter((call) => call.cwd === "hakari" && call.args[0] !== "hakari")
    .map((call) => call.args.map((arg) => specs.get(arg) ?? arg).join(" "));
}

/** What a's executable prints: the features of x that it was compiled with. */
function features(workspace: FixtureWorkspace, triple?: string): string {
  return execFileSync(
    join(
      workspace.root,
      "hakari",
      "target",
      ...(triple === undefined ? [] : [triple]),
      "debug",
      "a",
    ),
    { encoding: "utf8" },
  ).trim();
}

/**
 * The modification times of the compiled units of x and of a's binary in
 * cargo's build directory, wherever the cargo version's layout puts them.
 */
function unitTimes(workspace: FixtureWorkspace): Record<string, number> {
  const report = JSON.parse(cargo(workspace, "metadata", "--format-version", "1", "--no-deps")) as {
    target_directory: string;
    build_directory?: string;
  };
  const times: Record<string, number> = {};
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (
        /^libx-[0-9a-f]+\.rlib$/.test(entry.name) ||
        /(\/deps\/a-[0-9a-f]+|\/build\/a\/[0-9a-f]+\/out\/a)$/.test(path)
      ) {
        times[path] = statSync(path).mtimeMs;
      }
    }
  };
  walk(join(report.build_directory ?? report.target_directory, "debug"));
  return times;
}

describe("the hakari strategy in runs", () => {
  it(
    "builds only the selected crates, and a second selection compiles neither the shared crate nor a again, with the same features and hash",
    async () => {
      const workspace = hakariCopy();
      try {
        const first = await nx(workspace, ["run-many", "-t", "build", "-p", "a"]);
        expect(first.status).toBe(0);
        expect(first.output).toContain("stub cargo-hakari hakari generate --diff");
        expect(first.output).toContain("stub cargo-hakari hakari manage-deps --dry-run");
        expect(ran(workspace)).toEqual(["build -p a"]);
        expect(features(workspace)).toBe("f1 f2");
        const hash = (await workspace.hashTasks(["a:build"]))["a:build"].value;
        const times = unitTimes(workspace);
        expect(
          Object.keys(times)
            .map((file) => /libx-/.test(file))
            .sort(),
        ).toEqual([false, true]);

        const second = await nx(workspace, [
          "run-many",
          "-t",
          "build",
          "-p",
          "a,b",
          "--skip-nx-cache",
        ]);
        expect(second.status).toBe(0);
        expect(ran(workspace)).toEqual(["build --keep-going --message-format=json -p a -p b"]);
        expect(unitTimes(workspace)).toEqual(times);
        expect(features(workspace)).toBe("f1 f2");
        expect((await workspace.hashTasks(["a:build"]))["a:build"].value).toBe(hash);
        expect(second.output).not.toMatch(/warning.*feature strategy/);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs the test tasks of a group in one cargo test that selects their crates, and the next run restores them",
    async () => {
      const workspace = hakariCopy();
      try {
        const run = await nx(workspace, ["run-many", "-t", "test", "-p", "a,b"]);
        expect(run.status).toBe(0);
        expect(ran(workspace)).toEqual(["test --no-fail-fast -p a -p b"]);
        const again = await nx(workspace, ["run-many", "-t", "test", "-p", "a,b"]);
        expect(again.status).toBe(0);
        expect(restored(again.output, "a:test") && restored(again.output, "b:test")).toBe(true);
        expect(ran(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs a feature set given by flags one crate per cargo command, and the default features in one",
    async () => {
      // b depends on a's library, and a asks x for f3 under its feature more.
      const workspace = hakariCopy({
        "hakari/a/Cargo.toml": (manifest) =>
          `${manifest}\n[features]\nmore = ["x/f3"]\n\n[lib]\npath = "src/lib.rs"\n`,
        "hakari/a/src/lib.rs": "pub fn features() -> String {\n    x::features()\n}\n",
        "hakari/b/Cargo.toml": (manifest) =>
          (manifest ?? "").replace("[dependencies]\n", '[dependencies]\na = { path = "../a" }\n'),
        "hakari/workspace-hack/Cargo.toml": (manifest) =>
          (manifest ?? "").replace('features = ["f1", "f2"]', 'features = ["f1", "f2"]'),
      });
      try {
        for (const [flags, expected] of [
          [
            ["-c", "all-features"],
            ["check --all-targets -p a --all-features", "check --all-targets -p b --all-features"],
          ],
          [
            ["--noDefaultFeatures"],
            [
              "check --all-targets -p a --no-default-features",
              "check --all-targets -p b --no-default-features",
            ],
          ],
          [
            ["--features=a/more"],
            [
              "check --all-targets -p a --features a/more",
              "check --all-targets -p b --features a/more",
            ],
          ],
          [[], ["check --all-targets --keep-going --message-format=json -p a -p b"]],
        ] as const) {
          const run = await nx(workspace, [
            "run-many",
            "-t",
            "check",
            "-p",
            "a,b",
            "--skip-nx-cache",
            ...flags,
          ]);
          expect(run.status).toBe(0);
          expect(ran(workspace).sort()).toEqual([...expected].sort());
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  (muslInstalled ? describe : describe.skip)("with a non-host triple", () => {
    it(
      "runs a triple that platforms does not list one crate per command without a warning, and shares a command for one that it lists",
      async () => {
        const workspace = hakariCopy();
        try {
          const unlisted = await nx(workspace, [
            "run-many",
            "-t",
            "check",
            "-p",
            "a,b",
            `--targetTriple=${musl}`,
          ]);
          expect(unlisted.status).toBe(0);
          expect(ran(workspace).sort()).toEqual([
            `check --all-targets -p a --target ${musl}`,
            `check --all-targets -p b --target ${musl}`,
          ]);
          expect(unlisted.output).not.toContain("platforms");
          writeFileSync(
            join(workspace.root, "hakari", ".config", "hakari.toml"),
            hakariConfiguration("workspace-hack", [host, musl]),
          );
          const listed = await nx(workspace, [
            "run-many",
            "-t",
            "check",
            "-p",
            "a,b",
            `--targetTriple=${musl}`,
            "--skip-nx-cache",
          ]);
          expect(listed.status).toBe(0);
          expect(ran(workspace)).toEqual([
            `check --all-targets --keep-going --message-format=json -p a -p b --target ${musl}`,
          ]);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });

  it(
    "falls back where a check fails, printing the warning at the start of each task and building the whole workspace, and undoing the change brings back hakari with the earlier keys",
    async () => {
      const workspace = hakariCopy();
      const config = join(workspace.root, "hakari", ".config", "hakari.toml");
      try {
        // The lockfile task writes the digests that the keys read.
        expect((await nx(workspace, ["run", "a:check"])).status).toBe(0);
        const hakariKey = (await workspace.hashTasks(["a:check"]))["a:check"].value;
        const passing = readFileSync(config, "utf8");
        writeFileSync(config, hakariConfiguration("workspace-hack", []));
        const fallback = await nx(workspace, ["run", "a:check"]);
        expect(fallback.status).toBe(0);
        expect(fallback.output).toContain(
          "the Cargo workspace in hakari uses the feature strategy workspace-build in place of hakari, because platforms does not list the host's triple",
        );
        expect(fallback.output).not.toContain("hakari-check");
        expect(ran(workspace)).toEqual([
          "check --all-targets --keep-going --message-format=json --workspace",
        ]);
        expect((await workspace.hashTasks(["a:check"]))["a:check"].value).not.toBe(hakariKey);
        writeFileSync(config, passing);
        expect((await workspace.hashTasks(["a:check"]))["a:check"].value).toBe(hakariKey);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a crate task without its dependency on hakari-check before cargo runs",
    async () => {
      const workspace = hakariCopy({
        "hakari/a/project.json": JSON.stringify({
          targets: {
            check: { dependsOn: [{ projects: ["directory:hakari"], target: "lockfile" }] },
          },
        }),
      });
      try {
        const run = await nx(workspace, ["run", "a:check"]);
        expect(run.status).toBe(1);
        expect(run.output).toContain(
          "a:check: this task does not depend on the hakari-check task of its Cargo workspace, in hakari",
        );
        expect(ran(workspace)).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails the tasks of a shared command whose sibling's digest changes during the run, while a group of one crate compares its own",
    async () => {
      // b asks a second git crate g, whose two commits differ only in its
      // source line in Cargo.lock, which a does not reach.
      const second = thirdPartyRepository("g");
      const commit = (url: string) =>
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: url.replace("file://", ""),
          encoding: "utf8",
        }).trim();
      const workspace = hakariCopy({
        "hakari/b/Cargo.toml": (manifest) =>
          (manifest ?? "").replace(
            "[dependencies]\n",
            `[dependencies]\ng = { git = "${second.url}" }\n`,
          ),
      });
      try {
        const first = commit(second.url);
        execFileSync(
          "git",
          [
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "two",
          ],
          { cwd: second.url.replace("file://", ""), env: testEnvironment(), stdio: "pipe" },
        );
        const next = commit(second.url);
        cargo(workspace, "update", "-p", "g", "--precise", first);
        const lockfile = join(workspace.root, "hakari", "Cargo.lock");
        const before = readFileSync(lockfile, "utf8");
        for (const [args, failing] of [
          [
            ["run-many", "-t", "build", "-p", "a,b"],
            ["a", "b"],
          ],
          [["run", "a:build"], []],
        ] as const) {
          writeFileSync(lockfile, before);
          const hold = holdCargo("build");
          let run: { status: number | null; output: string };
          try {
            const raced = nx(workspace, [...args, "--skip-nx-cache"], hold.env);
            await Promise.race([
              hold.held(),
              raced.then((early) => {
                throw new Error(`The run ended before cargo build was held:\n${early.output}`);
              }),
            ]);
            cargo(workspace, "update", "-p", "g", "--precise", next);
            hold.release();
            run = await raced;
          } finally {
            hold.release();
            hold.remove();
          }
          for (const name of failing) {
            expect(run.output).toContain(
              `${name}:build: the locked dependencies of b had the digest`,
            );
          }
          expect(run.status).toBe(failing.length === 0 ? 0 : 1);
        }
      } finally {
        workspace.remove();
        second.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

const hakari = cargoHakariFolder();
if (hakari === undefined) {
  // eslint-disable-next-line no-console
  console.warn(
    "hakari-runs.spec.ts: cargo-hakari is neither on PATH nor in the Cargo home's bin, and NX_RUST_TEST_CARGO_HAKARI names no folder with it, so the drift cases of VER-BATCHING skip.",
  );
}

(hakari === undefined ? describe.skip : describe)("the drift check with cargo-hakari", () => {
  const real = { PATH: pathWith(hakari ?? "") };

  it.each<[string, FileChanges]>([
    [
      "b asking x for another feature",
      {
        "hakari/b/Cargo.toml": (manifest) =>
          (manifest ?? "").replace('features = ["f2"]', 'features = ["f3"]'),
      },
    ],
    [
      "a new member without the dependency on the hack crate",
      {
        "hakari/Cargo.toml": (manifest) => (manifest ?? "").replace('"b", ', '"b", "c", '),
        "hakari/c/Cargo.toml": '[package]\nname = "c"\nversion = "0.1.0"\nedition = "2024"\n',
        "hakari/c/src/lib.rs": "",
      },
    ],
    [
      "a no longer asking for a feature that the hack crate gives",
      {
        "hakari/a/Cargo.toml": (manifest) =>
          (manifest ?? "").replace('features = ["f1"]', "features = []"),
      },
    ],
  ])(
    "fails hakari-check for %s, runs no crate task and stores nothing, and after generate and manage-deps the keys differ and the tasks run",
    async (_case, changes) => {
      const workspace = hakariCopy();
      try {
        const passing = await nx(workspace, ["run-many", "-t", "check", "-p", "a,b"], real);
        expect(passing.status).toBe(0);
        const hashes = await workspace.hashTasks(["a:check", "b:check"]);
        for (const [file, change] of Object.entries(changes)) {
          const path = join(workspace.root, file);
          const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
          const next = typeof change === "function" ? change(current) : change;
          if (next !== null) {
            execFileSync("mkdir", ["-p", join(path, "..")]);
            writeFileSync(path, next);
          }
        }
        cargo(workspace, "update", "--workspace", "--offline");
        const stale = await nx(workspace, ["run-many", "-t", "check", "-p", "a,b"], real);
        expect(stale.status).toBe(1);
        expect(stale.output).toContain("hakari-check: `cargo hakari");
        expect(stale.output).toContain(
          "Run `cargo hakari generate` and `cargo hakari manage-deps`",
        );
        expect(ran(workspace)).toEqual([]);

        spawnSync("cargo", ["hakari", "generate"], {
          cwd: join(workspace.root, "hakari"),
          env: { ...testEnvironment(), ...real },
        });
        spawnSync("cargo", ["hakari", "manage-deps", "-y"], {
          cwd: join(workspace.root, "hakari"),
          env: { ...testEnvironment(), ...real },
        });
        const after = await workspace.hashTasks(["a:check", "b:check"]);
        expect(after["a:check"].value).not.toBe(hashes["a:check"].value);
        const fixed = await nx(workspace, ["run-many", "-t", "check", "-p", "a,b"], real);
        expect(fixed.status).toBe(0);
        expect(ran(workspace)).toEqual([
          "check --all-targets --keep-going --message-format=json -p a -p b",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails hakari-check with cargo-hakari's output offline in an empty Cargo home",
    async () => {
      const workspace = hakariCopy();
      try {
        const run = await nx(
          workspace,
          ["run", "hakari:hakari-check", "--exclude-task-dependencies"],
          {
            ...real,
            CARGO_HOME: join(workspace.root, "empty-cargo-home"),
            CARGO_NET_OFFLINE: "true",
          },
        );
        expect(run.status).toBe(1);
        expect(run.output).toContain("hakari:hakari-check: `cargo hakari generate --diff` failed");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "passes hakari-check on the generated hack crate of the harness",
    async () => {
      const workspace = hakariCopy();
      try {
        const run = await nx(workspace, ["run", "hakari:hakari-check"], real);
        expect(run.status).toBe(0);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("hakari-check without cargo-hakari", () => {
  it(
    "fails with the message for a missing tool, whatever the machine has installed, and runs a stand-in once one is there",
    async () => {
      // An empty PATH folder and an empty Cargo home hide the cargo-hakari
      // that the machine may have, as for the tools of missing-tools.spec.ts;
      // links to the toolchain's cargo and rustc keep graph creation and the
      // lockfile task working, and a cargo subcommand is found only through
      // PATH and the Cargo home.
      const tools = new ToolFolders();
      for (const program of ["cargo", "rustc"]) {
        const found = findExecutable(program, testEnvironment().PATH ?? "");
        if (found === undefined) {
          throw new Error(`${program} is not on PATH`);
        }
        symlinkSync(found, join(tools.path, program));
      }
      const workspace = hakariCopy();
      const tool = optionalTools.find((candidate) => candidate.id === "cargo-hakari")!;
      const context = {
        workspaceRoot: workspace.root,
        workspaces: [],
        env: tools.env(),
        folder: join(workspace.root, "hakari"),
      };
      // Only the drift check runs, so that no lockfile task needs the Cargo home.
      const args = ["run", "hakari:hakari-check", "--exclude-task-dependencies"];
      try {
        expect(tool.installed(context)).toBe(false);
        const missing = await nx(workspace, args, tools.env());
        expect(missing.status).toBe(1);
        expect(missing.output).toContain(
          `hakari:hakari-check: ${missingToolMessage(tool, ["the hakari-check target of the Cargo workspace in hakari"])}`,
        );
        expect(workspace.cargoCalls().filter((call) => call.args[0] === "hakari")).toEqual([]);

        expect(readdirSync(tools.path).sort()).toEqual(["cargo", "rustc"]);
        expect(readdirSync(join(tools.cargoHome, "bin"))).toEqual([]);

        // The positive control: the same environment finds a stand-in.
        tools.install(tools.path, "cargo-hakari", "the stand-in ran");
        expect(tool.installed(context)).toBe(true);
        const present = await nx(workspace, args, tools.env());
        expect(present.status).toBe(0);
        expect(present.output).toContain("the stand-in ran");
      } finally {
        workspace.remove();
        tools.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the cargo strategy", () => {
  it(
    "passes the workspace setting and -Zfeature-unification on every step, and on a stable toolchain every task fails with cargo's error and nothing is stored",
    async () => {
      const workspace = hakariCopy({
        "hakari/Cargo.toml": (manifest) =>
          `${manifest}\n[workspace.metadata.nx]\nfeatureUnification = "cargo"\n`,
      });
      try {
        const unification = `--config resolver.feature-unification="workspace" -Zfeature-unification`;
        const run = await nx(workspace, ["run-many", "-t", "check", "-p", "a,b"]);
        expect(ran(workspace)).toEqual([
          `check --all-targets --keep-going --message-format=json -p a -p b ${unification}`,
        ]);
        expect(run.status).toBe(1);
        expect(run.output).toMatch(/-Z.*nightly/);
        expect(run.output).not.toContain("hakari-check");
        const again = await nx(workspace, ["run-many", "-t", "check", "-p", "a,b"]);
        expect(restored(again.output, "a:check")).toBe(false);
        expect(ran(workspace)).toHaveLength(1);
        // --features runs one crate per command; all features share one.
        await nx(workspace, ["run-many", "-t", "check", "-p", "a,b", "--features=x/f3"]);
        expect(ran(workspace).sort()).toEqual([
          `check --all-targets -p a --features x/f3 ${unification}`,
          `check --all-targets -p b --features x/f3 ${unification}`,
        ]);
        await nx(workspace, ["run-many", "-t", "check", "-p", "a,b", "-c", "all-features"]);
        expect(ran(workspace)).toEqual([
          `check --all-targets --keep-going --message-format=json -p a -p b --all-features ${unification}`,
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});
