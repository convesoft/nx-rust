import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enclosingWorkspace, excludingEntry } from "../src/generators/crate/enclosing-workspace";
import {
  changedFiles,
  FileChanges,
  FixtureName,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  repositoryFiles,
  testEnvironment,
  withoutColours,
} from "./harness";

// Checks the parts of VER-SETUP about the library and binary generators.

const pluginName = "@convesoft/nx-rust";

interface Run {
  status: number | null;
  output: string;
  /** The files that the run added, removed or changed. */
  changed: string[];
}

/** Runs `nx g` in a copy of `fixture` and hands the result to `test`. */
async function generate(
  fixture: FixtureName,
  files: FileChanges,
  args: string[],
  test: (workspace: FixtureWorkspace, run: Run) => void | Promise<void>,
  cwd = ".",
): Promise<void> {
  const workspace = FixtureWorkspace.create(fixture, files);
  try {
    const before = repositoryFiles(workspace.root);
    const { status, output } = await workspace.nx(["g", ...args], {}, cwd);
    await test(workspace, {
      status,
      output: withoutColours(output),
      changed: changedFiles(before, repositoryFiles(workspace.root)),
    });
  } finally {
    workspace.remove();
  }
}

/** The repository's files after running plain `cargo new` with `args` in the root of a copy of `fixture`. */
function filesAfterCargoNew(
  fixture: FixtureName,
  files: FileChanges,
  args: string[],
): Map<string, string> {
  const workspace = FixtureWorkspace.create(fixture, files);
  try {
    const result = spawnSync("cargo", ["new", ...args], {
      cwd: workspace.root,
      env: testEnvironment(),
      encoding: "utf8",
    });
    expect(result.stderr).toContain("Creating");
    expect(result.status).toBe(0);
    return repositoryFiles(workspace.root);
  } finally {
    workspace.remove();
  }
}

/** The `cargo new` calls in the log. */
function cargoNewCalls(workspace: FixtureWorkspace) {
  return workspace.cargoCalls().filter((call) => call.args[0] === "new");
}

/**
 * The lines in which Nx lists the changes a generator made to its file tree,
 * as `CREATE <path>`, `UPDATE <path>` or `DELETE <path>`. Nx prints them
 * after the generator returns, with and without `--dry-run`, and init's
 * `--dry-run` test shows such a line.
 */
function treeChanges(output: string): string[] {
  return output.split("\n").filter((line) => /^(CREATE|UPDATE|DELETE) /.test(line));
}

/** The names of the workspace members, as `cargo metadata` reports them, in `folder`. */
function memberNames(workspace: FixtureWorkspace, folder: string): string[] {
  const result = spawnSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
    cwd: join(workspace.root, folder),
    env: testEnvironment(),
    encoding: "utf8",
  });
  expect(result.stderr).toBe("");
  const report = JSON.parse(result.stdout);
  return report.packages
    .filter((pkg: { id: string }) => report.workspace_members.includes(pkg.id))
    .map((pkg: { name: string }) => pkg.name)
    .sort();
}

function read(workspace: FixtureWorkspace, path: string): string {
  return readFileSync(join(workspace.root, path), "utf8");
}

