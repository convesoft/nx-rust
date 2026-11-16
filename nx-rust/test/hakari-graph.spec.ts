import type { ProjectConfiguration } from "@nx/devkit";
import {
  type FileChanges,
  FixtureWorkspace,
  HARNESS_TIMEOUT,
  composed,
  hakariConfiguration,
  hakariWorkspace,
  testHost,
  type ThirdPartyRepository,
  thirdPartyRepository,
} from "./harness";

// The graph-time part of VER-BATCHING's hakari cases (DES-UNIFICATION, "When
// the hack crate is enough", "Fallback", "Drift", "What the keys hold"):
// which strategy graph creation chooses for a workspace with a cargo-hakari
// configuration, the warning of the fallback, the hakari-check target and
// the inputs. No cargo-hakari runs here; the hack crate is written as
// cargo-hakari 0.9.39 generates it (`hakariWorkspace` in the harness).

const host = testHost();
let repository: ThirdPartyRepository;

beforeAll(() => {
  repository = thirdPartyRepository();
});

afterAll(() => {
  repository?.remove();
});

interface Outcome {
  /** The strategy that the workspace project's metadata records. */
  strategy: string | undefined;
  /** The warnings of the workspace's projects that concern the strategy. */
  warnings: string[];
  /** The projects of the graph, by name. */
  projects: Record<string, ProjectConfiguration>;
}

/** Creates the graph of the hakari workspace with `changes`, and what it says about the strategy. */
async function outcome(changes: FileChanges = {}): Promise<Outcome> {
  const workspace = FixtureWorkspace.create(
    "subfolder-workspace",
    composed(hakariWorkspace("hakari", repository, host), changes),
  );
  try {
    const { projects } = await workspace.graph();
    const metadata = (name: string) =>
      (projects[name]?.metadata as { cargo?: { featureUnification?: string; warnings?: string[] } })
        ?.cargo;
    return {
      strategy: metadata("a")?.featureUnification,
      warnings: (metadata("a")?.warnings ?? []).filter(
        (warning) => warning.includes("hakari") || warning.includes("platforms"),
      ),
      projects,
    };
  } finally {
    workspace.remove();
  }
}

// Replaces `from` by `to` in a file of the hakari workspace.
const edit =
  (from: string | RegExp, to: string) =>
  (content: string | undefined): string => {
    const edited = (content ?? "").replace(from, to);
    if (edited === content) {
      throw new Error(`${String(from)} is not in:\n${content}`);
    }
    return edited;
  };

/** A member `c` of the hakari workspace with `manifest` lines after its package table. */
function memberC(...lines: string[]): FileChanges {
  return {
    "hakari/Cargo.toml": edit('"b", ', '"b", "c", '),
    "hakari/c/Cargo.toml": [
      "[package]",
      'name = "c"',
      'version = "0.1.0"',
      'edition = "2024"',
      "",
      ...lines,
      "",
    ].join("\n"),
    "hakari/c/src/lib.rs": "",
  };
}

const dependency = (line: string, table = "[dependencies]") => ({
  "hakari/a/Cargo.toml": edit(
    "[dependencies]\n",
    `${table}\n${line}\n${table === "[dependencies]" ? "" : "\n[dependencies]\n"}`,
  ),
});

