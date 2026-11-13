// The module object itself, which the harness calls through.
import fs from "node:fs";
import { FixtureWorkspace, HARNESS_TIMEOUT, inFixture, testRunSocketFolder } from "./harness";

describe("fixture workspace", () => {
  let folders: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    // Whatever the test found, leave nothing behind.
    for (const folder of folders) {
      fs.rmSync(folder, { recursive: true, force: true });
    }
    folders = [];
  });

  it("removes its temporary folders when it cannot be created", () => {
    // Records the folders that `create` makes, and still makes them: the
    // copy's, and where the test run has a socket folder, one for its sockets.
    const mkdtemp = jest.spyOn(fs, "mkdtempSync");

    expect(() =>
      FixtureWorkspace.create("subfolder-workspace", {
        "rust/Cargo.toml": () => {
          throw new Error("a broken change");
        },
      }),
    ).toThrow("a broken change");

    folders = mkdtemp.mock.results.map((result) => result.value as string);
    expect(folders).toHaveLength(testRunSocketFolder() === undefined ? 1 : 2);
    expect(folders.filter((folder) => fs.existsSync(folder))).toEqual([]);
  });

  it(
    "has a daemon that installs no other Nx",
    () =>
      // `CI=false`, so that the daemon asks its start-up questions in CI too,
      // where Nx would otherwise skip them.
      inFixture("standalone-crate", undefined, async (workspace) => {
        const env = { NX_DAEMON: "true", CI: "false" };
        try {
          const result = await workspace.nx(["show", "projects", "--json"], env);

          expect(result.status).toBe(0);
        } finally {
          await workspace.nx(["daemon", "--stop"], env);
        }
        const log = workspace.daemonLog();
        // The daemon asked, and the installed Nx answered.
        expect(log).toContain("[AI-AGENTS]: Using local implementation");
        expect(log).not.toContain("[LATEST-NX]");
      }),
    HARNESS_TIMEOUT,
  );
});
