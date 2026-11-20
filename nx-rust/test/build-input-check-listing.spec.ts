import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type FileChanges,
  type FixtureWorkspace,
  HARNESS_TIMEOUT,
  inFixture,
  linesWith,
  runNx,
} from "./harness";

// Checks the paragraph of VER-BUILD-INPUT-CHECK on files that a cargo call
// writes: the check of a build lists the repository's files, and matches the
// task's inputs, as they are after the cargo call it judges, also where an
// earlier group of the same batch process has listed them already
// (DES-BUILD-INPUT-CHECK, point 5).
//
// In batch-groups, base and indep are crates of one workspace. Here each
// gives its `build` target a feature set of its own, so that
// `nx run-many -t build -p base indep` hands one batch process two groups of
// one crate, each selecting its crate with `-p` in a cargo call of its own,
// one after the other (DES-BATCH, "Groups of one crate"). A crate's build
// script runs only in its own group's call, so whichever group runs second
// writes its file after the first group's check has listed the repository.

/** The version of this repository's Nx. */
const nxVersion: string = JSON.parse(
  readFileSync(require.resolve("nx/package.json"), "utf8"),
).version;

/** The first line of the check's failure message, without the task. */
const failure = "cargo build read files in the repository that none of the task's inputs covers";

const crates = ["base", "indep"] as const;

/**
 * A build script that writes `file` and names `named` with
 * `rerun-if-changed`, both relative to the crate.
 */
function buildScript(file: string, named: string): string {
  return [
    "use std::{fs, path::Path};",
    "",
    "fn main() {",
    `    let file = Path::new(${JSON.stringify(file)});`,
    '    fs::create_dir_all(file.parent().unwrap()).expect("the folder");',
    '    fs::write(file, "written by the build script\\n").expect("the file");',
    '    println!("cargo::rerun-if-changed=build.rs");',
    `    println!("cargo::rerun-if-changed=${named}");`,
    "}",
    "",
  ].join("\n");
}

/**
 * A feature `own` of the crate, which its `build` target turns on, and
 * `lines` of the crate's own table: the feature set puts the crate's task
 * into a group of one crate.
 */
function ownGroup(crate: string, ...lines: string[]): FileChanges {
  return {
    [`rust/crates/${crate}/Cargo.toml`]: (manifest = "") =>
      [
        manifest,
        "[features]",
        "own = []",
        "",
        "[package.metadata.nx]",
        ...lines,
        "",
        "[package.metadata.nx.targets.build.options]",
        'features = ["own"]',
        "",
      ].join("\n"),
  };
}

/**
 * Each crate's build script names the folder gen/<crate>, which holds
 * old.txt from the start and gets new.txt during the crate's build. Nothing
 * declares either.
 */
function writesIntoNamedFolder(crate: string): FileChanges {
  return {
    ...ownGroup(crate),
    [`gen/${crate}/old.txt`]: "there before the build\n",
    [`rust/crates/${crate}/build.rs`]: buildScript(
      `../../../gen/${crate}/new.txt`,
      `../../../gen/${crate}`,
    ),
  };
}

/** The lines of the failure message for {@link writesIntoNamedFolder}. */
function namedFolderFiles(crate: string): string[] {
  return ["new.txt", "old.txt"].map(
    (file) => `gen/${crate}/${file}, in the folder gen/${crate}, which cargo records as a whole`,
  );
}

/** The files that the failure message lists for a crate, as its lines show them. */
function listedFiles(output: string, crate: string): string[] {
  const lines = output.split("\n").map((line) => line.trim());
  const start = lines.indexOf(`The crate ${crate} read:`);
  if (start === -1) {
    return [];
  }
  const listed: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("- ")) {
      break;
    }
    listed.push(line.slice(2));
  }
  return listed;
}

/** The tasks that Nx lists as failed at the end of a run, sorted. */
function failedTasks(output: string): string[] {
  const list = /Failed tasks:\n\n((?:- \S+\n?)+)/.exec(output)?.[1] ?? "";
  return [...list.matchAll(/^- (\S+)$/gm)].map((match) => match[1]).sort();
}

function exists(workspace: FixtureWorkspace, path: string): boolean {
  return existsSync(join(workspace.root, path));
}

