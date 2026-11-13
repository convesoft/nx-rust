import { execFileSync } from "node:child_process";
import { lutimesSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  applyFileChanges,
  FileChanges,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  inFixture,
  testEnvironment,
} from "./harness";

// Checks the parts of VER-CACHE-KEYS for declared files that the matrix in
// cache-keys.spec.ts does not: what `nx affected` selects after a commit or
// with --files, declared files that Git or Nx ignores and declared links,
// each hashed twice in one workspace as consecutive runs hash them, and the
// graph-creation errors of REQ-FILE-INPUTS-HASHABLE and DES-INPUTS.
//
// In declared-files, the workspace table declares proto/**/*.proto for every
// member, and api's own table declares docs/banner.txt. app depends on api;
// other depends on neither.

/** The cached targets of a crate and the workspace project's `doc`. */
const cachedTargets = ["build", "check", "lint", "test", "fmt-check", "doc"];

/** The cached tasks of the crates that declare or depend on a file of api's, and their workspace's `doc`. */
const apiAndDependents = [
  ...["api", "app"].flatMap((crate) =>
    ["build", "check", "fmt-check", "lint", "test"].map((target) => `${crate}:${target}`),
  ),
  "rust:doc",
].sort();

/** A change to api's own table that declares `patterns` in place of docs/banner.txt. */
function apiDeclares(...patterns: string[]): FileChanges {
  return {
    "rust/crates/api/Cargo.toml": (manifest) =>
      manifest.replace(
        'fileInputs = ["../../../docs/banner.txt"]',
        `fileInputs = ${JSON.stringify(patterns)}`,
      ),
  };
}

/** Runs git in the workspace, as a user without a configuration of their own would. */
function git(workspace: FixtureWorkspace, ...args: string[]): string {
  const env = testEnvironment();
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    delete env[name];
  }
  return execFileSync(
    "git",
    // What the user's own configuration ignores must not decide what is committed.
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.excludesFile=/dev/null",
      ...args,
    ],
    { cwd: workspace.root, env, encoding: "utf8" },
  );
}

/**
 * Makes the workspace a git repository with one commit of every file, and
 * of `forced`, which Git ignores. The links that the harness puts into the
 * root `node_modules` and Nx's own data stay out of it.
 */
function commitWorkspace(workspace: FixtureWorkspace, forced: string[] = []): void {
  git(workspace, "init", "-q");
  writeFileSync(join(workspace.root, ".git", "info", "exclude"), "/node_modules/\n/.nx/\n");
  git(workspace, "add", "-A");
  if (forced.length > 0) {
    git(workspace, "add", "-f", ...forced);
  }
  git(workspace, "commit", "-q", "-m", "base");
}

/** Applies `changes` and commits every change to a tracked file. */
function commitChanges(workspace: FixtureWorkspace, changes: FileChanges): void {
  applyFileChanges(workspace.root, changes);
  git(workspace, "add", "-A");
  git(workspace, "commit", "-q", "-a", "-m", "change");
}

let graphs = 0;

/**
 * The cached tasks that `nx affected` selects with `args`, without the
 * tasks that those depend on.
 */
async function affectedTasks(workspace: FixtureWorkspace, args: string[]): Promise<string[]> {
  // Outside the repository, so that Nx does not see it.
  const file = join(workspace.root, "..", `affected-${++graphs}.json`);
  const { status, output } = await workspace.nx([
    "affected",
    "-t",
    ...cachedTargets,
    ...args,
    `--graph=${file}`,
  ]);
  expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
  const { tasks } = JSON.parse(readFileSync(file, "utf8"));
  return Object.keys(tasks.tasks)
    .filter((id) => cachedTargets.includes(id.split(":")[1]))
    .sort();
}

/** What a change to one declared file does to the keys of some tasks and to `nx affected`. */
interface DeclaredFileOutcome {
  /** Whether the key of each task changed. */
  keysDiffer: Record<string, boolean>;
  /** What `nx affected` selects for the commit that changed the file. */
  afterCommit: string[];
  /** What `nx affected --files=<file>` selects. */
  withFiles: string[];
}

