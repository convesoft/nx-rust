import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CargoMetadata, requestMetadata } from "../src/cargo/metadata";
import { ComputationReports, possibleRoots } from "../src/graph/computation-reports";

// Checks the reuse of reports in one graph computation (DES-METADATA-REPORT):
// the manifests of one workspace that arrive together are reported once, by
// a real cargo, while requests that cannot report one workspace run at the
// same time.

const CARGO_TIMEOUT = 60_000;

let base: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "nx-rust-reports-"));
  const crate = (folder: string, name: string, extra = "") =>
    write(
      join(folder, "Cargo.toml"),
      `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n${extra}`,
      join(folder, "src", "lib.rs"),
    );
  // A workspace with a member in a subfolder and two outside its folder: one
  // that names the root with package.workspace, and one below it that does
  // not, which cargo sends to the root through the manifest above it.
  write(
    join(base, "root", "Cargo.toml"),
    '[workspace]\nresolver = "2"\nmembers = ["crates/a", "../outside", "../outside/child"]\n',
  );
  crate(join(base, "root", "crates", "a"), "a");
  crate(join(base, "outside"), "outside", 'workspace = "../root"\n');
  crate(join(base, "outside", "child"), "child");
  // A separate workspace in a folder of the first.
  write(
    join(base, "root", "nested", "Cargo.toml"),
    '[workspace]\nresolver = "2"\nmembers = ["b"]\n',
  );
  crate(join(base, "root", "nested", "b"), "b");
  // A standalone crate beside them.
  crate(join(base, "other"), "other");
  // A manifest that is no valid TOML.
  write(join(base, "broken", "Cargo.toml"), "[package\n");
  // A link followed by `..`: the file system reaches elsewhere/a, while
  // cargo takes the path as text and reaches root/crates/a.
  write(join(base, "elsewhere", "a", "Cargo.toml"), "[workspace]\n");
  mkdirSync(join(base, "elsewhere", "sub"));
  symlinkSync(join("..", "..", "elsewhere", "sub"), join(base, "root", "crates", "link"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function write(file: string, content: string, empty?: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (empty !== undefined) {
    mkdirSync(dirname(empty), { recursive: true });
    writeFileSync(empty, "");
  }
}

function manifest(folder: string): string {
  return join(base, folder, "Cargo.toml");
}

// The calls of a real cargo, with how many were in flight when each started.
function countingCargo(): {
  calls: { folder: string; alongside: number }[];
  reports: ComputationReports;
} {
  const calls: { folder: string; alongside: number }[] = [];
  let running = 0;
  const reports = new ComputationReports(async (path, cwd) => {
    calls.push({ folder: dirname(path).slice(base.length + 1), alongside: running });
    running += 1;
    try {
      return await requestMetadata(path, cwd);
    } finally {
      running -= 1;
    }
  });
  return { calls, reports };
}

describe("one workspace's manifests requested together", () => {
  it(
    "are reported once from the root manifest, with members inside and outside the root's folder",
    async () => {
      const { calls, reports } = countingCargo();

      const results = await Promise.all([
        reports.request(manifest("root"), join(base, "root")),
        reports.request(manifest("root/crates/a"), join(base, "root/crates/a")),
        reports.request(manifest("outside"), join(base, "outside")),
        reports.requestFromRoot(manifest("root")),
      ]);

      expect(calls.map((call) => call.folder)).toEqual(["root"]);
      expect(new Set(results).size).toBe(1);
      expect(reports.fromRoot(results[0])).toBe(true);
    },
    CARGO_TIMEOUT,
  );

  it(
    "are reported once with a member that a manifest above it sends to the root",
    async () => {
      const { calls, reports } = countingCargo();

      const [root, child] = await Promise.all([
        reports.request(manifest("root"), join(base, "root")),
        reports.request(manifest("outside/child"), join(base, "outside/child")),
      ]);

      expect(calls.map((call) => call.folder)).toEqual(["root"]);
      expect(child).toBe(root);
    },
    CARGO_TIMEOUT,
  );

  it(
    "are reported once from a member outside the root's folder, and once more from the root",
    async () => {
      const { calls, reports } = countingCargo();

      const [outside, member, root] = await Promise.all([
        reports.request(manifest("outside"), join(base, "outside")),
        reports.request(manifest("root/crates/a"), join(base, "root/crates/a")),
        reports.requestFromRoot(manifest("root")),
      ]);

      // A report from another folder never serves as the workspace's own.
      expect(calls.map((call) => call.folder)).toEqual(["outside", "root"]);
      expect(member).toBe(outside);
      expect(reports.fromRoot(outside)).toBe(false);
      expect(reports.fromRoot(root)).toBe(true);
    },
    CARGO_TIMEOUT,
  );
});

describe("different workspaces requested together", () => {
  it(
    "are reported at the same time, a nested workspace too, each once",
    async () => {
      const { calls, reports } = countingCargo();

      const [root, nested, member, other] = await Promise.all([
        reports.request(manifest("root"), join(base, "root")),
        reports.request(manifest("root/nested"), join(base, "root/nested")),
        reports.request(manifest("root/nested/b"), join(base, "root/nested/b")),
        reports.request(manifest("other"), join(base, "other")),
      ]);

      // The nested member waits for the nested workspace and reuses its
      // report; the others start without waiting.
      expect(calls).toEqual([
        { folder: "root", alongside: 0 },
        { folder: "root/nested", alongside: 1 },
        { folder: "other", alongside: 2 },
      ]);
      expect(member).toBe(nested);
      expect(new Set([root, nested, other]).size).toBe(3);
    },
    CARGO_TIMEOUT,
  );
});

describe("a request that may share a workspace with one in flight", () => {
  // A runner whose reports arrive only when the test lets them.
  function heldCargo(): {
    started: string[];
    finish: (folder: string) => void;
    reports: ComputationReports;
  } {
    const started: string[] = [];
    const pending = new Map<string, () => void>();
    const reports = new ComputationReports((path) => {
      const folder = dirname(path).slice(base.length + 1);
      started.push(folder);
      return new Promise<CargoMetadata>((resolve) => {
        pending.set(folder, () =>
          resolve({
            packages: [],
            workspace_members: [],
            workspace_root: dirname(path),
            target_directory: join(dirname(path), "target"),
            metadata: null,
          }),
        );
      });
    });
    const finish = (folder: string) => {
      const resolve = pending.get(folder);
      if (resolve === undefined) {
        throw new Error(`no request in flight for ${folder}`);
      }
      resolve();
    };
    return { started, finish, reports };
  }

  async function settle(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
    }
  }

  it.each([
    ["names its workspace with package.workspace", "outside"],
    ["is no valid TOML", "broken"],
    ["lies in a folder of the one in flight", "root/crates/a"],
    ["lies below a manifest with package.workspace", "outside/child"],
  ])("waits for it where the manifest %s", async (_case, folder) => {
    const { started, finish, reports } = heldCargo();

    const first = reports.request(manifest("root"), join(base, "root"));
    const second = reports.request(manifest(folder), join(base, folder));
    await settle();
    expect(started).toEqual(["root"]);

    finish("root");
    await first;
    await settle();
    // The stub's report lists no packages, so it covers none of these.
    expect(started).toEqual(["root", folder]);
    finish(folder);
    await second;
  });

  it("does not wait for one in a sibling folder", async () => {
    const { started, finish, reports } = heldCargo();

    const first = reports.request(manifest("root"), join(base, "root"));
    const second = reports.request(manifest("other"), join(base, "other"));
    await settle();
    expect(started).toEqual(["root", "other"]);

    finish("other");
    finish("root");
    await Promise.all([first, second]);
  });
});

describe("the possible roots of a manifest", () => {
  it("follow the path as cargo normalises it, before links", () => {
    const roots = possibleRoots(`${join(base, "root", "crates", "link")}/../a/Cargo.toml`);

    expect(roots).not.toBe("any");
    expect([...(roots as ReadonlySet<string>)].sort()).toEqual(
      [manifest("root/crates/a"), manifest("root")].map((path) => realpathSync(path)).sort(),
    );
  });
});
