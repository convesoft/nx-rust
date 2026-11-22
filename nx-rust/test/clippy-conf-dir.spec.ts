import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { clippyConfigurationCommand } from "../src/graph/clippy-input";
import { FixtureWorkspace, HARNESS_TIMEOUT, runNx, taskCalls } from "./harness";

// The row of VER-CACHE-KEYS about CLIPPY_CONF_DIR (DES-INPUTS, "Clippy's
// configuration folder"), with the real Nx hasher and a real cargo clippy:
// the key of lint follows the file that clippy takes in the folder that the
// variable names, which lies outside the repository (nxr-rpcfg4).

describe("CLIPPY_CONF_DIR", () => {
  /** A folder outside the repository, with an empty folder `inner` below it. */
  let conf: string;
  beforeEach(() => {
    conf = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-clippy-conf-")));
    mkdirSync(join(conf, "inner"));
  });
  afterEach(() => rmSync(conf, { recursive: true, force: true }));

  const write = (file: string, text: string) => writeFileSync(join(conf, file), text);
  const threshold = (value: number) => `too-many-arguments-threshold = ${value}\n`;

  it(
    "changes the key of lint, and of no other target, with the configuration file that clippy takes there",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace");
      const tasks = ["api:lint", "api:check", "api:test"];
      // The key of each task, by task, for the environment.
      const keys = async (env: Record<string, string | undefined>) => {
        const hashes = await workspace.hashTasks(tasks, { env });
        return Object.fromEntries(tasks.map((task) => [task, hashes[task].value]));
      };
      // Which tasks' keys differ between two states.
      const differing = (a: Record<string, string>, b: Record<string, string>) =>
        tasks.filter((task) => a[task] !== b[task]);
      try {
        const absolute = { CLIPPY_CONF_DIR: conf };
        // From the workspace root, where cargo runs clippy-driver.
        const fromWorkspace = { CLIPPY_CONF_DIR: relative(join(workspace.root, "rust"), conf) };
        const inner = { CLIPPY_CONF_DIR: join(conf, "inner") };
        const unset = { CLIPPY_CONF_DIR: undefined };

        write("clippy.toml", threshold(5));
        const before = {
          absolute: await keys(absolute),
          fromWorkspace: await keys(fromWorkspace),
          inner: await keys(inner),
          unset: await keys(unset),
        };
        write("clippy.toml", threshold(2));
        const changed = {
          absolute: await keys(absolute),
          fromWorkspace: await keys(fromWorkspace),
          inner: await keys(inner),
          unset: await keys(unset),
        };
        write(".clippy.toml", threshold(4));
        const dotFile = await keys(absolute);

        expect({
          absolute: differing(before.absolute, changed.absolute),
          fromWorkspace: differing(before.fromWorkspace, changed.fromWorkspace),
          // inner holds no file, so clippy takes its parent's.
          inner: differing(before.inner, changed.inner),
          unset: differing(before.unset, changed.unset),
          dotFile: differing(changed.absolute, dotFile),
        }).toEqual({
          absolute: ["api:lint"],
          fromWorkspace: ["api:lint"],
          inner: ["api:lint"],
          unset: [],
          dotFile: ["api:lint"],
        });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  it("is printed by the runtime input without a path, and nothing of it where it is unset", () => {
    const repository = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-clippy-repo-")));
    try {
      mkdirSync(join(repository, "rust"));
      const print = (env: Record<string, string | undefined>) => {
        const { CLIPPY_CONF_DIR: _inherited, ...rest } = process.env;
        return execFileSync("sh", ["-c", clippyConfigurationCommand("rust")], {
          cwd: repository,
          env: { ...rest, ...env },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      };
      write("clippy.toml", threshold(2));
      write(".clippy.toml", threshold(4));

      expect({
        unset: print({}),
        set: print({ CLIPPY_CONF_DIR: conf }),
        inner: print({ CLIPPY_CONF_DIR: join(conf, "inner") }),
        missing: print({ CLIPPY_CONF_DIR: join(conf, "missing") }),
        empty: print({ CLIPPY_CONF_DIR: "" }),
      }).toEqual({
        unset: "",
        set: `.clippy.toml 33\n${threshold(4)}\nclippy.toml 33\n${threshold(2)}\nend of clippy configuration\n`,
        inner: `.clippy.toml 33\n${threshold(4)}\nclippy.toml 33\n${threshold(2)}\nend of clippy configuration\n`,
        missing: "CLIPPY_CONF_DIR names no folder\n",
        empty: "CLIPPY_CONF_DIR names no folder\n",
      });
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it(
    "runs a lint that passed before the threshold in its clippy.toml was lowered, and fails it",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace", {
        "rust/crates/api/src/lib.rs": (source) =>
          `#![deny(clippy::too_many_arguments)]\n${source}\npub fn sum(a: u8, b: u8, c: u8) -> u8 {\n    a + b + c\n}\n`,
      });
      const env = { CLIPPY_CONF_DIR: conf };
      // Runs api:lint and says whether cargo ran.
      const lint = async () => {
        const calls = taskCalls(workspace).length;
        const { status } = await runNx(workspace, ["run", "api:lint"], env);
        return { status, ran: taskCalls(workspace).length > calls };
      };
      try {
        write("clippy.toml", threshold(5));
        const first = await lint();
        const again = await lint();
        write("clippy.toml", threshold(2));
        const lowered = await lint();

        expect({ first, again, lowered }).toEqual({
          first: { status: 0, ran: true },
          again: { status: 0, ran: false },
          lowered: { status: 1, ran: true },
        });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );
});