/**
 * Commits the fixture with `files` and `links`, `changed` also where Git
 * ignores it, hashes `tasks`, by default `api:test` and `app:test`, commits
 * a change to `changed`, hashes them again in the same workspace and asks
 * `nx affected` what the commit and `--files` select.
 */
async function changeDeclaredFile(options: {
  files: FileChanges;
  changed: string;
  links?: Record<string, string>;
  tasks?: string[];
}): Promise<DeclaredFileOutcome> {
  const { tasks = ["api:test", "app:test"] } = options;
  const workspace = FixtureWorkspace.create("declared-files", options.files);
  try {
    for (const [link, target] of Object.entries(options.links ?? {})) {
      symlinkSync(target, join(workspace.root, link));
      // Nx reads a link that changed within the last moment again at the
      // next hash, as it would any such file; a link of a checkout is older.
      const minuteAgo = Date.now() / 1000 - 60;
      lutimesSync(join(workspace.root, link), minuteAgo, minuteAgo);
    }
    commitWorkspace(workspace, [options.changed]);
    const before = await workspace.hashTasks(tasks);
    commitChanges(workspace, { [options.changed]: (current) => `${current ?? ""}changed\n` });
    const after = await workspace.hashTasks(tasks);
    return {
      keysDiffer: Object.fromEntries(
        tasks.map((task) => [task, before[task].value !== after[task].value]),
      ),
      afterCommit: await affectedTasks(workspace, ["--base=HEAD~1", "--head=HEAD"]),
      withFiles: await affectedTasks(workspace, [`--files=${options.changed}`]),
    };
  } finally {
    workspace.remove();
  }
}

const bothDiffer = { "api:test": true, "app:test": true };

