import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnsupportedCargoError } from "../src/compatibility/cargo-version";
import {
  describeNxMajors,
  installedNx,
  majorsOfRange,
  nxVerdict,
  nxWorkspaceRoot,
  supportedNxMajors,
} from "../src/compatibility/nx-version";
import {
  CargoCall,
  fakeNxPackage,
  FileChanges,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  testEnvironment,
  withoutColours,
} from "./harness";

// Checks the parts of VER-SETUP about the versions of Nx and Cargo, with the
// real Nx and cargo. An Nx or Cargo release that the machine does not have
// is faked where the plugin reads its version: a copy of Nx whose
// package.json gives another version (FixtureWorkspace.useNx), and the cargo
// wrapper, which pretends to be an older Cargo with
// NX_RUST_TEST_CARGO_VERSION.

const installedNxVersion: string = require("nx/package.json").version;
const installedMajor = Number(installedNxVersion.split(".")[0]);
const newerNx = `${installedMajor + 1}.0.0`;
const olderNx = `${installedMajor - 1}.4.2`;

/** How the messages name the supported majors. */
const supported = describeNxMajors(supportedNxMajors());

/** The message for a newer major without the variable, as far as tests compare it. */
const untested = (version: string) =>
  `nx-rust has not been checked with Nx ${version}, which is installed in this repository: this version of @convesoft/nx-rust supports ${supported}.`;

/** The call that reads the workspace whose root manifest is in `root`. */
function workspaceCall(root: string): CargoCall {
  return {
    cwd: root,
    args: [
      "metadata",
      "--format-version",
      "1",
      "--no-deps",
      "--manifest-path",
      `{workspaceRoot}/${root === "." ? "" : `${root}/`}Cargo.toml`,
    ],
  };
}

/** Runs `test` in a copy of `fixture` that is removed afterwards. */
async function inFixture(
  files: FileChanges,
  test: (workspace: FixtureWorkspace) => Promise<void>,
): Promise<void> {
  const workspace = FixtureWorkspace.create("subfolder-workspace", files);
  try {
    await test(workspace);
  } finally {
    workspace.remove();
  }
}

/** The error with which graph creation fails, or a failed test when it succeeds. */
async function graphError(
  workspace: FixtureWorkspace,
  env: Record<string, string | undefined> = {},
): Promise<string> {
  const error = await workspace.graph(env).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GraphCreationError);
  return (error as GraphCreationError).message;
}

/** How often `text` occurs in `output`. */
function occurrences(output: string, text: string): number {
  return output.split(text).length - 1;
}

describe("the supported Nx majors", () => {
  it("are the majors of the peer dependency range on nx, which names the Nx these tests run on", () => {
    const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

    expect(packageJson.peerDependencies).toEqual({ nx: `^${installedMajor}` });
    expect(supportedNxMajors()).toEqual([installedMajor]);
  });

  it.each([
    ["^24", [24]],
    ["^24.1.0", [24]],
    ["24", [24]],
    ["24.x", [24]],
    ["^25 || ^24", [24, 25]],
    ["^24 || ^24.2.0 || 25.x.x", [24, 25]],
  ])("reads %s as %j", (range, majors) => {
    expect(majorsOfRange(range)).toEqual(majors);
  });

  it.each([">=24", "24.1.0", "~24.1.0", "^24 - ^25", "latest", ""])(
    "rejects the range %j",
    (range) => {
      expect(() => majorsOfRange(range)).toThrow(
        /@convesoft\/nx-rust cannot tell which Nx versions it supports: it cannot read the peer dependency range on nx/,
      );
    },
  );

  it("are named in words", () => {
    expect(describeNxMajors([24])).toBe("Nx 24");
    expect(describeNxMajors([24, 25])).toBe("Nx 24 and 25");
    expect(describeNxMajors([23, 24, 25])).toBe("Nx 23, 24 and 25");
  });
});

