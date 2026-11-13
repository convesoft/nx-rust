// The module object itself, which the harness calls through.
import fs from "node:fs";
import { FixtureWorkspace } from "./harness";

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

  it("removes its temporary folder when it cannot be created", () => {
    // Records the folder that `create` makes, and still makes it.
    const mkdtemp = jest.spyOn(fs, "mkdtempSync");

    expect(() =>
      FixtureWorkspace.create("subfolder-workspace", {
        "rust/Cargo.toml": () => {
          throw new Error("a broken change");
        },
      }),
    ).toThrow("a broken change");

    folders = mkdtemp.mock.results.map((result) => result.value as string);
    expect(folders).toHaveLength(1);
    expect(fs.existsSync(folders[0])).toBe(false);
  });
});
