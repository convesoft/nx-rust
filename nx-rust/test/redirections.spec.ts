import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { cratesBelowPathsFolder } from "../src/cargo/paths-crates";
import { readRedirections } from "../src/cargo/redirections";
import { cargoMetadataOf } from "../src/graph/collisions";
import {
  applyFileChanges,
  FileChanges,
  FixtureGraph,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  loadFixtureGraph,
  pinnedToolchain,
  pinnedToolchainAvailable,
  runNx,
  testEnvironment,
} from "./harness";

// Checks the parts of VER-GRAPH about crates that [patch], [replace] and
// paths redirect dependencies to. graph.spec.ts checks the edges of
// patched-workspaces as committed, where rust/Cargo.toml patches model,
// types and fork; here the same redirections come from elsewhere. The
// crates with a project behind a redirected crate without one are checked
// here with their keys as well (VER-CACHE-KEYS).

describe("reading redirections", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-redirections-")));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(path: string, content: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  /** The redirections of the workspace in `folder`, with paths relative to the temporary root. */
  async function read(folder: string, env: NodeJS.ProcessEnv = {}): Promise<string[][]> {
    const { redirections } = await readRedirections(join(root, folder), {
      CARGO_HOME: join(root, "cargo-home"),
      ...env,
    });
    return redirections.map(({ table, folder, file }) => [
      table,
      relative(root, folder) || ".",
      relative(root, file),
    ]);
  }

  it("takes [patch] and [replace] entries with a path from the root manifest, against its folder", async () => {
    write(
      "ws/Cargo.toml",
      [
        "[workspace]",
        "[patch.crates-io]",
        'model = { path = "crates/model" }',
        'remote = { git = "https://example.com/remote.git" }',
        '[patch."https://example.com/types.git"]',
        'types = { path = "../shared/types", package = "types" }',
        "[replace]",
        '"fork:0.1.0" = { path = "/abs/fork" }',
        '"other:0.1.0" = { git = "https://example.com/other.git" }',
      ].join("\n"),
    );

    expect(await read("ws")).toEqual([
      ["patch", "ws/crates/model", "ws/Cargo.toml"],
      ["patch", "shared/types", "ws/Cargo.toml"],
      ["replace", relative(root, "/abs/fork"), "ws/Cargo.toml"],
    ]);
  });

  it("takes [patch] and paths from .cargo/config.toml or .cargo/config in the workspace folder and above, against the folder that holds .cargo", async () => {
    write("ws/Cargo.toml", "[workspace]\n");
    write("ws/.cargo/config", 'paths = ["local/lexer"]\n');
    write(".cargo/config.toml", '[patch.crates-io]\ntypes = { path = "shared/types" }\n');
    write("ws/crates/api/.cargo/config.toml", '[patch.crates-io]\nignored = { path = "x" }\n');

    expect(await read("ws")).toEqual([
      ["paths", "ws/local/lexer", "ws/.cargo/config"],
      ["patch", "shared/types", ".cargo/config.toml"],
    ]);
  });

  it("reads only .cargo/config where .cargo/config.toml exists beside it, as cargo does, also when the other is no valid TOML", async () => {
    write("ws/Cargo.toml", "[workspace]\n");
    write("ws/.cargo/config", '[patch.crates-io]\nmodel = { path = "crates/model" }\n');
    write(
      "ws/.cargo/config.toml",
      '[patch.crates-io]\nother = { path = "crates/other" }\nnot toml [\n',
    );

    expect(await read("ws")).toEqual([["patch", "ws/crates/model", "ws/.cargo/config"]]);
  });

  it("skips an included file that is no valid TOML, with a warning that names it and says what to do", async () => {
    write("ws/Cargo.toml", "[workspace]\n");
    write(
      "ws/.cargo/config.toml",
      'include = ["broken.toml"]\n[patch.crates-io]\nmodel = { path = "crates/model" }\n',
    );
    write("ws/.cargo/broken.toml", "not toml [\n");

    const found = await readRedirections(join(root, "ws"), {
      CARGO_HOME: join(root, "cargo-home"),
    });

    expect(found.redirections.map((entry) => relative(root, entry.folder))).toEqual([
      "ws/crates/model",
    ]);
    const config = join(root, "ws/.cargo/config.toml");
    expect(found.warnings).toEqual([
      expect.stringContaining(
        `nx-rust: ${join(root, "ws/.cargo/broken.toml")}, which ${config} includes, cannot be read`,
      ),
    ]);
    expect(found.warnings[0].split("\n").at(-1)).toBe(
      `Correct the file's TOML, or remove it from include in ${config}.`,
    );
  });

  it("follows include in either form, against the folder above the included file's folder", async () => {
    write("ws/Cargo.toml", "[workspace]\n");
    write(
      "ws/.cargo/config.toml",
      'include = ["patches.toml", { path = "../conf/deep/more.toml" }]\n',
    );
    write("ws/.cargo/patches.toml", '[patch.crates-io]\nmodel = { path = "crates/model" }\n');
    write("ws/conf/deep/more.toml", 'paths = ["../vendor/lexer"]\n');

    expect(await read("ws")).toEqual([
      ["patch", "ws/crates/model", "ws/.cargo/patches.toml"],
      ["paths", "ws/vendor/lexer", "ws/conf/deep/more.toml"],
    ]);
  });

  it("reads the Cargo home's configuration, against the folder that holds the Cargo home", async () => {
    write("ws/Cargo.toml", "[workspace]\n");
    write("cargo-home/config.toml", '[patch.crates-io]\nmodel = { path = "ws/crates/model" }\n');

    expect(await read("ws")).toEqual([["patch", "ws/crates/model", "cargo-home/config.toml"]]);
  });

  it("ignores [patch] in a member's manifest, which cargo ignores too", async () => {
    write("ws/Cargo.toml", '[workspace]\nmembers = ["crates/api"]\n');
    write(
      "ws/crates/api/Cargo.toml",
      '[package]\nname = "api"\n[patch.crates-io]\nmodel = { path = "../model" }\n',
    );

    expect(await read("ws")).toEqual([]);
  });

  it("fails, naming the file and what to do, when a file it reads is no valid TOML", async () => {
    write("ws/Cargo.toml", "[workspace]\n");
    write("ws/.cargo/config.toml", "paths = [\n");

    // Cargo rejects such a file first, so the message asks for a report of
    // a file that cargo accepts.
    const failure = read("ws");
    await expect(failure).rejects.toThrow(join(root, "ws/.cargo/config.toml"));
    await expect(failure).rejects.toThrow(
      "If cargo accepts the file, please report this at https://github.com/convesoft/nx-rust/issues.",
    );
  });
});

