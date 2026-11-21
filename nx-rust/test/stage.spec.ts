import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutorContext, Task } from "@nx/devkit";
import {
  createStage,
  currentOwner,
  moveStagedFiles,
  processState,
  removeStage,
  removeStaleStages,
  sharedBuildFolders,
  type Stage,
  stagedFinalFiles,
  stageFlags,
  stagesCommand,
  tomlString,
  withStage,
} from "../src/executors/stage";
import type { GroupInvocation } from "../src/executors/task";

// VER-BATCHING, "Staged builds" of DES-BATCH: the stage that a
// whole-workspace build and the compile of napi-build and wasm-build build
// in, and what moves out of it. The runs through the real Nx batch runner
// are in batch-deferral.spec.ts.

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nx-rust-stage-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const directories = () => ({ artifact: join(root, "target"), build: join(root, "build dir") });
const stages = () => join(root, "target", ".nx-rust-stage");

describe("stageFlags", () => {
  it("gives cargo the stage and the build directory that it would use anyway", () => {
    const stage: Stage = { path: "/repo/target/.nx-rust-stage/7-0", directories: directories() };
    expect(stageFlags(stage)).toEqual([
      "--target-dir",
      "/repo/target/.nx-rust-stage/7-0",
      "--config",
      `build.build-dir="${root}/build dir"`,
    ]);
  });

  it("writes the build directory as a TOML basic string", () => {
    expect(tomlString('C:\\dir "quoted"\ttab\u007f')).toBe(
      '"C:\\\\dir \\"quoted\\"\\u0009tab\\u007f"',
    );
  });
});

describe("stagesCommand", () => {
  it.each<[string, "workspace" | "crates" | "alone", boolean]>([
    ["build", "workspace", true],
    ["build", "crates", false],
    ["build", "alone", false],
    ["napi-build", "alone", true],
    ["napi-build", "workspace", true],
    ["wasm-build", "crates", true],
    ["test", "workspace", false],
    ["bench", "alone", false],
    ["check", "workspace", false],
    ["lint", "workspace", false],
    ["doc", "workspace", false],
  ])("stages %s selecting %s: %s", (target, kind, staged) => {
    expect(stagesCommand(target, { kind })).toBe(staged);
  });
});

describe("withStage", () => {
  it("adds the flags to the command and every step, before the arguments after --", () => {
    const stage: Stage = { path: "/s", directories: { artifact: "/t", build: "/b" } };
    const invocation = {
      cwd: "/w",
      args: ["build", "--workspace"],
      steps: [
        { kind: "json", args: ["build", "--workspace"] },
        { kind: "command", args: ["run", "--", "x"] },
      ],
    } as unknown as GroupInvocation;
    const staged = withStage(invocation, stage);
    const flags = ["--target-dir", "/s", "--config", 'build.build-dir="/b"'];
    expect(staged.args).toEqual(["build", "--workspace", ...flags]);
    expect(staged.steps.map((step) => step.args)).toEqual([
      ["build", "--workspace", ...flags],
      ["run", ...flags, "--", "x"],
    ]);
    expect(invocation.args).toEqual(["build", "--workspace"]);
    // What names the command's configuration, without the stage.
    expect(staged.unstagedArgs).toEqual(["build", "--workspace"]);
    expect(withStage(staged, stage).unstagedArgs).toEqual(["build", "--workspace"]);
  });
});

