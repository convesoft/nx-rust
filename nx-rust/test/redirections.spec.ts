import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { readRedirections } from "../src/cargo/redirections";
import {
  FileChanges,
  FixtureGraph,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  loadFixtureGraph,
  testEnvironment,
} from "./harness";

// Checks the parts of VER-GRAPH about crates that [patch], [replace] and
// paths redirect dependencies to. graph.spec.ts checks the edges of
// patched-workspaces as committed, where rust/Cargo.toml patches model,
// types and fork; here the same redirections come from elsewhere.

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
    const found = await readRedirections(join(root, folder), {
      CARGO_HOME: join(root, "cargo-home"),
      ...env,
    });
    return found.map(({ table, folder, file }) => [
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

  it("takes [patch] and paths from .cargo/config.toml and .cargo/config in the workspace folder and above, against the folder that holds .cargo", async () => {
    write("ws/Cargo.toml", "[workspace]\n");
    write("ws/.cargo/config.toml", '[patch.crates-io]\nmodel = { path = "crates/model" }\n');
    write("ws/.cargo/config", 'paths = ["local/lexer"]\n');
    write(".cargo/config.toml", '[patch.crates-io]\ntypes = { path = "shared/types" }\n');
    write("ws/crates/api/.cargo/config.toml", '[patch.crates-io]\nignored = { path = "x" }\n');

    expect(await read("ws")).toEqual([
      ["paths", "ws/local/lexer", "ws/.cargo/config"],
      ["patch", "ws/crates/model", "ws/.cargo/config.toml"],
      ["patch", "shared/types", ".cargo/config.toml"],
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
      } finally {
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
        // util has no edge to model, which depends on it; plain has no
        // registry dependency.
        expect(JSON.parse(output.slice(output.indexOf("["))).sort()).toEqual([
          "api",
          "harness",
          "model",
          "rust",
          "viaw",
        ]);
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