describe("the hakari strategy at graph creation", () => {
  it(
    "uses hakari where every check passes, with hakari-check, the hack crate's manifest and the configuration in the keys, and no other member's manifest",
    async () => {
      const { strategy, warnings, projects } = await outcome();
      expect({ strategy, warnings }).toEqual({ strategy: "hakari", warnings: [] });
      const workspaceProject = Object.values(projects).find(
        (project) => project.root === "hakari",
      ) as ProjectConfiguration;
      const check = workspaceProject.targets?.["hakari-check"];
      expect(check).toMatchObject({
        executor: "@convesoft/nx-rust:lockfile",
        cache: false,
        dependsOn: [{ projects: ["directory:hakari"], target: "lockfile" }],
      });
      expect(check?.inputs).toEqual(
        expect.arrayContaining(["{workspaceRoot}/hakari/.config/hakari.toml"]),
      );
      for (const target of ["build", "check", "lint", "test"]) {
        expect(projects.a.targets?.[target]?.dependsOn).toEqual([
          { projects: ["directory:hakari"], target: "lockfile" },
          { projects: ["directory:hakari"], target: "hakari-check" },
        ]);
        const inputs = projects.a.targets?.[target]?.inputs ?? [];
        expect(inputs).toEqual(
          expect.arrayContaining([
            "{workspaceRoot}/hakari/workspace-hack/Cargo.toml",
            "{workspaceRoot}/hakari/.config/hakari.toml",
            {
              dependentTasksOutputFiles: ".nx/workspace-data/nx-rust/lockfile/hakari/a.digest",
            },
          ]),
        );
        expect(inputs).not.toContain("{workspaceRoot}/hakari/b/Cargo.toml");
        expect(
          (projects.a.targets?.[target]?.metadata as { cargo?: { everyDigest?: boolean } })?.cargo
            ?.everyDigest,
        ).toBeUndefined();
      }
      expect(projects.a.targets?.["fmt-check"]?.dependsOn ?? []).toEqual([]);
      expect(
        (projects.a.metadata as { cargo?: { hakariPlatforms?: string[] } }).cargo?.hakariPlatforms,
      ).toEqual([host]);
      // doc builds every member, and depends on the drift check as well.
      expect(workspaceProject.targets?.doc?.dependsOn).toEqual([
        { projects: ["directory:hakari"], target: "lockfile" },
        { projects: ["directory:hakari"], target: "hakari-check" },
      ]);
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, FileChanges, string, string]>([
    [
      "a features list on a member",
      {
        ...memberC("[features]", "g = []"),
        ...dependency('c = { path = "../c", features = ["g"] }'),
      },
      "a member asks a feature of another member",
      "asks the member c for the features g",
    ],
    [
      "default-features = false on a member that has a default feature",
      {
        ...memberC("[features]", 'default = ["g"]', "g = []"),
        ...dependency('c = { path = "../c", default-features = false }'),
      },
      "a member asks a feature of another member",
      "turns off the default features of the member c",
    ],
    [
      "default-features = false on a member that declares default = []",
      {
        ...memberC("[features]", "default = []"),
        ...dependency('c = { path = "../c", default-features = false }'),
      },
      "a member asks a feature of another member",
      "turns off the default features of the member c",
    ],
    [
      "c/g in a member's features, through a renamed and optional dependency",
      {
        ...memberC("[features]", "g = []"),
        "hakari/a/Cargo.toml": edit(
          "[dependencies]\n",
          '[features]\nwith = ["renamed/g"]\n\n[dependencies]\nrenamed = { package = "c", path = "../c", optional = true }\n',
        ),
      },
      "a member asks a feature of another member",
      'turns on "renamed/g", a feature of the member c',
    ],
    [
      "c?/g in a member's features, through a dependency inherited with workspace = true",
      {
        ...memberC("[features]", "g = []"),
        "hakari/Cargo.toml": (manifest) =>
          `${edit('"b", ', '"b", "c", ')(manifest)}\n[workspace.dependencies]\nc = { path = "c" }\n`,
        "hakari/a/Cargo.toml": edit(
          "[dependencies]\n",
          '[features]\nwith = ["c?/g"]\n\n[dependencies]\nc = { workspace = true, optional = true }\n',
        ),
      },
      "a member asks a feature of another member",
      'turns on "c?/g", a feature of the member c',
    ],
    [
      "a features list under a cfg table and as a dev-dependency",
      {
        ...memberC("[features]", "g = []"),
        ...dependency(
          'c = { path = "../c", features = ["g"] }',
          "[target.'cfg(unix)'.dev-dependencies]",
        ),
      },
      "a member asks a feature of another member",
      "in a dev-dependency under [target.'cfg(unix)']",
    ],
    [
      "a member's dev-dependency on itself with features",
      {
        "hakari/b/Cargo.toml": (manifest) =>
          `${edit("[dependencies]\n", "[features]\nself = []\n\n[dependencies]\n")(manifest)}\n[dev-dependencies]\nb = { path = ".", features = ["self"] }\n`,
      },
      "a member asks a feature of another member",
      "has a dev-dependency on its own crate b",
    ],
    [
      "the empty platforms of cargo hakari init",
      { "hakari/.config/hakari.toml": hakariConfiguration("workspace-hack", []) },
      "platforms does not list the host's triple",
      "is empty and not the host's triple",
    ],
    [
      "platforms with other triples only",
      {
        "hakari/.config/hakari.toml": hakariConfiguration("workspace-hack", [
          "aarch64-apple-darwin",
        ]),
      },
      "platforms does not list the host's triple",
      "lists aarch64-apple-darwin and not the host's triple",
    ],
    [
      "a path crate outside the workspace that depends on a member through a normal dependency",
      {
        "outside/Cargo.toml":
          '[package]\nname = "outside"\nversion = "0.1.0"\nedition = "2024"\n\n[workspace]\n\n[dependencies]\nb = { path = "../hakari/b" }\n',
        "outside/src/lib.rs": "",
        ...dependency('outside = { path = "../../outside" }'),
      },
      "a crate outside the workspace may reach a member",
      "the crate outside in outside, outside the workspace, depends on the member b through a normal dependency",
    ],
    [
      "such a crate behind another crate outside the workspace",
      {
        "outside/Cargo.toml":
          '[package]\nname = "outside"\nversion = "0.1.0"\nedition = "2024"\n\n[workspace]\n\n[dependencies]\ndeeper = { path = "../deeper" }\n',
        "outside/src/lib.rs": "",
        "deeper/Cargo.toml":
          '[package]\nname = "deeper"\nversion = "0.1.0"\nedition = "2024"\n\n[workspace]\n\n[build-dependencies]\nb = { path = "../hakari/b" }\n',
        "deeper/src/lib.rs": "",
        ...dependency('outside = { path = "../../outside" }'),
      },
      "a crate outside the workspace may reach a member",
      "depends on the member b through a build dependency",
    ],
    [
      "a [patch.crates-io] entry whose path is a member's folder",
      {
        "hakari/Cargo.toml": (manifest) => `${manifest}\n[patch.crates-io]\nb = { path = "b" }\n`,
      },
      "a crate outside the workspace may reach a member",
      "redirects to the member b",
    ],
    [
      "a path crate outside the workspace whose folder holds .cargo-checksum.json",
      {
        "vendor/Cargo.toml": '[package]\nname = "vendored"\nversion = "0.1.0"\nedition = "2024"\n',
        "vendor/src/lib.rs": "",
        "vendor/.cargo-checksum.json": '{"files":{},"package":null}',
        ...dependency('vendored = { path = "../../vendor" }'),
      },
      "a crate outside the workspace may reach a member",
      "whose folder holds .cargo-checksum.json",
    ],
    [
      "a configuration without hakari-package",
      { "hakari/.config/hakari.toml": `platforms = ["${host}"]\n` },
      "names no member as the hack crate",
      "has no hakari-package",
    ],
    [
      "a hakari-package that names no member",
      { "hakari/.config/hakari.toml": hakariConfiguration("missing-hack", [host]) },
      "names no member as the hack crate",
      'hakari-package in hakari/.config/hakari.toml is "missing-hack"',
    ],
    ...(
      [
        ['traversal-excludes = { workspace-members = ["b"] }', "traversal-excludes"],
        ['final-excludes = { third-party = [{ name = "x" }] }', "final-excludes"],
        [
          'workspace-hack-line-style = "version-only"',
          'workspace-hack-line-style = "version-only"',
        ],
        ['[registries]\nmine = { index = "https://example.com/index" }', "registries"],
        ["unknown-key = true", "unknown-key = true"],
      ] as const
    ).map(([line, named]): [string, FileChanges, string, string] => [
      `the setting ${line.split("\n")[0]}`,
      { "hakari/.config/hakari.toml": hakariConfiguration("workspace-hack", [host], [line]) },
      "has a setting that @convesoft/nx-rust does not accept",
      named,
    ]),
  ])(
    "falls back to workspace-build with the warning for %s",
    async (_case, changes, check, item) => {
      const { strategy, warnings, projects } = await outcome(changes);
      expect(strategy).toBe("workspace-build");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(
        "the Cargo workspace in hakari uses the feature strategy workspace-build in place of hakari",
      );
      expect(warnings[0]).toContain(check);
      expect(warnings[0]).toContain(item);
      expect(warnings[0]).toContain('featureUnification = "workspace-build"');
      const workspaceProject = Object.values(projects).find((project) => project.root === "hakari");
      expect(workspaceProject?.targets?.["hakari-check"]).toBeUndefined();
      expect(projects.a.targets?.build?.dependsOn).toEqual([
        { projects: ["directory:hakari"], target: "lockfile" },
      ]);
      expect(projects.a.targets?.build?.inputs).toContain("{workspaceRoot}/hakari/b/Cargo.toml");
      // The warning reaches every project of the workspace.
      expect(
        (projects.b.metadata as { cargo?: { warnings?: string[] } }).cargo?.warnings,
      ).toContain(warnings[0]);
    },
    HARNESS_TIMEOUT,
  );

  it.each<[string, FileChanges]>([
    ["a dependency with default features on a member", dependency('b = { path = "../b" }')],
    [
      "default-features = false on a member without a default feature",
      dependency('b = { path = "../b", default-features = false }'),
    ],
    [
      "a path crate outside the workspace that reaches a member only through a dev-dependency",
      {
        "outside/Cargo.toml":
          '[package]\nname = "outside"\nversion = "0.1.0"\nedition = "2024"\n\n[workspace]\n\n[dev-dependencies]\nb = { path = "../hakari/b" }\n',
        "outside/src/lib.rs": "",
        ...dependency('outside = { path = "../../outside" }'),
      },
    ],
    ...[
      'resolver = "3"',
      'unify-target-host = "replicate-target-on-host"',
      "exact-versions = true",
      "output-single-feature = false",
      'workspace-hack-line-style = "workspace-dotted"',
      "traversal-excludes = { workspace-members = [], third-party = [] }",
      "final-excludes = {}",
    ].map((line): [string, FileChanges] => [
      `the setting ${line}`,
      {
        "hakari/.config/hakari.toml": (config) =>
          (config ?? "").replace(/^resolver = "2"\n/m, "") + `${line}\n`,
      },
    ]),
  ])(
    "keeps hakari for %s",
    async (_case, changes) => {
      const { strategy, warnings } = await outcome(changes);
      expect({ strategy, warnings }).toEqual({ strategy: "hakari", warnings: [] });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "checks nothing and warns about nothing where the workspace table sets workspace-build, and falls back with the warning where it sets hakari without a configuration",
    async () => {
      const set = (value: string) => ({
        "hakari/Cargo.toml": (manifest: string | undefined) =>
          `${manifest}\n[workspace.metadata.nx]\nfeatureUnification = "${value}"\n`,
      });
      const explicit = await outcome({
        ...set("workspace-build"),
        "hakari/.config/hakari.toml": hakariConfiguration("workspace-hack", []),
      });
      expect({ strategy: explicit.strategy, warnings: explicit.warnings }).toEqual({
        strategy: "workspace-build",
        warnings: [],
      });
      const missing = await outcome({ ...set("hakari"), "hakari/.config/hakari.toml": null });
      expect(missing.strategy).toBe("workspace-build");
      expect(missing.warnings).toEqual([
        expect.stringContaining("because it has no configuration of cargo-hakari"),
      ]);
      // Without a configuration and without a setting: workspace-build, no warning.
      const plain = await outcome({ "hakari/.config/hakari.toml": null });
      expect({ strategy: plain.strategy, warnings: plain.warnings }).toEqual({
        strategy: "workspace-build",
        warnings: [],
      });
      // The cargo strategy is set and not checked.
      const cargo = await outcome({
        ...set("cargo"),
        "hakari/.config/hakari.toml": hakariConfiguration("workspace-hack", []),
      });
      expect({ strategy: cargo.strategy, warnings: cargo.warnings }).toEqual({
        strategy: "cargo",
        warnings: [],
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives the hack crate no nx-release-publish whatever the strategy, also without publish = false, and a crate that no configuration names keeps it (VER-RELEASE, group 8)",
    async () => {
      const published = (projects: Record<string, ProjectConfiguration>, name: string) =>
        projects[name]?.targets?.["nx-release-publish"] !== undefined;
      const stub = { "hakari/workspace-hack/Cargo.toml": edit(/^publish = false\n/m, "") };
      const workspaceBuild = {
        "hakari/Cargo.toml": (manifest: string | undefined) =>
          `${manifest}\n[workspace.metadata.nx]\nfeatureUnification = "workspace-build"\n`,
      };
      for (const changes of [
        {},
        stub,
        { ...stub, ...workspaceBuild },
        {
          ...stub,
          "hakari/.config/hakari.toml": null,
          "hakari/.guppy/hakari.toml": hakariConfiguration("workspace-hack", []),
        },
      ] as FileChanges[]) {
        const { projects } = await outcome(changes);
        expect(published(projects, "workspace-hack")).toBe(false);
        expect(published(projects, "a")).toBe(true);
      }
      const { projects } = await outcome({ ...stub, "hakari/.config/hakari.toml": null });
      expect(published(projects, "workspace-hack")).toBe(true);
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "keeps hakari for a non-host triple that build.target or a crate's targetTriple sets and platforms does not list, and warns, naming the triple",
    async () => {
      const triple =
        host === "aarch64-unknown-linux-gnu"
          ? "x86_64-unknown-linux-gnu"
          : "aarch64-unknown-linux-gnu";
      for (const changes of [
        { "hakari/.cargo/config.toml": `[build]\ntarget = ["${host}", "${triple}"]\n` },
        {
          "hakari/b/Cargo.toml": (manifest: string | undefined) =>
            `${manifest}\n[package.metadata.nx.targets.check.options]\ntargetTriple = "${triple}"\n`,
        },
      ] as FileChanges[]) {
        const { strategy, warnings, projects } = await outcome(changes);
        expect(strategy).toBe("hakari");
        expect(warnings).toEqual([
          expect.stringContaining(
            `builds for the triple ${triple}, which platforms in hakari/.config/hakari.toml does not list`,
          ),
        ]);
        expect(
          Object.values(projects).find((project) => project.root === "hakari")?.targets?.[
            "hakari-check"
          ],
        ).toBeDefined();
      }
      // Listed, it draws no warning.
      const listed = await outcome({
        "hakari/.cargo/config.toml": `[build]\ntarget = ["${host}", "${triple}"]\n`,
        "hakari/.config/hakari.toml": hakariConfiguration("workspace-hack", [host, triple]),
      });
      expect({ strategy: listed.strategy, warnings: listed.warnings }).toEqual({
        strategy: "hakari",
        warnings: [],
      });
    },
    HARNESS_TIMEOUT,
  );
});