describe.each([
  ["library", "--lib"],
  ["binary", "--bin"],
])("the %s generator", (generator, flag) => {
  it("declares directory, name and edition and no other option", () => {
    const schema = JSON.parse(
      readFileSync(
        join(__dirname, "..", "src", "generators", "crate", `${generator}.schema.json`),
        "utf8",
      ),
    );
    expect(Object.keys(schema.properties).sort()).toEqual(["directory", "edition", "name"]);
    expect(schema.required).toEqual(["directory"]);
    expect(schema.properties.directory.$default).toEqual({ $source: "argv", index: 0 });
  });

  it(
    "creates what cargo new --vcs none creates, also where folders on the way do not exist",
    () =>
      generate(
        "subfolder-workspace",
        {},
        [`${pluginName}:${generator}`, "rust/libs/parsing/core-kit"],
        (workspace, { status, output }) => {
          expect(status).toBe(0);
          expect(cargoNewCalls(workspace)).toEqual([
            {
              cwd: ".",
              args: ["new", "--vcs", "none", flag, "rust/libs/parsing/core-kit"],
            },
          ]);
          // Cargo added the member; the generator wrote nothing through Nx's tree.
          expect(output).toContain("Adding `core-kit` as member of workspace");
          expect(treeChanges(output)).toEqual([]);
          const expected = filesAfterCargoNew("subfolder-workspace", {}, [
            "--vcs",
            "none",
            flag,
            "rust/libs/parsing/core-kit",
          ]);
          expect(repositoryFiles(workspace.root)).toEqual(expected);
          for (const folder of ["rust/libs", "rust/libs/parsing", "rust/libs/parsing/core-kit"]) {
            expect(existsSync(join(workspace.root, folder, ".git"))).toBe(false);
          }
          // Cargo added the crate to members, once.
          expect(read(workspace, "rust/Cargo.toml")).toContain(
            'members = ["crates/*", "libs/parsing/core-kit"]',
          );
          expect(memberNames(workspace, "rust")).toEqual([
            "api",
            "codegen",
            "core-kit",
            "model",
            "testkit",
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );
});

describe("the crate generators", () => {
  it(
    "leave members as they are where a glob covers the crate",
    () =>
      generate(
        "subfolder-workspace",
        {},
        [`${pluginName}:library`, "rust/crates/fresh"],
        (workspace, { status, changed }) => {
          expect(status).toBe(0);
          expect(changed).toEqual(["rust/crates/fresh/Cargo.toml", "rust/crates/fresh/src/lib.rs"]);
          expect(memberNames(workspace, "rust")).toContain("fresh");
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "give a workspace without members a members list",
    () =>
      generate(
        "subfolder-workspace",
        {
          "host/Cargo.toml":
            '[package]\nname = "host"\nversion = "0.1.0"\nedition = "2024"\n\n[workspace]\n',
          "host/src/lib.rs": "",
        },
        [`${pluginName}:library`, "host/crates/part"],
        (workspace, { status, output }) => {
          expect(status).toBe(0);
          expect(output).toContain("Adding `part` as member of workspace");
          expect(read(workspace, "host/Cargo.toml")).toContain('members = ["crates/part"]');
          expect(memberNames(workspace, "host")).toEqual(["host", "part"]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "pass name and edition to cargo",
    () =>
      generate(
        "subfolder-workspace",
        {},
        [`${pluginName}:binary`, "rust/tools/tool-dir", "--name", "my-tool", "--edition", "2021"],
        (workspace, { status }) => {
          expect(status).toBe(0);
          expect(cargoNewCalls(workspace)[0].args).toEqual([
            "new",
            "--vcs",
            "none",
            "--bin",
            "--name",
            "my-tool",
            "--edition",
            "2021",
            "rust/tools/tool-dir",
          ]);
          const manifest = read(workspace, "rust/tools/tool-dir/Cargo.toml");
          expect(manifest).toContain('name = "my-tool"');
          expect(manifest).toContain('edition = "2021"');
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "leave the edition to the workspace's [workspace.package]",
    () =>
      generate(
        "subfolder-workspace",
        { "rust/Cargo.toml": (manifest) => `${manifest}\n[workspace.package]\nedition = "2021"\n` },
        [`${pluginName}:library`, "rust/crates/inherits"],
        (workspace, { status }) => {
          expect(status).toBe(0);
          expect(read(workspace, "rust/crates/inherits/Cargo.toml")).toContain(
            "edition.workspace = true",
          );
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "leave the fields of [workspace.package] and the lints of [workspace.lints] to cargo, as cargo new does",
    () => {
      const files: FileChanges = {
        "rust/Cargo.toml": (manifest) =>
          `${manifest}\n[workspace.package]\nlicense = "MIT"\nrust-version = "1.91"\n\n[workspace.lints.rust]\nunsafe_code = "forbid"\n`,
      };
      return generate(
        "subfolder-workspace",
        files,
        [`${pluginName}:library`, "rust/libs/inherits"],
        (workspace, { status }) => {
          expect(status).toBe(0);
          const manifest = read(workspace, "rust/libs/inherits/Cargo.toml");
          expect(manifest).toContain("license.workspace = true");
          expect(manifest).toContain("rust-version.workspace = true");
          expect(manifest).toMatch(/\[lints\]\nworkspace = true/);
          // No edition in [workspace.package]: cargo's default.
          expect(manifest).toMatch(/^edition = "\d{4}"$/m);
          expect(repositoryFiles(workspace.root)).toEqual(
            filesAfterCargoNew("subfolder-workspace", files, [
              "--vcs",
              "none",
              "--lib",
              "rust/libs/inherits",
            ]),
          );
        },
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "resolve a relative directory against the folder nx runs in",
    () =>
      generate(
        "subfolder-workspace",
        {},
        [`${pluginName}:library`, "crates/from-rust"],
        (workspace, { status, changed }) => {
          expect(status).toBe(0);
          expect(changed).toEqual([
            "rust/crates/from-rust/Cargo.toml",
            "rust/crates/from-rust/src/lib.rs",
          ]);
          expect(cargoNewCalls(workspace)).toEqual([
            { cwd: ".", args: ["new", "--vcs", "none", "--lib", "rust/crates/from-rust"] },
          ]);
        },
        "rust",
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "stop without running cargo where the workspace's exclude covers the folder",
    () =>
      generate(
        "excluded-member",
        {},
        [`${pluginName}:library`, "rust/crates/legacy/part"],
        (workspace, { status, output, changed }) => {
          expect(status).toBe(1);
          expect(output).toContain(
            'nx-rust did not create a crate in rust/crates/legacy/part: rust/Cargo.toml lists "crates/legacy" under [workspace] exclude',
          );
          expect(output).toContain('remove "crates/legacy" from exclude in rust/Cargo.toml');
          expect(changed).toEqual([]);
          expect(cargoNewCalls(workspace)).toEqual([]);
          // The positive control: graph creation's cargo calls are logged.
          expect(workspace.cargoCalls()).not.toEqual([]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "go by the nearest workspace where one lies in the folder of another",
    () => {
      // The outer workspace's exclude matches the folder, the inner
      // workspace's does not: cargo adds the crate to the inner one.
      const files: FileChanges = {
        "rust/Cargo.toml": (manifest) =>
          manifest.replace('resolver = "3"', 'resolver = "3"\nexclude = ["nested"]'),
        "rust/nested/Cargo.toml": '[workspace]\nmembers = ["crates/*"]\nresolver = "3"\n',
        "rust/nested/crates/inner/Cargo.toml":
          '[package]\nname = "inner"\nversion = "0.1.0"\nedition = "2024"\n',
        "rust/nested/crates/inner/src/lib.rs": "",
      };
      return generate(
        "subfolder-workspace",
        files,
        [`${pluginName}:library`, "rust/nested/libs/deep"],
        (workspace, { status, output, changed }) => {
          expect(status).toBe(0);
          expect(output).not.toContain("nx-rust did not create a crate");
          expect(cargoNewCalls(workspace)).toEqual([
            { cwd: ".", args: ["new", "--vcs", "none", "--lib", "rust/nested/libs/deep"] },
          ]);
          expect(changed).toEqual([
            "rust/nested/Cargo.toml",
            "rust/nested/libs/deep/Cargo.toml",
            "rust/nested/libs/deep/src/lib.rs",
          ]);
          expect(read(workspace, "rust/nested/Cargo.toml")).toContain(
            'members = ["crates/*", "libs/deep"]',
          );
          expect(memberNames(workspace, "rust/nested")).toEqual(["deep", "inner"]);
          expect(memberNames(workspace, "rust")).toEqual(["api", "codegen", "model", "testkit"]);
        },
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "say that a crate outside every workspace is standalone",
    () =>
      generate(
        "subfolder-workspace",
        {},
        [`${pluginName}:binary`, "tools/cli"],
        (workspace, { status, output, changed }) => {
          expect(status).toBe(0);
          expect(output).toContain(
            "tools/cli lies outside every Cargo workspace, so the crate will be a standalone crate, with its own Cargo.lock and build directory.",
          );
          expect(changed).toEqual(["tools/cli/Cargo.toml", "tools/cli/src/main.rs"]);
          expect(read(workspace, "rust/Cargo.toml")).toBe(
            readFileSync(
              join(__dirname, "fixtures", "subfolder-workspace", "rust", "Cargo.toml"),
              "utf8",
            ),
          );
          expect(memberNames(workspace, "tools/cli")).toEqual(["cli"]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "print the cargo command and change nothing with --dry-run",
    () =>
      generate(
        "subfolder-workspace",
        {},
        [`${pluginName}:library`, "rust/crates/dry", "--name", "dry-run", "--dry-run"],
        (workspace, { status, output, changed }) => {
          expect(status).toBe(0);
          expect(output).toContain(
            "Without --dry-run, nx-rust would run `cargo new --vcs none --lib --name dry-run rust/crates/dry` in the repository root.",
          );
          expect(treeChanges(output)).toEqual([]);
          expect(changed).toEqual([]);
          expect(cargoNewCalls(workspace)).toEqual([]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "fail with cargo's message and change nothing where the folder exists",
    () =>
      generate(
        "subfolder-workspace",
        {},
        [`${pluginName}:library`, "rust/crates/model"],
        (workspace, { status, output, changed }) => {
          expect(status).toBe(1);
          expect(output).toContain(
            "`cargo new --vcs none --lib rust/crates/model` failed with status 101:",
          );
          expect(output).toMatch(/destination `.*rust\/crates\/model` already exists/);
          expect(changed).toEqual([]);
        },
      ),
    HARNESS_TIMEOUT,
  );
});

describe("the workspace that encloses a new crate", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nx-rust-enclosing-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function write(path: string, content: string): void {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  it("is the nearest manifest above the folder with a [workspace] table", () => {
    write("Cargo.toml", '[workspace]\nexclude = ["inner/vendor"]\n');
    write("inner/Cargo.toml", '[package]\nname = "inner"\n');
    write("inner/nested/Cargo.toml", '[workspace]\nexclude = ["vendor"]\n');

    expect(enclosingWorkspace(join(root, "inner", "nested", "crates", "a"))).toEqual({
      manifest: join(root, "inner", "nested", "Cargo.toml"),
      exclude: ["vendor"],
    });
    // A package without [workspace] does not enclose.
    expect(enclosingWorkspace(join(root, "inner", "a"))?.manifest).toBe(join(root, "Cargo.toml"));
  });

  it("passes over a manifest that is not valid TOML", () => {
    write("Cargo.toml", "[workspace]\n");
    write("broken/Cargo.toml", "[workspace\n");

    expect(enclosingWorkspace(join(root, "broken", "a"))?.manifest).toBe(join(root, "Cargo.toml"));
  });

  it("is none outside every workspace", () => {
    write("Cargo.toml", '[package]\nname = "host"\n');

    // The temporary folder lies in no workspace either.
    expect(enclosingWorkspace(join(root, "a"))).toBeUndefined();
  });

  it("leaves a folder out when an exclude entry is the folder or a folder above it", () => {
    const workspace = {
      manifest: join(root, "Cargo.toml"),
      exclude: ["vendor/*", "legacy", "crates/old"],
    };

    expect(excludingEntry(workspace, join(root, "legacy"))).toBe("legacy");
    expect(excludingEntry(workspace, join(root, "legacy", "a", "b"))).toBe("legacy");
    expect(excludingEntry(workspace, join(root, "crates", "old", "a"))).toBe("crates/old");
    // Cargo reads entries as paths, not as globs, and compares whole folder names.
    expect(excludingEntry(workspace, join(root, "vendor", "a"))).toBeUndefined();
    expect(excludingEntry(workspace, join(root, "crates", "older"))).toBeUndefined();
    expect(excludingEntry(workspace, join(root, "crates"))).toBeUndefined();
  });
});
