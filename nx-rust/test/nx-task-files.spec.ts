import type { ExecutorContext } from "@nx/devkit";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadHashPlanInspector } from "../src/compatibility/nx-bridge";
import {
  type NxTaskFileParts,
  nxTaskFileParts,
  nxTaskFiles,
  resetNxWorkspaceContext,
} from "../src/executors/nx-task-files";

/** A `HashPlanInspector` that gives the task `crate:build` no input files. */
class Inspector {
  async init(): Promise<void> {}
  inspectTaskInputs(): Record<string, { files: string[] }> {
    return { "crate:build": { files: [] } };
  }
}

/** Does nothing, for the parts of tests that do not use Nx's workspace context. */
function reset(): void {}

/**
 * The context of the task `crate:build`. With `graph`, the project graph
 * holds the project `crate` in the folder `crate`, whose `build` reads the
 * files of its folder, as a crate's own folder is an input of its tasks.
 */
function contextFor(root: string, graph = false): ExecutorContext {
  return {
    root,
    cwd: root,
    isVerbose: false,
    projectName: "crate",
    targetName: "build",
    projectGraph: graph
      ? {
          nodes: {
            crate: {
              name: "crate",
              type: "lib",
              data: {
                root: "crate",
                targets: { build: { executor: "nx:noop", inputs: ["{projectRoot}/**/*"] } },
              },
            },
          },
          dependencies: { crate: [] },
        }
      : { nodes: {}, dependencies: {} },
    projectsConfigurations: { version: 2, projects: {} },
    nxJsonConfiguration: {},
  };
}

/** The files below `root` on disk, relative to it, read anew on every call. */
function filesOnDisk(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}

describe("nxTaskFiles.filesBelow", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-task-files-"));
    writeFileSync(join(root, "nx.json"), "{}\n");
    mkdirSync(join(root, "crate", "data"), { recursive: true });
    writeFileSync(join(root, "crate", "data", "a.txt"), "a\n");
    writeFileSync(join(root, "crate", "lib.rs"), "\n");
    mkdirSync(join(root, "other"));
    writeFileSync(join(root, "other", "b.txt"), "b\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists the repository once across several calls of one instance", async () => {
    const glob = jest.fn((workspaceRoot: string) => filesOnDisk(workspaceRoot));
    const files = await nxTaskFiles({ Inspector, glob, reset }, contextFor(root));

    expect(files.filesBelow("crate/data")).toEqual(["crate/data/a.txt"]);
    expect(files.filesBelow("crate")).toEqual(["crate/data/a.txt", "crate/lib.rs"]);
    expect(files.filesBelow("other")).toEqual(["other/b.txt"]);
    expect(files.filesBelow("")).toEqual([
      "crate/data/a.txt",
      "crate/lib.rs",
      "nx.json",
      "other/b.txt",
    ]);
    expect(glob).toHaveBeenCalledTimes(1);
    expect(glob).toHaveBeenCalledWith(root, ["**/*"]);
  });

  it("does not let a caller change the list that later calls give", async () => {
    const files = await nxTaskFiles({ Inspector, glob: filesOnDisk, reset }, contextFor(root));

    files.filesBelow("").push("crate/data/injected.txt");

    expect(files.filesBelow("crate/data")).toEqual(["crate/data/a.txt"]);
  });

  it("gives a check after resetNxWorkspaceContext the files written since an earlier check of the process", async () => {
    // The real parts of the installed Nx, whose workspace context this
    // process makes on first use and keeps until it is cleared.
    const parts = nxTaskFileParts(root);
    const { HashPlanInspector } = loadHashPlanInspector(root);
    const real: NxTaskFileParts = { ...parts, Inspector: HashPlanInspector };
    resetNxWorkspaceContext(root);

    // The check of one task, after its cargo call.
    const first = await nxTaskFiles(real, contextFor(root, true));
    expect(first.filesBelow("crate/data")).toEqual(["crate/data/a.txt"]);
    // Nx adds nx.json to the files of every task.
    expect([...first.inputFiles].sort()).toEqual(["crate/data/a.txt", "crate/lib.rs", "nx.json"]);

    // A later cargo call, such as that of the next group of a batch, writes
    // a file into a folder that a build script names, in the crate's folder.
    writeFileSync(join(root, "crate", "data", "generated.txt"), "g\n");

    // Without the reset, Nx gives the next check the files of the first.
    const stale = await nxTaskFiles(real, contextFor(root, true));
    expect(stale.filesBelow("crate/data")).toEqual(["crate/data/a.txt"]);
    expect(stale.inputFiles.has("crate/data/generated.txt")).toBe(false);

    // After it, both the folder and the task's input files hold the file.
    resetNxWorkspaceContext(root);
    const second = await nxTaskFiles(real, contextFor(root, true));
    expect(second.filesBelow("crate/data")).toEqual([
      "crate/data/a.txt",
      "crate/data/generated.txt",
    ]);
    expect([...second.inputFiles].sort()).toEqual([
      "crate/data/a.txt",
      "crate/data/generated.txt",
      "crate/lib.rs",
      "nx.json",
    ]);
    // An instance made before the reset keeps the list it took.
    expect(first.filesBelow("crate/data")).toEqual(["crate/data/a.txt"]);
  });

  it("lists the repository with Nx's workspace context when first asked, not when made", async () => {
    // The real glob of the installed Nx, whose workspace context for this
    // fixture does not exist before the first call.
    const { glob } = nxTaskFileParts(root);
    resetNxWorkspaceContext(root);
    const files = await nxTaskFiles({ Inspector, glob, reset }, contextFor(root));

    // A file written after the instance is made and before its first use,
    // as by a cargo call between the two, is listed.
    writeFileSync(join(root, "crate", "data", "late.txt"), "l\n");

    expect(files.filesBelow("crate/data").sort()).toEqual([
      "crate/data/a.txt",
      "crate/data/late.txt",
    ]);
    expect(files.filesBelow("other")).toEqual(["other/b.txt"]);
  });
});