describe("createStage and removeStage", () => {
  const owner = { pid: 4242, start: "ticks:1" };

  it("makes a marked stage in the artifact directory and removes it with everything in it", () => {
    const stage = createStage(directories(), owner, () => "dead");
    expect(stage.path).toMatch(/\/target\/\.nx-rust-stage\/4242-\d+$/);
    expect(JSON.parse(readFileSync(join(stage.path, ".nx-rust-owner"), "utf8"))).toEqual(owner);
    mkdirSync(join(stage.path, "debug"));
    writeFileSync(join(stage.path, "debug", "pa"), "x");
    const second = createStage(directories(), owner, () => "dead");
    expect(second.path).not.toBe(stage.path);
    expect(removeStage(stage)).toBeUndefined();
    expect(existsSync(stage.path)).toBe(false);
    expect(existsSync(second.path)).toBe(true);
  });

  it("removes nothing that is no stage of the artifact directory", () => {
    const folder = join(root, "target", "debug");
    mkdirSync(folder, { recursive: true });
    expect(removeStage({ path: folder, directories: directories() })).toMatch(/is no stage of/);
    expect(removeStage({ path: join(stages(), "other"), directories: directories() })).toMatch(
      /is no stage of/,
    );
    expect(existsSync(folder)).toBe(true);
  });

  it("removes the stages of processes that no longer run, and of a process that got a dead owner's id", () => {
    const make = (name: string, marker?: object): string => {
      const path = join(stages(), name);
      mkdirSync(path, { recursive: true });
      if (marker !== undefined) {
        writeFileSync(join(path, ".nx-rust-owner"), JSON.stringify(marker));
      }
      return path;
    };
    make("100-0", { pid: 100, start: "ticks:5" }); // dead
    make("200-0", { pid: 200, start: "ticks:5" }); // live, same start
    make("300-0", { pid: 300, start: "ticks:5" }); // id reused: another start
    make("400-0"); // live, not marked yet
    make("500-0"); // dead, not marked
    make("600-0", { pid: 600, start: "ticks:5" }); // live, start unknown
    make("unrelated"); // not a stage's name
    const states: Record<number, ReturnType<typeof processState>> = {
      100: "dead",
      200: { pid: 200, start: "ticks:5" },
      300: { pid: 300, start: "ticks:9" },
      400: { pid: 400, start: "ticks:1" },
      500: "dead",
      600: { pid: 600, start: undefined },
    };
    removeStaleStages(join(root, "target"), owner, (pid) => states[pid] ?? "dead");
    expect(readdirSync(stages()).sort()).toEqual(["200-0", "400-0", "600-0", "unrelated"]);
  });

  it("replaces a leftover that an earlier process of the same id left under the name it takes", () => {
    const stage = createStage(directories(), owner, () => "dead");
    removeStage(stage);
    // An earlier process with this id and another start left the next name.
    const next = Number(/-(\d+)$/.exec(stage.path)?.[1]) + 1;
    const leftover = join(stages(), `4242-${next}`);
    mkdirSync(join(leftover, "debug"), { recursive: true });
    writeFileSync(
      join(leftover, ".nx-rust-owner"),
      JSON.stringify({ pid: 4242, start: "ticks:0" }),
    );
    const fresh = createStage(directories(), owner, () => owner);
    expect(fresh.path).toBe(leftover);
    expect(readdirSync(fresh.path)).toEqual([".nx-rust-owner"]);
  });

  it("tells this process apart from a dead one", () => {
    const me = currentOwner();
    expect(processState(me.pid)).toEqual(me);
    expect(me.start).toBeDefined();
  });
});

