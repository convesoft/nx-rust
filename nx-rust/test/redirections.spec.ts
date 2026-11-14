import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
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
  withoutColours,
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

  it("skips an included file that is no valid TOML, with a warning that names it", async () => {
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
    expect(found.warnings).toEqual([
      expect.stringContaining(
        `nx-rust: ${join(root, "ws/.cargo/broken.toml")}, which ${join(root, "ws/.cargo/config.toml")} includes, cannot be read`,
      ),
    ]);
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

  it("fails, naming the file, when a file it reads is no valid TOML", async () => {
    write("ws/Cargo.toml", "[workspace]\n");
    write("ws/.cargo/config.toml", "paths = [\n");

    await expect(read("ws")).rejects.toThrow(join(root, "ws/.cargo/config.toml"));
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

/** The [patch.crates-io] table of the fixture without model. */
const patchWithoutModel = [
  "[patch.crates-io]",
  'types = { path = "../shared/crates/types" }',
  'fork = { path = "../third_party/fork" }',
];

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
    [
      "paths in the workspace's .cargo/config.toml",
      {
        "rust/Cargo.toml": rootManifest(...patchWithoutModel),
        "rust/.cargo/config.toml": 'paths = ["crates/model"]\n',
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
        expect(after.output).toContain(`nx-rust: ${config} redirects dependencies`);
        // The Cargo home applies to both workspaces; shared has no member
        // with a registry dependency, so it gets no edge.
        expect(after.output).toContain("the Cargo workspaces in rust and shared through [patch]");
        expect(after.output).toContain("outside the repository");
        expect(after.output).toContain(
          "To let Nx follow the redirections, move them into the root Cargo.toml of the workspace that needs them or into a .cargo/config.toml inside the repository.",
        );
        // Every project of both workspaces repeats it at the start of its tasks.
        expect(warnedProjects(graph, `nx-rust: ${config} redirects dependencies`)).toEqual(
          Object.keys(graph.projects).sort(),
        );
      } finally {
        workspace.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "warn about configuration outside the repository again at the start of a task, where the Nx daemon keeps graph creation's output in its log",
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
      const warning = `nx-rust: ${config} redirects dependencies`;
      try {
        for (const task of ["types:fmt-check", "api:fmt-check"]) {
          const { status, output } = await workspace.nx(
            ["run", task, "--output-style=static"],
            env,
          );

          expect({ task, status }).toEqual({ task, status: 0 });
          expect({ task, warned: withoutColours(output).includes(warning) }).toEqual({
            task,
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
          "To have them followed, fix what cargo reports, so that `cargo metadata --no-deps --manifest-path rust/local/Cargo.toml` succeeds in rust.",
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

        expect(edges(graph)).toEqual(committed);
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
