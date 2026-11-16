import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  allOf,
  cargoHakariFolder,
  cargoIn,
  type FileChanges,
  hackCrateFiles,
  hakariConfiguration,
  HARNESS_TIMEOUT,
  nxRelease,
  pathWith,
  plainCrate,
  publishCalls,
  type PublishCopy,
  publishList,
  testEnvironment,
  testHost,
  uploadNames,
  withPublishCopy,
} from "./harness";

// Checks group 8 of VER-RELEASE: the check _Unpublished dependencies_ of
// DES-RELEASE and the hack crate of cargo-hakari, with the real Nx and
// cargo, in copies of the fixture publish-crates, each with a harness
// registry of its own (`SparseRegistry`) that stands in for crates.io and
// receives the uploads. Every command gets the registry's variables, which
// pin `CARGO_REGISTRY_DEFAULT` to it, so that the executor runs no probe. No
// test reaches a real registry. The hack crate is written as cargo-hakari
// 0.9.39 writes it (`hackCrateFiles`, `EVD-HAKARI-PUBLISHING`); the last case
// lets the real tool write it and skips where cargo-hakari is not installed.

const base = "pub-base:nx-release-publish";
const core = "pub-core:nx-release-publish";
const tool = "pub-tool:nx-release-publish";
const plain = "pub-plain:nx-release-publish";

/**
 * Regenerates the lockfiles of `rust/` and of `tools/`, whose `pub-tool`
 * depends on `pub-core` by path, after a change of the members, before the
 * first commit.
 */
function relock(copy: PublishCopy): void {
  for (const folder of ["rust", "tools"]) {
    const { status, output } = cargoIn(copy, folder, "generate-lockfile");
    expect({ status, output }).toMatchObject({ status: 0 });
  }
}

/** A change that adds `line` to the `[dependencies]` table of `manifest`, which ends the fixture's manifests. */
function dependency(manifest: string, line: string): FileChanges {
  return {
    [manifest]: (content) =>
      /^\[dependencies\]$/m.test(content ?? "")
        ? `${content}${line}\n`
        : `${content}\n[dependencies]\n${line}\n`,
  };
}

/** `pub-core` depends on `pub-private` through `[workspace.dependencies]`, with a version requirement and the harness's registry. */
const coreNeedsPrivate = allOf(
  {
    "rust/Cargo.toml": (content) =>
      `${content}pub-private = { path = "crates/private", version = "0.1.0", registry = "nx-rust-test" }\n`,
  },
  dependency("rust/crates/core/Cargo.toml", "pub-private = { workspace = true }"),
);

/** `pub-plain`, in the release and in `pub-core`'s cargo call, depends on `pub-core`. */
const plainNeedsCore = allOf(
  plainCrate,
  dependency(
    "rust/crates/plain/Cargo.toml",
    'pub-core = { path = "../core", version = "0.1.0", registry = "nx-rust-test" }',
  ),
  {
    "nx.json": (nxJson) => {
      const config = JSON.parse(nxJson ?? "{}");
      config.release.groups.crates.projects.push("pub-plain");
      return `${JSON.stringify(config, null, 2)}\n`;
    },
  },
);

/**
 * The hack crate `pub-hack` in `rust/crates/hack`, named by
 * `rust/.config/hakari.toml`, with `publish = false` as `cargo hakari init`
 * writes it or, as a stub to publish, without; `pub-core` depends on it as
 * `cargo hakari manage-deps` writes the dependency in every dep-format from
 * 2 on, with the harness's registry added. The other members do not, so
 * that the rest of `pub-core`'s cargo call runs.
 */
function hackCrate(publishFalse: boolean): FileChanges {
  const files = hackCrateFiles("rust/crates/hack", "pub-hack");
  const manifest = files["rust/crates/hack/Cargo.toml"] as string;
  return allOf(
    {
      ...files,
      "rust/crates/hack/Cargo.toml": publishFalse
        ? manifest
        : manifest.replace(/^publish = false\n/m, ""),
      "rust/.config/hakari.toml": hakariConfiguration("pub-hack", [testHost()]),
    },
    dependency(
      "rust/crates/core/Cargo.toml",
      'pub-hack = { version = "0.1", path = "../hack", registry = "nx-rust-test" }',
    ),
  );
}

/** The `-p` crates of every `cargo publish` other than a probe, sorted. */
function publishedCrates(copy: PublishCopy): string[] {
  return publishCalls(copy)
    .flatMap((call) => call.crates)
    .sort();
}

