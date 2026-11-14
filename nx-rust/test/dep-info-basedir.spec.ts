import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { configuredDepInfoBasedir } from "../src/cargo/dep-info-basedir";

// Checks the order in which the build input check of DES-BUILD-INPUT-CHECK
// finds build.dep-info-basedir, which decides how it reads the paths that
// Cargo's dependency files record. build-input-check.spec.ts checks the
// setting with real builds.

describe("the folder that build.dep-info-basedir gives", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-basedir-")));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(path: string, content: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  const basedir = (value: string) => `[build]\ndep-info-basedir = ${value}\n`;

  /** The folder for a command in `ws`, with the Cargo home in `home`. */
  function folder(env: Record<string, string> = {}): string | undefined {
    return configuredDepInfoBasedir(join(root, "ws"), { CARGO_HOME: join(root, "home"), ...env });
  }

  it("is undefined where nothing sets it", () => {
    write("ws/.cargo/config.toml", '[build]\ntarget-dir = "out"\n');
    expect(folder()).toBeUndefined();
  });

  it("takes CARGO_BUILD_DEP_INFO_BASEDIR first, from the command's folder, unless it is empty", () => {
    write("ws/.cargo/config.toml", basedir('"file"'));
    expect(folder({ CARGO_BUILD_DEP_INFO_BASEDIR: "env" })).toBe(join(root, "ws/env"));
    expect(folder({ CARGO_BUILD_DEP_INFO_BASEDIR: "" })).toBe(join(root, "ws/file"));
  });

  it("passes over a value that is no string", () => {
    write("ws/.cargo/config.toml", basedir("5"));
    write(".cargo/config.toml", basedir('"b"'));
    expect(folder()).toBe(join(root, "b"));
  });

  it("is undefined where a file that would decide cannot be read, and not where one after the deciding file cannot", () => {
    write("ws/.cargo/config.toml", "not toml [");
    write(".cargo/config.toml", basedir('"b"'));
    expect(folder()).toBeUndefined();
    write("ws/.cargo/config.toml", basedir('"a"'));
    write(".cargo/config.toml", "not toml [");
    expect(folder()).toBe(join(root, "ws/a"));
    // A .cargo that is a file.
    rmSync(join(root, "ws/.cargo"), { recursive: true });
    write("ws/.cargo", "");
    expect(folder()).toBeUndefined();
  });

  it("follows include: a file's own value first, a later include before an earlier one, each from the folder above its own, and an unreadable include decides", () => {
    write("ws/.cargo/config.toml", 'include = ["one.toml", "sub/two.toml"]\n');
    write("ws/.cargo/one.toml", basedir('"one"'));
    write("ws/.cargo/sub/two.toml", basedir('"two"'));
    write(".cargo/config.toml", basedir('"b"'));
    expect(folder()).toBe(join(root, "ws/.cargo/two"));
    write("ws/.cargo/config.toml", `include = ["one.toml", "sub/two.toml"]\n${basedir('"own"')}`);
    expect(folder()).toBe(join(root, "ws/own"));
    write("ws/.cargo/config.toml", 'include = ["one.toml", "sub/two.toml"]\n');
    write("ws/.cargo/sub/two.toml", "not toml [");
    expect(folder()).toBeUndefined();
    write("ws/.cargo/config.toml", 'include = ["missing.toml"]\n');
    expect(folder()).toBe(join(root, "b"));
  });
});