/** Each edge as source and target, sorted. */
function edges(graph: FixtureGraph): [string, string][] {
  return graph.dependencies
    .map((edge): [string, string] => [edge.source, edge.target])
    .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Each project's name with its folder. */
function roots(graph: FixtureGraph): Record<string, string> {
  return Object.fromEntries(
    Object.entries(graph.projects).map(([name, project]) => [name, project.root]),
  );
}

/**
 * Runs `task` and says whether its own output, after its header and below
 * what graph creation printed, holds `text`.
 */
async function printedByTask(
  workspace: FixtureWorkspace,
  task: string,
  text: string,
  env: Record<string, string> = {},
): Promise<{ task: string; status: number | null; warned: boolean }> {
  const { status, output } = await runNx(workspace, ["run", task], env);
  const header = output.indexOf(`> nx run ${task}`);
  const next = output.indexOf("> nx run ", header + 1);
  const own = header < 0 ? "" : output.slice(header, next < 0 ? undefined : next);
  return { task, status, warned: own.includes(text) };
}

/**
 * The projects whose metadata holds a warning that contains `text`, which
 * the executor prints at the start of each of their tasks.
 */
function warnedProjects(graph: FixtureGraph, text: string): string[] {
  return Object.entries(graph.projects)
    .filter(([, project]) =>
      (cargoMetadataOf(project)?.warnings ?? []).some((warning) => warning.includes(text)),
    )
    .map(([name]) => name)
    .sort();
}

/** The projects of the fixture's workspace in rust. */
const rustProjects = ["api", "harness", "model", "plain", "rust", "util", "viaw"];

/** rust/Cargo.toml with only the given lines below its [workspace] table. */
function rootManifest(...lines: string[]): string {
  return ['[workspace]\nmembers = ["crates/*"]\nresolver = "3"\n', ...lines].join("\n") + "\n";
}

/**
 * The committed edges as `paths = ["crates/model"]` changes them: cargo
 * takes model's path dependencies util, a normal one, and harness, a
 * dev-dependency, from the entry as well. api and viaw, which have registry
 * dependencies and which neither reaches, may use both. util and harness
 * may only possibly use each other, and so may harness and model now, so
 * none of these uses is an edge: harness gets model's files as inputs in
 * place of its edge to model, while model keeps its dev-dependency edge to
 * harness.
 */
function withModelPathDependencies(committed: [string, string][]): [string, string][] {
  const added: [string, string][] = [
    ["api", "harness"],
    ["api", "util"],
    ["viaw", "harness"],
    ["viaw", "util"],
  ];
  return [...committed.filter(([from, to]) => from !== "harness" || to !== "model"), ...added].sort(
    (a, b) => compare(a[0], b[0]) || compare(a[1], b[1]),
  );
}

/** The [patch.crates-io] table of the fixture without model. */
const patchWithoutModel = [
  "[patch.crates-io]",
  'types = { path = "../shared/crates/types" }',
  'fork = { path = "../third_party/fork" }',
];

describe("finding the crates below a paths folder", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-paths-crates-")));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function crate(
    folder: string,
    manifest = '[package]\nname = "model"\nversion = "0.1.0"\n',
  ): void {
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, "Cargo.toml"), manifest);
  }

  /** The crates found below `folder`, relative to the temporary root. */
  function found(folder: string): string[] {
    return cratesBelowPathsFolder(join(root, folder)).map((crate) => relative(root, crate));
  }

  it("takes every crate to any depth, as cargo does, also below another crate and in a nested workspace", () => {
    crate("local/model");
    crate("local/a/b/c/d/e/model");
    crate("local/outer");
    crate("local/outer/inner");
    crate("local/nested", '[workspace]\nmembers = ["member"]\n');
    crate("local/nested/member");
    crate("local/broken", "not toml [\n");
    crate("local/vendored");
    writeFileSync(join(root, "local/vendored/.cargo-checksum.json"), "{}\n");
    crate("local/target/model");

    expect(found("local")).toEqual([
      "local/a/b/c/d/e/model",
      "local/broken",
      "local/model",
      "local/nested",
      "local/nested/member",
      "local/outer",
      "local/outer/inner",
      // No Cargo.toml beside this target folder.
      "local/target/model",
      "local/vendored",
    ]);
  });

  it("skips what cargo skips: hidden folders, folders holding .git and target beside a manifest", () => {
    crate("local/.hidden/model");
    crate("local/repository/model");
    mkdirSync(join(root, "local/repository/.git"));
    crate("local/submodule/model");
    writeFileSync(join(root, "local/submodule/.git"), "gitdir: ../.git/modules/submodule\n");
    crate("local/kept");
    crate("local/kept/target/model");
    crate("local/kept/deeper/target/model");
    crate("local/target/model");
    writeFileSync(join(root, "local/Cargo.toml"), '[package]\nname = "top"\nversion = "0.1.0"\n');

    expect(found("local")).toEqual(["local", "local/kept", "local/kept/deeper/target/model"]);
  });

  it("follows a symbolic link given as the folder and none below it, as cargo does", () => {
    crate("elsewhere/inner/model");
    symlinkSync("elsewhere", join(root, "local"));
    crate("other/model");
    symlinkSync("../other", join(root, "elsewhere/link"));

    expect(found("local")).toEqual(["elsewhere/inner/model"]);
  });

  it("enters node_modules and Cargo's artifact directories, as cargo does, and skips a folder it cannot read", () => {
    crate("local/node_modules/package/model");
    crate("local/out/package/model-0.1.0");
    writeFileSync(
      join(root, "local/out/CACHEDIR.TAG"),
      "Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag created by cargo.\n",
    );
    crate("local/locked/model");
    chmodSync(join(root, "local/locked"), 0o000);
    try {
      expect(found("local")).toEqual(
        process.getuid?.() === 0
          ? [
              "local/locked/model",
              "local/node_modules/package/model",
              "local/out/package/model-0.1.0",
            ]
          : ["local/node_modules/package/model", "local/out/package/model-0.1.0"],
      );
    } finally {
      chmodSync(join(root, "local/locked"), 0o755);
    }
  });

  it("finds nothing for a folder that does not exist", () => {
    expect(found("missing")).toEqual([]);
  });
});