describe("the verdict on the installed Nx", () => {
  const majors = [24, 25];
  const verdict = (version: string, env: NodeJS.ProcessEnv = {}) =>
    nxVerdict({ version, major: Number(version.split(".")[0]) }, majors, env);

  it("accepts each supported major, prereleases included", () => {
    expect(verdict("24.0.0")).toEqual({ kind: "supported" });
    expect(verdict("25.9.1")).toEqual({ kind: "supported" });
    expect(verdict("25.0.0-beta.2")).toEqual({ kind: "supported" });
  });

  it("stops with an older major, naming the version found and the supported majors", () => {
    expect(verdict("23.4.2")).toEqual({
      kind: "error",
      message: [
        "nx-rust does not support Nx 23.4.2, which is installed in this repository: this version of @convesoft/nx-rust supports Nx 24 and 25.",
        "Upgrade Nx to a supported version with `nx migrate`, or use a version of @convesoft/nx-rust that supports Nx 23.",
      ].join("\n"),
    });
  });

  it("stops with an older major also when NX_RUST_ALLOW_UNSUPPORTED_NX is true", () => {
    const result = verdict("23.4.2", { NX_RUST_ALLOW_UNSUPPORTED_NX: "true" });

    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.message).toContain(
      "NX_RUST_ALLOW_UNSUPPORTED_NX applies only to Nx majors newer than the supported ones.",
    );
  });

  it("stops with a newer major and says how to try it anyway", () => {
    expect(verdict("26.1.0")).toEqual({
      kind: "error",
      message: [
        "nx-rust has not been checked with Nx 26.1.0, which is installed in this repository: this version of @convesoft/nx-rust supports Nx 24 and 25.",
        "Use a version of @convesoft/nx-rust that supports Nx 26, or set NX_RUST_ALLOW_UNSUPPORTED_NX=true to try this one with Nx 26: nobody has checked its cache keys and batching on that major.",
      ].join("\n"),
    });
  });

  it("warns instead with a newer major when NX_RUST_ALLOW_UNSUPPORTED_NX is true", () => {
    expect(verdict("26.1.0", { NX_RUST_ALLOW_UNSUPPORTED_NX: "true" })).toEqual({
      kind: "warning",
      message: [
        "nx-rust has not been checked with Nx 26.1.0, which is installed in this repository: this version of @convesoft/nx-rust supports Nx 24 and 25.",
        "It continues because NX_RUST_ALLOW_UNSUPPORTED_NX is true, but nobody has checked its cache keys and batching on Nx 26. Use a version of @convesoft/nx-rust that supports Nx 26 once there is one.",
      ].join("\n"),
    });
  });

  it.each(["1", "TRUE", "yes", ""])(
    "stops with a newer major when NX_RUST_ALLOW_UNSUPPORTED_NX is %j",
    (value) => {
      const result = verdict("26.1.0", { NX_RUST_ALLOW_UNSUPPORTED_NX: value });

      expect(result.kind).toBe("error");
      expect(result.kind === "error" && result.message).toContain(
        `NX_RUST_ALLOW_UNSUPPORTED_NX is ${JSON.stringify(value)}; only the value true turns this error into a warning.`,
      );
    },
  );
});

describe("the repository in which the plugin looks for Nx when it loads", () => {
  it(
    "is the nearest folder with nx.json, or NX_WORKSPACE_ROOT_PATH",
    () =>
      inFixture({}, async (workspace) => {
        expect(nxWorkspaceRoot(join(workspace.root, "rust", "crates", "api"), {})).toBe(
          workspace.root,
        );
        expect(nxWorkspaceRoot(workspace.root, { NX_WORKSPACE_ROOT_PATH: "/somewhere/else" })).toBe(
          "/somewhere/else",
        );
      }),
    HARNESS_TIMEOUT,
  );
});

