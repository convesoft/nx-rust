import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { ExecutorContext, Task } from "@nx/devkit";
import type { CargoDirectories } from "../src/cargo/directories";
import type { CargoPackage } from "../src/cargo/metadata";
import * as bridge from "../src/compatibility/nx-bridge";
import type { GroupMember } from "../src/executors/group-run";
import type { GroupSelection } from "../src/executors/groups";
import {
  filesToKeep,
  type KeptCandidate,
  keepFiles,
  type Keeping,
  putBack,
} from "../src/executors/kept-files";
import { createStage, stageFolderName } from "../src/executors/stage";

// VER-BATCHING, "Files that a test batch puts back" of DES-BATCH: which
// files a test or bench group keeps, in a stage of the artifact directory,
// and how it puts them back. The runs through the real Nx batch runner are in
// batch-runs.spec.ts and test-after-build.spec.ts.

let root: string;
let artifact: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nx-rust-kept-"));
  artifact = join(root, "rust", "target");
  mkdirSync(artifact, { recursive: true });
});
afterEach(() => {
  for (const folder of [root, artifact, join(artifact, "debug")]) {
    if (existsSync(folder)) {
      chmodSync(folder, 0o755);
    }
  }
  rmSync(root, { recursive: true, force: true });
});

const directories = (): CargoDirectories => ({ artifact, build: artifact });

