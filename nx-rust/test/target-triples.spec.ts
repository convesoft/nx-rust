import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  configuredTriples,
  type PickedTriples,
  pickedTriples,
  pickText,
} from "../src/cargo/target-triples";
import { tripleCommand } from "../src/graph/inputs";
import { HARNESS_TIMEOUT, loadsCompiledPlugin, pluginPackage, testEnvironment } from "./harness";

// Checks the rule of DES-OUTPUTS ("Paths") by which the plugin names the
// triples that cargo builds for without --target, from build.target in
// Cargo's configuration files and CARGO_BUILD_TARGET (EVD-CARGO-TRIPLE-FOLDERS),
// and, with the real cargo, that the folders it names are those that cargo
// writes to.

function hostTriple(): string {
  const { stdout } = spawnSync("rustc", ["-vV"], { env: testEnvironment(), encoding: "utf8" });
  const host = /^host: (.+)$/m.exec(stdout)?.[1];
  if (host === undefined) {
    throw new Error(`rustc -vV named no host triple:\n${stdout}`);
  }
  return host;
}

describe("the triples that cargo picks without --target", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-triples-")));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(path: string, content: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  const target = (value: string) => `[build]\ntarget = ${value}\n`;

  /** The pick for the workspace in `ws`, with files relative to the temporary root. */
  function pick(env: NodeJS.ProcessEnv = {}): PickedTriples {
    const picked = pickedTriples(join(root, "ws"), { CARGO_HOME: join(root, "home"), ...env });
    return picked.kind === "none"
      ? picked
      : { ...picked, files: picked.files.map((file) => relative(root, file)) };
  }

  it("is none without build.target and CARGO_BUILD_TARGET", () => {
    write("ws/.cargo/config.toml", '[build]\ntarget-dir = "out"\n');
    expect(pick()).toEqual({ kind: "none" });
  });

  it("takes the string of the deepest file, over the folders above and the Cargo home", () => {
    write("ws/.cargo/config.toml", target('"a-ws"'));
    write(".cargo/config.toml", target('"a-parent"'));
    write("home/config.toml", target('"a-home"'));
    expect(pick()).toEqual({
      kind: "triples",
      triples: ["a-ws"],
      files: ["ws/.cargo/config.toml"],
      fromEnv: false,
    });
    rmSync(join(root, "ws/.cargo"), { recursive: true });
    expect(pick()).toMatchObject({ triples: ["a-parent"], files: [".cargo/config.toml"] });
    rmSync(join(root, ".cargo"), { recursive: true });
    expect(pick()).toMatchObject({ triples: ["a-home"], files: ["home/config.toml"] });
  });

  it("reads .cargo/config where it exists beside .cargo/config.toml", () => {
    write("ws/.cargo/config", target('"legacy"'));
    write("ws/.cargo/config.toml", target('"current"'));
    expect(pick()).toMatchObject({ triples: ["legacy"], files: ["ws/.cargo/config"] });
  });

  it("joins the lists of several files, each triple once, and builds for none with an empty list", () => {
    write("ws/.cargo/config.toml", target('["a", "b"]'));
    write(".cargo/config.toml", target('["c", "a"]'));
    const picked = pick();
    expect(picked.kind === "triples" && [...picked.triples].sort()).toEqual(["a", "b", "c"]);
    expect(picked).toMatchObject({ files: ["ws/.cargo/config.toml", ".cargo/config.toml"] });

    rmSync(join(root, ".cargo"), { recursive: true });
    write("ws/.cargo/config.toml", target("[]"));
    expect(pick()).toEqual({
      kind: "triples",
      triples: [],
      files: ["ws/.cargo/config.toml"],
      fromEnv: false,
    });
  });

  it("names nothing where a string meets a list or a value is no string", () => {
    write("ws/.cargo/config.toml", target('["a"]'));
    write(".cargo/config.toml", target('"b"'));
    expect(pick()).toMatchObject({
      kind: "unnamed",
      reason: "cargo cannot merge a string with a list",
    });
    rmSync(join(root, ".cargo"), { recursive: true });
    write("ws/.cargo/config.toml", target("5"));
    expect(pick()).toMatchObject({
      kind: "unnamed",
      reason: "cargo accepts only a string or a list of strings",
    });
  });

  it("lets CARGO_BUILD_TARGET replace a string, and join a list with its words", () => {
    expect(pick({ CARGO_BUILD_TARGET: "e" })).toEqual({
      kind: "triples",
      triples: ["e"],
      files: [],
      fromEnv: true,
    });
    write("ws/.cargo/config.toml", target('"a"'));
    expect(pick({ CARGO_BUILD_TARGET: "e" })).toEqual({
      kind: "triples",
      triples: ["e"],
      files: [],
      fromEnv: true,
    });
    write("ws/.cargo/config.toml", target('["a"]'));
    expect(pick({ CARGO_BUILD_TARGET: "e  a f" })).toEqual({
      kind: "triples",
      triples: ["a", "e", "f"],
      files: ["ws/.cargo/config.toml"],
      fromEnv: true,
    });
    // An empty value adds no word to a list, and cargo rejects it elsewhere.
    expect(pick({ CARGO_BUILD_TARGET: "" })).toMatchObject({ kind: "triples", triples: ["a"] });
    write("ws/.cargo/config.toml", target('"a"'));
    expect(pick({ CARGO_BUILD_TARGET: "" })).toMatchObject({
      kind: "unnamed",
      reason: "cargo rejects an empty triple",
    });
    // Without a list, the whole value is one triple.
    expect(pick({ CARGO_BUILD_TARGET: "e f" })).toMatchObject({
      kind: "unnamed",
      value: "e f",
      reason: "it is no triple name",
    });
  });

  it.each([
    ['"host-tuple"', "host-tuple", "cargo replaces it with the host's triple"],
    ['["a", "specs/custom.json"]', "specs/custom.json", "it names a target specification file"],
    ['"a{b}"', "a{b}", "it is no triple name"],
  ])("cannot name the folder of %s", (value, triple, reason) => {
    write("ws/.cargo/config.toml", target(value));
    expect(pick()).toEqual({
      kind: "unnamed",
      value: triple,
      reason,
      files: ["ws/.cargo/config.toml"],
      fromEnv: false,
    });
  });

  it("names the triple of an included file only where the cargo versions that ignore include agree", () => {
    const versions =
      "a file that include adds sets build.target, which cargo 1.91 ignores and later versions apply, so the triple depends on the Cargo version";
    write("ws/.cargo/config.toml", 'include = ["extra.toml"]\n');
    write("ws/.cargo/extra.toml", target('"a"'));
    expect(pick()).toMatchObject({ kind: "unnamed", reason: versions });

    // The including file's own value wins over the included one, so the
    // versions agree; so do they where CARGO_BUILD_TARGET replaces both.
    write("ws/.cargo/config.toml", `include = ["extra.toml"]\n${target('"b"')}`);
    expect(pick()).toMatchObject({ kind: "triples", triples: ["b"] });
    write("ws/.cargo/config.toml", 'include = ["extra.toml"]\n');
    expect(pick({ CARGO_BUILD_TARGET: "e" })).toMatchObject({ kind: "triples", triples: ["e"] });

    // A later include wins over an earlier one, and lists join.
    write("ws/.cargo/config.toml", `include = ["one.toml", "two.toml"]\n${target('["b"]')}`);
    write("ws/.cargo/one.toml", target('["a"]'));
    write("ws/.cargo/two.toml", target('["c"]'));
    expect(pick()).toMatchObject({ kind: "unnamed", reason: versions });
  });
});

