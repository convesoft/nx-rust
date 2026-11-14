import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyFileChanges,
  CargoCall,
  FileChanges,
  FixtureGraph,
  FixtureName,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  LocalRegistry,
  pluginEntry,
  RegistryCrate,
  testEnvironment,
} from "./harness";

// Checks the part of VER-GRAPH about the crates that `cargo vendor` writes,
// which hold `.cargo-checksum.json`. Each test vendors for real: a registry
// outside the repository holds `hello`, which depends on `greet`, a member
// depends on `hello`, and `cargo vendor` copies both into the fixture's
// copy. Nothing third-party is committed, and the registry needs no network.

/** The crates of the local registry, in the order they are published. */
const registryCrates: RegistryCrate[] = [
  {
    name: "greet",
    version: "0.1.0",
    source: 'pub fn greet() -> &\'static str {\n    "hello"\n}\n',
  },
  {
    name: "hello",
    version: "0.1.0",
    dependencies: [{ name: "greet", req: "^0.1" }],
    source: "pub fn hello() -> &'static str {\n    greet::greet()\n}\n",
  },
];

/**
 * In the repository at `root`, adds `hello = "0.1"` to the crate in `member`
 * and runs `cargo vendor` in `workspace`, both relative to `root`, into
 * `directory`, relative to the workspace, from the registry. Cargo updates
 * the workspace's `Cargo.lock`.
 *
 * @returns The `[source]` tables that `cargo vendor` prints for the
 *   workspace's `.cargo/config.toml`.
 */