describe("filesToKeep", () => {
  /** A crate with a binary of its name, and an integration test where `tested`. */
  const crate = (name: string, tested = true, more: CargoPackage["targets"] = []): CargoPackage =>
    ({
      id: `path+file:///${name}#0.1.0`,
      name,
      targets: [
        { name, kind: ["bin"], test: true },
        ...(tested ? [{ name: "it", kind: ["test"], test: true }] : []),
        ...more,
      ],
    }) as unknown as CargoPackage;
  const task = (project: string, target: string, outputs: string[] = [], cache = true): Task =>
    ({
      id: `${project}:${target}`,
      target: { project, target },
      outputs,
      cache,
      overrides: {},
    }) as unknown as Task;
  const contextOf = (tasks: Task[]): ExecutorContext =>
    ({
      root,
      taskGraph: {
        roots: [],
        dependencies: {},
        continuousDependencies: {},
        tasks: Object.fromEntries(tasks.map((entry) => [entry.id, entry])),
      },
      projectGraph: {
        dependencies: {},
        nodes: Object.fromEntries(
          [...new Set(tasks.map((entry) => entry.target.project))].map((name) => [
            name,
            {
              name,
              type: "lib",
              data: {
                root: "",
                targets: Object.fromEntries(
                  tasks
                    .filter((entry) => entry.target.project === name)
                    .map((entry) => [
                      entry.target.target,
                      entry.target.target === "pack"
                        ? {}
                        : {
                            metadata: {
                              cargo: {
                                target:
                                  entry.target.target === "compile" ? "build" : entry.target.target,
                              },
                            },
                          },
                    ]),
                ),
              },
            },
          ]),
        ),
      },
    }) as unknown as ExecutorContext;
  /** The group's members, one per crate, each with the workspace's members. */
  const membersOf = (
    target: "test" | "bench",
    crates: CargoPackage[],
    workspace: CargoPackage[],
    options: Record<string, unknown> = {},
    env: NodeJS.ProcessEnv = {},
  ): GroupMember[] =>
    crates.map(
      (pkg) =>
        ({
          prepared: {
            task: `${pkg.name}:${target}`,
            target,
            options,
            env,
            cwd: join(root, "rust"),
          },
          invocation: { cwd: join(root, "rust"), workspaceMembers: workspace, package: pkg },
          context: {},
        }) as unknown as GroupMember,
    );
  const workspace: GroupSelection = { kind: "workspace", host: "x86_64-unknown-linux-gnu" };
  const crates: GroupSelection = { kind: "crates" };
  const pa = crate("pa");
  const pb = crate("pb");
  const lonely = crate("lonely", false);
  const all = [pa, pb, lonely];
  const kept = (
    members: GroupMember[],
    selection: GroupSelection,
    tasks: Task[],
    match?: bridge.MatchGlobPaths,
  ): { path: string; owner: string }[] => {
    const result = filesToKeep(
      members,
      members.map((member) => member.prepared.task),
      selection,
      contextOf(tasks),
      match,
      directories,
    );
    if ("problem" in result) {
      throw new Error(result.problem);
    }
    return result.files.map(({ path, owner }) => ({ path: relative(root, path), owner }));
  };
  const builds = (...names: string[]): Task[] =>
    names.map((name) => task(name, "build", [`rust/target/debug/${name}`]));

  it("names the final files of every crate that the group's cargo test can link again, where a cached build stores them", () => {
    expect(
      kept(membersOf("test", [pa], all), workspace, [
        ...builds("pa", "pb", "lonely"),
        task("pa", "test"),
      ]),
    ).toEqual([
      { path: "rust/target/debug/pa", owner: "pa:build" },
      { path: "rust/target/debug/pb", owner: "pb:build" },
    ]);
  });

  it("names for bench every crate with a binary, in the folder of the bench profile", () => {
    expect(
      kept(membersOf("bench", [pa], all), workspace, [
        task("pa", "build", ["rust/target/release/pa"]),
        task("lonely", "build", ["rust/target/release/lonely"]),
        task("pb", "build", ["rust/target/debug/pb"]),
      ]),
    ).toEqual([
      { path: "rust/target/release/pa", owner: "pa:build" },
      { path: "rust/target/release/lonely", owner: "lonely:build" },
    ]);
  });

  it("names only its own crates and their projects' builds for a group that selects them", () => {
    expect(
      kept(membersOf("test", [pb], all), crates, [...builds("pa", "pb"), task("pb", "test")]),
    ).toEqual([{ path: "rust/target/debug/pb", owner: "pb:build" }]);
  });

  it("names the files in the folders of the group's triple and profile, every final file kind of a build", () => {
    const shaped = crate("shaped", true, [
      { name: "shaped", kind: ["cdylib", "staticlib"] },
    ] as CargoPackage["targets"]);
    const folder = "rust/target/x86_64-unknown-linux-gnu/custom";
    expect(
      kept(
        membersOf("test", [shaped], [shaped], {
          targetTriple: "x86_64-unknown-linux-gnu",
          profile: "custom",
        }),
        workspace,
        [
          task("shaped", "build", [
            `${folder}/shaped`,
            `${folder}/libshaped.so`,
            `${folder}/libshaped.dylib`,
            `${folder}/libshaped.a`,
          ]),
        ],
      ),
    ).toEqual(
      ["shaped", "libshaped.so", "libshaped.dylib", "libshaped.a"].map((name) => ({
        path: `${folder}/${name}`,
        owner: "shaped:build",
      })),
    );
  });

  // Cargo replaces host-tuple with the host's triple and builds into that
  // triple's folder, which a cached build that names the triple stores.
  it("names the files in the host triple's folder where the option or the configuration says host-tuple, and none for a target specification file", () => {
    const host = /^host: (\S+)$/m.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
    expect(host).toBeDefined();
    const build = (folder: string) => [
      task("pa", "build", [`rust/target/${folder}/release/pa`]),
      task("pa", "bench"),
    ];
    // The option, in a group that selects its crate, asks rustc for the host.
    expect(
      kept(
        membersOf("bench", [pa], all, { targetTriple: "host-tuple" }, process.env),
        crates,
        build(host as string),
      ),
    ).toEqual([{ path: `rust/target/${host}/release/pa`, owner: "pa:build" }]);
    // A target specification file names a folder that the plugin cannot tell.
    expect(
      kept(
        membersOf("bench", [pa], all, { targetTriple: "spec.json" }, process.env),
        crates,
        build("spec"),
      ),
    ).toEqual([]);
    // The configuration, in a group of the whole workspace, which knows the host.
    mkdirSync(join(root, "rust", ".cargo"), { recursive: true });
    writeFileSync(join(root, "rust", ".cargo", "config.toml"), '[build]\ntarget = "host-tuple"\n');
    expect(
      kept(membersOf("test", [pa], all), workspace, [
        task("pa", "build", ["rust/target/x86_64-unknown-linux-gnu/debug/pa"]),
      ]),
    ).toEqual([{ path: "rust/target/x86_64-unknown-linux-gnu/debug/pa", owner: "pa:build" }]);
  });

  it("takes an output that is the repository root as a folder above every file", () => {
    const members = membersOf("test", [pa], all);
    for (const outputs of [["."], [root], [".", "!rust/target/debug/pb"]]) {
      expect(kept(members, workspace, [task("pa", "build", outputs)])).toEqual([
        { path: "rust/target/debug/pa", owner: "pa:build" },
        ...(outputs.length === 1 ? [{ path: "rust/target/debug/pb", owner: "pa:build" }] : []),
      ]);
    }
  });

  it("takes a folder, a glob and an exclusion as Nx stores them, and an absolute output inside the repository", () => {
    const members = membersOf("test", [pa], all);
    expect(kept(members, workspace, [task("pa", "build", ["rust/target"])])).toEqual([
      { path: "rust/target/debug/pa", owner: "pa:build" },
      { path: "rust/target/debug/pb", owner: "pa:build" },
    ]);
    expect(kept(members, workspace, [task("pa", "build", ["rust/target/*/p?"])])).toEqual([
      { path: "rust/target/debug/pa", owner: "pa:build" },
      { path: "rust/target/debug/pb", owner: "pa:build" },
    ]);
    // A folder that a glob matches stands for its files.
    expect(kept(members, workspace, [task("pa", "build", ["rust/*"])])).toHaveLength(2);
    expect(
      kept(members, workspace, [
        task("pa", "build", ["rust/target/debug", "!rust/target/debug/pb"]),
      ]),
    ).toEqual([{ path: "rust/target/debug/pa", owner: "pa:build" }]);
    expect(
      kept(members, workspace, [
        task("pa", "build", [
          join(root, "rust/target/debug"),
          `!${join(root, "rust/target/debug/pb")}`,
        ]),
      ]),
    ).toEqual([{ path: "rust/target/debug/pa", owner: "pa:build" }]);
    // An output spelled through a symbolic link names no file at the
    // physical path below the artifact directory.
    symlinkSync(join(root, "rust"), join(root, "linked"));
    expect(kept(members, workspace, [task("pa", "build", ["linked/target/debug/pa"])])).toEqual([]);
    // Nx cannot store an output outside the repository.
    expect(kept(members, workspace, [task("pa", "build", [join(tmpdir(), "elsewhere")])])).toEqual(
      [],
    );
  });

  it("names nothing that an uncached build, a build with empty outputs, or another target stores", () => {
    const members = membersOf("test", [pa], all);
    expect(
      kept(members, workspace, [task("pa", "build", ["rust/target/debug/pa"], false)]),
    ).toEqual([]);
    expect(kept(members, workspace, [task("pa", "build", [])])).toEqual([]);
    expect(kept(members, workspace, [task("pack", "pack", ["rust/target/debug/pa"])])).toEqual([]);
    // A build under another name, which the metadata tells, counts.
    expect(kept(members, workspace, [task("pa", "compile", ["rust/target/debug/pa"])])).toEqual([
      { path: "rust/target/debug/pa", owner: "pa:compile" },
    ]);
  });

  it("names nothing for a group of another target, and asks cargo nothing where no cached build stores a file", () => {
    const report = jest.fn(directories);
    const members = membersOf("test", [pa], all);
    const lint = members.map((member) => ({
      ...member,
      prepared: { ...member.prepared, target: "lint" },
    })) as unknown as GroupMember[];
    for (const [group, tasks] of [
      [lint, builds("pa")],
      [members, [task("pa", "test")]],
    ] as const) {
      expect(
        filesToKeep(group, ["pa:test"], workspace, contextOf([...tasks]), undefined, report),
      ).toEqual({
        files: [],
      });
    }
    expect(report).not.toHaveBeenCalled();
  });

  it("fails the group where a glob needs Nx's glob matching and it cannot be loaded, and where cargo reports no directories", () => {
    const members = membersOf("test", [pa], all);
    const load = jest.spyOn(bridge, "loadNxNative").mockImplementation(() => {
      throw new Error("no native module");
    });
    try {
      expect(
        filesToKeep(
          members,
          ["pa:test"],
          workspace,
          contextOf([task("pa", "build", ["rust/target/*/pa"])]),
          undefined,
          directories,
        ),
      ).toEqual({
        problem:
          "could not read the outputs rust/target/*/pa of pa:build as Nx reads them, to tell which files those builds store, because Nx's glob matching could not be loaded: no native module",
      });
      // Outputs that name paths need no matching.
      expect(kept(members, workspace, builds("pa"))).toHaveLength(1);
    } finally {
      load.mockRestore();
    }
    const { DirectoryReportError } = jest.requireActual("../src/cargo/directories");
    expect(
      filesToKeep(members, ["pa:test"], workspace, contextOf(builds("pa")), undefined, () => {
        throw new DirectoryReportError("cargo metadata failed", "");
      }),
    ).toEqual({
      problem: expect.stringMatching(
        /^could not get Cargo's directories for the group, .*: cargo metadata failed$/,
      ),
    });
  });
});

