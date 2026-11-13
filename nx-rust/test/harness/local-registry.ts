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
import { testEnvironment } from "./environment";

/** A dependency of a {@link RegistryCrate}. */
export interface RegistryDependency {
  /** The name the crate uses for it; the package's name unless `package` says otherwise. */
  name: string;
  /** The version requirement, such as `^1` or `>=1, <3`. */
  req: string;
  /** The package's name where `name` renames it. */
  package?: string;
  optional?: boolean;
}

/** A crate version to publish to a {@link LocalRegistry}. */
export interface RegistryCrate {
  name: string;
  version: string;
  dependencies?: RegistryDependency[];
  /** The crate's `[features]`. */
  features?: Record<string, string[]>;
  /** The content of `src/lib.rs`; empty by default. */
  source?: string;
}

/**
 * A registry in a folder outside any repository, which a Cargo home of its
 * own puts in place of crates.io, so that tests can lock, update and bump
 * registry crates without the network. Its index is a git repository and its
 * crates are downloaded through `file://` URLs, because Cargo 1.91's `cargo
 * vendor` fails on a `local-registry` source, looking for the crate files in
 * the Cargo home's cache. Each crate is packaged by the real `cargo
 * package`; publish a crate's dependencies first.
 *
 * Give commands `CARGO_HOME: registry.cargoHome`, and {@link remove} it
 * when done.
 */
export class LocalRegistry {
  /** The Cargo home whose configuration replaces crates.io with this registry. */
  readonly cargoHome: string;
  private readonly index: string;
  private readonly crates: string;

  private constructor(readonly base: string) {
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
    this.git("add", "-A");
    this.git("commit", "-q", "-m", "config");
    writeFileSync(
      join(this.cargoHome, "config.toml"),
      `[source.crates-io]\nreplace-with = "local"\n\n[source.local]\nregistry = "file://${this.index}"\n`,
    );
  }

  /** Creates an empty registry in a new temporary folder and publishes `crates` in order. */
  static create(crates: readonly RegistryCrate[] = []): LocalRegistry {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "nx-rust-registry-")));
    try {
      const registry = new LocalRegistry(base);
      for (const crate of crates) {
        registry.publish(crate);
      }
      return registry;
    } catch (error) {
      rmSync(base, { recursive: true, force: true });
      throw error;
    }
  }

  /** Packages the crate version and adds it to the registry and its index. */
  publish(crate: RegistryCrate): void {
    const folder = join(this.base, "sources", `${crate.name}-${crate.version}`);
    mkdirSync(join(folder, "src"), { recursive: true });
    const dependencies = crate.dependencies ?? [];
    writeFileSync(
      join(folder, "Cargo.toml"),
      [
        "[package]",
        `name = "${crate.name}"`,
        `version = "${crate.version}"`,
        'edition = "2021"',
        'description = "A crate of the tests\' registry"',
        'license = "MIT"',
        "",
        "[dependencies]",
        ...dependencies.map(
          (dependency) =>
            `${dependency.name} = { version = ${JSON.stringify(dependency.req)}${dependency.package === undefined ? "" : `, package = "${dependency.package}"`}${dependency.optional ? ", optional = true" : ""} }`,
        ),
        "",
        "[features]",
        ...Object.entries(crate.features ?? {}).map(
          ([feature, enables]) => `${feature} = ${JSON.stringify(enables)}`,
        ),
        "",
      ].join("\n"),
    );
    writeFileSync(join(folder, "src", "lib.rs"), crate.source ?? "");
    execFileSync("cargo", ["package", "--allow-dirty", "--no-verify", "--quiet"], {
      cwd: folder,
      env: testEnvironment({ CARGO_HOME: this.cargoHome }),
      stdio: "pipe",
    });
    const file = `${crate.name}-${crate.version}.crate`;
    const crateFile = join(this.crates, file);
    copyFileSync(join(folder, "target", "package", file), crateFile);
    const entry = {
      name: crate.name,
      vers: crate.version,
      deps: dependencies.map((dependency) => ({
        name: dependency.name,
        req: dependency.req,
        features: [],
        optional: dependency.optional ?? false,
        default_features: true,
        target: null,
        kind: "normal",
        ...(dependency.package === undefined ? {} : { package: dependency.package }),
      })),
      cksum: createHash("sha256").update(readFileSync(crateFile)).digest("hex"),
      features: crate.features ?? {},
      yanked: false,
    };
    const indexFile = join(this.index, ...indexPath(crate.name));
    mkdirSync(dirname(indexFile), { recursive: true });
    let lines = "";
    try {
      lines = readFileSync(indexFile, "utf8");
    } catch {
      // The crate's first version.
    }
    writeFileSync(indexFile, `${lines}${JSON.stringify(entry)}\n`);
    this.git("add", "-A");
    this.git("commit", "-q", "-m", `${crate.name} ${crate.version}`);
  }

  /** Deletes the registry and its Cargo home, unless `NX_RUST_KEEP_FIXTURES` is set. */
  remove(): void {
    if (!process.env.NX_RUST_KEEP_FIXTURES) {
      rmSync(this.base, { recursive: true, force: true });
    }
  }

  private git(...args: string[]): void {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: this.index,
      env: testEnvironment(),
      stdio: "pipe",
    });
  }
}

// Cargo's index layout: by the length of the lowercased name.
function indexPath(name: string): string[] {
  const lower = name.toLowerCase();
  switch (lower.length) {
    case 1:
      return ["1", lower];
    case 2:
      return ["2", lower];
    case 3:
      return ["3", lower.slice(0, 1), lower];
    default:
      return [lower.slice(0, 2), lower.slice(2, 4), lower];
  }
}
