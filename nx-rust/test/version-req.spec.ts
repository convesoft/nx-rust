import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { satisfies } from "../src/cargo/version-req";
import { HARNESS_TIMEOUT, testEnvironment } from "./harness";

// Checks the version requirements that DES-PROJECT-GRAPH evaluates for a
// direct redirection against real cargo: with an empty Cargo home and
// offline, a dependency patched to a local crate resolves exactly when the
// crate's version satisfies the requirement, because no registry can offer
// another version.

/** Requirement as written in Cargo.toml, local version, whether it matches. */
const cases: [req: string, version: string, matches: boolean][] = [
  ["0.1", "0.1.0", true],
  ["0.1", "0.1.5", true],
  ["0.1", "0.2.0", false],
  ["1", "1.4.2", true],
  ["1", "2.0.0", false],
  ["0", "0.9.0", true],
  ["0", "1.0.0", false],
  ["0.0", "0.0.7", true],
  ["0.0", "0.1.0", false],
  ["1.2", "1.9.9", true],
  ["1.2", "1.1.9", false],
  ["1.2.3", "1.3.0", true],
  ["1.2.3", "1.2.2", false],
  ["0.0.3", "0.0.3", true],
  ["0.0.3", "0.0.4", false],
  ["^0.2.1", "0.2.5", true],
  ["^0.2.1", "0.3.0", false],
  ["~1.2.3", "1.2.9", true],
  ["~1.2.3", "1.3.0", false],
  ["~1.2", "1.2.0", true],
  ["~1", "1.9.0", true],
  ["~1", "2.0.0", false],
  ["=1.2.3", "1.2.3", true],
  ["=1.2.3", "1.2.4", false],
  ["=1.2", "1.2.9", true],
  ["=1.2", "1.3.0", false],
  [">1.2.3", "1.2.4", true],
  [">1.2.3", "1.2.3", false],
  [">1.2", "1.3.0", true],
  [">1.2", "1.2.9", false],
  [">=1.2.3, <1.5", "1.4.0", true],
  [">=1.2.3, <1.5", "1.5.0", false],
  [">=1.2.3, <1.5", "1.2.2", false],
  ["<=1.2", "1.2.9", true],
  ["<=1.2", "1.3.0", false],
  ["<2", "1.9.9", true],
  ["<2", "2.0.0", false],
  ["*", "3.1.4", true],
  ["1.*", "1.5.0", true],
  ["1.*", "2.0.0", false],
  ["1.2.*", "1.2.7", true],
  ["1.2.*", "1.3.0", false],
  ["0.1", "0.1.5+local", true],
];

describe("version requirements", () => {
  let base: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "nx-rust-version-req-"));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it.each(cases)(
    "%s with %s matches as cargo resolves it",
    (req, version, matches) => {
      const root = mkdtempSync(join(base, "case-"));
      const write = (path: string, content: string) => {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), content);
      };
      write(
        "Cargo.toml",
        '[workspace]\nmembers = ["api"]\nresolver = "2"\n\n[patch.crates-io]\nmodel = { path = "model" }\n',
      );
      write(
        "api/Cargo.toml",
        `[package]\nname = "api"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nmodel = "${req}"\n`,
      );
      write("api/src/lib.rs", "");
      write(
        "model/Cargo.toml",
        `[package]\nname = "model"\nversion = "${version}"\nedition = "2021"\n`,
      );
      write("model/src/lib.rs", "");
      const cargoHome = join(root, "cargo-home");
      mkdirSync(cargoHome);
      const env = testEnvironment({ CARGO_HOME: cargoHome, CARGO_NET_OFFLINE: "true" });
      const run = (args: string[]) =>
        spawnSync("cargo", ["metadata", "--format-version", "1", ...args], {
          cwd: root,
          env,
          encoding: "utf8",
        });

      // The requirement as the report that the plugin reads writes it.
      const report = JSON.parse(run(["--no-deps"]).stdout);
      const reported = report.packages.find((pkg: { name: string }) => pkg.name === "api")
        .dependencies[0].req;
      const resolved = run([]);

      expect([reported, resolved.status === 0, resolved.stderr]).toEqual([
        reported,
        matches,
        expect.any(String),
      ]);
      expect(satisfies(reported, version)).toBe(matches);
    },
    HARNESS_TIMEOUT,
  );

  it("cannot tell for a pre-release or an operator before a wildcard", () => {
    expect(satisfies("^1.0.0-alpha", "1.0.0-alpha")).toBeUndefined();
    expect(satisfies("^1", "1.1.0-beta")).toBeUndefined();
    expect(satisfies(">=1.*", "1.0.0")).toBeUndefined();
    expect(satisfies("^1.2.3.4", "1.2.3")).toBeUndefined();
  });
});
