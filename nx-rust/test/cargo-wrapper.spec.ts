import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  CargoWrapper,
  cargoProbeProject,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  installProbeExecutor,
  testEnvironment,
} from "./harness";

describe("cargo wrapper", () => {
  let directory: string;
  let cargo: CargoWrapper;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-cargo-wrapper-")));
    cargo = CargoWrapper.install(join(directory, "wrapper"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it(
    "logs each invocation with its folder and runs the real cargo",
    () => {
      const folder = join(directory, "some folder");
      mkdirSync(folder);

      const version = execFileSync("cargo", ["--version"], {
        cwd: folder,
        env: cargo.environment(testEnvironment()),
        encoding: "utf8",
      });

      expect(version).toMatch(/^cargo \d+\.\d+\.\d+/);
      expect(cargo.calls()).toEqual([{ cwd: folder, args: ["--version"] }]);
      expect(cargo.calls(directory)).toEqual([{ cwd: "some folder", args: ["--version"] }]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "exits as cargo did",
    () => {
      const result = spawnSync("cargo", ["no-such-command"], {
        cwd: directory,
        env: cargo.environment(testEnvironment()),
        encoding: "utf8",
      });

      expect(result.status).toBe(101);
      expect(result.stderr).toContain("no-such-command");
      expect(cargo.calls()).toHaveLength(1);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs the real cargo with its own folder first on PATH, so that cargo runs the matching rustc",
    () => {
      // A rustc that fails, ahead of everything but the wrapper, as a system
      // rustc in Node's folder is for an nx:run-commands task.
      const decoy = join(directory, "decoy");
      mkdirSync(decoy);
      writeFileSync(join(decoy, "rustc"), "#!/bin/sh\necho decoy rustc >&2\nexit 1\n", {
        mode: 0o755,
      });
      const crate = join(directory, "crate");
      mkdirSync(join(crate, "src"), { recursive: true });
      writeFileSync(
        join(crate, "Cargo.toml"),
        '[package]\nname = "probe"\nversion = "0.1.0"\nedition = "2021"\n',
      );
      writeFileSync(join(crate, "src", "main.rs"), "fn main() {}\n");
      const env = testEnvironment({
        CARGO_TARGET_DIR: join(directory, "target"),
        CARGO_BUILD_BUILD_DIR: join(directory, "build"),
      });

      const result = spawnSync("cargo", ["build", "--offline"], {
        cwd: crate,
        env: { ...env, PATH: [cargo.binDirectory, decoy, env.PATH].join(delimiter) },
        encoding: "utf8",
      });

      expect(result.stderr).not.toContain("decoy rustc");
      expect(result.status).toBe(0);
    },
    HARNESS_TIMEOUT,
  );
});

/** What the stand-in of {@link recordingCargo} got. */
interface ReceivedCall {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/**
 * Writes a stand-in for the real cargo into `folder` that appends its
 * arguments, its folder and its environment as a JSON line to `received`.
 */
function recordingCargo(folder: string, received: string): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "cargo"),
    [
      `#!${process.execPath}`,
      `const call = { args: process.argv.slice(2), cwd: process.cwd(), env: process.env };`,
      `require("node:fs").appendFileSync(${JSON.stringify(received)}, JSON.stringify(call) + "\\n");`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

describe("cargo wrapper with a stand-in for the real cargo", () => {
  let directory: string;
  let realFolder: string;
  let received: string;
  let cargo: CargoWrapper;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-cargo-wrapper-")));
    realFolder = join(directory, "real");
    received = join(directory, "received.jsonl");
    recordingCargo(realFolder, received);
    cargo = CargoWrapper.install(join(directory, "wrapper"), { PATH: realFolder });
    env = cargo.environment(testEnvironment());
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function receivedCalls(): ReceivedCall[] {
    return readFileSync(received, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));
  }

  it(
    "logs each argument as it was given and passes it on unchanged, whatever characters it holds",
    () => {
      const argumentLists = [
        [],
        [""],
        ["", "a", ""],
        ["metadata", "--format-version", "1", "--manifest-path", "/a folder/Cargo.toml"],
        ["a b", " ", "'", "$HOME", "`id`", "*", "[!a]", "%s", "-n", "~", "{}", "a|b;c&d"],
        ['say "hi"'],
        ["back\\slash", "\\", "\\n"],
        ["line\nbreak", "tab\tand\rreturn", "\u0001", "\u001b[31m", "\u007f"],
        ["é", "日本語", "😀", "\u2028"],
        ["x".repeat(5000)],
      ];

      for (const args of argumentLists) {
        execFileSync("cargo", args, { cwd: directory, env });
      }

      const expected = argumentLists.map((args) => ({ cwd: directory, args }));
      expect(cargo.calls()).toEqual(expected);
      expect(receivedCalls().map(({ args, cwd }) => ({ cwd, args }))).toEqual(expected);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "logs the folder by its real path where a shell reached it through a symbolic link",
    () => {
      mkdirSync(join(directory, "a folder", "sub"), { recursive: true });
      symlinkSync(join(directory, "a folder"), join(directory, "link"));

      // The shell's cd keeps the link in PWD, which the wrapper inherits.
      execFileSync("/bin/sh", ["-c", "cd link/sub && cargo check && cd .. && cargo check"], {
        cwd: directory,
        env,
      });

      expect(cargo.calls(directory)).toEqual([
        { cwd: "a folder/sub", args: ["check"] },
        { cwd: "a folder", args: ["check"] },
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "runs the real cargo with the environment it was given, but for its own folder first on PATH",
    () => {
      const given: NodeJS.ProcessEnv = {
        ...env,
        NX_RUST_TEST_PROBE: "a value with spaces",
        NX_RUST_TEST_EMPTY: "",
        RUSTUP_AUTO_INSTALL: "0",
      };
      // The names of the wrapper script's own variables.
      const withScriptNames: NodeJS.ProcessEnv = {
        ...given,
        nx_rust_plain: "",
        nx_rust_safe: "kept",
        nx_rust_folder: "kept",
        nx_rust_line: "kept",
        nx_rust_comma: "kept",
        nx_rust_arg: "kept",
      };

      execFileSync("cargo", ["check"], { cwd: directory, env: given });
      execFileSync("cargo", ["check"], { cwd: directory, env: withScriptNames });

      // Variables that /bin/sh sets or drops itself, for any script it runs.
      const shellVariables = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);
      const withoutShellVariables = (variables: NodeJS.ProcessEnv) =>
        Object.fromEntries(Object.entries(variables).filter(([name]) => !shellVariables.has(name)));
      const expected = (variables: NodeJS.ProcessEnv) =>
        withoutShellVariables({ ...variables, PATH: [realFolder, variables.PATH].join(delimiter) });
      expect(receivedCalls().map((call) => withoutShellVariables(call.env))).toEqual([
        expected(given),
        expected(withScriptNames),
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives the real cargo only its own folder as PATH where the caller has none or an empty one",
    () => {
      const withoutPath = { ...env };
      delete withoutPath.PATH;
      const wrapperPath = join(cargo.binDirectory, "cargo");

      execFileSync(wrapperPath, ["check"], { cwd: directory, env: withoutPath });
      execFileSync(wrapperPath, ["check"], { cwd: directory, env: { ...withoutPath, PATH: "" } });

      expect(receivedCalls().map((call) => call.env.PATH)).toEqual([realFolder, realFolder]);
      expect(cargo.calls()).toEqual([
        { cwd: directory, args: ["check"] },
        { cwd: directory, args: ["check"] },
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "neither logs nor runs cargo where the folder it starts in no longer exists",
    () => {
      mkdirSync(join(directory, "gone"));

      const result = spawnSync("/bin/sh", ["-c", 'cd gone && rmdir "$PWD" && exec cargo check'], {
        cwd: directory,
        env,
        encoding: "utf8",
      });

      expect(result.status).not.toBe(0);
      expect(cargo.calls()).toEqual([]);
      expect(existsSync(received)).toBe(false);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "logs each call of commands that run at the same moment on a line of its own",
    async () => {
      // A cargo that does nothing, so that many calls can run at once.
      const quiet = join(directory, "quiet");
      mkdirSync(quiet);
      writeFileSync(join(quiet, "cargo"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const wrapper = CargoWrapper.install(join(directory, "quiet-wrapper"), { PATH: quiet });
      // Lines of 512 bytes with their newline, the most that the wrapper
      // writes from the shell, and a few of 300 kB, which a shell would write
      // in many parts and which the wrapper hands to Node.
      const lineBytes = (args: string[]) =>
        Buffer.byteLength(
          `${JSON.stringify({ cwd: directory, args, env: { RUSTUP_AUTO_INSTALL: "0" } })}\n`,
        );
      const padding = 512 - lineBytes(["check", ""]);
      const argumentLists = Array.from({ length: 50 }, (_, index) =>
        index % 10 === 5
          ? ["check", `${index}`.padEnd(100_000, "x"), "y".repeat(100_000), "z".repeat(100_000)]
          : ["check", `${index}`.padEnd(padding, "x")],
      );

      // Each command waits until the file `go` exists, so that the calls
      // start together rather than as fast as Node starts processes.
      const go = join(directory, "go");
      const commands = argumentLists.map((args) => {
        const child = spawn(
          "/bin/sh",
          ["-c", 'while [ ! -e "$0" ]; do :; done; exec cargo "$@"', go, ...args],
          { cwd: directory, env: wrapper.environment(testEnvironment()), stdio: "ignore" },
        );
        return {
          started: new Promise<void>((resolve, reject) => {
            child.on("spawn", resolve);
            child.on("error", reject);
          }),
          finished: new Promise<void>((resolve, reject) => {
            child.on("error", reject);
            child.on("close", (status) =>
              status === 0 ? resolve() : reject(new Error(`cargo ${args[1]}: ${status}`)),
            );
          }),
        };
      });
      await Promise.all(commands.map(({ started }) => started));
      writeFileSync(go, "");
      await Promise.all(commands.map(({ finished }) => finished));

      const byArguments = (calls: { args: string[] }[]) =>
        calls.map(({ args }) => args).sort((a, b) => a[1].localeCompare(b[1]));
      expect(byArguments(wrapper.calls())).toEqual(
        byArguments(argumentLists.map((args) => ({ args }))),
      );
    },
    HARNESS_TIMEOUT,
  );
});

// Nx starts cargo in two ways: from an nx:run-commands task, which rebuilds
// PATH with Node's folder ahead of the inherited one, and from an executor
// process, which inherits Nx's PATH, alone or in a batch.
describe("cargo wrapper in a fixture workspace", () => {
  let workspace: FixtureWorkspace;

  beforeAll(() => {
    workspace = FixtureWorkspace.create("subfolder-workspace", {
      "rust/crates/api/project.json": cargoProbeProject("api"),
      "rust/crates/model/project.json": cargoProbeProject("model"),
    });
    installProbeExecutor(workspace.root);
  });

  beforeEach(() => workspace.cargo.clear());

  afterAll(() => workspace?.remove());

  it(
    "logs cargo that an nx:run-commands task starts, ahead of Node's folder",
    async () => {
      const { status, output } = await workspace.nx([
        "run",
        "api:probe-command",
        "--skip-nx-cache",
        "--output-style=static",
      ]);

      expect(status).toBe(0);
      expect(output).toContain(join(workspace.root, "node_modules", ".bin", "cargo"));
      expect(workspace.cargoCalls()).toContainEqual({
        cwd: "rust/crates/api",
        args: ["--version"],
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "logs cargo that an executor starts",
    async () => {
      const { status, output } = await workspace.nx([
        "run",
        "api:probe-executor",
        "--skip-nx-cache",
        "--output-style=static",
      ]);

      expect(status).toBe(0);
      expect(output).toMatch(/cargo \d+\.\d+\.\d+/);
      expect(workspace.cargoCalls()).toContainEqual({
        cwd: "rust/crates/api",
        args: ["--version"],
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "logs cargo that a batched executor starts",
    async () => {
      const { status } = await workspace.nx([
        "run-many",
        "-t",
        "probe-executor",
        "--batch",
        "--skip-nx-cache",
        "--output-style=static",
      ]);

      expect(status).toBe(0);
      const calls = workspace.cargoCalls();
      expect(calls).toContainEqual({ cwd: "rust/crates/api", args: ["-V"] });
      expect(calls).toContainEqual({ cwd: "rust/crates/model", args: ["-V"] });
    },
    HARNESS_TIMEOUT,
  );
});