describe("keepFiles and putBack", () => {
  const file = (name: string, text = "plain"): KeptCandidate => {
    const path = join(artifact, "debug", name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return { path, owner: `${name}:build` };
  };
  const keep = (files: KeptCandidate[]): Keeping => {
    const result = keepFiles(files, directories());
    if ("problem" in result) {
      throw new Error(result.problem);
    }
    return result.keeping;
  };
  const stages = (): string[] =>
    existsSync(join(artifact, stageFolderName)) ? readdirSync(join(artifact, stageFolderName)) : [];

  it("keeps a file in a stage, at its path relative to the artifact directory, and puts it back where a command replaced it", () => {
    const pa = file("pa");
    const before = statSync(pa.path).ino;
    const keeping = keep([pa]);
    expect(relative(artifact, keeping.files[0].staged)).toMatch(
      new RegExp(`^\\${stageFolderName}/\\d+-\\d+/debug/pa$`),
    );
    unlinkSync(pa.path);
    writeFileSync(pa.path, "extra");
    expect(putBack(keeping)).toEqual({ problems: [] });
    expect(readFileSync(pa.path, "utf8")).toBe("plain");
    expect(statSync(pa.path).ino).toBe(before);
    // No name is left beside the file, and the stage is gone.
    expect(readdirSync(join(artifact, "debug"))).toEqual(["pa"]);
    expect(stages()).toEqual([]);
  });

  it("puts back a file that a command removed, and leaves one that no command touched as it is", () => {
    const pa = file("pa");
    const pb = file("pb");
    const untouched = statSync(pb.path);
    const keeping = keep([pa, pb]);
    unlinkSync(pa.path);
    expect(putBack(keeping)).toEqual({ problems: [] });
    expect(readFileSync(pa.path, "utf8")).toBe("plain");
    const after = statSync(pb.path);
    expect([after.ino, after.mtimeMs, after.nlink]).toEqual([
      untouched.ino,
      untouched.mtimeMs,
      untouched.nlink,
    ]);
  });

  it("keeps no missing file, no folder and no symbolic link, and makes no stage for nothing", () => {
    mkdirSync(join(artifact, "debug", "folder"), { recursive: true });
    const pa = file("pa");
    symlinkSync(pa.path, join(artifact, "debug", "link"));
    expect(
      keep(
        ["missing", "folder", "link"].map((name) => ({
          path: join(artifact, "debug", name),
          owner: `${name}:build`,
        })),
      ),
    ).toEqual({ files: [] });
    expect(stages()).toEqual([]);
  });

  it("reports a file that a command wrote in place, or whose permissions it changed", () => {
    const pa = file("pa");
    const pb = file("pb");
    const keeping = keep([pa, pb]);
    writeFileSync(pa.path, "extra, longer");
    chmodSync(pb.path, 0o600);
    const { problems } = putBack(keeping);
    expect(problems).toEqual([
      expect.stringMatching(
        /debug\/pa, which pa:build stores, was written in place or had its permissions changed while/,
      ),
      expect.stringMatching(
        /debug\/pb, which pb:build stores, was written in place or had its permissions changed while/,
      ),
    ]);
    expect(stages()).toEqual([]);
  });

  it("reports a file that it cannot put back", () => {
    const pa = file("pa");
    const keeping = keep([pa]);
    unlinkSync(pa.path);
    unlinkSync(keeping.files[0].staged);
    const { problems } = putBack(keeping);
    expect(problems).toEqual([
      expect.stringMatching(/^could not put back .*debug\/pa, which pa:build stores, from /),
    ]);
    expect(stages()).toEqual([]);
  });

  // Root can write into a folder without write permission.
  (process.getuid?.() === 0 ? describe.skip : describe)(
    "in folders that cannot be read or written",
    () => {
      it("reports a file that it cannot keep, and leaves no stage", () => {
        const pa = file("pa");
        chmodSync(artifact, 0o555);
        expect(keepFiles([pa], directories())).toEqual({
          problem: expect.stringMatching(
            /^could not make a stage to keep the files of the command's builds in: /,
          ),
        });
      });

      it("reports a file that it cannot look at, instead of taking it as missing", () => {
        const pa = file("pa");
        chmodSync(join(artifact, "debug"), 0o000);
        expect(keepFiles([pa], directories())).toEqual({
          problem: expect.stringMatching(/^could not look at .*debug\/pa, which pa:build stores: /),
        });
      });
    },
  );

  // nxr-nbdazw: a batch process killed while its group runs leaves only its
  // stage, with the kept files in it, and no name beside the files; the next
  // group that keeps files removes it, since its process has ended.
  it("leaves only a stage where the process ends before it puts back, which the next keeping removes", () => {
    const pa = file("pa");
    const dead = createStage(directories(), { pid: 999_999_999, start: "ticks:1" }, () => "dead");
    writeFileSync(join(dead.path, "pa"), "kept by a killed batch");
    expect(readdirSync(join(artifact, "debug"))).toEqual(["pa"]);
    expect(stages()).toEqual([relative(join(artifact, stageFolderName), dead.path)]);
    const keeping = keep([pa]);
    expect(existsSync(dead.path)).toBe(false);
    expect(putBack(keeping)).toEqual({ problems: [] });
    expect(stages()).toEqual([]);
  });
});
