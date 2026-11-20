import type { ExecutorContext } from "@nx/devkit";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type NxTaskFileParts, nxTaskFileParts, nxTaskFiles } from "../src/executors/nx-task-files";

/** A `HashPlanInspector` that gives the task `crate:build` no input files. */
class Inspector {
  async init(): Promise<void> {}
  inspectTaskInputs(): Record<string, { files: string[] }> {
    return { "crate:build": { files: [] } };
  }
}

function contextFor(root: string): ExecutorContext {
  return {
    root,
    cwd: root,
    isVerbose: false,
    projectName: "crate",
    targetName: "build",
    projectGraph: { nodes: {}, dependencies: {} },
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
    const files = await nxTaskFiles({ Inspector, glob }, contextFor(root));

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
    const files = await nxTaskFiles({ Inspector, glob: filesOnDisk }, contextFor(root));

    files.filesBelow("").push("crate/data/injected.txt");

    expect(files.filesBelow("crate/data")).toEqual(["crate/data/a.txt"]);
  });

  it("gives each check the files that exist when it lists them, not those of an earlier check", async () => {
    const glob = jest.fn((workspaceRoot: string) => filesOnDisk(workspaceRoot));
    const parts: NxTaskFileParts = { Inspector, glob };

    // The check of one task, after its cargo call.
    const first = await nxTaskFiles(parts, contextFor(root));
    expect(first.filesBelow("crate/data")).toEqual(["crate/data/a.txt"]);

    // A later cargo call, such as that of the next group of a batch, writes
    // a file into a folder that a build script names.
    writeFileSync(join(root, "crate", "data", "generated.txt"), "g\n");

    // The check after it lists the repository again and sees the file.
    const second = await nxTaskFiles(parts, contextFor(root));
    expect(second.filesBelow("crate/data")).toEqual([
      "crate/data/a.txt",
      "crate/data/generated.txt",
    ]);
    expect(glob).toHaveBeenCalledTimes(2);
  });

  it("lists the repository with Nx's workspace context when first asked, not when made", async () => {
    // The real glob of the installed Nx, whose workspace context for this
    // fixture does not exist before the first call.
    const { glob } = nxTaskFileParts(root);
    const files = await nxTaskFiles({ Inspector, glob }, contextFor(root));

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
