import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { buildTemplate, HARNESS_TIMEOUT, testEnvironment } from "./harness";

// The template of a warmed fixture (harness/fixture-builds.ts) is built and
// cleaned in its own folder only, whatever the machine's Cargo configuration
// says.

/** Every file below `folder`, by its path relative to it, with a hash of its content. */
function snapshot(folder: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else {
        files[relative(folder, path)] = createHash("sha256")
          .update(readFileSync(path))
          .digest("hex");
      }
    }
  };
  walk(folder);
  return files;
}

describe("the template of a warmed fixture", () => {
  it(
    "builds and cleans only in its own folder where the Cargo home sets build.target-dir and build.build-dir",
    () => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-template-check-")));
      try {
        // Another project's output in the directories that the configuration names.
        const shared = join(base, "shared-target");
        const other: Record<string, string> = {
          "debug/.cargo-lock": "",
          "debug/libother.rlib": "other library\n",
          "debug/libother.d": "other record\n",
          "debug/incremental/other-0abc/state.bin": "other state\n",
          "debug/build/other/0123456789abcdef/out/generated.rs": "other output\n",
          "debug/deps/libother-0123456789abcdef.rlib": "other dependency\n",
        };
        for (const [path, content] of Object.entries(other)) {
          mkdirSync(join(shared, path, ".."), { recursive: true });
          writeFileSync(join(shared, path), content);
        }
        const home = join(base, "cargo-home");
        mkdirSync(home);
        writeFileSync(
          join(home, "config.toml"),
          `[build]\ntarget-dir = ${JSON.stringify(shared)}\nbuild-dir = ${JSON.stringify(shared)}\n`,
        );
        const before = snapshot(shared);

        const template = join(base, "template");
        buildTemplate(
          "wasm-packages",
          [{ folder: "rust", builds: [["build", "--workspace"]] }],
          template,
          testEnvironment({ CARGO_HOME: home }),
        );

        expect(snapshot(shared)).toEqual(before);
        expect(Object.keys(before).sort()).toEqual(Object.keys(other).sort());
        // The template has the build, without the workspace's own artifacts.
        const debug = join(template, "rust", "target", "debug");
        expect(existsSync(debug)).toBe(true);
        expect(
          existsSync(join(debug, "libcodec.so")) || existsSync(join(debug, "libcodec.dylib")),
        ).toBe(false);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
    HARNESS_TIMEOUT * 2,
  );
});