describe("the triple input of build and doc", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-triple-input-")));
    mkdirSync(join(root, "repo/rust/.cargo"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** What the command prints in the repository root, as Nx runs it, with `env`. */
  function evaluate(env: NodeJS.ProcessEnv, script?: string): string {
    const command = tripleCommand(
      "rust",
      script ?? join(pluginPackage(), "src/cargo/print-triples.js"),
    );
    const run = spawnSync("sh", ["-c", command], {
      cwd: join(root, "repo"),
      env: { ...testEnvironment(), CARGO_HOME: join(root, "home"), ...env },
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    return run.stdout;
  }

  it("writes each kind of pick as text without paths, and names the configuration alone without the variable", () => {
    const config = join(root, "repo/rust/.cargo/config.toml");
    writeFileSync(config, '[build]\ntarget = ["b", "a", "b"]\n');
    const env = { CARGO_HOME: join(root, "home") };
    expect(pickText(pickedTriples(join(root, "repo/rust"), env))).toBe("triples a b");
    expect(
      pickText(pickedTriples(join(root, "repo/rust"), { ...env, CARGO_BUILD_TARGET: "c" })),
    ).toBe("triples a b c");
    expect(
      pickText(configuredTriples(join(root, "repo/rust"), { ...env, CARGO_BUILD_TARGET: "c" })),
    ).toBe("triples a b");
    writeFileSync(config, '[build]\ntarget = "host-tuple"\n');
    expect(pickText(pickedTriples(join(root, "repo/rust"), env))).toBe(
      'unnamed "host-tuple": cargo replaces it with the host\'s triple',
    );
    rmSync(config);
    expect(pickText(pickedTriples(join(root, "repo/rust"), env))).toBe("none");
  });

  if (loadsCompiledPlugin()) {
    it("prints the pick of the workspace root with the task's environment, as graph creation reads it", () => {
      const config = join(root, "repo/rust/.cargo/config.toml");
      writeFileSync(config, '[build]\ntarget = ["x86_64-unknown-linux-gnu"]\n');
      expect(evaluate({})).toBe("triples x86_64-unknown-linux-gnu\n");
      expect(evaluate({ CARGO_BUILD_TARGET: "aarch64-unknown-linux-gnu" })).toBe(
        "triples aarch64-unknown-linux-gnu x86_64-unknown-linux-gnu\n",
      );
      // The Cargo home's configuration and one above the repository count.
      rmSync(config);
      mkdirSync(join(root, "home"), { recursive: true });
      writeFileSync(
        join(root, "home/config.toml"),
        '[build]\ntarget = "aarch64-unknown-linux-gnu"\n',
      );
      expect(evaluate({})).toBe("triples aarch64-unknown-linux-gnu\n");
      mkdirSync(join(root, ".cargo"));
      writeFileSync(join(root, ".cargo/config.toml"), '[build]\ntarget = "host-tuple"\n');
      expect(evaluate({})).toBe(
        'unnamed "host-tuple": cargo replaces it with the host\'s triple\n',
      );
      rmSync(join(root, ".cargo"), { recursive: true });
      rmSync(join(root, "home"), { recursive: true });
      expect(evaluate({})).toBe("none\n");
    });
  }

  it("prints a new random value at each evaluation where the script cannot run", () => {
    const missing = join(root, "missing/print-triples.js");
    const first = evaluate({}, missing);
    expect(first).toMatch(/^( [0-9a-f]{2}){16}\n$/);
    expect(evaluate({}, missing)).not.toBe(first);
  });
});

describe("the folders that the plugin names for cargo's picks", () => {
  // Each case: Cargo configuration files by path below the temporary root,
  // and the environment of the cargo command. The triple `x` is no triple,
  // so a build for it fails: a case that names it shows that cargo did not
  // pick it.
  const cases: [string, Record<string, string>, NodeJS.ProcessEnv][] = [
    ["no triple", {}, {}],
    ["a string", { "ws/.cargo/config.toml": "target = HOST" }, {}],
    ["a list", { "ws/.cargo/config.toml": "target = [HOST, HOST]" }, {}],
    ["CARGO_BUILD_TARGET", {}, { CARGO_BUILD_TARGET: "HOST" }],
    [
      "CARGO_BUILD_TARGET over a string",
      { "ws/.cargo/config.toml": 'target = "x"' },
      { CARGO_BUILD_TARGET: "HOST" },
    ],
    [
      "the workspace's string over its parent's",
      { "ws/.cargo/config.toml": "target = HOST", ".cargo/config.toml": 'target = "x"' },
      {},
    ],
    ["the parent's string", { ".cargo/config.toml": "target = HOST" }, {}],
    [
      "the workspace's string over the Cargo home's",
      { "ws/.cargo/config.toml": "target = HOST", "home/config.toml": 'target = "x"' },
      {},
    ],
    [
      "lists of the workspace and its parent",
      { "ws/.cargo/config.toml": "target = [HOST]", ".cargo/config.toml": "target = [HOST]" },
      {},
    ],
    [
      "a list and CARGO_BUILD_TARGET",
      { "ws/.cargo/config.toml": "target = [HOST]" },
      { CARGO_BUILD_TARGET: "HOST" },
    ],
    ["an empty list", { "ws/.cargo/config.toml": "target = []" }, {}],
  ];

  it.each(cases)(
    "are those that cargo build and cargo doc write to for %s",
    (_case, files, variables) => {
      const host = hostTriple();
      const root = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-triple-folders-")));
      try {
        mkdirSync(join(root, "ws/src"), { recursive: true });
        writeFileSync(
          join(root, "ws/Cargo.toml"),
          '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
        );
        writeFileSync(join(root, "ws/src/main.rs"), "fn main() {}\n");
        writeFileSync(join(root, "ws/src/lib.rs"), "pub fn f() {}\n");
        for (const [path, line] of Object.entries(files)) {
          mkdirSync(dirname(join(root, path)), { recursive: true });
          writeFileSync(join(root, path), `[build]\n${line.replace(/HOST/g, `"${host}"`)}\n`);
        }
        const env = testEnvironment({
          CARGO_HOME: join(root, "home"),
          CARGO_INCREMENTAL: "0",
          CARGO_PROFILE_DEV_DEBUG: "0",
          ...Object.fromEntries(
            Object.entries(variables).map(([name, value]) => [name, value?.replace(/HOST/g, host)]),
          ),
        });
        const picked = pickedTriples(join(root, "ws"), env);
        const named =
          picked.kind === "none" ? ["."] : picked.kind === "triples" ? picked.triples : undefined;
        expect(named).toBeDefined();

        for (const [command, artifact] of [
          [["build"], "debug/app"],
          [["doc", "--no-deps"], "doc"],
        ] as const) {
          rmSync(join(root, "ws/target"), { recursive: true, force: true });
          const run = spawnSync("cargo", [...command, "--offline"], {
            cwd: join(root, "ws"),
            env,
            encoding: "utf8",
          });
          expect({
            command,
            status: run.status,
            stderr: run.status === 0 ? "" : run.stderr,
          }).toEqual({
            command,
            status: 0,
            stderr: "",
          });
          // The folders below target/ that hold the artifact: `.` for
          // target/ itself, else a triple's folder.
          const written = ["."]
            .concat(existsSync(join(root, "ws/target")) ? readdirSync(join(root, "ws/target")) : [])
            .filter((folder) => existsSync(join(root, "ws/target", folder, artifact)))
            .sort();
          expect({ command, folders: written }).toEqual({
            command,
            folders: [...new Set(named)].sort(),
          });
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    HARNESS_TIMEOUT,
  );
});
