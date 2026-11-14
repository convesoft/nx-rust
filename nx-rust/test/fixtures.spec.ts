import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  copyFixture,
  FixtureName,
  fixtureNames,
  HARNESS_TIMEOUT,
  pinnedToolchain,
  pinnedToolchainAvailable,
  pluginPackageName,
  testEnvironment,
} from "./harness";

// What cargo must make of each fixture: the members of each workspace, by
// the workspace's root folder, relative to the repository root. Manifests
// that belong to no workspace are listed under `others`.
const expected: Record<FixtureName, { workspaces: Record<string, string[]>; others?: string[] }> = {
  "subfolder-workspace": {
    workspaces: {
      rust: ["rust/crates/api", "rust/crates/codegen", "rust/crates/model", "rust/crates/testkit"],
    },
  },
  "two-workspaces": {
    workspaces: { ".": ["crates/app", "crates/util"], tools: ["tools", "tools/scaffold"] },
  },
  "standalone-crate": {
    workspaces: { rust: ["rust/crates/api"], "tools/xtask": ["tools/xtask"] },
  },
  "excluded-member": {
    workspaces: { rust: ["rust/crates/app"], "rust/crates/legacy": ["rust/crates/legacy"] },
  },
  "cross-workspace-path": {
    workspaces: { backend: ["backend/crates/server"], shared: ["shared/crates/model"] },
  },
  "vendored-crate": {
    workspaces: { rust: ["rust/crates/app", "rust/crates/lib"] },
    others: ["vendor/lexer", "vendor/parser"],
  },
  "name-collision": {
    workspaces: { rust: ["rust/crates/api"], "tools/api": ["tools/api"] },
  },
  "dev-dependency-cycle": {
    workspaces: { rust: ["rust/crates/model", "rust/crates/testkit"] },
  },
  "different-toolchains": {
    workspaces: { pinned: ["pinned/crates/pinned-lib"], stable: ["stable/crates/stable-lib"] },
  },
  "mixed-folders": {
    workspaces: {
      "libs/rust": [
        "libs/rust/crates/addon",
        "libs/rust/crates/cli",
        "libs/rust/crates/engine",
        "libs/rust/crates/unnamed",
      ],
    },
  },
  "nested-folders": {
    workspaces: {
      "apps/Billing.API/rust_v2": ["apps/Billing.API/rust_v2/crates/gateway"],
      "services/billing": ["services/billing/crates/invoice"],
    },
  },
  "crate-shapes": {
    workspaces: {
      rust: [
        "rust/crates/cli",
        "rust/crates/core",
        "rust/crates/internal",
        "rust/crates/perf",
        "rust/crates/server",
      ],
    },
  },
  "patched-workspaces": {
    workspaces: {
      rust: [
        "rust/crates/api",
        "rust/crates/harness",
        "rust/crates/model",
        "rust/crates/plain",
        "rust/crates/util",
        "rust/crates/viaw",
      ],
      shared: ["shared/crates/types"],
    },
    others: ["third_party/fork"],
  },
  "declared-files": {
    workspaces: { rust: ["rust/crates/api", "rust/crates/app", "rust/crates/other"] },
  },
  "undeclared-files": {
    workspaces: {
      rust: [
        "rust/crates/base",
        "rust/crates/cola",
        "rust/crates/colb",
        "rust/crates/macros",
        "rust/crates/multi",
        "rust/crates/plain",
        "rust/crates/reader",
      ],
    },
  },
  "shared-names": {
    workspaces: { rust: ["rust/crates/good", "rust/crates/toolkit"] },
    others: ["third_party/good"],
  },
};

// Without the pinned toolchain, different-toolchains is not checked.
const checkedFixtures = fixtureNames.filter(
  (fixture) => fixture !== "different-toolchains" || pinnedToolchainAvailable(),
);

describe("fixtures", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-fixture-check-")));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each(checkedFixtures)(
    "%s is what cargo reports, with a current lockfile per workspace",
    (fixture) => {
      copyFixture(fixture, root, { plugin: pluginPackageName });
      const { workspaces, others = [] } = expected[fixture];

      for (const [folder, members] of Object.entries(workspaces)) {
        const metadata = cargoMetadata(join(root, folder));
        expect(relative(root, metadata.workspace_root) || ".").toBe(folder);
        const memberIds = new Set(metadata.workspace_members);
        const memberFolders = metadata.packages
          .filter((p) => memberIds.has(p.id))
          .map((p) => relative(root, dirname(p.manifest_path)) || ".")
          .sort();
        expect(memberFolders).toEqual(members);
        expect(existsSync(join(root, folder, "Cargo.lock"))).toBe(true);
      }

      const listed = new Set([
        ...Object.keys(workspaces),
        ...Object.values(workspaces).flat(),
        ...others,
      ]);
      expect(manifestFolders(root)).toEqual([...listed].sort());
    },
    HARNESS_TIMEOUT,
  );

  // So that fmt and fmt-check leave a fixture as it is (VER-CARGO-UNCHANGED).
  it.each(fixtureNames)(
    "%s has Rust sources that rustfmt leaves as they are",
    (fixture) => {
      copyFixture(fixture, root, { plugin: pluginPackageName });
      const sources = rustSources(root);
      expect(sources.length).toBeGreaterThan(0);

      // Throws on a source that rustfmt would change, naming it.
      execFileSync("rustfmt", ["--check", "--edition", "2024", ...sources], {
        cwd: root,
        env: testEnvironment(),
        encoding: "utf8",
      });
    },
    HARNESS_TIMEOUT,
  );

  if (pinnedToolchainAvailable()) {
    it(
      "different-toolchains uses two toolchains",
      () => {
        copyFixture("different-toolchains", root, { plugin: pluginPackageName });
        const pinned = rustcVersion(join(root, "pinned"));
        const stable = rustcVersion(join(root, "stable"));

        expect(pinned).toContain(`rustc ${pinnedToolchain} `);
        expect(stable).not.toBe(pinned);
      },
      HARNESS_TIMEOUT,
    );
  } else {
    it.todo(
      `different-toolchains: install the ${pinnedToolchain} toolchain with rustup to check it`,
    );
  }
});

interface CargoMetadata {
  workspace_root: string;
  workspace_members: string[];
  packages: { id: string; manifest_path: string }[];
}

// The full report, offline and locked: it fails if a lockfile is missing a
// package or would change.
function cargoMetadata(cwd: string): CargoMetadata {
  return JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--offline", "--locked"], {
      cwd,
      env: testEnvironment(),
      encoding: "utf8",
    }),
  );
}

function rustcVersion(cwd: string): string {
  return execFileSync("rustc", ["-V"], { cwd, env: testEnvironment(), encoding: "utf8" }).trim();
}

function manifestFolders(root: string, folder = "."): string[] {
  const entries = readdirSync(join(root, folder), { withFileTypes: true });
  return entries
    .flatMap((entry) => {
      const path = folder === "." ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        return manifestFolders(root, path);
      }
      return entry.name === "Cargo.toml" ? [folder] : [];
    })
    .sort();
}

function rustSources(root: string, folder = "."): string[] {
  return readdirSync(join(root, folder), { withFileTypes: true })
    .flatMap((entry) => {
      const path = folder === "." ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        return rustSources(root, path);
      }
      return entry.name.endsWith(".rs") ? [path] : [];
    })
    .sort();
}
