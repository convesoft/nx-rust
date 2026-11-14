import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { configuredTools } from "../src/cargo/configured-tools";
import { findExecutable, HARNESS_TIMEOUT, testEnvironment } from "./harness";

// Checks how graph creation reads the programs that build.rustc and
// build.rustdoc name, which the toolchain input of DES-INPUTS asks for their
// version: with the precedence by which the plugin reads build.target
// (target-triples.spec.ts), and resolved as cargo resolves them
// (EVD-CARGO-COMPILER-SELECTION), the latter checked against the real cargo.

describe("the programs that Cargo's configuration names in place of rustc and rustdoc", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-tools-")));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(path: string, content: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  const build = (key: string, value: string) => `[build]\n${key} = ${value}\n`;

  /** The tools for the workspace in `ws`, with the Cargo home in `home`. */
  function tools(env: NodeJS.ProcessEnv = {}) {
    return configuredTools(join(root, "ws"), { CARGO_HOME: join(root, "home"), ...env });
  }

  it("names none without build.rustc and build.rustdoc", () => {
    write("ws/.cargo/config.toml", build("target-dir", '"out"'));
    expect(tools()).toEqual({ rustc: [], rustdoc: [] });
  });

  it("takes the value of the deepest file, over the folders above and the Cargo home", () => {
    write("ws/.cargo/config.toml", build("rustc", '"/ws/rustc"'));
    write(".cargo/config.toml", build("rustc", '"/parent/rustc"'));
    write("home/config.toml", build("rustc", '"/home/rustc"'));
    expect(tools().rustc).toEqual(["/ws/rustc"]);
    rmSync(join(root, "ws/.cargo"), { recursive: true });
    expect(tools().rustc).toEqual(["/parent/rustc"]);
    rmSync(join(root, ".cargo"), { recursive: true });
    expect(tools().rustc).toEqual(["/home/rustc"]);
  });

  it("reads .cargo/config where it exists beside .cargo/config.toml", () => {
    write("ws/.cargo/config", build("rustc", '"/legacy"'));
    write("ws/.cargo/config.toml", build("rustc", '"/current"'));
    expect(tools().rustc).toEqual(["/legacy"]);
  });

  it("resolves a path against the folder above the file's, and keeps a bare name", () => {
    write("ws/.cargo/config.toml", build("rustc", '"bin/rustc"'));
    expect(tools().rustc).toEqual([join(root, "ws/bin/rustc")]);
    write("ws/.cargo/config.toml", build("rustc", '"../bin/rustc"'));
    expect(tools().rustc).toEqual([join(root, "bin/rustc")]);
    write("ws/.cargo/config.toml", build("rustc", '"rustc-91"'));
    expect(tools().rustc).toEqual(["rustc-91"]);
    rmSync(join(root, "ws/.cargo"), { recursive: true });
    // The Cargo home's file counts from the Cargo home's parent.
    write("home/config.toml", build("rustc", '"bin/rustc"'));
    expect(tools().rustc).toEqual([join(root, "bin/rustc")]);
    expect(tools({ CARGO_HOME: join(root, "deep/home") }).rustc).toEqual([]);
  });

  it("follows include: the including file wins, an included path counts from the folder above the included file's, and Cargo 1.91's reading joins the list where it differs", () => {
    write("ws/.cargo/config.toml", 'include = ["sub/extra.toml"]\n');
    write("ws/.cargo/sub/extra.toml", build("rustc", '"../bin/rustc"'));
    // Cargo 1.91 ignores the include and runs rustc, which the input asks anyway.
    expect(tools().rustc).toEqual([join(root, "ws/bin/rustc")]);

    write("ws/.cargo/config.toml", `include = ["sub/extra.toml"]\n${build("rustc", '"/own"')}`);
    expect(tools().rustc).toEqual(["/own"]);

    write("ws/.cargo/config.toml", 'include = ["sub/extra.toml"]\n');
    write(".cargo/config.toml", build("rustc", '"/parent"'));
    expect(tools().rustc).toEqual([join(root, "ws/bin/rustc"), "/parent"]);
  });

  it("counts a file of the walk that a deeper file also includes in its own place, where Cargo 1.91 reads it", () => {
    // The folder above sets both; the workspace includes its file, and then extra.toml.
    write(
      ".cargo/config.toml",
      `${build("rustc", '"/parent/rustc"')}rustdoc = "/parent/rustdoc"\n`,
    );
    write("ws/.cargo/config.toml", 'include = ["../../.cargo/config.toml", "extra.toml"]\n');
    write(
      "ws/.cargo/extra.toml",
      `${build("rustc", '"/extra/rustc"')}rustdoc = "/extra/rustdoc"\n`,
    );
    expect(tools()).toEqual({
      rustc: ["/extra/rustc", "/parent/rustc"],
      rustdoc: ["/extra/rustdoc", "/parent/rustdoc"],
    });
    // Without extra.toml, both versions take the folder above.
    write("ws/.cargo/config.toml", 'include = ["../../.cargo/config.toml"]\n');
    expect(tools()).toEqual({ rustc: ["/parent/rustc"], rustdoc: ["/parent/rustdoc"] });
  });

  it("names nothing for a value that is no string, on which cargo fails", () => {
    write("ws/.cargo/config.toml", build("rustc", "5"));
    write(".cargo/config.toml", build("rustc", '"/parent"'));
    expect(tools().rustc).toEqual([]);
  });

  it("reads build.rustdoc apart from build.rustc", () => {
    write("ws/.cargo/config.toml", build("rustdoc", '"doc/rustdoc"'));
    expect(tools()).toEqual({ rustc: [], rustdoc: [join(root, "ws/doc/rustdoc")] });
  });

  it(
    "names the program that cargo runs, for each way of naming it",
    () => {
      const real = findExecutable("rustc", testEnvironment().PATH ?? "");
      if (real === undefined) {
        throw new Error("No rustc on PATH");
      }
      const log = join(root, "calls.log");
      /** A rustc that logs its name and runs the real one. */
      const wrapper = (path: string) => {
        write(path, `#!/bin/sh\necho ${path.split("/").pop()} >> '${log}'\nexec '${real}' "$@"\n`);
        chmodSync(join(root, path), 0o755);
      };
      write("ws/Cargo.toml", '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n');
      write("ws/src/lib.rs", "");
      const cases: [string, string, Record<string, string>][] = [
        ["ws/.cargo/config.toml", "tools/rustc-ws", {}],
        [".cargo/config.toml", "tools/rustc-parent", {}],
        ["home/config.toml", "tools/rustc-home", {}],
        ["ws/.cargo/config.toml", "rustc-path", { PATH: join(root, "bin") }],
      ];
      for (const [file, program, env] of cases) {
        rmSync(join(root, "ws/.cargo"), { recursive: true, force: true });
        rmSync(join(root, ".cargo"), { recursive: true, force: true });
        rmSync(join(root, "home"), { recursive: true, force: true });
        rmSync(log, { force: true });
        const name = program.split("/").pop() as string;
        wrapper(program.includes("/") ? join(dirname(dirname(file)), program) : `bin/${program}`);
        write(file, build("rustc", JSON.stringify(program)));
        const path = env.PATH ? [env.PATH, testEnvironment().PATH].join(delimiter) : undefined;
        const fullEnv = { CARGO_HOME: join(root, "home"), ...(path ? { PATH: path } : {}) };

        const cargo = spawnSync("cargo", ["check", "--quiet"], {
          cwd: join(root, "ws"),
          env: testEnvironment(fullEnv),
          encoding: "utf8",
        });
        const named = tools(fullEnv).rustc;

        expect({
          file,
          status: cargo.status,
          stderr: cargo.status === 0 ? "" : cargo.stderr,
        }).toEqual({ file, status: 0, stderr: "" });
        expect({ file, ran: readFileSync(log, "utf8").split("\n")[0] }).toEqual({
          file,
          ran: name,
        });
        expect({ file, named }).toEqual({
          file,
          named: [program.includes("/") ? join(root, dirname(dirname(file)), program) : program],
        });
        expect(named.every((found) => !found.includes("/") || existsSync(found))).toBe(true);
      }
    },
    HARNESS_TIMEOUT,
  );
});
