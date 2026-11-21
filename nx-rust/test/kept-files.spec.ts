import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutorContext, Task } from "@nx/devkit";
import { keepFiles, keptOutputs, putBack } from "../src/executors/kept-files";

// VER-BATCHING, "Files that a batch leaves on disk" of DES-BATCH: which
// files a group keeps, and how it puts them back. The runs through the real
// Nx batch runner are in batch-deferral.spec.ts.

describe("keptOutputs", () => {
  const root = "/repo";
  const task = (project: string, target: string, outputs: string[] = []): Task =>
    ({ id: `${project}:${target}`, target: { project, target }, outputs, overrides: {} }) as Task;
  const tasks = [
    task("pa", "build", ["rust/target/debug/pa"]),
    task("pb", "build", ["rust/target/debug/pb"]),
    // A build target under another name, which the metadata tells.
    task("pc", "compile", ["rust/target/debug/pc", "rust/target/debug/libpc.so"]),
    task("pa", "test"),
    task("pa", "napi-build", ["rust/crates/pa/pa.node"]),
    task("pack", "pack", ["dist"]),
  ];
  const cargo = (target: string) => ({ metadata: { cargo: { target } } });
  const context = {
    root,
    taskGraph: {
      roots: [],
      dependencies: {},
      continuousDependencies: {},
      tasks: Object.fromEntries(tasks.map((entry) => [entry.id, entry])),
    },
    projectGraph: {
      dependencies: {},
      nodes: {
        pa: {
          name: "pa",
          type: "lib",
          data: {
            root: "",
            targets: {
              build: cargo("build"),
              test: cargo("test"),
              "napi-build": cargo("napi-build"),
            },
          },
        },
        pb: { name: "pb", type: "lib", data: { root: "", targets: { build: cargo("build") } } },
        pc: { name: "pc", type: "lib", data: { root: "", targets: { compile: cargo("build") } } },
        pack: { name: "pack", type: "lib", data: { root: "", targets: { pack: {} } } },
      },
    },
  } as unknown as ExecutorContext;

  it("names the outputs of every other build of the command for a group of the whole workspace", () => {
    expect(keptOutputs(["pb:build"], "build", true, context)).toEqual([
      { path: "/repo/rust/target/debug/pa", owner: "pa:build" },
      { path: "/repo/rust/target/debug/pc", owner: "pc:compile" },
      { path: "/repo/rust/target/debug/libpc.so", owner: "pc:compile" },
    ]);
  });

  it("names only the builds of its own crates for a group that selects them", () => {
    expect(keptOutputs(["pb:build"], "build", false, context)).toEqual([]);
    expect(keptOutputs(["pa:napi-build"], "napi-build", false, context)).toEqual([
      { path: "/repo/rust/target/debug/pa", owner: "pa:build" },
    ]);
  });

  // cargo test and cargo bench leave the executables as plain cargo does
  // after a build (ADR-TEST-AFTER-BUILD).
  it("names none for a target outside the build batch, or whose cargo command links no file", () => {
    for (const target of ["check", "lint", "doc", "test", "bench"]) {
      expect(keptOutputs(["pb:build"], target, true, context)).toEqual([]);
    }
  });
});

describe("keepFiles and putBack", () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "nx-rust-kept-"));
  });
  afterEach(() => {
    chmodSync(folder, 0o755);
    rmSync(folder, { recursive: true, force: true });
  });
  const file = (name: string, text: string): { path: string; owner: string } => {
    const path = join(folder, name);
    writeFileSync(path, text);
    return { path, owner: `${name}:build` };
  };
  const kept = (files: { path: string; owner: string }[]) => {
    const result = keepFiles(files);
    if ("problem" in result) {
      throw new Error(result.problem);
    }
    return result.kept;
  };

  it("puts back a file that a command replaced, as cargo replaces it", () => {
    const pa = file("pa", "plain");
    const before = statSync(pa.path).ino;
    const files = kept([pa]);
    unlinkSync(pa.path);
    writeFileSync(pa.path, "flag");
    expect(putBack(files)).toEqual([]);
    expect(readFileSync(pa.path, "utf8")).toBe("plain");
    expect(statSync(pa.path).ino).toBe(before);
    expect(readdirSync(folder)).toEqual(["pa"]);
  });

  it("puts back a file that a command removed", () => {
    const pa = file("pa", "plain");
    const files = kept([pa]);
    unlinkSync(pa.path);
    expect(putBack(files)).toEqual([]);
    expect(readFileSync(pa.path, "utf8")).toBe("plain");
  });

  it("leaves a file that no command touched as it is", () => {
    const pa = file("pa", "plain");
    const before = statSync(pa.path);
    expect(putBack(kept([pa]))).toEqual([]);
    const after = statSync(pa.path);
    expect([after.ino, after.mtimeMs, after.nlink]).toEqual([
      before.ino,
      before.mtimeMs,
      before.nlink,
    ]);
    expect(readdirSync(folder)).toEqual(["pa"]);
  });

  it("keeps no file that does not exist, and no folder", () => {
    mkdirSync(join(folder, "doc"));
    expect(
      kept([
        { path: join(folder, "missing"), owner: "missing:build" },
        { path: join(folder, "doc"), owner: "doc:build" },
      ]),
    ).toEqual([]);
  });

  it("reports a file that a command wrote in place, which it cannot put back", () => {
    const pa = file("pa", "plain");
    const files = kept([pa]);
    writeFileSync(pa.path, "flag, longer");
    const problems = putBack(files);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/pa, which pa:build stores, was written in place/);
    expect(readdirSync(folder)).toEqual(["pa"]);
  });

  // Root can write into a folder without write permission.
  (process.getuid?.() === 0 ? describe.skip : describe)(
    "in a folder that cannot be written",
    () => {
      it("reports a file that it cannot keep, and keeps none", () => {
        const pa = file("pa", "plain");
        chmodSync(folder, 0o555);
        expect(keepFiles([pa])).toEqual({
          problem: expect.stringMatching(
            /^could not keep .*pa, which pa:build stores, under a second name in its folder: /,
          ),
        });
      });
    },
  );

  it("reports a file that it cannot put back", () => {
    const pa = file("pa", "plain");
    const files = kept([pa]);
    unlinkSync(pa.path);
    for (const name of readdirSync(folder)) {
      unlinkSync(join(folder, name));
    }
    const problems = putBack(files);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^could not put back .*pa, which pa:build stores, from /);
  });
});