describe("edges to redirected crates", () => {
  let committed: [string, string][];

  beforeAll(async () => {
    committed = edges(await loadFixtureGraph("patched-workspaces"));
  }, HARNESS_TIMEOUT);

  it.each<[string, FileChanges]>([
    [
      "[patch] in the workspace's .cargo/config.toml",
      {
        "rust/Cargo.toml": rootManifest(...patchWithoutModel),
        "rust/.cargo/config.toml": '[patch.crates-io]\nmodel = { path = "crates/model" }\n',
      },
    ],
    [
      "[patch] in a .cargo/config.toml above the workspace",
      {
        "rust/Cargo.toml": rootManifest(...patchWithoutModel),
        ".cargo/config.toml": '[patch.crates-io]\nmodel = { path = "rust/crates/model" }\n',
      },
    ],
    [
      "[patch] in a file that the configuration includes",
      {
        "rust/Cargo.toml": rootManifest(...patchWithoutModel),
        "rust/.cargo/config.toml": 'include = ["patches.toml"]\n',
        "rust/.cargo/patches.toml": '[patch.crates-io]\nmodel = { path = "crates/model" }\n',
      },
    ],
    [
      // Cargo rejects [replace] beside [patch], so all three go there.
      "[replace]",
      {
        "rust/Cargo.toml": rootManifest(
          "[replace]",
          '"model:0.1.0" = { path = "crates/model" }',
          '"types:0.1.0" = { path = "../shared/crates/types" }',
          '"fork:0.1.0" = { path = "../third_party/fork" }',
        ),
      },
    ],
  ])(
    "are the same with model redirected through %s",
    async (_how, files) => {
      const graph = await loadFixtureGraph("patched-workspaces", { files });

      expect(edges(graph)).toEqual(committed);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "come from paths in the workspace's .cargo/config.toml also for the path dependencies of the crate it names",
    async () => {
      const graph = await loadFixtureGraph("patched-workspaces", {
        files: {
          "rust/Cargo.toml": rootManifest(...patchWithoutModel),
          "rust/.cargo/config.toml": 'paths = ["crates/model"]\n',
        },
      });

      expect(edges(graph)).toEqual(withModelPathDependencies(committed));
      expect(graph.projects.harness.targets.check.inputs).toEqual(
        expect.arrayContaining(["{workspaceRoot}/rust/crates/model/**/*"]),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "go to no workspace project of a virtual workspace below the folder of a paths entry",
    async () => {
      // shared, a virtual workspace with the project shared, lies in the
      // folder of the entry; cargo takes only its member types from there,
      // which rust's [patch] redirects already.
      const graph = await loadFixtureGraph("patched-workspaces", {
        files: { "rust/.cargo/config.toml": 'paths = ["../shared"]\n' },
      });

      expect(edges(graph)).toEqual(committed);
      for (const member of ["api", "harness", "model", "util", "viaw"]) {
        expect({ member, inputs: graph.projects[member].targets.check.inputs }).toEqual({
          member,
          inputs: expect.not.arrayContaining(["{workspaceRoot}/shared/**/*"]),
        });
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "come from no [patch] in a member's manifest, which cargo ignores",
    async () => {
      const graph = await loadFixtureGraph("patched-workspaces", {
        files: {
          "rust/Cargo.toml": rootManifest(...patchWithoutModel),
          "rust/crates/api/Cargo.toml": (manifest) =>
            `${manifest}\n[patch.crates-io]\nmodel = { path = "../model" }\n`,
        },
      });

      expect(edges(graph)).toEqual(
        committed.filter(
          ([source, target]) => target !== "model" || ["model", "rust"].includes(source),
        ),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "come from configuration outside the repository, with a warning that names the file",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces", {
        "rust/Cargo.toml": rootManifest(...patchWithoutModel),
      });
      try {
        const before = await workspace.nx(["show", "projects"]);
        const cargoHome = join(dirname(workspace.root), "cargo-home");
        mkdirSync(cargoHome);
        const config = join(cargoHome, "config.toml");
        writeFileSync(
          config,
          `[patch.crates-io]\nmodel = { path = "${basename(workspace.root)}/rust/crates/model" }\n`,
        );
        const env = { CARGO_HOME: cargoHome };

        const graph = await workspace.graph(env);
        const after = await workspace.nx(["show", "projects"], env);

        expect(edges(graph)).toEqual(committed);
        expect(before.output).not.toContain("outside the repository");
        expect(after.status).toBe(0);
        // The Cargo home applies to both workspaces; shared has no member
        // with a registry dependency, so it gets no edge.
        for (const text of [
          `nx-rust: ${config} sets [patch] for the Cargo workspaces in rust and shared, and Nx does not hash it: it lies outside the repository. A result that Nx cached before a change to the file can therefore be restored after it.`,
          "It redirects dependencies through [patch], so nx-rust gives the crates that may use the redirected crates edges to them; with the Nx daemon, the graph keeps these edges until a file that Nx reads changes or the daemon restarts (`nx reset`).",
          "After changing the file, run `nx reset`. Running a command with --skip-nx-cache instead covers that command alone: Nx stores none of its results, so a later run can still restore a result from before the change.",
          "To let Nx follow the redirections, move them into the root Cargo.toml of the workspace that needs them or into a .cargo/config.toml inside the repository.",
        ]) {
          expect(after.output).toContain(text);
        }
        // The lockfile task of each workspace repeats it, and a task of a
        // crate does not (DES-DIAGNOSTICS).
        for (const [task, warned] of [
          ["rust:lockfile", true],
          ["shared:lockfile", true],
          ["api:fmt-check", false],
        ] as const) {
          expect(await printedByTask(workspace, task, `nx-rust: ${config} sets`, env)).toEqual({
            task,
            status: 0,
            warned,
          });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it.each([
    ["a .cargo/config.toml", ".gitignore", { ".gitignore": "target/\nrust/.cargo/\n" }],
    ["a .cargo/config.toml", ".nxignore", { ".nxignore": "rust/.cargo/\n" }],
    ["the root manifest", ".nxignore", { ".nxignore": "rust/Cargo.toml\n" }],
  ])(
    "come from %s that %s leaves out of the files that Nx reads, with a warning that names the file",
    async (subject, _ignoreFile, ignore) => {
      // The Nx daemon does not create the graph again when such a file
      // changes (EVD-CARGO-REDIRECTIONS).
      const config = subject !== "the root manifest";
      const file = config ? "rust/.cargo/config.toml" : "rust/Cargo.toml";
      const workspace = FixtureWorkspace.create(
        "patched-workspaces",
        config
          ? {
              "rust/Cargo.toml": rootManifest(...patchWithoutModel),
              "rust/.cargo/config.toml": '[patch.crates-io]\nmodel = { path = "crates/model" }\n',
            }
          : {},
      );
      // A configuration file names what it sets; the root manifest, whose
      // workspace has no lockfile task then, only its redirections.
      const texts = config
        ? [
            "nx-rust: rust/.cargo/config.toml sets [patch] for the Cargo workspace in rust, and Nx does not hash it: an ignore rule, such as one in .gitignore or .nxignore, leaves it out of the files that Nx reads. A result that Nx cached before a change to the file can therefore be restored after it.",
            "It redirects dependencies through [patch], so nx-rust gives the crates that may use the redirected crates edges to them; with the Nx daemon, the graph keeps these edges until a file that Nx reads changes or the daemon restarts (`nx reset`).",
            "After changing the file, run `nx reset`. Running a command with --skip-nx-cache instead covers that command alone: Nx stores none of its results, so a later run can still restore a result from before the change.",
            "To have Nx hash the file and follow its redirections, stop ignoring it.",
          ]
        : [
            "nx-rust: rust/Cargo.toml redirects dependencies of the Cargo workspace in rust through [patch], so nx-rust gives the crates that may use the redirected crates edges to them.",
            "An ignore rule, such as one in .gitignore or .nxignore, leaves the file out of the files that Nx reads, so Nx does not see when it changes: with the Nx daemon, the graph keeps these edges until a file that Nx reads changes or the daemon restarts (`nx reset`).",
            "To let Nx follow the redirections, stop ignoring the file, or run `nx reset` after each change to it.",
          ];
      const start = `nx-rust: ${file} `;
      try {
        const seen = await workspace.nx(["show", "projects"]);
        applyFileChanges(workspace.root, ignore);
        const graph = await workspace.graph();
        const shown = await workspace.nx(["show", "projects"]);

        // Without its root manifest, the workspace has no project of its own.
        expect(edges(graph)).toEqual(
          committed.filter(([source, target]) => config || ![source, target].includes("rust")),
        );
        expect(seen.status).toBe(0);
        expect(seen.output).not.toContain(start);
        expect(shown.status).toBe(0);
        for (const text of texts) {
          expect(shown.output).toContain(text);
        }
        // The lockfile task of rust repeats it, and that of shared does not.
        const tasks: [string, boolean][] = [
          ...(config ? ([["rust:lockfile", true]] as [string, boolean][]) : []),
          ["shared:lockfile", false],
        ];
        for (const [task, warned] of tasks) {
          expect(await printedByTask(workspace, task, start)).toEqual({ task, status: 0, warned });
        }
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "warn about configuration outside the repository again in the lockfile tasks, where the Nx daemon keeps graph creation's output in its log",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces", {
        "rust/Cargo.toml": rootManifest(...patchWithoutModel),
      });
      const cargoHome = join(dirname(workspace.root), "cargo-home");
      mkdirSync(cargoHome);
      const config = join(cargoHome, "config.toml");
      writeFileSync(
        config,
        `[patch.crates-io]\nmodel = { path = "${basename(workspace.root)}/rust/crates/model" }\n`,
      );
      const env = { CARGO_HOME: cargoHome, NX_DAEMON: "true" };
      const warning = `nx-rust: ${config} sets [patch]`;
      try {
        for (const task of ["shared:lockfile", "rust:lockfile"]) {
          expect(await printedByTask(workspace, task, warning, env)).toEqual({
            task,
            status: 0,
            warned: true,
          });
        }
        expect(workspace.daemonLog()).toContain(warning);
      } finally {
        await workspace.nx(["daemon", "--stop"], env);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "come from a member whose only registry dependency is unknown to every Cargo home",
    async () => {
      // viaw reaches model through fork; a registry crate that depends on
      // model may lead there as well, and the graph needs no registry.
      const graph = await loadFixtureGraph("patched-workspaces", {
        files: {
          "rust/crates/viaw/Cargo.toml": (manifest) =>
            manifest.replace('fork = "0.1"', 'wrapper = "0.1"'),
          "rust/Cargo.lock": null,
        },
      });

      expect(edges(graph)).toEqual(committed);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "come from a member whose registry dependency is behind a path crate of another workspace",
    async () => {
      // shared redirects nothing, so link has no edge to model; built in
      // rust, link gets the crates of rust's [patch].
      const graph = await loadFixtureGraph("patched-workspaces", {
        files: {
          "shared/crates/link/Cargo.toml":
            '[package]\nname = "link"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\nmodel = "0.1"\n',
          "shared/crates/link/src/lib.rs": "",
          "rust/crates/plain/Cargo.toml": (manifest) =>
            `${manifest}\n[dependencies]\nlink = { path = "../../../shared/crates/link" }\n`,
        },
      });

      expect(edges(graph)).toEqual(
        [
          ...committed,
          ["plain", "link"],
          ["plain", "model"],
          ["plain", "types"],
          ["shared", "link"],
        ].sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1])),
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "are left out for a redirection to a folder without a crate, which does not fail the graph",
    async () => {
      const graph = await loadFixtureGraph("patched-workspaces", {
        files: {
          "rust/Cargo.toml": (manifest) => `${manifest}ghost = { path = "../ghost" }\n`,
        },
      });

      expect(edges(graph)).toEqual(committed);
      expect(graph.cargoCalls).toHaveLength(3);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "reach a crate of another plugin entry",
    async () => {
      const graph = await loadFixtureGraph("patched-workspaces", {
        files: {
          "nx.json": (nxJson) => {
            const config = JSON.parse(nxJson);
            const { plugin } = config.plugins[0];
            return JSON.stringify({
              plugins: [
                { plugin, include: ["rust/**"] },
                { plugin, include: ["shared/**"] },
              ],
            });
          },
        },
      });

      expect(edges(graph)).toEqual(committed);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "make nx affected select every member that may use a patched crate",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces");
      try {
        const { status, output } = await workspace.nx([
          "show",
          "projects",
          "--affected",
          "--files=rust/crates/model/src/lib.rs",
          "--json",
        ]);

        expect(status).toBe(0);
        // util has no edge to model, which depends on it, but its targets
        // hash model's folder (DES-INPUTS, "Redirected crates"); plain has no
        // registry dependency.
        expect(JSON.parse(output.slice(output.indexOf("["))).sort()).toEqual([
          "api",
          "harness",
          "model",
          "rust",
          "util",
          "viaw",
        ]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "keep a direct redirection whose crate a possible one would reach back",
    async () => {
      // util 0.2.0 is patched in and needs model = "0.1", which is patched
      // in as well; model needs the registry's util = "0.1", which local
      // util 0.2.0 does not satisfy. Cargo builds util against local model.
      const workspace = FixtureWorkspace.create("patched-workspaces", {
        "rust/Cargo.toml": (manifest) => `${manifest}util = { path = "crates/util" }\n`,
        "rust/crates/util/Cargo.toml": (manifest) =>
          manifest.replace('version = "0.1.0"', 'version = "0.2.0"') + 'model = "0.1"\n',
        "rust/crates/model/Cargo.toml": (manifest) =>
          manifest.replace('util = { path = "../util" }', 'util = "0.1"'),
        "rust/Cargo.lock": null,
      });
      try {
        const graph = await workspace.graph();
        const affected = await workspace.nx([
          "show",
          "projects",
          "--affected",
          "--files=rust/crates/model/src/lib.rs",
          "--json",
        ]);

        expect(edges(graph)).toContainEqual(["util", "model"]);
        // A possible use of util by model would close a cycle with that real
        // edge: model gets util's files as an input instead.
        expect(edges(graph)).not.toContainEqual(["model", "util"]);
        expect(JSON.parse(affected.output.slice(affected.output.indexOf("[")))).toContain("util");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "are left out both ways between two redirected crates that may only possibly use each other",
    async () => {
      const graph = await loadFixtureGraph("patched-workspaces", {
        files: {
          "rust/Cargo.toml": (manifest) =>
            `${manifest}util = { path = "crates/util" }\nharness = { path = "crates/harness" }\n`,
        },
      });

      expect(edges(graph)).not.toContainEqual(["util", "harness"]);
      expect(edges(graph)).not.toContainEqual(["harness", "util"]);
      // The positive control: both keep their direct edge to types.
      expect(edges(graph)).toContainEqual(["util", "types"]);
      expect(edges(graph)).toContainEqual(["harness", "types"]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "reach a crate through a symbolic link in the redirection's path",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces", {
        "rust/Cargo.toml": (manifest) =>
          manifest.replace('"../shared/crates/types"', '"alias/crates/types"'),
      });
      try {
        symlinkSync("../shared", join(workspace.root, "rust/alias"));

        const graph = await workspace.graph();

        expect(roots(graph)).toMatchObject({ types: "shared/crates/types" });
        expect(edges(graph)).toEqual(committed);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "do not fail the graph for a redirected crate that cargo cannot report, and warn",
    async () => {
      // rust/local lies in the folder of rust without being its member:
      // cargo builds it as a patch but refuses to report it.
      const workspace = FixtureWorkspace.create("patched-workspaces", {
        "rust/Cargo.toml": (manifest) =>
          manifest.replace('fork = { path = "../third_party/fork" }', 'fork = { path = "local" }'),
        "rust/local/Cargo.toml":
          '[package]\nname = "fork"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\nmodel = "0.1"\n',
        "rust/local/src/lib.rs": "",
        ".nxignore": "rust/local/\n",
      });
      try {
        const graph = await workspace.graph();
        const shown = await workspace.nx(["show", "projects"]);

        expect(edges(graph)).toEqual(committed);
        expect(shown.status).toBe(0);
        expect(shown.output).toContain("`cargo metadata` failed for rust/local/Cargo.toml");
        expect(shown.output).toContain("believes it's in a workspace");
        expect(shown.output).toContain(
          "To have those crates followed, fix what cargo reports, so that `cargo metadata --no-deps --manifest-path rust/local/Cargo.toml` succeeds in rust, or declare their files with fileInputs in the [package.metadata.nx] or [workspace.metadata.nx] table of the crates that use it.",
        );
        // The projects of rust, whose [patch] names the crate, repeat it at
        // the start of their tasks, and those of shared do not.
        expect(
          warnedProjects(graph, "nx-rust: `cargo metadata` failed for rust/local/Cargo.toml"),
        ).toEqual(rustProjects);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "come from a member that reaches a registry dependency only through a path crate that cargo does not report",
    async () => {
      // other lists no members, so cargo builds stray for plain, applying
      // rust's [patch] to stray's model, but refuses to report it. What stray
      // depends on is then unknown, so plain may use every redirected crate.
      const workspace = FixtureWorkspace.create("patched-workspaces", {
        "rust/crates/plain/Cargo.toml": (manifest) =>
          `${manifest}\n[dependencies]\nstray = { path = "../../../other/stray" }\n`,
        "other/Cargo.toml": '[workspace]\nmembers = []\nresolver = "3"\n',
        "other/stray/Cargo.toml":
          '[package]\nname = "stray"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\nmodel = "0.1"\n',
        "other/stray/src/lib.rs": "",
        ".nxignore": "other/\n",
      });
      try {
        const graph = await workspace.graph();
        const shown = await workspace.nx(["show", "projects"]);

        expect(edges(graph)).toEqual(
          [...committed, ["plain", "model"], ["plain", "types"]].sort(
            (a, b) => compare(a[0], b[0]) || compare(a[1], b[1]),
          ),
        );
        expect(shown.status).toBe(0);
        expect(shown.output).toContain("`cargo metadata` failed for other/stray/Cargo.toml");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "keep a possible use whose opposite rests only on a crate without a report, and turn that one into an input",
    async () => {
      // backend redirects server and b to themselves. server depends on the
      // registry crate wrapper, which depends on b: cargo builds server ->
      // wrapper -> b -> leaf. b's only dependency, leaf, is a crate of a
      // directory source without a report, so b's use of server is assumed.
      const crate = (name: string) =>
        `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`;
      const workspace = FixtureWorkspace.create("cross-workspace-path", {
        "backend/Cargo.toml":
          '[workspace]\nmembers = ["crates/server", "crates/b"]\nresolver = "3"\n\n[patch.crates-io]\nserver = { path = "crates/server" }\nb = { path = "crates/b" }\n',
        "backend/.cargo/config.toml":
          '[source.crates-io]\nreplace-with = "vendor"\n\n[source.vendor]\ndirectory = "../vendor"\n',
        "backend/crates/server/Cargo.toml": `${crate("server")}\n[dependencies]\nwrapper = "0.1"\n`,
        "backend/crates/b/Cargo.toml": `${crate("b")}\n[dependencies]\nleaf = { path = "../../../vendor/leaf" }\n`,
        "backend/crates/b/src/lib.rs": "",
        "vendor/leaf/Cargo.toml": crate("leaf"),
        "vendor/leaf/src/lib.rs": "",
        "vendor/leaf/.cargo-checksum.json": '{"files":{},"package":null}\n',
        "vendor/wrapper/Cargo.toml": `${crate("wrapper")}\n[dependencies]\nb = "0.1"\n`,
        "vendor/wrapper/src/lib.rs": "",
        "vendor/wrapper/.cargo-checksum.json": '{"files":{},"package":null}\n',
        ".nxignore": "shared/\n",
      });
      try {
        const graph = await workspace.graph();
        const affected = await workspace.nx([
          "show",
          "projects",
          "--affected",
          "--files=backend/crates/b/src/lib.rs",
          // Nx prints JSON by itself only where it detects an AI agent.
          "--json",
        ]);

        expect(edges(graph).filter(([source]) => source !== "backend")).toEqual([["server", "b"]]);
        expect(affected.status).toBe(0);
        // The JSON is the last line, after any warning of graph creation.
        expect(JSON.parse(affected.output.trim().split("\n").pop()).sort()).toEqual([
          "b",
          "backend",
          "server",
        ]);
        // What the left-out use would have brought.
        expect(graph.projects.b.targets.check.inputs).toContain(
          "{workspaceRoot}/backend/crates/server/**/*",
        );
        expect(graph.projects.server.targets.check.inputs).not.toContain(
          "{workspaceRoot}/backend/crates/b/**/*",
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave out an assumed use whose opposite is an edge through a crate without a project, and turn it into an input",
    async () => {
      // backend redirects server to itself. b's only dependency, leaf, is a
      // crate of a directory source without a report, so b's use of server
      // is assumed. server dev-depends on tools/bridge, which nx.json
      // excludes and which depends on b: cargo builds b for server's tests,
      // so server has an edge to b.
      const crate = (name: string) =>
        `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`;
      const workspace = FixtureWorkspace.create("cross-workspace-path", {
        "backend/Cargo.toml":
          '[workspace]\nmembers = ["crates/server", "crates/b"]\nresolver = "3"\n\n[patch.crates-io]\nserver = { path = "crates/server" }\n',
        "backend/crates/server/Cargo.toml": `${crate("server")}\n[dev-dependencies]\nbridge = { path = "../../../tools/bridge" }\n`,
        "backend/crates/b/Cargo.toml": `${crate("b")}\n[dependencies]\nleaf = { path = "../../../vendor/leaf" }\n`,
        "backend/crates/b/src/lib.rs": "",
        "tools/bridge/Cargo.toml": `${crate("bridge")}\n[workspace]\n\n[dependencies]\nb = { path = "../../backend/crates/b" }\n`,
        "tools/bridge/src/lib.rs": "",
        "vendor/leaf/Cargo.toml": crate("leaf"),
        "vendor/leaf/src/lib.rs": "",
        "vendor/leaf/.cargo-checksum.json": '{"files":{},"package":null}\n',
        ".nxignore": "shared/\n",
        "nx.json": (text) =>
          JSON.stringify({
            ...JSON.parse(text),
            plugins: JSON.parse(text).plugins.map((plugin: string) => ({
              plugin,
              exclude: ["tools/**"],
            })),
          }),
      });
      try {
        const graph = await workspace.graph();
        const affected = await workspace.nx([
          "show",
          "projects",
          "--affected",
          "--files=backend/crates/b/src/lib.rs",
          // Nx prints JSON by itself only where it detects an AI agent.
          "--json",
        ]);

        expect(edges(graph).filter(([source]) => source !== "backend")).toEqual([["server", "b"]]);
        expect(affected.status).toBe(0);
        // The JSON is the last line, after any warning of graph creation.
        expect(JSON.parse(affected.output.trim().split("\n").pop()).sort()).toEqual([
          "b",
          "backend",
          "server",
        ]);
        // What the left-out use would have brought.
        expect(graph.projects.b.targets.check.inputs).toContain(
          "{workspaceRoot}/backend/crates/server/**/*",
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  // Cargo 1.91 ignores include, so only that version accepts a broken
  // included file; 1.100 fails on it, and so does graph creation.
  if (pinnedToolchainAvailable()) {
    it(
      `do not fail the graph for an included file that is no valid TOML, which cargo ${pinnedToolchain} ignores`,
      async () => {
        const workspace = FixtureWorkspace.create("patched-workspaces", {
          "rust/rust-toolchain.toml": `[toolchain]\nchannel = "${pinnedToolchain}"\n`,
          "rust/.cargo/config.toml": 'include = ["broken.toml"]\n',
          "rust/.cargo/broken.toml": "not toml [\n",
        });
        try {
          const graph = await workspace.graph();
          const shown = await workspace.nx(["show", "projects"]);

          expect(edges(graph)).toEqual(committed);
          expect(shown.status).toBe(0);
          expect(shown.output).toContain("rust/.cargo/broken.toml, which");
          expect(warnedProjects(graph, "rust/.cargo/broken.toml, which")).toEqual(rustProjects);
        } finally {
          workspace.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  } else {
    it.todo(
      `do not fail the graph for an included file that is no valid TOML: install the ${pinnedToolchain} toolchain with rustup to check it`,
    );
  }

  it.each<[string, FileChanges]>([
    [
      "a .cargo/config.toml that is no valid TOML beside the .cargo/config that cargo reads",
      {
        "rust/.cargo/config": 'paths = ["crates/model"]\n',
        "rust/.cargo/config.toml": "not toml [\n",
      },
    ],
  ])(
    "do not fail the graph for %s",
    async (_file, files) => {
      const workspace = FixtureWorkspace.create("patched-workspaces", files);
      try {
        const graph = await workspace.graph();
        const shown = await workspace.nx(["show", "projects"]);

        expect(edges(graph)).toEqual(withModelPathDependencies(committed));
        expect(shown.status).toBe(0);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "come from a git dependency that [patch] redirects to a crate of the repository",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces");
      try {
        // A git repository outside the repository holds remote 0.1.0.
        const repository = join(dirname(workspace.root), "remote.git");
        mkdirSync(join(repository, "src"), { recursive: true });
        writeFileSync(
          join(repository, "Cargo.toml"),
          '[package]\nname = "remote"\nversion = "0.1.0"\nedition = "2024"\n',
        );
        writeFileSync(join(repository, "src/lib.rs"), "");
        const git = (...args: string[]) =>
          execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
            cwd: repository,
            env: testEnvironment(),
          });
        git("init", "-q");
        git("add", "-A");
        git("commit", "-q", "-m", "remote");
        const url = `file://${repository}`;
        applyFileChanges(workspace.root, {
          "rust/Cargo.toml": (manifest) =>
            `${manifest}\n[patch."${url}"]\nremote = { path = "../shared/crates/remote" }\n`,
          "shared/crates/remote/Cargo.toml":
            '[package]\nname = "remote"\nversion = "0.1.0"\nedition = "2024"\n',
          "shared/crates/remote/src/lib.rs": "",
          "rust/crates/plain/Cargo.toml": (manifest) =>
            `${manifest}\n[dependencies]\nremote = { git = "${url}" }\n`,
        });

        const graph = await workspace.graph();
        const affected = await workspace.nx([
          "show",
          "projects",
          "--affected",
          "--files=shared/crates/remote/src/lib.rs",
          "--json",
        ]);

        // plain's only dependency is the git one, so its edge is the direct one.
        expect(edges(graph)).toContainEqual(["plain", "remote"]);
        expect(JSON.parse(affected.output.slice(affected.output.indexOf("[")))).toContain("plain");
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "cover every crate with a project that cargo builds for a member",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces");
      try {
        const graph = await workspace.graph();
        const nameByRoot = new Map(
          Object.entries(graph.projects).map(([name, project]) => [project.root, name]),
        );
        const members = ["api", "harness", "model", "plain", "util", "viaw"];
        const used = Object.fromEntries(
          members.map((member) => [
            member,
            cargoTree(join(workspace.root, "rust"), member)
              .map((folder) => nameByRoot.get(relative(workspace.root, folder)))
              .filter((name): name is string => name !== undefined && name !== member),
          ]),
        );
        // What cargo builds for a member that the graph does not reach from it.
        const missing = members.flatMap((member) =>
          used[member]
            .filter((name) => !reachable(graph, member).includes(name))
            .map((name) => `${member} -> ${name}`),
        );

        // The positive control: cargo builds model for api and viaw only
        // through the [patch], and for viaw through fork, which has no project.
        expect(used.api).toContain("model");
        expect(used.viaw).toContain("model");
        expect(missing).toEqual([]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("crates with a project behind a redirected crate without one", () => {
  const crate = (name: string) =>
    `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`;
  // fork, which nx.json excludes and rust's [patch] redirects, depends by
  // path on plain, a member of rust, in place of model: cargo builds plain
  // for every member that uses fork. api uses fork directly, harness may use
  // it through its registry dependency on types, and lone may use it through
  // leaf, a crate of a directory source that has no report.
  const forkUsesPlain: FileChanges = {
    "third_party/fork/Cargo.toml": (manifest) =>
      manifest.replace('model = "0.1"', 'plain = { path = "../../rust/crates/plain" }'),
    "rust/crates/lone/Cargo.toml": `${crate("lone")}\n[dependencies]\nleaf = { path = "../../../third_party/leaf" }\n`,
    "rust/crates/lone/src/lib.rs": "",
    "third_party/leaf/Cargo.toml": crate("leaf"),
    "third_party/leaf/src/lib.rs": "",
    "third_party/leaf/.cargo-checksum.json": '{"files":{},"package":null}\n',
  };
  const plainSource = "rust/crates/plain/src/lib.rs";
  // api's use is direct, harness's possible and lone's assumed; types uses
  // nothing of rust.
  const tasks = ["api:test", "api:build", "harness:test", "lone:test", "types:test"];

  /** What a change in plain does: the graph before, which keys change and what `nx affected` selects. */
  async function changePlain(
    files: FileChanges,
    links: Record<string, string> = {},
  ): Promise<{ graph: FixtureGraph; keysDiffer: Record<string, boolean>; affected: string[] }> {
    const workspace = FixtureWorkspace.create("patched-workspaces", forkUsesPlain, files);
    try {
      for (const [link, target] of Object.entries(links)) {
        symlinkSync(target, join(workspace.root, link));
      }
      const graph = await workspace.graph();
      const before = await workspace.hashTasks(tasks);
      applyFileChanges(workspace.root, { [plainSource]: (current) => `${current}// changed\n` });
      const after = await workspace.hashTasks(tasks);
      const { status, output } = await runNx(workspace, [
        "show",
        "projects",
        "--affected",
        `--files=${plainSource}`,
        "--json",
      ]);
      expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
      return {
        graph,
        keysDiffer: Object.fromEntries(
          tasks.map((task) => [task, before[task].value !== after[task].value]),
        ),
        // The JSON is the last line, after any warning of graph creation.
        affected: JSON.parse(output.trim().split("\n").pop()).sort(),
      };
    } finally {
      workspace.remove();
    }
  }

  // Every row names its links, also where it has none: Jest takes a test
  // function with more parameters than its row for one that calls `done`.
  it.each<[string, FileChanges, Record<string, string>]>([
    ["[patch], as rust/Cargo.toml has it", {}, {}],
    [
      // Cargo rejects [replace] beside [patch], so all three go there.
      "[replace]",
      {
        "rust/Cargo.toml": rootManifest(
          "[replace]",
          '"model:0.1.0" = { path = "crates/model" }',
          '"types:0.1.0" = { path = "../shared/crates/types" }',
          '"fork:0.1.0" = { path = "../third_party/fork" }',
        ),
      },
      {},
    ],
    [
      "paths",
      {
        "rust/Cargo.toml": rootManifest(
          "[patch.crates-io]",
          'model = { path = "crates/model" }',
          'types = { path = "../shared/crates/types" }',
        ),
        "rust/.cargo/config.toml": 'paths = ["../third_party/fork"]\n',
      },
      {},
    ],
    [
      // The reproduction of nxr-8sf4xw: cargo takes fork from below the
      // folder of the entry, not from the folder itself.
      "paths, with the crate below the entry's folder",
      {
        "rust/Cargo.toml": rootManifest(
          "[patch.crates-io]",
          'model = { path = "crates/model" }',
          'types = { path = "../shared/crates/types" }',
        ),
        "rust/.cargo/config.toml": 'paths = ["../third_party"]\n',
      },
      {},
    ],
    // Cargo walks node_modules, a folder it tagged as its cache directory and
    // the artifact and build directories too (the review of nxr-8sf4xw).
    ...(
      [
        ["in node_modules", "node_modules/pkg", {}],
        [
          "in a folder that cargo tagged as its cache directory",
          "cache",
          {
            "third_party/cache/CACHEDIR.TAG":
              "Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag created by cargo.\n",
          },
        ],
        [
          "in the workspace's artifact directory",
          "artifacts",
          {
            "rust/.cargo/config.toml":
              'paths = ["../third_party"]\n\n[build]\ntarget-dir = "../third_party/artifacts"\n',
          },
        ],
        [
          "in the workspace's build directory",
          "builds",
          {
            "rust/.cargo/config.toml":
              'paths = ["../third_party"]\n\n[build]\nbuild-dir = "../third_party/builds"\n',
          },
        ],
      ] as const
    ).map(([where, folder, more]): [string, FileChanges, Record<string, string>] => [
      `paths, with the crate ${where} below the entry's folder`,
      {
        "rust/Cargo.toml": rootManifest(
          "[patch.crates-io]",
          'model = { path = "crates/model" }',
          'types = { path = "../shared/crates/types" }',
        ),
        "rust/.cargo/config.toml": 'paths = ["../third_party"]\n',
        "third_party/fork": null,
        [`third_party/${folder}/fork/Cargo.toml`]: `${crate("fork")}\n[dependencies]\nplain = { path = "${relative(`third_party/${folder}/fork`, "rust/crates/plain")}" }\n`,
        [`third_party/${folder}/fork/src/lib.rs`]: "",
        ...more,
      },
      {},
    ]),
    [
      // Cargo also takes the path dependencies, of every kind, of each crate
      // it finds below the folder, wherever they lie: here fork, which seed
      // only names as a dev-dependency (the review of nxr-8sf4xw).
      "paths, with the crate a dev-dependency, outside the entry's folder, of a crate below it",
      {
        "rust/Cargo.toml": rootManifest(
          "[patch.crates-io]",
          'model = { path = "crates/model" }',
          'types = { path = "../shared/crates/types" }',
        ),
        "rust/.cargo/config.toml": 'paths = ["../third_party"]\n',
        "third_party/fork": null,
        "third_party/seed/Cargo.toml": `${crate("seed")}\n[dev-dependencies]\nfork = { path = "../../outside/fork" }\n`,
        "third_party/seed/src/lib.rs": "",
        "outside/fork/Cargo.toml": `${crate("fork")}\n[dependencies]\nplain = { path = "../../rust/crates/plain" }\n`,
        "outside/fork/src/lib.rs": "",
        "nx.json": `${JSON.stringify({ plugins: [{ plugin: "@convesoft/nx-rust", exclude: ["third_party/**", "outside/**"] }] })}\n`,
      },
      {},
    ],
    [
      "a chain of two crates without a project",
      {
        "third_party/fork/Cargo.toml": (manifest) =>
          manifest.replace(
            'plain = { path = "../../rust/crates/plain" }',
            'bridge = { path = "../bridge" }',
          ),
        "third_party/bridge/Cargo.toml": `${crate("bridge")}\n[dependencies]\nplain = { path = "../../rust/crates/plain" }\n`,
        "third_party/bridge/src/lib.rs": "",
      },
      {},
    ],
    [
      "a path dependency written through a symbolic link",
      {
        "third_party/fork/Cargo.toml": (manifest) =>
          manifest.replace('"../../rust/crates/plain"', '"../alias"'),
      },
      { "third_party/alias": "../rust/crates/plain" },
    ],
  ])(
    "reach the members that use it through %s, with their keys and nx affected",
    async (_how, files, links) => {
      const { graph, keysDiffer, affected } = await changePlain(files, links);

      // Every member of rust that may use fork, and none of shared.
      expect(edges(graph).filter(([, target]) => target === "plain")).toEqual([
        ["api", "plain"],
        ["harness", "plain"],
        ["lone", "plain"],
        ["model", "plain"],
        ["rust", "plain"],
        ["util", "plain"],
        ["viaw", "plain"],
      ]);
      expect(keysDiffer).toEqual({
        "api:test": true,
        "api:build": true,
        "harness:test": true,
        "lone:test": true,
        "types:test": false,
      });
      expect(affected).toEqual([
        "api",
        "harness",
        "lone",
        "model",
        "plain",
        "rust",
        "util",
        "viaw",
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it(
    "turn an inherited use that would close a cycle into an input, as for a redirected crate with a project",
    async () => {
      // plain depends by path on harness and lone, so cargo would reject the
      // use of fork, which depends on plain, by either of them; api uses
      // fork directly, and that edge stays.
      const { graph, keysDiffer, affected } = await changePlain({
        "rust/crates/plain/Cargo.toml": (manifest) =>
          `${manifest}\n[dependencies]\nharness = { path = "../harness" }\nlone = { path = "../lone" }\n`,
      });

      expect(edges(graph)).toContainEqual(["api", "plain"]);
      expect(edges(graph)).toContainEqual(["plain", "harness"]);
      expect(edges(graph)).toContainEqual(["plain", "lone"]);
      expect(edges(graph)).not.toContainEqual(["harness", "plain"]);
      expect(edges(graph)).not.toContainEqual(["lone", "plain"]);
      for (const member of ["harness", "lone"]) {
        expect({ member, inputs: graph.projects[member].targets.check.inputs }).toEqual({
          member,
          inputs: expect.arrayContaining(["{workspaceRoot}/rust/crates/plain/**/*"]),
        });
      }
      expect(keysDiffer).toMatchObject({
        "api:test": true,
        "harness:test": true,
        "lone:test": true,
        "types:test": false,
      });
      expect(affected).toEqual(expect.arrayContaining(["api", "harness", "lone"]));
    },
    HARNESS_TIMEOUT,
  );

  // rust's [patch] keeps model and types; fork comes from below the folder
  // of paths, as in the reproduction of nxr-8sf4xw.
  const pathsAbove: FileChanges = {
    "rust/Cargo.toml": rootManifest(
      "[patch.crates-io]",
      'model = { path = "crates/model" }',
      'types = { path = "../shared/crates/types" }',
    ),
    "rust/.cargo/config.toml": 'paths = ["../third_party"]\n',
  };

  it(
    "request a report for each crate that cargo takes from below a paths folder, and warn for one that cargo cannot read or report",
    async () => {
      // Besides fork and leaf, third_party holds a manifest that is no valid
      // TOML, a crate in a virtual workspace that does not list it, rust's
      // artifact directory, a node_modules folder and a hidden folder, each
      // with a crate. Cargo walks all of them but the hidden folder.
      const workspace = FixtureWorkspace.create("patched-workspaces", forkUsesPlain, pathsAbove, {
        "rust/.cargo/config.toml":
          'paths = ["../third_party"]\n\n[build]\ntarget-dir = "../third_party/out"\n',
        "third_party/broken/Cargo.toml": "not toml [\n",
        "third_party/group/Cargo.toml": "[workspace]\nmembers = []\n",
        "third_party/group/refused/Cargo.toml": crate("refused"),
        "third_party/group/refused/src/lib.rs": "",
        "third_party/out/package/copy/Cargo.toml": crate("copy"),
        "third_party/out/package/copy/src/lib.rs": "",
        "third_party/node_modules/js/Cargo.toml": crate("js"),
        "third_party/node_modules/js/src/lib.rs": "",
        "third_party/.hidden/h/Cargo.toml": crate("h"),
      });
      try {
        const graph = await workspace.graph();
        const reports = workspace
          .cargoCalls()
          .filter((call) => call.args[0] === "metadata")
          .map((call) => [call.cwd, call.args.at(-1)]);
        const shown = await workspace.nx(["show", "projects"]);
        const failed = (manifest: string) =>
          `To have those crates followed, fix what cargo reports, so that \`cargo metadata --no-deps --manifest-path ${manifest}\` succeeds in rust, or declare their files with fileInputs in the [package.metadata.nx] or [workspace.metadata.nx] table of the crates that use it.`;

        // leaf holds .cargo-checksum.json and gets no report.
        expect(reports).toEqual([
          ["rust", "{workspaceRoot}/rust/Cargo.toml"],
          ["shared", "{workspaceRoot}/shared/Cargo.toml"],
          ["rust", "{workspaceRoot}/third_party/broken/Cargo.toml"],
          ["rust", "{workspaceRoot}/third_party/fork/Cargo.toml"],
          ["rust", "{workspaceRoot}/third_party/group/Cargo.toml"],
          ["rust", "{workspaceRoot}/third_party/group/refused/Cargo.toml"],
          ["rust", "{workspaceRoot}/third_party/node_modules/js/Cargo.toml"],
          ["rust", "{workspaceRoot}/third_party/out/package/copy/Cargo.toml"],
        ]);
        expect(edges(graph)).toContainEqual(["api", "plain"]);
        expect(shown.status).toBe(0);
        expect(shown.output).toContain("`cargo metadata` failed for third_party/broken/Cargo.toml");
        expect(shown.output).toContain(failed("third_party/broken/Cargo.toml"));
        // A crate that cargo refuses to report keeps its folder and loses
        // what lies behind it, and the warning says so and what to do.
        expect(shown.output).toContain(
          "`cargo metadata` failed for third_party/group/refused/Cargo.toml",
        );
        expect(shown.output).toContain("believes it's in a workspace when it's not");
        expect(shown.output).toContain(
          "nx-rust goes on without its report, so it does not follow the crates that this crate depends on by path: the crates that use it take only its own folder into their cache keys, and a change in a crate behind it can leave their keys unchanged.",
        );
        expect(shown.output).toContain(failed("third_party/group/refused/Cargo.toml"));
        for (const manifest of [
          "third_party/broken/Cargo.toml",
          "third_party/group/refused/Cargo.toml",
        ]) {
          expect({
            manifest,
            warned: warnedProjects(graph, `nx-rust: \`cargo metadata\` failed for ${manifest}`),
          }).toEqual({ manifest, warned: [...rustProjects, "lone"].sort() });
        }
        // The crates without a project join the named input of api, which
        // may use them; Nx sees no file in node_modules, so js joins none.
        expect(graph.projects.api.namedInputs.default).toEqual(
          expect.arrayContaining([
            "{workspaceRoot}/third_party/group/refused/**/*",
            "{workspaceRoot}/third_party/out/package/copy/**/*",
          ]),
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "reach the members through a crate added below a paths folder after the Nx daemon created the graph",
    async () => {
      const workspace = FixtureWorkspace.create("patched-workspaces", forkUsesPlain, pathsAbove, {
        "third_party/fork": null,
      });
      const daemon = { NX_DAEMON: "true" };
      const affected = async () => {
        const { status, output } = await runNx(
          workspace,
          ["show", "projects", "--affected", `--files=${plainSource}`, "--json"],
          daemon,
        );
        expect({ status, output }).toEqual({ status: 0, output: expect.any(String) });
        // The JSON is the last line, after any warning of graph creation.
        return JSON.parse(output.trim().split("\n").pop()).sort();
      };
      try {
        expect(await affected()).toEqual(["plain", "rust"]);
        applyFileChanges(workspace.root, {
          "third_party/fork/Cargo.toml": `${crate("fork")}\n[dependencies]\nplain = { path = "../../rust/crates/plain" }\n`,
          "third_party/fork/src/lib.rs": "",
        });

        expect(await affected()).toEqual([
          "api",
          "harness",
          "lone",
          "model",
          "plain",
          "rust",
          "util",
          "viaw",
        ]);
      } finally {
        await workspace.nx(["daemon", "--stop"], daemon);
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );
});

describe("the crates that cargo builds with a crate whose edge is left out", () => {
  const crate = (name: string, ...lines: string[]) =>
    [`[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2024"\n`, ...lines, ""].join("\n");
  // In place of patched-workspaces' crates, rust has the members a, b, c and
  // d, and b depends on c by path. The graph and the keys need no registry
  // for the registry crates.
  const members: FileChanges = {
    rust: null,
    shared: null,
    third_party: null,
    "rust/Cargo.toml": '[workspace]\nmembers = ["crates/*"]\nresolver = "3"\n',
    "rust/crates/a/Cargo.toml": crate("a"),
    "rust/crates/a/src/lib.rs": "",
    "rust/crates/b/Cargo.toml": crate("b", "[dependencies]", 'c = { path = "../c" }'),
    "rust/crates/b/src/lib.rs": "",
    "rust/crates/c/Cargo.toml": crate("c"),
    "rust/crates/c/src/lib.rs": "",
    "rust/crates/d/Cargo.toml": crate("d"),
    "rust/crates/d/src/lib.rs": "",
  };
  // x, which nx.json excludes, depends on b by path.
  const x: FileChanges = {
    "third_party/x/Cargo.toml": crate(
      "x",
      "[workspace]",
      "[dependencies]",
      'b = { path = "../../rust/crates/b" }',
    ),
    "third_party/x/src/lib.rs": "",
  };
  const cSource = "rust/crates/c/src/lib.rs";
  // d uses nothing, so its key is the control.
  const tasks = ["a:test", "a:build", "a:check", "b:test", "d:test"];

  it.each<[string, FileChanges]>([
    [
      // a may use x through the registry crate wrapper, and b, behind x, may
      // use a through other: two possible uses in opposite directions. Cargo
      // builds a -> wrapper -> x -> b -> c.
      "a's possible use of b behind x yields to b's possible use of a",
      {
        ...x,
        "rust/Cargo.toml": rootManifest(
          "[patch.crates-io]",
          'x = { path = "../third_party/x" }',
          'a = { path = "crates/a" }',
        ),
        "rust/crates/a/Cargo.toml": crate("a", "[dependencies]", 'wrapper = "0.1"'),
        "rust/crates/b/Cargo.toml": (manifest) => `${manifest}other = "0.1"\n`,
      },
    ],
    [
      // a may use x only through leaf, a crate of a directory source without
      // a report; b dev-depends on a, so a's assumed use of b behind x gives
      // way. Cargo builds a -> leaf -> x -> b -> c.
      "a's assumed use of b behind x yields to b's dev-dependency on a",
      {
        ...x,
        "rust/Cargo.toml": rootManifest("[patch.crates-io]", 'x = { path = "../third_party/x" }'),
        "rust/crates/a/Cargo.toml": crate(
          "a",
          "[dependencies]",
          'leaf = { path = "../../../third_party/leaf" }',
        ),
        "third_party/leaf/Cargo.toml": crate("leaf", "[dependencies]", 'x = "0.1"'),
        "third_party/leaf/src/lib.rs": "",
        "third_party/leaf/.cargo-checksum.json": '{"files":{},"package":null}\n',
        "rust/crates/b/Cargo.toml": (manifest) =>
          `${manifest}\n[dev-dependencies]\na = { path = "../a" }\n`,
      },
    ],
    [
      // rust redirects a and b to themselves, and each may use the other
      // through a registry crate. Cargo can build a -> wrapper -> b -> c.
      "a's possible use of the redirected b yields to b's possible use of a",
      {
        "rust/Cargo.toml": rootManifest(
          "[patch.crates-io]",
          'a = { path = "crates/a" }',
          'b = { path = "crates/b" }',
        ),
        "rust/crates/a/Cargo.toml": crate("a", "[dependencies]", 'wrapper = "0.1"'),
        "rust/crates/b/Cargo.toml": (manifest) => `${manifest}other = "0.1"\n`,
      },
    ],
  ])(
    "give the member what lies behind the crate, where %s",
    async (_case, files) => {
      const workspace = FixtureWorkspace.create("patched-workspaces", members, files);
      try {
        const graph = await workspace.graph();
        const before = await workspace.hashTasks(tasks);
        applyFileChanges(workspace.root, { [cSource]: (current) => `${current}// changed\n` });
        const after = await workspace.hashTasks(tasks);
        const { status, output } = await runNx(workspace, [
          "show",
          "projects",
          "--affected",
          `--files=${cSource}`,
          "--json",
        ]);

        expect(edges(graph)).not.toContainEqual(["a", "b"]);
        expect(edges(graph)).toContainEqual(["b", "c"]);
        expect(graph.projects.a.targets.check.inputs).toEqual(
          expect.arrayContaining([
            "{workspaceRoot}/rust/crates/b/**/*",
            "{workspaceRoot}/rust/crates/c/**/*",
          ]),
        );
        expect(
          Object.fromEntries(tasks.map((task) => [task, before[task].value !== after[task].value])),
        ).toEqual({
          "a:test": true,
          "a:build": true,
          "a:check": true,
          "b:test": true,
          "d:test": false,
        });
        expect(status).toBe(0);
        // The JSON is the last line, after any warning of graph creation.
        expect(JSON.parse(output.trim().split("\n").pop()).sort()).toEqual(["a", "b", "c", "rust"]);
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "give the member each variable and command that the crates behind it add once, as for a path dependency without a project",
    async () => {
      // As in the first case above: a has no edge to b, which depends on c.
      // b and c add variables and a command, some twice and some that a has
      // already through its workspace's table or its targets. d depends by
      // path on p, which nx.json excludes, and both add SHARED.
      const table = (envInputs: string[], runtimeInputs: string[] = []) =>
        `\n[package.metadata.nx]\nenvInputs = ${JSON.stringify(envInputs)}\nruntimeInputs = ${JSON.stringify(runtimeInputs)}\n`;
      const workspace = FixtureWorkspace.create("patched-workspaces", members, x, {
        "rust/Cargo.toml": `${rootManifest(
          "[patch.crates-io]",
          'x = { path = "../third_party/x" }',
          'a = { path = "crates/a" }',
        )}\n[workspace.metadata.nx]\nenvInputs = ["WORKSPACE"]\n`,
        "rust/crates/a/Cargo.toml": crate("a", "[dependencies]", 'wrapper = "0.1"'),
        "rust/crates/b/Cargo.toml": (manifest) =>
          `${manifest}other = "0.1"\n${table(["SHARED", "B"], ["echo b"])}`,
        "rust/crates/c/Cargo.toml": (manifest) =>
          `${manifest}${table(["SHARED", "RUSTFLAGS", "WORKSPACE"], ["echo b"])}`,
        "rust/crates/d/Cargo.toml": (manifest) =>
          `${manifest}\n[dependencies]\np = { path = "../../../third_party/p" }\n${table(["SHARED"])}`,
        "third_party/p/Cargo.toml": `${crate("p", "[workspace]")}${table(["SHARED", "P"], ["echo p"])}`,
        "third_party/p/src/lib.rs": "",
      });
      let graph: FixtureGraph;
      try {
        graph = await workspace.graph();
      } finally {
        workspace.remove();
      }
      const { a, d } = graph.projects;
      const times = (inputs: unknown[], entry: object) =>
        inputs.filter((input) => JSON.stringify(input) === JSON.stringify(entry)).length;
      const added = [
        { env: "SHARED" },
        { env: "B" },
        { env: "RUSTFLAGS" },
        { env: "WORKSPACE" },
        { runtime: "echo b" },
      ];

      expect(edges(graph)).not.toContainEqual(["a", "b"]);
      expect(
        added.map((entry) => times([...a.namedInputs.default, ...a.targets.check.inputs], entry)),
      ).toEqual(added.map(() => 1));
      expect(
        [{ env: "SHARED" }, { env: "P" }, { env: "WORKSPACE" }, { runtime: "echo p" }].map(
          (entry) => times(d.namedInputs.default, entry),
        ),
      ).toEqual([1, 1, 1, 1]);
    },
    HARNESS_TIMEOUT,
  );
});

// The folders of the crates that `cargo tree` shows for a package with all
// three kinds of dependency, offline and from the lockfile.
function cargoTree(cwd: string, pkg: string): string[] {
  const output = execFileSync(
    "cargo",
    ["tree", "--offline", "--locked", "-p", pkg, "-e", "normal,build,dev", "--prefix", "none"],
    { cwd, env: testEnvironment(), encoding: "utf8" },
  );
  return output
    .split("\n")
    .map((line) => /\((\/[^)]*)\)/.exec(line)?.[1])
    .filter((folder): folder is string => folder !== undefined);
}

// The projects that `from` reaches through edges.
function reachable(graph: FixtureGraph, from: string): string[] {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const source = queue.shift();
    for (const edge of graph.dependencies) {
      if (edge.source === source && !seen.has(edge.target)) {
        seen.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return [...seen].sort();
}