describe("nx release publish with dependencies that are not published", () => {
  it(
    "fails a crate whose dependency has publish = false before any upload, with a batch, without one and in a dry run, also where the registry has an unrelated crate of that name, and leaves out the crates of its call that depend on it",
    async () => {
      const files = allOf(coreNeedsPrivate, plainNeedsCore);
      await withPublishCopy({ files, prepare: relock }, async (copy) => {
        // An unrelated pub-private 0.1.0, which cargo would take for the dependency.
        copy.registry.seed(
          { name: "pub-private", version: "0.1.0", source: "pub fn unrelated() {}\n" },
          { crateFile: true },
        );
        const unpublished = [
          `${core}: pub-core depends on pub-private through the entry in rust/Cargo.toml, which points to the registry \`nx-rust-test\`, and pub-private is not published there: rust/crates/private/Cargo.toml sets \`publish = false\`. Nothing was uploaded for pub-core: cargo would package it for the registry \`nx-rust-test\` with a dependency on pub-private, which fails to resolve there or resolves to an unrelated crate of that name.`,
          "  To publish it, publish pub-private to the registry `nx-rust-test` as well, by removing `publish = false` from its manifest; or make pub-private no normal or build dependency of pub-core.",
        ].join("\n");

        const { status, output } = await nxRelease(copy, ["publish"]);

        expect({ status, output }).toMatchObject({ status: 1 });
        expect(output).toContain(unpublished);
        expect(output).not.toContain("cargo-hakari");
        // Which of the two messages pub-plain gets follows the order of the
        // batch's tasks: before pub-core's check, it stays in the call until
        // pub-core is left out; after it, pub-core is no longer in the call.
        expect(output).toMatch(
          new RegExp(
            `${plain}: pub-plain (depends on pub-core, which is left out of this cargo call because ${core} failed, so pub-plain is left out as well|needs pub-core 0\\.1\\.0, which is not in the registry \`nx-rust-test\` yet, because ${core} failed in this run)`,
          ),
        );
        expect(output).toContain(
          `${tool}: pub-tool needs pub-core 0.1.0, which is not in the registry \`nx-rust-test\` yet, because ${core} failed in this run`,
        );
        expect(publishCalls(copy)).toEqual([
          {
            cwd: "rust",
            flags: ["publish", "--locked", "--registry", "nx-rust-test"],
            crates: ["pub-base"],
          },
        ]);
        expect(uploadNames(copy)).toEqual(["nx-rust-test:pub-base@0.1.0"]);

        for (const [args, extra] of [
          [["--dry-run"], {}],
          [["--projects", "pub-core"], { NX_BATCH_MODE: "false" }],
          [["--dry-run", "--projects", "pub-core"], { NX_BATCH_MODE: "false" }],
        ] as [string[], Record<string, string>][]) {
          copy.workspace.cargo.clear();

          const run = await nxRelease(copy, ["publish", ...args], extra);

          expect(run).toMatchObject({ status: 1 });
          expect(run.output).toContain(unpublished);
          expect(publishedCrates(copy)).not.toContain("pub-core");
          expect(publishedCrates(copy)).not.toContain("pub-plain");
        }
        expect(uploadNames(copy)).toEqual(["nx-rust-test:pub-base@0.1.0"]);
      });
    },
    HARNESS_TIMEOUT * 3,
  );

  it(
    "fails a crate whose dependency's publish list leaves out the registry that its entry points to, naming the list and the registry key",
    async () => {
      const files = allOf(
        coreNeedsPrivate,
        publishList("rust/crates/private/Cargo.toml", ["elsewhere"]),
      );
      await withPublishCopy({ files, prepare: relock }, async (copy) => {
        const { status, output } = await nxRelease(copy, ["publish", "--projects", "pub-core"]);

        expect({ status, output }).toMatchObject({ status: 1 });
        expect(output).toContain(
          `${core}: pub-core depends on pub-private through the entry in rust/Cargo.toml, which points to the registry \`nx-rust-test\`, and pub-private is not published there: its publish list in rust/crates/private/Cargo.toml, ["elsewhere"], does not hold \`nx-rust-test\`. Nothing was uploaded for pub-core`,
        );
        expect(output).toContain(
          '\n  To publish it, publish pub-private to the registry `nx-rust-test` as well, by adding "nx-rust-test" to its publish list; name in that entry, with its `registry` key, a registry that the publish list of pub-private holds, `elsewhere`; or make pub-private no normal or build dependency of pub-core.',
        );
        expect(publishedCrates(copy)).not.toContain("pub-core");
        expect(copy.registry.allUploads()).toEqual([]);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "never publishes the hack crate, and fails a crate that depends on it with publish = false, giving cargo-hakari's two ways",
    async () => {
      await withPublishCopy({ files: hackCrate(true), prepare: relock }, async (copy) => {
        const graph = await copy.workspace.graph(copy.env);
        expect(graph.projects["pub-hack"]).toBeDefined();
        expect(graph.projects["pub-hack"].targets?.["nx-release-publish"]).toBeUndefined();
        expect(graph.projects["pub-core"].targets?.["nx-release-publish"]).toBeDefined();

        for (const args of [["publish", "--dry-run"], ["publish"]]) {
          copy.workspace.cargo.clear();

          const { status, output } = await nxRelease(copy, args);

          expect({ status, output }).toMatchObject({ status: 1 });
          expect(output).toContain(
            `${core}: pub-core depends on pub-hack through the entry in rust/crates/core/Cargo.toml, which points to the registry \`nx-rust-test\`, and pub-hack is not published there: rust/crates/hack/Cargo.toml sets \`publish = false\`.`,
          );
          expect(output).toContain(
            "  pub-hack is the hack crate of cargo-hakari, which @convesoft/nx-rust never publishes. cargo-hakari offers two ways: publish a stub of the hack crate once under a name of your own and without `publish = false`, after which pub-core publishes normally; or publish pub-core with `cargo hakari publish -p pub-core` outside Nx, which takes the dependency out for the upload. See https://docs.rs/cargo-hakari/latest/cargo_hakari/publishing.",
          );
          expect(publishedCrates(copy)).toEqual(["pub-base"]);
        }
        expect(uploadNames(copy)).toEqual(["nx-rust-test:pub-base@0.1.0"]);
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "publishes the dependents of a hack crate without publish = false once its stub is in the registry, and says before that to publish the stub",
    async () => {
      await withPublishCopy({ files: hackCrate(false), prepare: relock }, async (copy) => {
        const graph = await copy.workspace.graph(copy.env);
        expect(graph.projects["pub-hack"].targets?.["nx-release-publish"]).toBeUndefined();

        // The hack crate has no task that would publish it, so a dry run fails
        // its dependent as a real run does (DES-RELEASE, "Dry run").
        const before = await nxRelease(copy, ["publish", "--dry-run"]);

        expect(before).toMatchObject({ status: 1 });
        expect(before.output).toContain(
          `${core}: pub-core needs pub-hack 0.1.0, which is not in the registry \`nx-rust-test\` yet, so @convesoft/nx-rust does not publish pub-core, and nothing was uploaded for it: cargo would publish it against an older version of pub-hack that its requirement accepts. pub-hack is the hack crate of cargo-hakari, which @convesoft/nx-rust never publishes: publish its stub pub-hack 0.1.0 to the registry \`nx-rust-test\` once yourself, as https://docs.rs/cargo-hakari/latest/cargo_hakari/publishing describes, and run nx release publish again.`,
        );
        expect(copy.registry.allUploads()).toEqual([]);

        // The stub, published once outside Nx.
        copy.registry.seed(
          { name: "pub-hack", version: "0.1.0", source: "// This is a stub lib.rs.\n" },
          { crateFile: true },
        );
        copy.workspace.cargo.clear();

        const { status, output } = await nxRelease(copy, ["publish"]);

        expect({ status, output }).toMatchObject({ status: 0 });
        expect(publishedCrates(copy)).toEqual(["pub-base", "pub-core", "pub-tool"]);
        expect(uploadNames(copy)).toEqual([
          "nx-rust-test:pub-base@0.1.0",
          "nx-rust-test:pub-core@0.1.0",
          "nx-rust-test:pub-tool@0.1.0",
        ]);
      });
    },
    HARNESS_TIMEOUT * 2,
  );
});

const hakari = cargoHakariFolder();
if (hakari === undefined) {
  // eslint-disable-next-line no-console
  console.warn(
    "release-unpublished.spec.ts: cargo-hakari is neither on PATH nor in the Cargo home's bin, and NX_RUST_TEST_CARGO_HAKARI names no folder with it, so the case with the hack crate that the real tool writes skips.",
  );
}

(hakari === undefined ? describe.skip : describe)(
  "nx release publish with the real cargo-hakari",
  () => {
    it(
      "fails the crates that depend on the hack crate that the real cargo-hakari writes, before any upload",
      async () => {
        const prepare = (copy: PublishCopy) => {
          const env = testEnvironment({ ...copy.env, PATH: pathWith(hakari as string) });
          for (const args of [
            ["hakari", "init", "pub-hack", "--yes"],
            ["hakari", "manage-deps", "--yes"],
          ]) {
            const run = spawnSync("cargo", args, {
              cwd: join(copy.workspace.root, "rust"),
              env,
              encoding: "utf8",
            });
            expect({ status: run.status, output: `${run.stdout}${run.stderr}` }).toMatchObject({
              status: 0,
            });
          }
          relock(copy);
        };
        await withPublishCopy({ prepare }, async (copy) => {
          const manifest = copy.workspace.files()["rust/crates/core/Cargo.toml"];
          expect(manifest).toContain('pub-hack = { version = "0.1", path = "../../pub-hack" }');
          const graph = await copy.workspace.graph(copy.env);
          expect(graph.projects["pub-hack"].targets?.["nx-release-publish"]).toBeUndefined();

          const { status, output } = await nxRelease(copy, ["publish", "--dry-run"]);

          expect({ status, output }).toMatchObject({ status: 1 });
          for (const [task, crate] of [
            [base, "pub-base"],
            [core, "pub-core"],
          ]) {
            // cargo-hakari writes no registry key, so the entry points to crates.io.
            expect(output).toContain(
              `${task}: ${crate} depends on pub-hack through the entry in rust/crates/${crate.slice(4)}/Cargo.toml, which points to crates.io, and pub-hack is not published there: rust/pub-hack/Cargo.toml sets \`publish = false\`.`,
            );
          }
          expect(output).toContain("pub-hack is the hack crate of cargo-hakari");
          expect(publishCalls(copy)).toEqual([]);
          expect(copy.registry.allUploads()).toEqual([]);
        });
      },
      HARNESS_TIMEOUT * 2,
    );
  },
);