describe("stagedFinalFiles and moveStagedFiles", () => {
  let stage: Stage;
  beforeEach(() => {
    stage = createStage(directories(), { pid: 1, start: "x" }, () => "dead");
  });
  const file = (relativePath: string, text: string): string => {
    const path = join(stage.path, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
    return path;
  };
  const artifact = (packageId: string, kind: string[], filenames: string[]): string =>
    JSON.stringify({
      reason: "compiler-artifact",
      package_id: packageId,
      target: { kind, name: "x" },
      filenames,
    });

  it("names the final artifacts of the group's own packages in the stage, and the records of all their targets", () => {
    const pa = file("debug/pa", "pa");
    file("debug/pa.d", "pa.d");
    const dwp = file("debug/pa.dwp", "dwp");
    const so = file("debug/libpc.so", "so");
    const a = file("debug/libpc.a", "a");
    file("debug/libpc.d", "libpc.d");
    const rlib = file("debug/libpc.rlib", "rlib");
    const pb = file("debug/pb", "pb");
    file("debug/libpd.d", "libpd.d");
    const pm = file("debug/libpm.so", "pm");
    file("debug/libpm.d", "libpm.d");
    const wasm = file("wasm32-unknown-unknown/debug/codec.wasm", "wasm");
    const output = [
      "   Compiling pa v0.1.0",
      artifact("pa-id", ["bin"], [pa, dwp]),
      artifact("pc-id", ["cdylib", "staticlib", "rlib"], [so, a, rlib]),
      artifact(
        "pd-id",
        ["lib"],
        [file("debug/libpd.rlib", "pd"), join(root, "build dir", "libpd.rmeta")],
      ),
      artifact("pm-id", ["proc-macro"], [pm]),
      artifact("pb-id", ["bin"], [pb]),
      artifact("codec-id", ["cdylib"], [wasm]),
      artifact("pa-id", ["custom-build"], [join(root, "build dir", "build-script-build")]),
      "{not json",
    ].join("\n");
    const files = stagedFinalFiles(
      output,
      stage,
      new Set(["pa-id", "pc-id", "pd-id", "pm-id", "codec-id"]),
    );
    const target = join(root, "target");
    expect(
      files.map(({ from, to, packageId }) => [from.slice(stage.path.length + 1), to, packageId]),
    ).toEqual([
      ["debug/pa", join(target, "debug/pa"), "pa-id"],
      ["debug/pa.d", join(target, "debug/pa.d"), "pa-id"],
      ["debug/pa.dwp", join(target, "debug/pa.dwp"), "pa-id"],
      ["debug/libpc.so", join(target, "debug/libpc.so"), "pc-id"],
      ["debug/libpc.d", join(target, "debug/libpc.d"), "pc-id"],
      ["debug/libpc.a", join(target, "debug/libpc.a"), "pc-id"],
      // An rlib-only library and a proc macro: their records, not their files.
      ["debug/libpd.d", join(target, "debug/libpd.d"), "pd-id"],
      ["debug/libpm.d", join(target, "debug/libpm.d"), "pm-id"],
      [
        "wasm32-unknown-unknown/debug/codec.wasm",
        join(target, "wasm32-unknown-unknown/debug/codec.wasm"),
        "codec-id",
      ],
    ]);
  });

  it("moves each file by rename, replacing the one in the artifact directory in one step", () => {
    const pa = file("debug/pa", "new");
    const inode = statSync(pa).ino;
    const target = join(root, "target", "debug", "pa");
    mkdirSync(join(root, "target", "debug"), { recursive: true });
    writeFileSync(target, "old");
    const problems = moveStagedFiles(stage, [{ from: pa, to: target, packageId: "pa-id" }]);
    expect(problems).toEqual(new Map());
    expect(readFileSync(target, "utf8")).toBe("new");
    expect(statSync(target).ino).toBe(inode);
    expect(existsSync(pa)).toBe(false);
  });

  it("creates the folder of a profile or triple that the artifact directory does not have yet", () => {
    const pa = file("x86_64-unknown-linux-gnu/release/pa", "pa");
    const target = join(root, "target", "x86_64-unknown-linux-gnu", "release", "pa");
    expect(moveStagedFiles(stage, [{ from: pa, to: target, packageId: "pa-id" }])).toEqual(
      new Map(),
    );
    expect(readFileSync(target, "utf8")).toBe("pa");
  });

  it("takes nothing from outside the stage and writes nothing outside the artifact directory", () => {
    const outside = join(root, "elsewhere");
    writeFileSync(outside, "x");
    const pa = file("debug/pa", "pa");
    const problems = moveStagedFiles(stage, [
      { from: outside, to: join(root, "target", "elsewhere"), packageId: "a" },
      { from: pa, to: join(root, "other", "debug", "pa"), packageId: "b" },
      { from: pa, to: join(stages(), "x", "pa"), packageId: "c" },
    ]);
    expect([...problems.keys()]).toEqual(["a", "b", "c"]);
    expect(existsSync(pa)).toBe(true);
    expect(existsSync(join(root, "other"))).toBe(false);
  });

  it("reports a file that it cannot move, by its package", () => {
    const pa = file("debug/pa", "pa");
    // The profile folder is a file, so the move cannot make it.
    mkdirSync(join(root, "target"), { recursive: true });
    writeFileSync(join(root, "target", "debug"), "not a folder");
    const problems = moveStagedFiles(stage, [
      { from: pa, to: join(root, "target", "debug", "pa"), packageId: "pa-id" },
    ]);
    expect(problems.get("pa-id")?.[0]).toMatch(/^could not move .*debug\/pa to /);
  });
});

describe("sharedBuildFolders", () => {
  const graphTask = (id: string, outputs: string[]): Task => {
    const [project, target] = id.split(":");
    return { id, target: { project, target }, overrides: {}, outputs } as unknown as Task;
  };
  const cargo = (target: string) => ({ metadata: { cargo: { target } } });
  const context = (tasks: Task[]): ExecutorContext =>
    ({
      root: "/repo",
      taskGraph: {
        roots: [],
        dependencies: {},
        continuousDependencies: {},
        tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
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
                "build-alt": cargo("build"),
                "build-wasm": cargo("build"),
                pack: {},
                "napi-build": cargo("napi-build"),
              },
            },
          },
          pb: { name: "pb", type: "lib", data: { root: "", targets: { build: cargo("build") } } },
        },
      },
    }) as unknown as ExecutorContext;
  const host = "x86_64-unknown-linux-gnu";

  it("refuses two builds of one crate whose outputs, as Nx resolved them, share a file", () => {
    // An implicit and an explicit host triple: Nx resolved both outputs into
    // the triple's folder.
    const refused = sharedBuildFolders(
      ["pa:build", "pa:build-alt", "pb:build"],
      context([
        graphTask("pa:build", [`rust/target/${host}/debug/pa`]),
        graphTask("pa:build-alt", [`rust/target/./${host}/debug/pa`]),
        graphTask("pb:build", [`rust/target/${host}/debug/pb`]),
      ]),
    );
    expect([...refused.keys()]).toEqual(["pa:build", "pa:build-alt"]);
    expect(refused.get("pa:build")).toBe(
      `pa:build: pa:build-alt of this command builds the same crate into the same folder of its artifact directory, rust/target/${host}/debug, so that each would store the files that the other's cargo command wrote. The task does not run, so that Nx stores no result for it. Run these tasks in separate nx commands.`,
    );
  });

  it("refuses a build whose peer elsewhere in the command, run or restored, shares its folder, and one whose output holds the other's", () => {
    expect([
      ...sharedBuildFolders(
        ["pa:build"],
        context([
          graphTask("pa:build", ["rust/target/debug/pa"]),
          graphTask("pa:build-alt", ["rust/target/debug"]),
        ]),
      ).entries(),
    ]).toEqual([["pa:build", expect.stringContaining(", rust/target/debug, so that")]]);
  });

  it("lets builds of one crate into other folders share a command, and judges none whose outputs name nothing", () => {
    expect(
      sharedBuildFolders(
        ["pa:build", "pa:build-alt", "pa:build-wasm"],
        context([
          graphTask("pa:build", ["rust/target/debug/pa"]),
          graphTask("pa:build-alt", ["rust/target/release/pa"]),
          graphTask("pa:build-wasm", []),
          graphTask("pa:napi-build", ["rust/crates/pa/pa.node"]),
          graphTask("pa:pack", ["rust/target/debug/pa"]),
        ]),
      ),
    ).toEqual(new Map());
  });
});
