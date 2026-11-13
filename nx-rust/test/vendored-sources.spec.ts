import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  applyFileChanges,
  CargoCall,
  FixtureName,
  FixtureWorkspace,
  GraphCreationError,
  HARNESS_TIMEOUT,
  testEnvironment,
} from "./harness";

// Checks the part of VER-GRAPH about the crates that `cargo vendor` writes.
// Each test vendors for real: a registry outside the repository holds
// `hello`, which depends on `greet`, a member depends on `hello`, and
// `cargo vendor` copies both into the fixture's copy. Nothing third-party is
// committed, and the registry needs no network.

/** The crates of the local registry, in the order they are published. */
const registryCrates: { name: string; dependencies: string[]; source: string }[] = [
  {
    name: "greet",
    dependencies: [],
    source: 'pub fn greet() -> &\'static str {\n    "hello"\n}\n',
  },
  {
    name: "hello",
    dependencies: ["greet"],
    source: "pub fn hello() -> &'static str {\n    greet::greet()\n}\n",
  },
];

/** The projects that the vendored crates would get. */
const vendoredNames = registryCrates.map((crate) => crate.name);

/** The replacement that `cargo vendor` prints, with the folder it vendored into. */
function sourceReplacement(directory: string): string {
  return [
    "[source.crates-io]",
    'replace-with = "vendored-sources"',
    "",
    "[source.vendored-sources]",
    `directory = "${directory}"`,
    "",
  ].join("\n");
}

/**
 * A registry in a folder outside the repository holding {@link registryCrates},
 * packaged by the real `cargo package`, and a Cargo home whose configuration
 * replaces crates.io with it. Its index is a git repository and its crates are
 * downloaded through `file://` URLs, because Cargo 1.91's `cargo vendor`
 * fails on a `local-registry` source, looking for the crate files in the
 * Cargo home's cache.
 */
class LocalRegistry {
  readonly cargoHome: string;
  private readonly index: string;
  private readonly crates: string;

  constructor(readonly base: string) {
    this.index = join(base, "index");
    this.crates = join(base, "crates");
    this.cargoHome = join(base, "home");
    for (const folder of [this.index, this.crates, this.cargoHome]) {
      mkdirSync(folder, { recursive: true });
    }
    writeFileSync(
      join(this.index, "config.json"),
      `${JSON.stringify({ dl: `file://${this.crates}/{crate}-{version}.crate` })}\n`,
    );
    this.git("init", "-q");
    writeFileSync(
      join(this.cargoHome, "config.toml"),
      `[source.crates-io]\nreplace-with = "local"\n\n[source.local]\nregistry = "file://${this.index}"\n`,
    );
    for (const crate of registryCrates) {
      this.publish(crate.name, crate.dependencies, crate.source);
    }
  }

  // Packages the crate and adds it to the registry and its index.
  private publish(name: string, dependencies: string[], source: string): void {
    const folder = join(this.base, "sources", name);
    mkdirSync(join(folder, "src"), { recursive: true });
    writeFileSync(
      join(folder, "Cargo.toml"),
      [
        "[package]",
        `name = "${name}"`,
        'version = "0.1.0"',
        'edition = "2021"',
        'description = "A crate of the tests\' registry"',
        'license = "MIT"',
        "",
        "[dependencies]",
        ...dependencies.map((dependency) => `${dependency} = "0.1"`),
        "",
      ].join("\n"),
    );
    writeFileSync(join(folder, "src", "lib.rs"), source);
    execFileSync("cargo", ["package", "--allow-dirty", "--no-verify", "--quiet"], {
      cwd: folder,
      env: testEnvironment({ CARGO_HOME: this.cargoHome }),
      stdio: "pipe",
    });
    const crateFile = join(this.crates, `${name}-0.1.0.crate`);
    copyFileSync(join(folder, "target", "package", `${name}-0.1.0.crate`), crateFile);
    const entry = {
      name,
      vers: "0.1.0",
      deps: dependencies.map((dependency) => ({
        name: dependency,
        req: "^0.1",
        features: [],
        optional: false,
        default_features: true,
        target: null,
        kind: "normal",
      })),
      cksum: createHash("sha256").update(readFileSync(crateFile)).digest("hex"),
      features: {},
      yanked: false,
    };
    // Cargo's index layout for names of four or more characters.
    const indexFile = join(this.index, name.slice(0, 2), name.slice(2, 4), name);
    mkdirSync(dirname(indexFile), { recursive: true });
    writeFileSync(indexFile, `${JSON.stringify(entry)}\n`);
    this.git("add", "-A");
    this.git("commit", "-q", "-m", name);
  }