function vendor(
  registry: LocalRegistry,
  root: string,
  workspace: string,
  member: string,
  directory: string,
): string {
  applyFileChanges(root, {
    [`${member}/Cargo.toml`]: (manifest) => `${manifest}\n[dependencies]\nhello = "0.1"\n`,
  });
  return execFileSync("cargo", ["vendor", "--respect-source-config", directory], {
    cwd: join(root, workspace),
    env: testEnvironment({ CARGO_HOME: registry.cargoHome }),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The `cargo metadata` calls of graph creation, which name the manifests that the plugin read. */
function metadataCalls(calls: CargoCall[]): CargoCall[] {
  return calls.filter((call) => call.args[0] === "metadata");
}

/** The call that reads the workspace whose root manifest is in `root`. */
function workspaceCall(root: string): CargoCall {
  return {
    cwd: root,
    args: [
      "metadata",
      "--format-version",
      "1",
      "--no-deps",
      "--manifest-path",
      `{workspaceRoot}/${root}/Cargo.toml`,
    ],
  };
}

/** Each edge as source and target. */
function edges(graph: FixtureGraph): string[] {
  return graph.dependencies.map((edge) => `${edge.source} -> ${edge.target}`).sort();
}

describe("crates that cargo vendor writes", () => {
  let base: string;
  let registry: LocalRegistry;
  // An empty Cargo home: what cargo uses must come from the repository.
  let emptyHome: string;

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-vendored-")));
    registry = LocalRegistry.create(registryCrates);
    emptyHome = join(base, "empty-home");
    mkdirSync(emptyHome);
  }, HARNESS_TIMEOUT);

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
    registry.remove();
  });

  /** One way of vendoring into a fixture: the fixture, the workspace and its member that uses `hello`, and the vendor folder. */
  interface Placement {
    fixture: FixtureName;
    workspace: string;
    member: string;
    /** The member's package name. */
    pkg: string;
    /** The vendor folder, relative to the workspace, as `cargo vendor` takes it. */
    directory: string;
    /** The vendor folder, relative to the repository root. */
    vendor: string;
    /** The projects of the fixture, which vendoring must not change. */
    projects: string[];
    /** The workspaces whose reports graph creation requests. */
    workspaces: string[];
  }

  const inside: Placement = {
    fixture: "subfolder-workspace",
    workspace: "rust",
    member: "rust/crates/model",
    pkg: "model",
    directory: "vendor",
    vendor: "rust/vendor",
    projects: ["api", "codegen", "model", "rust", "testkit"],
    workspaces: ["rust"],
  };

  // In nested-folders, vendor/greet/Cargo.toml lies higher than the root
  // manifest of apps/Billing.API/rust_v2, the workspace that uses it.
  const outside: Placement = {
    fixture: "nested-folders",
    workspace: "apps/Billing.API/rust_v2",
    member: "apps/Billing.API/rust_v2/crates/gateway",
    pkg: "gateway",
    directory: "../../../vendor",
    vendor: "vendor",
    projects: ["apps-Billing.API-rust_v2", "gateway", "invoice", "services-billing"],
    workspaces: ["services/billing", "apps/Billing.API/rust_v2"],
  };

  /**
   * A copy of the placement's fixture in which `cargo vendor` has written the
   * vendor folder, with the `[source]` tables it printed in the workspace's
   * `.cargo/config.toml` unless `configure` is false.
   */
  function vendoredWorkspace(placement: Placement, configure = true): FixtureWorkspace {
    const copy = FixtureWorkspace.create(placement.fixture);
    try {
      const tables = vendor(
        registry,
        copy.root,
        placement.workspace,
        placement.member,
        placement.directory,
      );
      if (configure) {
        applyFileChanges(copy.root, { [`${placement.workspace}/.cargo/config.toml`]: tables });
      }
      copy.cargo.clear();
      return copy;
    } catch (error) {
      copy.remove();
      throw error;
    }
  }

  // Builds the member offline with an empty Cargo home, which only the
  // vendored sources make possible.
  function buildOffline(copy: FixtureWorkspace, placement: Placement): void {
    execFileSync("cargo", ["build", "--offline", "--locked", "--quiet", "-p", placement.pkg], {
      cwd: join(copy.root, placement.workspace),
      env: testEnvironment({ CARGO_HOME: emptyHome, CARGO_TARGET_DIR: join(base, "target") }),
      stdio: "pipe",
    });
  }

  async function projectNames(copy: FixtureWorkspace): Promise<string[]> {
    const shown = await copy.nx(["show", "projects", "--json"]);
    expect(shown.status).toBe(0);
    return JSON.parse(shown.output.slice(shown.output.indexOf("["))).sort();
  }

  describe.each([
    ["inside the workspace folder", inside],
    ["outside every workspace folder, higher than the workspace", outside],
  ])("with the vendor folder %s", (_where, placement) => {
    it(
      "get no project and no cargo call with the [source] tables that cargo vendor prints, and the workspace builds from them offline",
      async () => {
        const copy = vendoredWorkspace(placement);
        try {
          const graph = await copy.graph();
          const calls = metadataCalls(copy.cargoCalls());
          const shown = await projectNames(copy);
          buildOffline(copy, placement);

          expect(Object.keys(graph.projects).sort()).toEqual(placement.projects);
          expect(shown).toEqual(placement.projects);
          expect(calls).toEqual(placement.workspaces.map(workspaceCall));
        } finally {
          copy.remove();
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "get no project and no cargo call without any configuration",
      async () => {
        const copy = vendoredWorkspace(placement, false);
        try {
          const graph = await copy.graph();

          expect(Object.keys(graph.projects).sort()).toEqual(placement.projects);
          expect(metadataCalls(copy.cargoCalls())).toEqual(placement.workspaces.map(workspaceCall));
        } finally {
          copy.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });

  it(
    "are read like any crate once .cargo-checksum.json is gone, which fails inside the workspace folder",
    async () => {
      // The positive control: the marker is what keeps the plugin away.
      const copy = vendoredWorkspace(inside);
      try {
        rmSync(join(copy.root, "rust/vendor/greet/.cargo-checksum.json"));

        const failure = await copy.graph().catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(GraphCreationError);
        expect((failure as Error).message).toContain("rust/vendor/greet/Cargo.toml");
        expect((failure as Error).message).toContain(
          "current package believes it's in a workspace when it's not",
        );
        expect((failure as Error).message).toContain(
          "Fix what cargo reports, so that `cargo metadata --no-deps` succeeds in rust/vendor/greet.",
        );
      } finally {
        copy.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "leave a crate without .cargo-checksum.json in the same folder its project",
    async () => {
      const copy = vendoredWorkspace(outside);
      try {
        applyFileChanges(copy.root, {
          "vendor/extra/Cargo.toml":
            '[package]\nname = "extra"\nversion = "0.1.0"\nedition = "2024"\n',
          "vendor/extra/src/lib.rs": "",
        });

        const graph = await copy.graph();

        expect(Object.keys(graph.projects).sort()).toEqual([...outside.projects, "extra"].sort());
        // vendor/extra lies higher than the workspace in apps/, so it comes first.
        expect(metadataCalls(copy.cargoCalls())).toEqual([
          workspaceCall("services/billing"),
          workspaceCall("vendor/extra"),
          workspaceCall("apps/Billing.API/rust_v2"),
        ]);
      } finally {
        copy.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  it(
    "get no project from an entry that receives only the vendor folder",
    async () => {
      const copy = vendoredWorkspace(inside);
      try {
        applyFileChanges(copy.root, {
          "nx.json": `${JSON.stringify({
            plugins: [
              { plugin: pluginEntry(), exclude: ["rust/vendor/**"] },
              { plugin: pluginEntry(), include: ["rust/vendor/**"] },
            ],
          })}\n`,
        });

        const graph = await copy.graph();

        expect(Object.keys(graph.projects).sort()).toEqual(inside.projects);
        expect(metadataCalls(copy.cargoCalls())).toEqual([workspaceCall("rust")]);
      } finally {
        copy.remove();
      }
    },
    HARNESS_TIMEOUT,
  );

  describe("used by path", () => {
    const pathDependency: FileChanges = {
      "rust/crates/model/Cargo.toml": (manifest) =>
        `${manifest}greet = { path = "../../vendor/greet" }\n`,
    };

    it(
      "get a project with edges where cargo enrols them as members",
      async () => {
        const copy = vendoredWorkspace(inside);
        try {
          applyFileChanges(copy.root, pathDependency);

          const graph = await copy.graph();

          expect(Object.keys(graph.projects).sort()).toEqual([...inside.projects, "greet"].sort());
          expect(edges(graph)).toEqual(expect.arrayContaining(["model -> greet", "rust -> greet"]));
          expect(metadataCalls(copy.cargoCalls())).toEqual([workspaceCall("rust")]);
        } finally {
          copy.remove();
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "get no project and no cargo call where the workspace excludes them",
      async () => {
        const copy = vendoredWorkspace(inside);
        try {
          applyFileChanges(copy.root, {
            ...pathDependency,
            "rust/Cargo.toml": (manifest) =>
              manifest.replace("[workspace]", '[workspace]\nexclude = ["vendor"]'),
          });

          const graph = await copy.graph();

          expect(Object.keys(graph.projects).sort()).toEqual(inside.projects);
          expect(edges(graph).filter((edge) => edge.includes("greet"))).toEqual([]);
          expect(metadataCalls(copy.cargoCalls())).toEqual([workspaceCall("rust")]);
        } finally {
          copy.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });
});

// A [source] table names a folder that cargo takes a replaced source's
// packages from; it says nothing about the crates of the repository in that
// folder, which cargo still builds by path. None of these changes the graph.
describe("a [source] directory that names a folder of crates without .cargo-checksum.json", () => {
  const source = (directory: string) =>
    `[source.review]\ndirectory = ${JSON.stringify(directory)}\n`;

  // Every row has its setup, so that jest does not take the fourth parameter
  // for a done callback.
  const noSetup = () => ({});

  async function summary(
    fixture: FixtureName,
    files: FileChanges,
    setup: (copy: FixtureWorkspace) => Record<string, string> = noSetup,
  ) {
    const copy = FixtureWorkspace.create(fixture, files);
    try {
      const env = setup(copy);
      const graph = await copy.graph(env);
      return {
        projects: Object.keys(graph.projects).sort(),
        edges: edges(graph),
        calls: metadataCalls(copy.cargoCalls()),
      };
    } finally {
      copy.remove();
    }
  }

  it.each<[string, FixtureName, FileChanges, (copy: FixtureWorkspace) => Record<string, string>]>([
    [
      "another workspace's folder",
      "cross-workspace-path",
      { "backend/.cargo/config.toml": source("../shared") },
      noSetup,
    ],
    [
      "another workspace's folder through a symbolic link",
      "cross-workspace-path",
      { "backend/.cargo/config.toml": source("alias") },
      (copy) => {
        symlinkSync("../shared", join(copy.root, "backend/alias"));
        return {};
      },
    ],
    [
      "another workspace's folder from the Cargo home's configuration",
      "cross-workspace-path",
      {},
      (copy) => {
        const home = join(copy.root, "..", "cargo-home");
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, "config.toml"), source(join(copy.root, "shared")));
        return { CARGO_HOME: home };
      },
    ],
    ["the repository root", "two-workspaces", { ".cargo/config.toml": source(".") }, noSetup],
  ])(
    "leaves the graph unchanged when it names %s",
    async (_case, fixture, files, setup) => {
      const control = await summary(fixture, {});
      const changed = await summary(fixture, files, setup);

      expect(changed).toEqual(control);
      expect(control.projects.length).toBeGreaterThan(2);
    },
    HARNESS_TIMEOUT,
  );
});
