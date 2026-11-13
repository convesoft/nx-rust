import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CargoWrapper, HARNESS_TIMEOUT, testEnvironment } from "./harness";

describe("cargo wrapper", () => {
  let directory: string;
  let cargo: CargoWrapper;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-cargo-wrapper-")));
    cargo = CargoWrapper.install(join(directory, "wrapper"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it(
    "logs each invocation with its folder and runs the real cargo",
    () => {
      const folder = join(directory, "some folder");
      mkdirSync(folder);

      const version = execFileSync("cargo", ["--version"], {
        cwd: folder,
        env: cargo.environment(testEnvironment()),
        encoding: "utf8",
      });

      expect(version).toMatch(/^cargo \d+\.\d+\.\d+/);
      expect(cargo.calls()).toEqual([{ cwd: folder, args: ["--version"] }]);
      expect(cargo.calls(directory)).toEqual([{ cwd: "some folder", args: ["--version"] }]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "exits as cargo did",
    () => {
      const result = spawnSync("cargo", ["no-such-command"], {
        cwd: directory,
        env: cargo.environment(testEnvironment()),
        encoding: "utf8",
      });

      expect(result.status).toBe(101);
      expect(result.stderr).toContain("no-such-command");
      expect(cargo.calls()).toHaveLength(1);
    },
    HARNESS_TIMEOUT,
  );
});
