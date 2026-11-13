// The module object itself, which the harness calls through.
import fs from "node:fs";
import { FixtureWorkspace, testRunSocketFolder } from "./harness";

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
});
