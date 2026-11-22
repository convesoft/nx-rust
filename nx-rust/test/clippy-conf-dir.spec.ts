import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { clippyConfigurationCommand, configuredClippyFolders } from "../src/graph/clippy-input";
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

  it("is printed by the runtime input without a path, and nothing of it where nothing sets it", () => {
    const repository = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-clippy-repo-")));
    try {
      mkdirSync(join(repository, "rust", "-"), { recursive: true });
      writeFileSync(join(repository, "rust", "-", "clippy.toml"), threshold(3));
      const print = (env: Record<string, string | undefined>, configured: string[] = []) => {
        const { CLIPPY_CONF_DIR: _inherited, ...rest } = process.env;
        return execFileSync("sh", ["-c", clippyConfigurationCommand("rust", configured)], {
          cwd: repository,
          env: { ...rest, ...env },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      };
      write("clippy.toml", threshold(2));
      write(".clippy.toml", threshold(4));
      const both = `.clippy.toml 33\n${threshold(4)}\nclippy.toml 33\n${threshold(2)}\nend of clippy configuration\n`;
      const environment = "CLIPPY_CONF_DIR of the environment\n";
      const configuration = (index: number) =>
        `CLIPPY_CONF_DIR of the Cargo configuration ${index}\n`;

      expect({
        unset: print({}),
        set: print({ CLIPPY_CONF_DIR: conf }),
        inner: print({ CLIPPY_CONF_DIR: join(conf, "inner") }),
        missing: print({ CLIPPY_CONF_DIR: join(conf, "missing") }),
        empty: print({ CLIPPY_CONF_DIR: "" }),
        // A folder named "-" below the workspace root, not the previous folder.
        dash: print({ CLIPPY_CONF_DIR: "-", OLDPWD: conf }),
        configured: print({}, [join(conf, "inner"), "-"]),
        both: print({ CLIPPY_CONF_DIR: conf }, [join(conf, "missing")]),
      }).toEqual({
        unset: "",
        set: `${environment}${both}`,
        inner: `${environment}${both}`,
        missing: `${environment}names no folder\n`,
        empty: `${environment}names no folder\n`,
        dash: `${environment}clippy.toml 33\n${threshold(3)}\nend of clippy configuration\n`,
        configured: `${configuration(1)}${both}${configuration(2)}clippy.toml 33\n${threshold(3)}\nend of clippy configuration\n`,
        both: `${environment}${both}${configuration(1)}names no folder\n`,
      });
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("is named by Cargo's [env] as a string or as a table, relative to the workspace root or, with relative, to the folder of .cargo", () => {
    const above = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-clippy-env-")));
    try {
      const workspace = join(above, "ws");
      mkdirSync(join(workspace, ".cargo"), { recursive: true });
      mkdirSync(join(above, ".cargo"));
      writeFileSync(
        join(workspace, ".cargo", "config.toml"),
        '[env]\nCLIPPY_CONF_DIR = { value = "lint", relative = true, force = true }\n',
      );
      writeFileSync(join(above, ".cargo", "config.toml"), '[env]\nCLIPPY_CONF_DIR = "conf"\n');
      const home = join(above, "cargo-home");
      mkdirSync(home);
      writeFileSync(
        join(home, "config.toml"),
        '[env]\nCLIPPY_CONF_DIR = { value = "shared", relative = false }\nOTHER = "x"\n',
      );

      expect(configuredClippyFolders(workspace, { CARGO_HOME: home })).toEqual([
        join(workspace, "lint"),
        "conf",
        "shared",
      ]);
      expect(
        configuredClippyFolders(join(above, "other"), { CARGO_HOME: join(above, "none") }),
      ).toEqual(["conf"]);
    } finally {
      rmSync(above, { recursive: true, force: true });
    }
  });

  it(
    "changes the key of lint where Cargo's [env] names the folder, outside the repository or inside it, and the variable is unset",
    async () => {
      const workspace = FixtureWorkspace.create("subfolder-workspace");
      const config = join(workspace.root, "rust", ".cargo", "config.toml");
      const inside = join(workspace.root, "rust", "lint");
      const cargoHome = join(conf, "cargo-home");
      mkdirSync(join(workspace.root, "rust", ".cargo"));
      mkdirSync(inside);
      mkdirSync(cargoHome);
      const tasks = ["api:lint", "api:test"];
      const lintKey = async (env: Record<string, string | undefined> = {}) =>
        (await workspace.hashTasks(tasks, { env: { CLIPPY_CONF_DIR: undefined, ...env } }))[
          "api:lint"
        ].value;
      try {
        // A folder outside the repository, as an absolute string.
        writeFileSync(config, `[env]\nCLIPPY_CONF_DIR = ${JSON.stringify(conf)}\n`);
        write("clippy.toml", threshold(5));
        const outsideBefore = await lintKey();
        write("clippy.toml", threshold(2));
        const outsideAfter = await lintKey();

        // A folder inside the repository that no other input covers, relative to the folder of .cargo.
        writeFileSync(config, '[env]\nCLIPPY_CONF_DIR = { value = "lint", relative = true }\n');
        writeFileSync(join(inside, "clippy.toml"), threshold(5));
        const insideBefore = await lintKey();
        writeFileSync(join(inside, "clippy.toml"), threshold(2));
        const insideAfter = await lintKey();

        // The Cargo home's configuration, which Nx does not hash and warns about.
        rmSync(config);
        writeFileSync(
          join(cargoHome, "config.toml"),
          '[env]\nCLIPPY_CONF_DIR = { value = ".", relative = true }\n',
        );
        const homeBefore = await lintKey({ CARGO_HOME: cargoHome });
        write("clippy.toml", threshold(4));
        const homeAfter = await lintKey({ CARGO_HOME: cargoHome });
        const shown = await runNx(workspace, ["show", "projects"], { CARGO_HOME: cargoHome });

        expect({
          outside: outsideBefore !== outsideAfter,
          inside: insideBefore !== insideAfter,
          home: homeBefore !== homeAfter,
          warned: shown.output.includes(
            `nx-rust: ${join(cargoHome, "config.toml")} sets [env] for the Cargo workspace in rust, but lies outside the repository, so Nx does not hash it`,
          ),
        }).toEqual({ outside: true, inside: true, home: true, warned: true });
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT * 2,
  );

  // Where clippy's folder comes from, and the clippy.toml there, relative to the repository root, or undefined for `conf`.
  const sources: [string, Record<string, string> | undefined, string | undefined][] = [
    ["CLIPPY_CONF_DIR in the environment", undefined, undefined],
    [
      "Cargo's [env] naming a folder outside the repository",
      { "rust/.cargo/config.toml": "absolute" },
      undefined,
    ],
    [
      "Cargo's [env] naming a folder inside the repository, relative to the folder of .cargo",
      {
        "rust/.cargo/config.toml": '[env]\nCLIPPY_CONF_DIR = { value = "lint", relative = true }\n',
      },
      "rust/lint/clippy.toml",
    ],
  ];

  it.each(sources)(
    "with %s, runs a lint that passed before the threshold in its clippy.toml was lowered, and fails it",
    async (_case, files, inside) => {
      const workspace = FixtureWorkspace.create("subfolder-workspace", {
        "rust/crates/api/src/lib.rs": (source) =>
          `#![deny(clippy::too_many_arguments)]\n${source}\npub fn sum(a: u8, b: u8, c: u8) -> u8 {\n    a + b + c\n}\n`,
        ...Object.fromEntries(
          Object.entries(files ?? {}).map(([path, text]) => [
            path,
            text === "absolute" ? `[env]\nCLIPPY_CONF_DIR = ${JSON.stringify(conf)}\n` : text,
          ]),
        ),
      });
      const env = { CLIPPY_CONF_DIR: files === undefined ? conf : undefined };
      const file = inside === undefined ? join(conf, "clippy.toml") : join(workspace.root, inside);
      mkdirSync(dirname(file), { recursive: true });
      // Runs api:lint and says whether cargo ran.
      const lint = async () => {
        const calls = taskCalls(workspace).length;
        const { status } = await runNx(workspace, ["run", "api:lint"], env);
        return { status, ran: taskCalls(workspace).length > calls };
      };
      try {
        writeFileSync(file, threshold(5));
        const first = await lint();
        const again = await lint();
        writeFileSync(file, threshold(2));
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