describe("graph creation with an unsupported Nx", () => {
  it(
    "fails with a newer major, naming the version found and the supported majors",
    () =>
      inFixture({}, async (workspace) => {
        workspace.useNx(newerNx);

        const message = await graphError(workspace);

        expect(message).toContain(untested(newerNx));
        expect(message).toContain(
          `set NX_RUST_ALLOW_UNSUPPORTED_NX=true to try this one with Nx ${installedMajor + 1}`,
        );
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "fails with a newer major also in a repository without a Cargo.toml",
    () =>
      inFixture({ rust: null }, async (workspace) => {
        workspace.useNx(newerNx);

        expect(await graphError(workspace)).toContain(untested(newerNx));
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "fails with an older major, also when NX_RUST_ALLOW_UNSUPPORTED_NX is true",
    () =>
      inFixture({ rust: null }, async (workspace) => {
        workspace.useNx(olderNx);
        const expected = `nx-rust does not support Nx ${olderNx}, which is installed in this repository: this version of @convesoft/nx-rust supports ${supported}.`;

        expect(await graphError(workspace)).toContain(expected);
        const allowed = await graphError(workspace, { NX_RUST_ALLOW_UNSUPPORTED_NX: "true" });
        expect(allowed).toContain(expected);
        expect(allowed).toContain(
          "NX_RUST_ALLOW_UNSUPPORTED_NX applies only to Nx majors newer than the supported ones.",
        );
      }),
    HARNESS_TIMEOUT,
  );

  it.each([
    ["in a plugin worker", {}],
    ["in Nx's own process", { NX_ISOLATE_PLUGINS: "false" }],
  ])(
    "succeeds with a newer major and NX_RUST_ALLOW_UNSUPPORTED_NX=true and warns once, %s",
    (_where, env) =>
      inFixture({}, async (workspace) => {
        workspace.useNx(newerNx);

        const allowed = await workspace.nx(["show", "projects"], {
          ...env,
          NX_RUST_ALLOW_UNSUPPORTED_NX: "true",
        });
        const output = withoutColours(allowed.output);

        expect(allowed.status).toBe(0);
        expect(output).toContain("api");
        expect(occurrences(output, untested(newerNx))).toBe(1);
        expect(output).toContain(
          `It continues because NX_RUST_ALLOW_UNSUPPORTED_NX is true, but nobody has checked its cache keys and batching on Nx ${installedMajor + 1}.`,
        );
        expect(workspace.cargoCalls()).toEqual([workspaceCall("rust")]);

        // The positive control: the same command without the variable fails.
        const stopped = await workspace.nx(["show", "projects"], env);
        expect(stopped.status).toBe(1);
        expect(withoutColours(stopped.output)).toContain(untested(newerNx));
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "follows NX_RUST_ALLOW_UNSUPPORTED_NX as it changes while the Nx daemon creates the graph",
    () =>
      inFixture({ rust: null }, async (workspace) => {
        workspace.useNx(newerNx);
        const daemon = { NX_DAEMON: "true" };
        try {
          const first = await workspace.nx(["show", "projects"], daemon);
          expect(first.status).toBe(1);
          expect(withoutColours(first.output)).toContain(untested(newerNx));

          const allowed = await workspace.nx(["show", "projects"], {
            ...daemon,
            NX_RUST_ALLOW_UNSUPPORTED_NX: "true",
          });
          expect(allowed.status).toBe(0);
          // The daemon created the graph: the warning is in its log.
          const log = workspace.daemonLog();
          expect(log).toContain(`[NX v${newerNx} Daemon Server]`);
          expect(log).toContain(untested(newerNx));
          expect(log).toContain("It continues because NX_RUST_ALLOW_UNSUPPORTED_NX is true");

          const again = await workspace.nx(["show", "projects"], daemon);
          expect(again.status).toBe(1);
          expect(withoutColours(again.output)).toContain(untested(newerNx));
        } finally {
          await workspace.nx(["daemon", "--stop"], daemon);
        }
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "says nothing about the version of a supported Nx",
    () =>
      inFixture({}, async (workspace) => {
        const shown = await workspace.nx(["show", "projects"], {
          NX_RUST_ALLOW_UNSUPPORTED_NX: "true",
        });
        const task = await workspace.nx(["run", "api:fmt-check", "--output-style=static"], {
          NX_RUST_ALLOW_UNSUPPORTED_NX: "true",
        });

        expect(shown.status).toBe(0);
        expect(shown.output).not.toContain("nx-rust");
        expect(task.status).toBe(0);
        expect(withoutColours(task.output)).not.toContain("has not been checked");
      }),
    HARNESS_TIMEOUT,
  );
});

describe("a task with an Nx major newer than the supported ones", () => {
  it.each<[string, Record<string, string>, number]>([
    // Graph creation prints the warning in the terminal, and the task again.
    ["without the daemon", {}, 2],
    // The daemon writes graph creation's warning to its log.
    ["with the daemon", { NX_DAEMON: "true" }, 1],
  ])(
    "prints the warning of NX_RUST_ALLOW_UNSUPPORTED_NX=true again at its start, %s",
    (_case, env, printed) =>
      inFixture({}, async (workspace) => {
        workspace.useNx(newerNx);
        const allowed = { ...env, NX_RUST_ALLOW_UNSUPPORTED_NX: "true" };
        try {
          const { status, output } = await workspace.nx(
            ["run", "api:fmt-check", "--output-style=static"],
            allowed,
          );

          expect(status).toBe(0);
          expect(occurrences(withoutColours(output), untested(newerNx))).toBe(printed);
          // Only the daemon has a log, where graph creation printed it.
          expect(workspace.daemonLog().includes(untested(newerNx))).toBe(env.NX_DAEMON === "true");
        } finally {
          if (env.NX_DAEMON === "true") {
            await workspace.nx(["daemon", "--stop"], allowed);
          }
        }
      }),
    HARNESS_TIMEOUT,
  );
});

describe("an installed Nx whose version cannot be read", () => {
  /** The advice that follows the problem in each such message. */
  const advice = `This version of @convesoft/nx-rust supports ${supported}. Reinstall nx, or install a supported version of it, then run the command again.`;

  it(
    "fails graph creation when its version is no version, naming the file, the value and the supported majors",
    () =>
      inFixture({}, async (workspace) => {
        workspace.useNx("not-a-version");

        const message = await graphError(workspace);

        expect(message).toMatch(
          /nx-rust could not read the version of the Nx installed in this repository: \S+\/nx-not-a-version\/node_modules\/nx\/package\.json gives the version "not-a-version"\./,
        );
        expect(message).toContain(advice);
      }),
    HARNESS_TIMEOUT,
  );

  // The Nx that runs reads its own package.json, so the unreadable one is
  // the one that Nx and the plugin look at first: .nx/installation.
  it(
    "fails graph creation when its package.json cannot be read, naming the file and the supported majors",
    () =>
      inFixture({}, async (workspace) => {
        const folder = join(workspace.root, ".nx", "installation", "node_modules", "nx");
        mkdirSync(folder, { recursive: true });
        const packageJson = join(folder, "package.json");
        writeFileSync(packageJson, `{ "name": "nx", "version": "${installedNxVersion}" }\n`);
        chmodSync(packageJson, 0o000);
        try {
          const message = await graphError(workspace);

          expect(message).toContain(
            `nx-rust could not read the version of the Nx installed in this repository: Cannot read package config ${packageJson}`,
          );
          expect(message).toContain(advice);
        } finally {
          chmodSync(packageJson, 0o644);
        }
      }),
    HARNESS_TIMEOUT,
  );

  it("is read from the harness's copy of Nx, and reported when that copy's package.json is unreadable or gives no version", () => {
    const base = mkdtempSync(join(tmpdir(), "nx-rust-installed-nx-"));
    try {
      const copy = fakeNxPackage(base, "25.1.0");
      const packageJson = join(copy, "package.json");

      expect(installedNx(base)).toEqual({ version: "25.1.0", major: 25 });

      // Node.js reports the file when it resolves the package, or, where it
      // has resolved it before in this process, when the plugin reads it.
      chmodSync(packageJson, 0o000);
      const unreadable = (() => {
        try {
          installedNx(base);
        } catch (error) {
          return (error as Error).message;
        }
        return "";
      })();
      chmodSync(packageJson, 0o644);
      expect(unreadable).toMatch(
        /^nx-rust could not read the version of the Nx installed in this repository: /,
      );
      expect(unreadable).toContain(packageJson);
      expect(unreadable).toContain(advice);

      writeFileSync(packageJson, '{ "name": "nx", "version": 25 }\n');
      expect(() => installedNx(base)).toThrow(
        `nx-rust could not read the version of the Nx installed in this repository: ${packageJson} gives the version 25.\n${advice}`,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("graph creation with an unsupported Cargo", () => {
  it(
    "fails, naming the version found, the version required and the workspace, after one more cargo call",
    () =>
      inFixture({}, async (workspace) => {
        const message = await graphError(workspace, { NX_RUST_TEST_CARGO_VERSION: "1.90.0" });

        expect(message).toContain(
          "nx-rust needs Cargo 1.91 or later, but the cargo that reads the Cargo workspace of rust/Cargo.toml is cargo 1.90.0 (0000000 2025-01-01).",
        );
        expect(message).toContain(
          "Update that toolchain, for example with `rustup update`, or pin Rust 1.91 or later in the rust-toolchain.toml that chooses it.",
        );
        expect(workspace.cargoCalls()).toEqual([
          workspaceCall("rust"),
          { cwd: "rust", args: ["--version"] },
        ]);
      }),
    HARNESS_TIMEOUT,
  );

  it(
    "fails for every workspace it reads, without leaving one out",
    async () => {
      const workspace = FixtureWorkspace.create("two-workspaces");
      try {
        const message = await graphError(workspace, { NX_RUST_TEST_CARGO_VERSION: "1.89.0" });

        expect(message).toContain(
          "nx-rust needs Cargo 1.91 or later, but the cargo that reads the Cargo workspace of Cargo.toml is cargo 1.89.0",
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "adds no cargo call when Cargo is supported",
    () =>
      inFixture({}, async (workspace) => {
        await workspace.graph();

        expect(workspace.cargoCalls()).toEqual([workspaceCall("rust")]);
      }),
    HARNESS_TIMEOUT,
  );

  // The wrapper's fake rests on what a real Cargo before 1.91 reports
  // (EVD-CARGO-DIRECTORIES). Where rustup has Rust 1.89, as on some
  // developers' machines but not in CI, this checks it with that Cargo.
  const realOldCargo =
    spawnSync("rustup", ["toolchain", "list"], { env: testEnvironment(), encoding: "utf8" })
      .stdout?.split("\n")
      .some((line) => line.startsWith("1.89-") || line.startsWith("1.89.0-")) ?? false;
  if (realOldCargo) {
    it(
      "fails the same way with a real Cargo 1.89",
      () =>
        inFixture({}, async (workspace) => {
          const message = await graphError(workspace, { RUSTUP_TOOLCHAIN: "1.89" });

          expect(message).toMatch(
            /nx-rust needs Cargo 1\.91 or later, but the cargo that reads the Cargo workspace of rust\/Cargo\.toml is cargo 1\.89\.\d+ \(/,
          );
        }),
      HARNESS_TIMEOUT,
    );
  }

  describe("its message", () => {
    const subject = "the Cargo workspace of rust/Cargo.toml";

    it("says that cargo is older when cargo --version fails", () => {
      const message = new UnsupportedCargoError({
        failure: "cargo exited with status 1",
      }).messageFor(subject);

      expect(message).toContain(
        "nx-rust needs Cargo 1.91 or later, but the cargo that reads the Cargo workspace of rust/Cargo.toml is older: its `cargo metadata` report has no build_directory, which Cargo reports from 1.91 on. `cargo --version` failed: cargo exited with status 1.",
      );
    });

    it("asks for a report when a Cargo from 1.91 on gives no build_directory", () => {
      const message = new UnsupportedCargoError({
        version: "cargo 1.95.0 (abc 2026-01-01)",
      }).messageFor(subject);

      expect(message).toContain(
        "nx-rust could not read the Cargo workspace of rust/Cargo.toml: cargo 1.95.0 (abc 2026-01-01) printed a `cargo metadata` report without build_directory",
      );
      expect(message).toContain("https://github.com/convesoft/nx-rust/issues");
    });
  });
});