describe("declared files", () => {
  it(
    "join the crate's named input after its path dependencies, as filesets that include ignored files",
    () =>
      inFixture(
        "declared-files",
        {
          // The last pattern names the repository root.
          "rust/crates/api/Cargo.toml": (manifest) =>
            manifest
              .replace(
                'fileInputs = ["../../../docs/banner.txt"]',
                'fileInputs = ["./../../../docs/./banner.txt", "../../../vendor/*/./data/**", "../../.."]',
              )
              .concat('\n[dependencies]\nlexer = { path = "../../../vendor/lexer" }\n'),
          "vendor/lexer/Cargo.toml":
            '[package]\nname = "lexer"\nversion = "0.1.0"\nedition = "2024"\n\n[workspace]\n',
          "vendor/lexer/src/lib.rs": "",
          "nx.json": (text) =>
            JSON.stringify({
              ...JSON.parse(text),
              plugins: JSON.parse(text).plugins.map((plugin: string) => ({
                plugin,
                exclude: ["vendor/**"],
              })),
            }),
        },
        async (workspace) => {
          const graph = await workspace.graph();
          const declared = (fileset: string) => ({ fileset, includeIgnored: true });

          expect(graph.projects.api.namedInputs).toEqual({
            default: [
              "{projectRoot}/**/*",
              "{workspaceRoot}/rust/Cargo.toml",
              "{workspaceRoot}/vendor/lexer/**/*",
              declared("{workspaceRoot}/proto/**/*.proto"),
              declared("{workspaceRoot}/docs/banner.txt"),
              declared("{workspaceRoot}/vendor/*/data/**"),
              declared("{workspaceRoot}/**/*"),
            ],
          });
          // A dependent hashes them through ^default, and the workspace
          // project through its dependency on every member.
          expect(graph.projects.app.namedInputs.default).toEqual([
            "{projectRoot}/**/*",
            "{workspaceRoot}/rust/Cargo.toml",
            declared("{workspaceRoot}/proto/**/*.proto"),
          ]);
          expect(graph.projects.rust.namedInputs.default).toEqual([
            "{projectRoot}/**/*",
            "!{projectRoot}/Cargo.lock",
          ]);
        },
      ),
    HARNESS_TIMEOUT,
  );

  it(
    "resolve an absolute pattern, links to a file or a folder inside the repository and a path below a file to the links they pass and their real paths",
    () =>
      inFixture("declared-files", { "shared/real/schema.sql": "" }, async (workspace) => {
        symlinkSync("real", join(workspace.root, "shared", "linked"));
        symlinkSync("banner.txt", join(workspace.root, "docs", "alias.txt"));
        // A ".." after this link leaves nested/inner, as the system reads it.
        mkdirSync(join(workspace.root, "nested", "inner"), { recursive: true });
        symlinkSync("../nested/inner", join(workspace.root, "shared", "deep"));
        applyFileChanges(
          workspace.root,
          apiDeclares(
            join(workspace.root, "shared", "real", "schema.sql"),
            "../../../shared/linked/*.sql",
            "../../../shared/linked/schema.sql",
            "../../../docs/alias.txt",
            "../../../shared/deep/../b.txt",
            // Below a file: no such file exists, and none is hashed.
            "../../../docs/banner.txt/part",
          ),
        );
        const graph = await workspace.graph();

        const declared = (path: string) => ({
          fileset: `{workspaceRoot}/${path}`,
          includeIgnored: true,
        });

        // Each link that a pattern passes, where it lies, then the real
        // path; each fileset once.
        expect(graph.projects.api.namedInputs.default).toEqual([
          "{projectRoot}/**/*",
          "{workspaceRoot}/rust/Cargo.toml",
          declared("proto/**/*.proto"),
          declared("shared/real/schema.sql"),
          declared("shared/linked"),
          declared("shared/real/*.sql"),
          declared("docs/alias.txt"),
          declared("docs/banner.txt"),
          declared("shared/deep"),
          declared("nested/b.txt"),
          declared("docs/banner.txt/part"),
        ]);
      }),
    HARNESS_TIMEOUT,
  );

  describe("in nx affected", () => {
    it(
      "select the cached tasks of the crate that declares the file, of its dependents and their workspace's doc",
      async () => {
        const outcome = await changeDeclaredFile({ files: {}, changed: "docs/banner.txt" });

        expect(outcome).toEqual({
          keysDiffer: bothDiffer,
          afterCommit: apiAndDependents,
          withFiles: apiAndDependents,
        });
      },
      HARNESS_TIMEOUT,
    );

    it(
      "select the tasks of every member for a file that the workspace table declares",
      async () => {
        const outcome = await changeDeclaredFile({ files: {}, changed: "proto/greeting.proto" });
        const everyMember = [
          ...["api", "app", "other"].flatMap((crate) =>
            ["build", "check", "fmt-check", "lint", "test"].map((target) => `${crate}:${target}`),
          ),
          "rust:doc",
        ].sort();

        expect(outcome.afterCommit).toEqual(everyMember);
        expect(outcome.withFiles).toEqual(everyMember);
      },
      HARNESS_TIMEOUT,
    );
  });

  describe("that Git or Nx ignores", () => {
    it(
      "change the keys but select no task when the root .gitignore ignores the file",
      async () => {
        const outcome = await changeDeclaredFile({
          files: {
            ".gitignore": (current) => `${current}generated/\n`,
            "generated/schema.json": "{}\n",
            ...apiDeclares("../../../generated/schema.json"),
          },
          changed: "generated/schema.json",
        });

        expect(outcome).toEqual({ keysDiffer: bothDiffer, afterCommit: [], withFiles: [] });
      },
      HARNESS_TIMEOUT,
    );

    it(
      "change the keys but select no task when the root .nxignore ignores the file",
      async () => {
        const outcome = await changeDeclaredFile({
          files: {
            ".nxignore": "nxig/\n",
            "nxig/n.txt": "n\n",
            ...apiDeclares("../../../nxig/n.txt"),
          },
          changed: "nxig/n.txt",
        });

        expect(outcome).toEqual({ keysDiffer: bothDiffer, afterCommit: [], withFiles: [] });
      },
      HARNESS_TIMEOUT,
    );

    it(
      "change the keys and select the tasks when only a .gitignore in a subfolder ignores the file",
      async () => {
        const outcome = await changeDeclaredFile({
          files: {
            "nested/.gitignore": "sub/\n",
            "nested/sub/h.txt": "h\n",
            ...apiDeclares("../../../nested/sub/h.txt"),
          },
          changed: "nested/sub/h.txt",
        });

        expect(outcome).toEqual({
          keysDiffer: bothDiffer,
          afterCommit: apiAndDependents,
          withFiles: apiAndDependents,
        });
      },
      HARNESS_TIMEOUT,
    );

    it(
      "change the keys and select the tasks when only Nx's exclusion of node_modules folders covers the file",
      async () => {
        const outcome = await changeDeclaredFile({
          files: {
            "vendor/node_modules/f.txt": "f\n",
            ...apiDeclares("../../../vendor/node_modules/f.txt"),
          },
          changed: "vendor/node_modules/f.txt",
        });

        expect(outcome).toEqual({
          keysDiffer: bothDiffer,
          afterCommit: apiAndDependents,
          withFiles: apiAndDependents,
        });
      },
      HARNESS_TIMEOUT,
    );
  });

  describe("through a symbolic link", () => {
    // Nx keeps the hash of a link's destination until the link itself
    // changes or `nx reset` clears it (EVD-NX-24-FILE-INPUTS), so the
    // workspace is hashed twice without a reset in between, and the link is
    // older than the moment within which Nx reads it again.
    const compiling = ["api:build", "api:check", "api:lint", "api:test", "rust:doc"];

    it(
      "change the keys of check, lint, test, build and doc and select the tasks when the link is declared in place of the file it points to",
      async () => {
        const outcome = await changeDeclaredFile({
          files: apiDeclares("../../../docs/alias.txt"),
          links: { "docs/alias.txt": "banner.txt" },
          changed: "docs/banner.txt",
          tasks: compiling,
        });

        expect(outcome).toEqual({
          keysDiffer: Object.fromEntries(compiling.map((task) => [task, true])),
          afterCommit: apiAndDependents,
          withFiles: apiAndDependents,
        });
      },
      HARNESS_TIMEOUT,
    );

    it(
      "change the keys and select the tasks when the fixed part of the pattern runs through a link to a folder",
      async () => {
        const outcome = await changeDeclaredFile({
          files: {
            "shared/real/schema.sql": "create table api ();\n",
            ...apiDeclares("../../../shared/linked/*.sql"),
          },
          links: { "shared/linked": "real" },
          changed: "shared/real/schema.sql",
          tasks: compiling,
        });

        expect(outcome).toEqual({
          keysDiffer: Object.fromEntries(compiling.map((task) => [task, true])),
          afterCommit: apiAndDependents,
          withFiles: apiAndDependents,
        });
      },
      HARNESS_TIMEOUT,
    );
  });

  describe("through a symbolic link that is replaced", () => {
    /**
     * Commits the fixture with `files` and the link `link` to `first`,
     * hashes the cached tasks of api and the workspace's doc, replaces the
     * link by one to `second`, commits only that, and hashes and asks
     * `nx affected` again; then commits a change to `changed`, a file that
     * the new link leads to, and does the same.
     */
    async function replaceLink(
      files: FileChanges,
      link: string,
      [first, second]: [string, string],
      changed: string,
    ) {
      const tasks = ["api:build", "api:check", "api:lint", "api:test", "rust:doc"];
      const workspace = FixtureWorkspace.create("declared-files", files);
      const differ = (before: Record<string, { value: string }>, after: typeof before) =>
        Object.fromEntries(tasks.map((task) => [task, before[task].value !== after[task].value]));
      try {
        symlinkSync(first, join(workspace.root, link));
        const minuteAgo = Date.now() / 1000 - 60;
        lutimesSync(join(workspace.root, link), minuteAgo, minuteAgo);
        commitWorkspace(workspace);
        const before = await workspace.hashTasks(tasks);
        rmSync(join(workspace.root, link));
        symlinkSync(second, join(workspace.root, link));
        git(workspace, "add", link);
        git(workspace, "commit", "-q", "-m", "replace the link");
        const replaced = await workspace.hashTasks(tasks);
        const linkChange = {
          keysDiffer: differ(before, replaced),
          afterCommit: await affectedTasks(workspace, ["--base=HEAD~1", "--head=HEAD"]),
          withFiles: await affectedTasks(workspace, [`--files=${link}`]),
        };
        commitChanges(workspace, { [changed]: (current) => `${current ?? ""}changed\n` });
        const after = await workspace.hashTasks(tasks);
        const targetChange = {
          keysDiffer: differ(replaced, after),
          afterCommit: await affectedTasks(workspace, ["--base=HEAD~1", "--head=HEAD"]),
        };
        return { linkChange, targetChange };
      } finally {
        workspace.remove();
      }
    }

    const everyKeyDiffers = Object.fromEntries(
      ["api:build", "api:check", "api:lint", "api:test", "rust:doc"].map((task) => [task, true]),
    );

    it(
      "change the keys and select the tasks when a declared link to a file is replaced, and again when its new target changes",
      async () => {
        const outcome = await replaceLink(
          { "docs/alternate.txt": "Other\n", ...apiDeclares("../../../docs/alias.txt") },
          "docs/alias.txt",
          ["banner.txt", "alternate.txt"],
          "docs/alternate.txt",
        );

        expect(outcome).toEqual({
          linkChange: {
            keysDiffer: everyKeyDiffers,
            afterCommit: apiAndDependents,
            withFiles: apiAndDependents,
          },
          targetChange: { keysDiffer: everyKeyDiffers, afterCommit: apiAndDependents },
        });
      },
      HARNESS_TIMEOUT,
    );

    it(
      "change the keys and select the tasks when a link to a folder that a pattern runs through is replaced, and again when a file of its new target changes",
      async () => {
        const outcome = await replaceLink(
          {
            "shared/real/schema.sql": "create table api ();\n",
            "shared/other/schema.sql": "create table other ();\n",
            ...apiDeclares("../../../shared/linked/*.sql"),
          },
          "shared/linked",
          ["real", "other"],
          "shared/other/schema.sql",
        );

        expect(outcome).toEqual({
          linkChange: {
            keysDiffer: everyKeyDiffers,
            afterCommit: apiAndDependents,
            withFiles: apiAndDependents,
          },
          targetChange: { keysDiffer: everyKeyDiffers, afterCommit: apiAndDependents },
        });
      },
      HARNESS_TIMEOUT,
    );
  });

  describe("of a crate without a project", () => {
    // vendor/lexer is excluded from the plugin and has a workspace of its
    // own; api depends on it by path and app on api.
    const withLexer = (lexerManifest: string): FileChanges => ({
      "rust/crates/api/Cargo.toml": (manifest) =>
        `${manifest}\n[dependencies]\nlexer = { path = "../../../vendor/lexer" }\n`,
      "vendor/lexer/Cargo.toml": lexerManifest,
      "vendor/lexer/src/lib.rs":
        'pub const TEXT: &str = include_str!("../../../shared/input.txt");\n',
      "shared/input.txt": "good",
      "nx.json": (text) =>
        JSON.stringify({
          ...JSON.parse(text),
          plugins: JSON.parse(text).plugins.map((plugin: string) => ({
            plugin,
            exclude: ["vendor/**"],
          })),
        }),
    });
    const lexer = '[package]\nname = "lexer"\nversion = "0.1.0"\nedition = "2024"\n\n[workspace]\n';

    it.each([
      [
        "its own table",
        `${lexer}\n[package.metadata.nx]\nfileInputs = ["../../shared/input.txt"]\n`,
      ],
      [
        "its workspace's table",
        `${lexer}\n[workspace.metadata.nx]\nfileInputs = ["../../shared/input.txt"]\n`,
      ],
    ])(
      "change the keys of the crates that depend on it and select their tasks for a file that %s declares",
      async (_table, manifest) => {
        const outcome = await changeDeclaredFile({
          files: withLexer(manifest),
          changed: "shared/input.txt",
        });

        expect(outcome).toEqual({
          keysDiffer: bothDiffer,
          afterCommit: apiAndDependents,
          withFiles: apiAndDependents,
        });
      },
      HARNESS_TIMEOUT,
    );

    it(
      "fail graph creation for a pattern that Nx cannot hash, naming its manifest",
      () =>
        inFixture(
          "declared-files",
          withLexer(`${lexer}\n[package.metadata.nx]\nfileInputs = ["../../../outside.txt"]\n`),
          async (workspace) => {
            const error = await workspace.graph().then(
              () => undefined,
              (error: unknown) => error,
            );

            expect(error).toBeInstanceOf(GraphCreationError);
            expect((error as Error).message).toContain(
              `vendor/lexer/Cargo.toml: the fileInputs pattern "../../../outside.txt" resolves to ${dirname(workspace.root)}/outside.txt, outside the repository, whose files Nx does not track.`,
            );
          },
        ),
      HARNESS_TIMEOUT,
    );
  });

  describe("that Nx cannot hash", () => {
    /** The message of the graph-creation error for each manifest and pattern, in order. */
    async function graphErrors(workspace: FixtureWorkspace): Promise<string[]> {
      const error = await workspace.graph().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(error).toBeInstanceOf(GraphCreationError);
      // Nx lists each plugin error, and then repeats it, so each message is taken once.
      const lines = (error as Error).message
        .split("\n")
        .filter((line) => line.includes("the fileInputs pattern"))
        .map((line) => line.replace(/^\s*(- )?/, ""));
      return [...new Set(lines)];
    }

    const runtimeAdvice =
      "To key the crate's tasks on such files, add a command to runtimeInputs that prints them or a hash of them; nx affected does not see a change to its output.";

    it(
      "fail graph creation for patterns that resolve outside the repository, naming each manifest and pattern once",
      () =>
        inFixture(
          "declared-files",
          {
            "rust/Cargo.toml": (manifest) =>
              manifest.replace(
                'fileInputs = ["../proto/**/*.proto"]',
                'fileInputs = ["../proto/**/*.proto", "../../shared/**/*.proto"]',
              ),
          },
          async (workspace) => {
            const outside = dirname(workspace.root);
            mkdirSync(join(outside, "elsewhere"));
            writeFileSync(join(outside, "elsewhere", "file.txt"), "");
            symlinkSync(join(outside, "elsewhere"), join(workspace.root, "docs", "linked"));
            symlinkSync(
              join(outside, "elsewhere", "file.txt"),
              join(workspace.root, "docs", "file-link.txt"),
            );
            // A link to a folder that does not exist yet.
            symlinkSync(join(outside, "later"), join(workspace.root, "docs", "later"));
            applyFileChanges(
              workspace.root,
              apiDeclares(
                "../../../docs/banner.txt",
                "../../../../outside.txt",
                join(outside, "elsewhere", "*.txt"),
                "../../../docs/linked/file.txt",
                "../../../docs/file-link.txt",
                "../../../docs/later/*.txt",
              ),
            );

            expect(await graphErrors(workspace)).toEqual([
              `rust/Cargo.toml: the fileInputs pattern "../../shared/**/*.proto" resolves to ${outside}/shared/**/*.proto, outside the repository, whose files Nx does not track. ${runtimeAdvice}`,
              `rust/crates/api/Cargo.toml: the fileInputs pattern "../../../../outside.txt" resolves to ${outside}/outside.txt, outside the repository, whose files Nx does not track. ${runtimeAdvice}`,
              `rust/crates/api/Cargo.toml: the fileInputs pattern "${outside}/elsewhere/*.txt" resolves to ${outside}/elsewhere/*.txt, outside the repository, whose files Nx does not track. ${runtimeAdvice}`,
              `rust/crates/api/Cargo.toml: the fileInputs pattern "../../../docs/linked/file.txt" resolves to ${outside}/elsewhere/file.txt, outside the repository, whose files Nx does not track. ${runtimeAdvice}`,
              `rust/crates/api/Cargo.toml: the fileInputs pattern "../../../docs/file-link.txt" resolves to ${outside}/elsewhere/file.txt, outside the repository, whose files Nx does not track. ${runtimeAdvice}`,
              `rust/crates/api/Cargo.toml: the fileInputs pattern "../../../docs/later/*.txt" resolves to ${outside}/later/*.txt, outside the repository, whose files Nx does not track. ${runtimeAdvice}`,
            ]);
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "fail graph creation for patterns with a .. segment after a glob character",
      () =>
        inFixture(
          "declared-files",
          apiDeclares("../../../proto/*/../greeting.proto", "../../../{docs,..}/banner.txt"),
          async (workspace) => {
            const advice =
              'has a ".." segment after a glob character, so that nx-rust cannot tell which folder it reaches, and Nx cannot hash it. Put every ".." before the first glob character, such as "*", "?" or "{".';

            expect(await graphErrors(workspace)).toEqual([
              `rust/crates/api/Cargo.toml: the fileInputs pattern "../../../proto/*/../greeting.proto" ${advice}`,
              `rust/crates/api/Cargo.toml: the fileInputs pattern "../../../{docs,..}/banner.txt" ${advice}`,
            ]);
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "fail graph creation for patterns that resolve into the workspace's build or artifact directory",
      () =>
        inFixture(
          "declared-files",
          {
            "rust/.cargo/config.toml": '[build]\nbuild-dir = "build-cache"\n',
            ...apiDeclares(
              "../../target/debug/api",
              "../../build-cache/**/output",
              "../../../docs/output-link.txt",
            ),
            "rust/crates/other/Cargo.toml": (manifest) =>
              `${manifest}\n[package.metadata.nx]\nfileInputs = ["../../target"]\n`,
          },
          async (workspace) => {
            // A link inside the repository to a file that a build writes.
            symlinkSync(
              "../rust/target/debug/output.txt",
              join(workspace.root, "docs", "output-link.txt"),
            );

            expect(await graphErrors(workspace)).toEqual([
              'rust/crates/api/Cargo.toml: the fileInputs pattern "../../target/debug/api" resolves into rust/target, Cargo\'s artifact directory of the Cargo workspace in rust. Cargo writes the files there; declare the files that they are made from instead.',
              'rust/crates/api/Cargo.toml: the fileInputs pattern "../../build-cache/**/output" resolves into rust/build-cache, Cargo\'s build directory of the Cargo workspace in rust. Cargo writes the files there; declare the files that they are made from instead.',
              'rust/crates/api/Cargo.toml: the fileInputs pattern "../../../docs/output-link.txt" resolves into rust/target, Cargo\'s artifact directory of the Cargo workspace in rust. Cargo writes the files there; declare the files that they are made from instead.',
              'rust/crates/other/Cargo.toml: the fileInputs pattern "../../target" resolves into rust/target, Cargo\'s artifact directory of the Cargo workspace in rust. Cargo writes the files there; declare the files that they are made from instead.',
            ]);
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "name a directory that is both Cargo's build and artifact directory as such",
      () =>
        inFixture("declared-files", apiDeclares("../../target/**/*.rs"), async (workspace) => {
          expect(await graphErrors(workspace)).toEqual([
            'rust/crates/api/Cargo.toml: the fileInputs pattern "../../target/**/*.rs" resolves into rust/target, Cargo\'s build and artifact directory of the Cargo workspace in rust. Cargo writes the files there; declare the files that they are made from instead.',
          ]);
        }),
      HARNESS_TIMEOUT,
    );
  });
});
