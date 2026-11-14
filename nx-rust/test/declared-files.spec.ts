import { execFileSync } from "node:child_process";
import { lutimesSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { patternsBelow } from "../src/graph/declared-files";
import {
  applyFileChanges,
  FileChanges,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  inFixture,
  testEnvironment,
  withoutColours,
} from "./harness";

// Checks the parts of VER-CACHE-KEYS for declared files that the matrix in
// cache-keys.spec.ts does not: what `nx affected` selects after a commit or
// with --files, declared files that Git or Nx ignores and declared links,
// each hashed twice in one workspace as consecutive runs hash them, patterns
// that name files of other projects, and the graph-creation errors of
// REQ-FILE-INPUTS-HASHABLE and DES-INPUTS.
//
// In declared-files, the workspace table declares proto/**/*.proto for every
// member, and api's own table declares docs/banner.txt. app depends on api;
// other depends on neither. rust is the folder of the workspace project rust.

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

/** What a commit that changes one file does to the keys of some tasks and to `nx affected`. */
interface FileChangeOutcome extends DeclaredFileOutcome {
  /** The file that the commit changed. */
  changed: string;
}

/**
 * Commits the fixture with `files`, then for each file of `changed` in turn
 * hashes `tasks`, commits a change to the file, hashes them again in the
 * same workspace and asks `nx affected` what the commit and `--files` select.
 */
async function changeFilesInTurn(options: {
  fixture?: "declared-files" | "undeclared-files";
  files: FileChanges;
  changed: string[];
  tasks: string[];
}): Promise<FileChangeOutcome[]> {
  const workspace = FixtureWorkspace.create(options.fixture ?? "declared-files", options.files);
  try {
    commitWorkspace(workspace);
    const outcomes: FileChangeOutcome[] = [];
    for (const changed of options.changed) {
      const before = await workspace.hashTasks(options.tasks);
      commitChanges(workspace, { [changed]: (current) => `${current ?? ""}// changed\n` });
      const after = await workspace.hashTasks(options.tasks);
      outcomes.push({
        changed,
        keysDiffer: Object.fromEntries(
          options.tasks.map((task) => [task, before[task].value !== after[task].value]),
        ),
        afterCommit: await affectedTasks(workspace, ["--base=HEAD~1", "--head=HEAD"]),
        withFiles: await affectedTasks(workspace, [`--files=${changed}`]),
      });
    }
    return outcomes;
  } finally {
    workspace.remove();
  }
}

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

  describe("of a crate with a project behind a crate without one", () => {
    // bridge, a member of rust that nx.json excludes, depends on api by path,
    // and the standalone crate cross depends on bridge: cross builds api.
    const withBridge: FileChanges = {
      "rust/crates/bridge/Cargo.toml":
        '[package]\nname = "bridge"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\napi = { path = "../api" }\n',
      "rust/crates/bridge/src/lib.rs": "pub fn text() -> &'static str {\n    api::banner()\n}\n",
      "cross/Cargo.toml":
        '[package]\nname = "cross"\nversion = "0.1.0"\nedition = "2024"\n\n[workspace]\n\n[dependencies]\nbridge = { path = "../rust/crates/bridge" }\n',
      "cross/src/lib.rs":
        '#[test]\nfn reads_the_banner() {\n    assert_eq!(bridge::text(), "Built with nx-rust");\n}\n',
      "nx.json": (text) =>
        JSON.stringify({
          ...JSON.parse(text),
          plugins: JSON.parse(text).plugins.map((plugin: string) => ({
            plugin,
            exclude: ["rust/crates/bridge/**"],
          })),
        }),
    };
    // The cached tasks of api, of the crates that build it and of rust's doc.
    const withCross = [
      ...apiAndDependents,
      ...["build", "check", "doc", "fmt-check", "lint", "test"].map((target) => `cross:${target}`),
    ].sort();

    it.each([
      ["a source file of api", "rust/crates/api/src/lib.rs"],
      ["a file that api declares", "docs/banner.txt"],
    ])(
      "change the keys of the crate that reaches it and select its tasks for %s",
      async (_file, changed) => {
        const outcome = await changeDeclaredFile({
          files: withBridge,
          changed,
          tasks: ["cross:test"],
        });

        expect(outcome).toEqual({
          keysDiffer: { "cross:test": true },
          afterCommit: withCross,
          withFiles: withCross,
        });
      },
      HARNESS_TIMEOUT,
    );

    it(
      "change the keys of the crate that reaches it and select its tasks where paths pass a symbolic link",
      async () => {
        // Four standalone crates: a -> b -> p -> q, with b excluded. alias is
        // a link to p, and both b's dependency and a's dev-dependency on p
        // name it: cargo builds q for a, through b and directly.
        const crate = (name: string, ...lines: string[]) =>
          [
            `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n\n[workspace]\n`,
            ...lines,
          ].join("\n");
        const files: FileChanges = {
          "a/Cargo.toml": crate(
            "a",
            '[dependencies]\nb = { path = "../b" }\n',
            '[dev-dependencies]\np = { path = "../alias" }\n',
          ),
          "a/src/lib.rs": "pub fn a() -> u8 {\n    b::b()\n}\n",
          "b/Cargo.toml": crate("b", '[dependencies]\np = { path = "../alias" }\n'),
          "b/src/lib.rs": "pub fn b() -> u8 {\n    p::p()\n}\n",
          "p/Cargo.toml": crate("p", '[dependencies]\nq = { path = "../q" }\n'),
          "p/src/lib.rs": "pub fn p() -> u8 {\n    q::q()\n}\n",
          "q/Cargo.toml": crate("q"),
          "q/src/lib.rs": "pub fn q() -> u8 {\n    1\n}\n",
          "nx.json": (text) =>
            JSON.stringify({
              ...JSON.parse(text),
              plugins: JSON.parse(text).plugins.map((plugin: string) => ({
                plugin,
                exclude: ["b/**"],
              })),
            }),
        };
        const aTasks = ["a:build", "a:check", "a:lint", "a:test"];

        const outcome = await changeDeclaredFile({
          files,
          changed: "q/src/lib.rs",
          links: { alias: "p" },
          tasks: aTasks,
        });

        const selected = ["a", "p", "q"]
          .flatMap((project) =>
            ["build", "check", "doc", "fmt-check", "lint", "test"].map(
              (target) => `${project}:${target}`,
            ),
          )
          .sort();
        expect(outcome).toEqual({
          keysDiffer: Object.fromEntries(aTasks.map((task) => [task, true])),
          afterCommit: selected,
          withFiles: selected,
        });
      },
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

  describe("that name files of other projects", () => {
    // A pattern of api that starts in rust/crates starts inside the folder of
    // the workspace project rust, so that Nx matches it against rust's own
    // files only (EVD-NX-24-FILESET-SCOPE). The filesets for the folders of
    // the crates below are what reach their files.

    /** The tasks of api that compile, and its workspace's doc. */
    const apiCompiling = ["api:build", "api:check", "api:lint", "api:test", "rust:doc"];
    const everyKeyDiffers = Object.fromEntries(apiCompiling.map((task) => [task, true]));
    const declared = (path: string) => ({
      fileset: `{workspaceRoot}/${path}`,
      includeIgnored: true,
    });
    /** A change to the workspace table that declares `pattern` beside proto/**\/*.proto. */
    const workspaceDeclares = (pattern: string): FileChanges => ({
      "rust/Cargo.toml": (manifest) =>
        manifest.replace(
          'fileInputs = ["../proto/**/*.proto"]',
          `fileInputs = ["../proto/**/*.proto", ${JSON.stringify(pattern)}]`,
        ),
    });

    it(
      "give a fileset for each folder of the plugin's projects below where a pattern starts, unless it starts at the repository root",
      () =>
        inFixture(
          "declared-files",
          {
            ...workspaceDeclares("crates/*/templates/**"),
            ...apiDeclares(
              "../*/src/**",
              "../a*/src/main.rs",
              "../app/**",
              "../../../*/banner.txt",
            ),
          },
          async (workspace) => {
            const graph = await workspace.graph();
            const templates = [
              declared("rust/crates/*/templates/**"),
              ...["api", "app", "other"].map((crate) =>
                declared(`rust/crates/${crate}/templates/**`),
              ),
            ];

            expect(graph.projects.api.namedInputs.default).toEqual([
              "{projectRoot}/**/*",
              "{workspaceRoot}/rust/Cargo.toml",
              declared("proto/**/*.proto"),
              ...templates,
              declared("rust/crates/*/src/**"),
              declared("rust/crates/api/src/**"),
              declared("rust/crates/app/src/**"),
              declared("rust/crates/other/src/**"),
              declared("rust/crates/a*/src/main.rs"),
              declared("rust/crates/api/src/main.rs"),
              declared("rust/crates/app/src/main.rs"),
              declared("rust/crates/app/**"),
              declared("*/banner.txt"),
            ]);
            expect(graph.projects.other.namedInputs.default).toEqual([
              "{projectRoot}/**/*",
              "{workspaceRoot}/rust/Cargo.toml",
              declared("proto/**/*.proto"),
              ...templates,
            ]);
          },
        ),
      HARNESS_TIMEOUT,
    );

    // rust/crates/assets is no crate: the workspace excludes it, and its
    // files belong to the workspace project rust.
    const sibling = "rust/crates/app/src/main.rs";
    const noCrate = "rust/crates/assets/src/main.rs";
    const withFilesOfNoCrate: FileChanges = {
      "rust/Cargo.toml": (manifest) =>
        manifest.replace(
          'members = ["crates/*"]',
          'members = ["crates/*"]\nexclude = ["crates/assets"]',
        ),
      [noCrate]: "fn main() {}\n",
      "rust/banner.txt": "Built in rust\n",
    };

    it.each([
      ["../app/src/main.rs", [sibling]],
      ["../app/**", [sibling]],
      ["../*/**", [sibling, noCrate]],
      ["../*/**/*", [sibling, noCrate]],
      ["../*/src/**", [sibling, noCrate]],
      ["../*/src/main.rs", [sibling, noCrate]],
      ["../a*/src/main.rs", [sibling, noCrate]],
      // rust/banner.txt is a file of the project rust, docs/banner.txt one of no project.
      ["../../../*/banner.txt", ["rust/banner.txt", "docs/banner.txt"]],
    ])(
      "change the keys of check, lint, test, build and doc and select the tasks for each file of another project and of no crate that %s names",
      async (pattern, changed) => {
        const outcomes = await changeFilesInTurn({
          files: { ...withFilesOfNoCrate, ...apiDeclares(pattern) },
          changed,
          tasks: apiCompiling,
        });

        expect(outcomes).toEqual(
          changed.map((file) => ({
            changed: file,
            keysDiffer: everyKeyDiffers,
            afterCommit: apiAndDependents,
            withFiles: apiAndDependents,
          })),
        );
      },
      HARNESS_TIMEOUT,
    );

    it(
      "change the keys of a crate's tasks and select them for a file of a crate it does not depend on, and of no crate, that ../** names",
      async () => {
        // In undeclared-files, reader depends on base only.
        const readerCompiling = ["reader:build", "reader:check", "reader:lint", "reader:test"];
        const outcomes = await changeFilesInTurn({
          fixture: "undeclared-files",
          files: {
            "rust/crates/reader/Cargo.toml": (manifest = "") =>
              `${manifest}\n[package.metadata.nx]\nfileInputs = ["../**"]\n`,
            "rust/crates/notes.txt": "notes\n",
          },
          changed: ["rust/crates/plain/src/lib.rs", "rust/crates/notes.txt"],
          tasks: [...readerCompiling, "rust:doc"],
        });

        for (const outcome of outcomes) {
          expect(outcome.keysDiffer).toEqual(
            Object.fromEntries([...readerCompiling, "rust:doc"].map((task) => [task, true])),
          );
          expect(outcome.afterCommit).toEqual(
            expect.arrayContaining([...readerCompiling, "rust:doc"]),
          );
          expect(outcome.withFiles).toEqual(outcome.afterCommit);
        }
      },
      HARNESS_TIMEOUT,
    );

    /** The lines of the graph-creation error about a project folder that a pattern names. */
    async function uncoveredFolderErrors(workspace: FixtureWorkspace): Promise<string[]> {
      const error = await workspace.graph().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(error).toBeInstanceOf(GraphCreationError);
      const lines = (error as Error).message
        .split("\n")
        .filter((line) => line.includes("which Nx would leave out of the cache keys"))
        .map((line) => line.replace(/^.*?(?=rust\/)/, ""));
      return [...new Set(lines)];
    }

    // web is a project of its own, from a project.json, inside app's folder.
    const withWeb: FileChanges = {
      "rust/crates/app/web/project.json": JSON.stringify({ name: "web" }),
      "rust/crates/app/web/index.js": "export {};\n",
    };
    const remedyOf = (manifest: string, root: string, owner: string, ...lines: string[]) =>
      [
        `The pattern starts in ${root}, inside the folder of the project "${owner}", and Nx matches such a pattern only against that project's own files, not against those of a project in a folder below it.`,
        `nx-rust adds a pattern for the folder of each project that it creates, but "web" comes from another plugin or entry.`,
        `Add ${lines.join(" and ")} beside it in the fileInputs of ${manifest}, or narrow the pattern so that it does not reach rust/crates/app/web.`,
      ].join(" ");

    it(
      "fail graph creation for a pattern that names files of another plugin's project in a folder below where it starts, naming the crates and the pattern to add",
      () =>
        inFixture(
          "declared-files",
          {
            ...withWeb,
            ...workspaceDeclares("crates/*/w*/**"),
            ...apiDeclares("../app/**", "../*/src/**"),
          },
          async (workspace) => {
            expect(await uncoveredFolderErrors(workspace)).toEqual([
              `rust/Cargo.toml: the fileInputs pattern "crates/*/w*/**" of the crates api, app and other names files in rust/crates/app/web, the folder of the project "web", which Nx would leave out of the cache keys. ${remedyOf("rust/Cargo.toml", "rust/crates", "rust", '"crates/app/web/**"')}`,
              `rust/crates/api/Cargo.toml: the fileInputs pattern "../app/**" of the crate api names files in rust/crates/app/web, the folder of the project "web", which Nx would leave out of the cache keys. ${remedyOf("rust/crates/api/Cargo.toml", "rust/crates/app", "app", '"../app/web/**"')}`,
            ]);
          },
        ),
      HARNESS_TIMEOUT,
    );

    it(
      "change the keys and select the tasks for a file of another plugin's project once the manifest adds the pattern that the error shows",
      async () => {
        const outcomes = await changeFilesInTurn({
          files: { ...withWeb, ...apiDeclares("../app/**", "../app/web/**") },
          changed: ["rust/crates/app/web/index.js"],
          tasks: apiCompiling,
        });

        expect(outcomes).toEqual([
          {
            changed: "rust/crates/app/web/index.js",
            keysDiffer: everyKeyDiffers,
            afterCommit: apiAndDependents,
            withFiles: apiAndDependents,
          },
        ]);
      },
      HARNESS_TIMEOUT,
    );

    it(
      "cover a crate added later in a folder that a pattern names, and fail graph creation for a project.json added there, with the Nx daemon",
      async () => {
        const daemon = { NX_DAEMON: "true" };
        const workspace = FixtureWorkspace.create("declared-files", {
          "rust/Cargo.toml": (manifest) =>
            manifest.replace(
              'members = ["crates/*"]',
              'members = ["crates/*"]\nexclude = ["crates/web"]',
            ),
          ...apiDeclares("../*/src/**"),
        });
        /** api's named input `default` as the daemon's graph has it, once `ready` accepts it. */
        const apiInputs = async (ready: (inputs: unknown[]) => boolean): Promise<unknown[]> => {
          let inputs: unknown[] = [];
          // The daemon recomputes the graph once its watcher reports the change.
          for (let attempt = 0; attempt < 60; attempt++) {
            const { status, output } = await workspace.nx(
              ["show", "project", "api", "--json"],
              daemon,
            );
            expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
            inputs = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1))
              .namedInputs.default;
            if (ready(inputs)) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          return inputs;
        };
        const extra = declared("rust/crates/extra/src/**");
        try {
          expect(await apiInputs(() => true)).not.toContainEqual(extra);

          applyFileChanges(workspace.root, {
            "rust/crates/extra/Cargo.toml":
              '[package]\nname = "extra"\nversion = "0.1.0"\nedition = "2024"\n',
            "rust/crates/extra/src/lib.rs": "",
          });
          expect(
            await apiInputs((inputs) =>
              inputs.some((input) => JSON.stringify(input) === JSON.stringify(extra)),
            ),
          ).toContainEqual(extra);

          applyFileChanges(workspace.root, {
            "rust/crates/web/project.json": JSON.stringify({ name: "web" }),
            "rust/crates/web/src/index.js": "export {};\n",
          });
          let failed = { status: 0 as number | null, output: "" };
          for (let attempt = 0; attempt < 60 && failed.status === 0; attempt++) {
            failed = await workspace.nx(["show", "projects"], daemon);
            if (failed.status === 0) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }
          expect(failed.status).not.toBe(0);
          expect(withoutColours(failed.output)).toContain(
            'rust/crates/api/Cargo.toml: the fileInputs pattern "../*/src/**" of the crate api names files in rust/crates/web, the folder of the project "web", which Nx would leave out of the cache keys.',
          );
          expect(withoutColours(failed.output)).toContain(
            'Add "../web/src/**" beside it in the fileInputs of rust/crates/api/Cargo.toml',
          );
        } finally {
          await workspace.nx(["daemon", "--stop"], daemon);
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });

  describe("patternsBelow", () => {
    it.each([
      ["*/**", ["app"], ["**"]],
      ["*/**/*", ["app"], ["**"]],
      ["*/src/**", ["app"], ["src/**"]],
      ["*/src/main.rs", ["app"], ["src/main.rs"]],
      ["a*/src/main.rs", ["app"], ["src/main.rs"]],
      ["a*/src/main.rs", ["other"], []],
      ["**/*.proto", ["a", "b"], ["**/*.proto"]],
      ["**/x/*.txt", ["a", "x"], ["**/x/*.txt", "*.txt"]],
      // A pattern that ends at the folder names no file below it.
      ["*", ["app"], []],
      // Without a glob, the pattern names a folder and everything below it.
      ["", ["app", "web"], ["**"]],
      ["{app,lib}/src/**", ["lib"], ["src/**"]],
      ["{app,lib}/src/**", ["other"], []],
      ["{app/src,lib}/**", ["app"], ["src/**"]],
      ["[ab]pp/**", ["app"], ["**"]],
      ["[!a]pp/**", ["app"], []],
      ["\\*/src/**", ["*"], ["src/**"]],
      ["\\*/src/**", ["app"], []],
      // A group is taken to match any name.
      ["@(app|lib)/src/**", ["other"], ["src/**"]],
      ["*/w*/**", ["app"], ["w*/**"]],
      ["*/w*/**", ["app", "web"], ["**"]],
    ])("gives for %j below %j the patterns %j", (glob, names, expected) => {
      expect(patternsBelow(glob, names)).toEqual(expected);
    });
  });
});