describe("the check of a build's dependency files after a later cargo call of the same process", () => {
  const buildBoth = ["run-many", "-t", "build", "-p", ...crates];

  it(
    "lists a file that the cargo call of the second group of a batch wrote into a folder that its build script names",
    async () => {
      const files: FileChanges = {};
      for (const crate of crates) {
        Object.assign(files, writesIntoNamedFolder(crate));
      }
      await inFixture("batch-groups", files, async (workspace) => {
        const { status, output } = await runNx(workspace, buildBoth);
        expect(status).not.toBe(0);
        expect(failedTasks(output)).toEqual(["base:build", "indep:build"]);
        for (const crate of crates) {
          expect(exists(workspace, `gen/${crate}/new.txt`)).toBe(true);
          expect(output).toContain(`${crate}:build: ${failure}`);
          // The check of each group sees the file that its own cargo call
          // wrote, beside the one that was there before the batch.
          expect(listedFiles(output, crate)).toEqual(namedFolderFiles(crate));
        }
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "covers a file that the cargo call of the second group of a batch wrote into the crate's folder and the crate includes",
    async () => {
      // Each crate's build script writes generated/value.txt into the
      // crate's folder, which the library includes, so that the crate's
      // record names the file itself. The crate's folder is an input of its
      // tasks, matched against the files that Nx's workspace context lists;
      // a pattern of `fileInputs` would not do, because Nx matches such an
      // `includeIgnored` fileset against the files on disk. The file does
      // not exist before the batch.
      const files: FileChanges = {};
      for (const crate of crates) {
        Object.assign(files, ownGroup(crate));
        files[`rust/crates/${crate}/build.rs`] = buildScript("generated/value.txt", "build.rs");
        files[`rust/crates/${crate}/src/lib.rs`] = (source = "") =>
          `${source}\npub fn generated() -> &'static str {\n    include_str!("../generated/value.txt")\n}\n`;
      }
      await inFixture("batch-groups", files, async (workspace) => {
        const { status, output } = await runNx(workspace, buildBoth);
        for (const crate of crates) {
          const generated = `rust/crates/${crate}/generated/value.txt`;
          expect(exists(workspace, generated)).toBe(true);
          expect(
            readFileSync(join(workspace.root, `rust/target/debug/lib${crate}.d`), "utf8"),
          ).toContain(generated);
        }
        expect(output).not.toContain(failure);
        expect(status).toBe(0);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "lists a file that the cargo call of a task run on its own wrote into a folder that its build script names",
    async () => {
      const files = writesIntoNamedFolder("base");
      await inFixture("batch-groups", files, async (workspace) => {
        const { status, output } = await runNx(workspace, ["run", "base:build", "--batch=false"]);
        expect(status).not.toBe(0);
        expect(output).toContain(`base:build: ${failure}`);
        expect(listedFiles(output, "base")).toEqual(namedFolderFiles("base"));
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "skips the check with one warning line where the installed Nx lacks resetWorkspaceContext, in a batch and on its own",
    async () => {
      await inFixture("batch-groups", writesIntoNamedFolder("base"), async (workspace) => {
        // A copy of this repository's Nx whose module of the workspace
        // context does not export resetWorkspaceContext, which nx itself
        // does not call here.
        workspace.useNx(nxVersion);
        const copy = realpathSync(join(workspace.root, "node_modules", "nx"));
        const module = join(copy, "dist", "src", "utils", "workspace-context.js");
        const exported = "exports.resetWorkspaceContext = resetWorkspaceContext;\n";
        const source = readFileSync(module, "utf8");
        expect(source).toContain(exported);
        // The file is a hard link to the real one: replace it, never write through it.
        rmSync(module);
        writeFileSync(module, source.replace(exported, ""));
        const skipped =
          "nx-rust: base:build: the build input check did not run, because the installed Nx lacks resetWorkspaceContext in nx/src/utils/workspace-context, so Nx caches the result without it. Use an Nx version that @convesoft/nx-rust supports, or a version of @convesoft/nx-rust that supports the installed one.";
        for (const args of [
          ["run", "base:build", "--skip-nx-cache"],
          ["run", "base:build", "--batch=false", "--skip-nx-cache"],
        ]) {
          const { status, output } = await runNx(workspace, args);
          expect({ status, output: status === 0 ? "" : output }).toEqual({ status: 0, output: "" });
          expect(
            linesWith(output, "the build input check did not run").map((line) => line.trim()),
          ).toEqual([skipped]);
        }
      });
    },
    HARNESS_TIMEOUT,
  );
});