  private git(...args: string[]): void {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: this.index,
      env: testEnvironment(),
      stdio: "pipe",
    });
  }

  /**
   * In the repository at `root`, adds `hello = "0.1"` to the crate in
   * `member` and runs `cargo vendor` in `workspace`, both relative to `root`,
   * into `directory`, relative to the workspace. Cargo updates the
   * workspace's `Cargo.lock`.
   */
  vendor(root: string, workspace: string, member: string, directory: string): void {
    applyFileChanges(root, {
      [`${member}/Cargo.toml`]: (manifest) => `${manifest}\n[dependencies]\nhello = "0.1"\n`,
    });
    execFileSync("cargo", ["vendor", "--respect-source-config", "--quiet", directory], {
      cwd: join(root, workspace),
      env: testEnvironment({ CARGO_HOME: this.cargoHome }),
      stdio: "pipe",
    });
  }
}

describe("crates that cargo vendor writes", () => {
  let base: string;
  let registry: LocalRegistry;
  // An empty Cargo home: what cargo uses must come from the repository.
  let emptyHome: string;

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-vendored-")));
    registry = new LocalRegistry(base);
    emptyHome = join(base, "empty-home");
    mkdirSync(emptyHome);
  }, HARNESS_TIMEOUT);

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  /** A copy of `fixture` in which `cargo vendor` has written the vendor folder. */
  function vendoredWorkspace(
    fixture: FixtureName,
    workspace: string,
    member: string,
    directory: string,
  ): FixtureWorkspace {
    const copy = FixtureWorkspace.create(fixture);
    try {
      registry.vendor(copy.root, workspace, member, directory);
      return copy;
    } catch (error) {
      copy.remove();
      throw error;
    }
  }

  // Builds the member offline with an empty Cargo home, which only the
  // vendored sources make possible.
  function buildOffline(copy: FixtureWorkspace, workspace: string, pkg: string, home = emptyHome) {
    execFileSync("cargo", ["build", "--offline", "--locked", "--quiet", "-p", pkg], {
      cwd: join(copy.root, workspace),
      env: testEnvironment({ CARGO_HOME: home, CARGO_TARGET_DIR: join(base, "target") }),
      stdio: "pipe",
    });
  }

  // The cargo calls that read a manifest in the vendor folder or start there.
  function vendorCalls(calls: CargoCall[], vendor: string): CargoCall[] {
    return calls.filter(
      (call) =>
        call.cwd.startsWith(vendor) ||
        call.args.some((arg) => arg.includes(`/${vendor}/`) || arg.startsWith(`${vendor}/`)),
    );
  }

  async function projectNames(copy: FixtureWorkspace): Promise<string[]> {
    const shown = await copy.nx(["show", "projects", "--json"]);
    expect(shown.status).toBe(0);
    return JSON.parse(shown.output.slice(shown.output.indexOf("["))).sort();
  }

  describe("with the vendor folder inside the workspace folder", () => {
    const subfolderProjects = ["api", "codegen", "model", "rust", "testkit"];

    it(
      "get no project and no cargo call, and the workspace builds from them offline",
      async () => {
        const copy = vendoredWorkspace(
          "subfolder-workspace",
          "rust",
          "rust/crates/model",
          "vendor",
        );
        try {
          applyFileChanges(copy.root, { "rust/.cargo/config.toml": sourceReplacement("vendor") });

          const graph = await copy.graph();
          const shown = await projectNames(copy);
          buildOffline(copy, "rust", "model");

          expect(Object.keys(graph.projects).sort()).toEqual(subfolderProjects);
          expect(shown).toEqual(subfolderProjects);
          expect(vendorCalls(copy.cargoCalls(), "rust/vendor")).toEqual([]);
          // The positive control: the wrapper logs the plugin's calls.
          expect(copy.cargoCalls().length).toBeGreaterThan(0);
        } finally {
          copy.remove();
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "get no project when the replacement is in the Cargo home's configuration",
      async () => {
        const copy = vendoredWorkspace(
          "subfolder-workspace",
          "rust",
          "rust/crates/model",
          "vendor",
        );
        const home = join(base, "home-with-replacement");
        try {
          mkdirSync(home, { recursive: true });
          writeFileSync(
            join(home, "config.toml"),
            sourceReplacement(join(copy.root, "rust", "vendor")),
          );

          const graph = await copy.graph({ CARGO_HOME: home });
          buildOffline(copy, "rust", "model", home);

          expect(Object.keys(graph.projects).sort()).toEqual(subfolderProjects);
          expect(vendorCalls(copy.cargoCalls(), "rust/vendor")).toEqual([]);
        } finally {
          rmSync(home, { recursive: true, force: true });
          copy.remove();
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "fail graph creation with cargo's message when no configuration names the folder",
      async () => {
        // The positive control: the vendor folder alone is not recognised.
        const copy = vendoredWorkspace(
          "subfolder-workspace",
          "rust",
          "rust/crates/model",
          "vendor",
        );
        try {
          const failure = await copy.graph().catch((error: unknown) => error);

          expect(failure).toBeInstanceOf(GraphCreationError);
          expect((failure as Error).message).toContain("rust/vendor/greet/Cargo.toml");
          expect((failure as Error).message).toContain(
            "current package believes it's in a workspace when it's not",
          );
        } finally {
          copy.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });

  describe("with the vendor folder outside every workspace folder", () => {
    // In nested-folders, vendor/greet/Cargo.toml lies higher than the root
    // manifest of apps/Billing.API/rust_v2, whose configuration names it, and
    // services/billing, read first, does not read that configuration.
    const workspace = "apps/Billing.API/rust_v2";
    const member = `${workspace}/crates/gateway`;
    const nestedProjects = ["apps-Billing.API-rust_v2", "gateway", "invoice", "services-billing"];

    it(
      "get no project and no cargo call, and the workspace builds from them offline",
      async () => {
        const copy = vendoredWorkspace("nested-folders", workspace, member, "../../../vendor");
        try {
          applyFileChanges(copy.root, {
            [`${workspace}/.cargo/config.toml`]: sourceReplacement("../../../vendor"),
          });

          const graph = await copy.graph();
          const shown = await projectNames(copy);
          buildOffline(copy, workspace, "gateway");

          expect(Object.keys(graph.projects).sort()).toEqual(nestedProjects);
          expect(shown).toEqual(nestedProjects);
          expect(vendorCalls(copy.cargoCalls(), "vendor")).toEqual([]);
        } finally {
          copy.remove();
        }
      },
      HARNESS_TIMEOUT,
    );

    it(
      "become standalone crates when no configuration names the folder",
      async () => {
        // The positive control: without the replacement, cargo reports each
        // vendored crate as a crate of its own.
        const copy = vendoredWorkspace("nested-folders", workspace, member, "../../../vendor");
        try {
          const graph = await copy.graph();

          expect(Object.keys(graph.projects).sort()).toEqual(
            [...nestedProjects, ...vendoredNames].sort(),
          );
          expect(vendorCalls(copy.cargoCalls(), "vendor")).not.toEqual([]);
        } finally {
          copy.remove();
        }
      },
      HARNESS_TIMEOUT,
    );
  });
});
