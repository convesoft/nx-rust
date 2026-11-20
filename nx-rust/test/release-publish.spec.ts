import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cargoIn,
  GraphCreationError,
  git,
  HARNESS_TIMEOUT,
  nxRelease,
  publishCalls,
  type PublishCopy,
  registryCalls,
  shortPublishTimeout,
  uploadNames,
  withPublishCopy,
  withReleaseGroups,
  removeSharedRegistry,
} from "./harness";

// Checks group 7 of VER-RELEASE: `nx release publish` with the plugin's
// publish executor, with the real Nx and cargo, in copies of the fixture
// publish-crates, each with an empty harness registry (`SparseRegistry`),
// whose server the file's tests share, that stands in for crates.io and
// receives the uploads. Every command gets
// the registry's variables, which pin `CARGO_REGISTRY_DEFAULT` to it, so that
// the executor runs no probe. No test reaches a real registry, and no cargo
// call that the wrapper logs carries `--registry crates-io`, a token or
// `--allow-dirty`.

const base = "pub-base:nx-release-publish";
const core = "pub-core:nx-release-publish";
const tool = "pub-tool:nx-release-publish";

/** `nx release version` with these arguments, which has to succeed. */
async function version(copy: PublishCopy, ...args: string[]): Promise<void> {
  const { status, output } = await nxRelease(copy, ["version", ...args]);
  expect({ status, output }).toMatchObject({ status: 0 });
}

/** Checks that no cargo call that the wrapper logged carried a token, `--allow-dirty` or `--registry crates-io`. */
function expectPlainCalls(copy: PublishCopy): void {
  for (const call of copy.workspace.cargoCalls()) {
    expect(call.args).not.toContain("--token");
    expect(call.args).not.toContain("--allow-dirty");
    expect(call.args.join(" ")).not.toContain("--registry crates-io");
  }
}

/** `pub-base` 0.1.0 in the registry, as an older release would have put it there, with a `.crate` file that cargo can build against. */
function seedOldBase(copy: PublishCopy): void {
  copy.registry.seed(
    { name: "pub-base", version: "0.1.0", source: "pub fn base() -> u32 {\n    1\n}\n" },
    { crateFile: true },
  );
}

afterAll(removeSharedRegistry);

describe("nx release publish", () => {
  it(
    "uploads the crates in dependency order with one call per workspace, leaves out versions that the registry has, and never publishes a crate with publish = false",
    async () => {
      await withPublishCopy({}, async (copy) => {
        const graph = await copy.workspace.graph(copy.env);
        for (const project of ["pub-base", "pub-core", "pub-tool"]) {
          const target = graph.projects[project].targets?.["nx-release-publish"];
          expect(target).toMatchObject({
            executor: "@convesoft/nx-rust:release-publish",
            cache: false,
          });
          expect(target?.dependsOn).toBeUndefined();
        }
        expect(graph.projects["pub-private"].targets?.["nx-release-publish"]).toBeUndefined();
        copy.workspace.cargo.clear();

        const { status, output } = await nxRelease(copy, ["publish"]);

        expect({ status, output }).toMatchObject({ status: 0 });
        expect(publishCalls(copy)).toEqual([
          {
            cwd: "rust",
            flags: ["publish", "--locked", "--registry", "nx-rust-test"],
            crates: ["pub-base", "pub-core"],
          },
          {
            cwd: "tools",
            flags: ["publish", "--locked", "--registry", "nx-rust-test"],
            crates: ["pub-tool"],
          },
        ]);
        expect(uploadNames(copy)).toEqual([
          "nx-rust-test:pub-base@0.1.0",
          "nx-rust-test:pub-core@0.1.0",
          "nx-rust-test:pub-tool@0.1.0",
        ]);
        // Each dependency names the registry that its dependent is published to.
        for (const upload of copy.registry.uploads()) {
          for (const dependency of upload.metadata.deps) {
            expect(dependency.registry ?? null).toBeNull();
          }
        }
        expectPlainCalls(copy);

        // A second run finds every version in the registry.
        copy.workspace.cargo.clear();
        const again = await nxRelease(copy, ["publish"]);
        expect(again).toMatchObject({ status: 0 });
        for (const [task, crate] of [
          [base, "pub-base"],
          [core, "pub-core"],
          [tool, "pub-tool"],
        ]) {
          expect(again.output).toContain(
            `${task}: ${crate} 0.1.0 is in the registry \`nx-rust-test\` already, so it is left out of cargo publish.`,
          );
        }
        expect(publishCalls(copy)).toEqual([]);
        expect(copy.registry.uploads()).toHaveLength(3);
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails a crate whose dependency's new version is not in the registry, with --projects, --groups and without a batch, and publishes it once the dependency is there",
    async () => {
      const files = withReleaseGroups({ base: ["pub-base"], users: ["pub-core", "pub-tool"] });
      await withPublishCopy({ files }, async (copy) => {
        seedOldBase(copy);
        // pub-core keeps its requirement 0.1.0, which 0.1.1 still matches.
        await version(copy, "0.1.1", "--projects", "pub-base");
        expect(copy.workspace.files()["rust/Cargo.toml"]).toContain('version = "0.1.0"');
        const publishFirst = `${core}: pub-core needs pub-base 0.1.1, which is not in the registry \`nx-rust-test\` yet`;

        for (const [args, extra] of [
          [["--projects", "pub-core"], {}],
          [["--groups", "users"], {}],
          [["--projects", "pub-core"], { NX_BATCH_MODE: "false" }],
        ] as [string[], Record<string, string>][]) {
          const { status, output } = await nxRelease(copy, ["publish", ...args], extra);

          expect({ status, output }).toMatchObject({ status: 1 });
          expect(output).toContain(publishFirst);
          expect(output).toContain("Publish pub-base first");
          expect(output).toContain("or by running pub-base:nx-release-publish before this task");
          expect(copy.registry.uploads()).toEqual([]);
        }

        // nx release publish with --projects or --groups would also select the
        // dependents of pub-base in the other group, as Nx's release graph adds them.
        const alone = await copy.workspace.nx(["run", "pub-base:nx-release-publish"], copy.env);
        expect(alone).toMatchObject({ status: 0 });
        expect(uploadNames(copy)).toEqual(["nx-rust-test:pub-base@0.1.1"]);
        const { status, output } = await nxRelease(copy, ["publish", "--groups", "users"]);
        expect({ status, output }).toMatchObject({ status: 0 });
        expect(uploadNames(copy)).toEqual([
          "nx-rust-test:pub-base@0.1.1",
          "nx-rust-test:pub-core@0.1.1",
          "nx-rust-test:pub-tool@0.1.1",
        ]);
        expectPlainCalls(copy);
      });
    },
    HARNESS_TIMEOUT * 3,
  );

  it(
    "publishes each crate with a call of its own without a batch, and a second run publishes what the first left out",
    async () => {
      await withPublishCopy({}, async (copy) => {
        const first = await nxRelease(copy, ["publish", "--projects", "pub-base,pub-core"], {
          NX_BATCH_MODE: "false",
        });
        const second = await nxRelease(copy, ["publish", "--projects", "pub-base,pub-core"], {
          NX_BATCH_MODE: "false",
        });

        expect(second).toMatchObject({ status: 0 });
        expect([first.status, second.status]).toContain(0);
        for (const call of publishCalls(copy)) {
          expect(call.crates).toHaveLength(1);
          expect(call.flags).toEqual(["publish", "--locked", "--registry", "nx-rust-test"]);
        }
        expect(uploadNames(copy).sort()).toEqual([
          "nx-rust-test:pub-base@0.1.0",
          "nx-rust-test:pub-core@0.1.0",
        ]);
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "uploads no crate that depends on a crate whose upload the index does not show in time, and fails its task",
    async () => {
      await withPublishCopy({}, async (copy) => {
        await copy.registry.setIndexDelay(Infinity);

        const { status, output } = await nxRelease(copy, ["publish"], shortPublishTimeout(2));

        expect({ status, output }).toMatchObject({ status: 1 });
        expect(output).toContain("timed out waiting for pub-base v0.1.0 to be available");
        expect(uploadNames(copy)).toEqual(["nx-rust-test:pub-base@0.1.0"]);
        expect(output).toContain(
          `${core}: cargo publish failed after it uploaded pub-base@0.1.0, and its output does not show that pub-core 0.1.0 was uploaded.`,
        );
        expect(output).toContain(
          `${tool}: pub-tool needs pub-core 0.1.0, which is not in the registry \`nx-rust-test\` yet`,
        );
        expect(output).toMatch(
          /Successfully ran target nx-release-publish for project pub-base|pub-base:nx-release-publish\b/,
        );
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "gives each task of a failed dry-run call the result that cargo's output shows for its crate",
    async () => {
      const files = { "rust/crates/core/src/lib.rs": "pub fn core() -> u32 {\n    missing\n}\n" };
      await withPublishCopy({ files }, async (copy) => {
        const { status, output } = await nxRelease(copy, [
          "publish",
          "--dry-run",
          "--projects",
          "pub-base,pub-core",
        ]);

        expect({ status, output }).toMatchObject({ status: 1 });
        expect(publishCalls(copy)).toEqual([
          {
            cwd: "rust",
            flags: ["publish", "--dry-run", "--locked", "--registry", "nx-rust-test"],
            crates: ["pub-base", "pub-core"],
          },
        ]);
        expect(output).toContain("error: failed to verify package tarball");
        expect(output).toContain(
          `${base}: cargo verified pub-base 0.1.0 before the call failed for another of its crates, whose task says why.`,
        );
        expect(output).toContain(
          `${core}: cargo publish failed after it verified pub-base@0.1.0, and its output does not show that pub-core 0.1.0 was verified.`,
        );
        expect(output).not.toContain("pub-base 0.1.0 was not verified");
        expect(output).toMatch(/^- pub-core:nx-release-publish$/m);
        expect(output).not.toMatch(/^- pub-base:nx-release-publish$/m);
        expect(copy.registry.allUploads()).toEqual([]);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "gives each task of a call that fails after its first upload the result of its own upload, and a second run uploads only the rest",
    async () => {
      await withPublishCopy({}, async (copy) => {
        // The index shows pub-base only once cargo, which waits a second,
        // has given up on it, so that cargo stops before pub-core.
        await copy.registry.setIndexDelay(Infinity);

        const first = await nxRelease(copy, ["publish", "--projects", "pub-base,pub-core"], {
          ...shortPublishTimeout(1),
        });

        expect(first).toMatchObject({ status: 1 });
        expect(uploadNames(copy)).toEqual(["nx-rust-test:pub-base@0.1.0"]);
        expect(first.output).toContain(
          `${base}: cargo uploaded pub-base 0.1.0 before the call failed for another of its crates, whose task says why.`,
        );
        expect(first.output).toContain(
          `${core}: cargo publish failed after it uploaded pub-base@0.1.0, and its output does not show that pub-core 0.1.0 was uploaded.`,
        );
        expect(first.output).toMatch(/^- pub-core:nx-release-publish$/m);
        expect(first.output).not.toMatch(/^- pub-base:nx-release-publish$/m);

        // Once the index shows pub-base, a second run leaves it out.
        await copy.registry.flushIndex();
        await copy.registry.setIndexDelay(0);
        copy.workspace.cargo.clear();

        const second = await nxRelease(copy, ["publish", "--projects", "pub-base,pub-core"]);

        expect(second).toMatchObject({ status: 0 });
        expect(second.output).toContain(
          `${base}: pub-base 0.1.0 is in the registry \`nx-rust-test\` already, so it is left out of cargo publish.`,
        );
        expect(publishCalls(copy)).toEqual([
          {
            cwd: "rust",
            flags: ["publish", "--locked", "--registry", "nx-rust-test"],
            crates: ["pub-core"],
          },
        ]);
        expect(uploadNames(copy)).toEqual([
          "nx-rust-test:pub-base@0.1.0",
          "nx-rust-test:pub-core@0.1.0",
        ]);
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "leaves uncommitted changes to cargo's own check: refused on the latest stable cargo, with the line that says to commit the new versions, also after nx release version without git settings, and uploaded by Cargo 1.91 in a workspace below the repository root",
    async () => {
      await withPublishCopy({}, async (copy) => {
        // Whether uncommitted changes stop publishing is cargo's own check,
        // which the plugin leaves alone and to which it adds none
        // (DES-RELEASE, "Credentials and tree"; RISK-UNCOMMITTED-PUBLISH).
        // Cargo 1.91 does not refuse them in a Cargo workspace below the
        // repository root, as the fixture's are, while 1.97 and later do
        // (EVD-CARGO-PUBLISH, fourth session), so the test records what
        // cargo does on each version, not a promise of the plugin.
        const cargoRefuses = !cargoIn(copy, "rust", "--version").output.startsWith("cargo 1.91.");
        /** How a run ended, whether cargo refused it with the plugin's line, and what the registry holds. */
        const outcome = (result: { status: number | null; output: string }) => ({
          status: result.status,
          refused:
            result.output.includes("contain changes that were not yet committed into git") &&
            result.output.includes(
              `${base}: cargo publishes committed files only, and @convesoft/nx-rust never passes --allow-dirty. Commit the new versions first`,
            ),
          uploads: uploadNames(copy),
        });
        appendFileSync(join(copy.workspace.root, "rust/crates/base/src/lib.rs"), "// changed\n");

        const dirty = await nxRelease(copy, ["publish", "--projects", "pub-base"]);

        expect(outcome(dirty)).toEqual(
          cargoRefuses
            ? { status: 1, refused: true, uploads: [] }
            : { status: 0, refused: false, uploads: ["nx-rust-test:pub-base@0.1.0"] },
        );
        git(copy.workspace, "checkout", "--", ".");

        // Without git settings, nx release version stages its changes and commits nothing.
        const nxJsonPath = join(copy.workspace.root, "nx.json");
        const nxJson = JSON.parse(copy.workspace.files()["nx.json"]);
        delete nxJson.release.version;
        writeFileSync(nxJsonPath, `${JSON.stringify(nxJson, null, 2)}\n`);
        git(copy.workspace, "commit", "--quiet", "--all", "--message", "No git settings");
        await version(copy, "0.2.0", "--projects", "pub-base");
        expect(git(copy.workspace, "status", "--porcelain")).toContain(
          "M  rust/crates/base/Cargo.toml",
        );

        const staged = await nxRelease(copy, ["publish", "--projects", "pub-base"]);

        expect(outcome(staged)).toEqual(
          cargoRefuses
            ? { status: 1, refused: true, uploads: [] }
            : {
                status: 0,
                refused: false,
                uploads: ["nx-rust-test:pub-base@0.1.0", "nx-rust-test:pub-base@0.2.0"],
              },
        );
        expectPlainCalls(copy);
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "ignores --tag, --access and --otp with a line each, and --first-release changes nothing",
    async () => {
      await withPublishCopy({}, async (copy) => {
        const { status, output } = await nxRelease(copy, [
          "publish",
          "--projects",
          "pub-base",
          "--dry-run",
          "--tag",
          "next",
          "--access",
          "public",
          "--otp",
          "123456",
          "--first-release",
        ]);

        expect({ status, output }).toMatchObject({ status: 0 });
        for (const [option, value, what] of [
          ["tag", "next", "distribution tags"],
          ["access", "public", "access levels"],
          ["otp", "123456", "one-time passwords"],
        ]) {
          expect(output).toContain(
            `${base}: ignoring option \`${option}\` (${value}), passed to \`nx release publish\`: it is npm's, and cargo publish has no ${what}.`,
          );
        }
        expect(output).not.toContain("ignoring option `firstRelease`");
        expect(publishCalls(copy)).toEqual([
          {
            cwd: "rust",
            flags: ["publish", "--dry-run", "--locked", "--registry", "nx-rust-test"],
            crates: ["pub-base"],
          },
        ]);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails the tasks with cargo's message before any upload when the registry cannot be reached",
    async () => {
      await withPublishCopy({}, async (copy) => {
        await copy.registry.stop();

        const { status, output } = await nxRelease(copy, ["publish", "--projects", "pub-base"], {
          CARGO_NET_RETRY: "0",
        });

        expect({ status, output }).toMatchObject({ status: 1 });
        expect(output).toContain(
          `${base}: \`cargo info pub-base@0.1.0 --registry nx-rust-test --locked\`, run in the folder rust, failed, so @convesoft/nx-rust cannot tell whether pub-base 0.1.0 is in the registry \`nx-rust-test\``,
        );
        expect(publishCalls(copy)).toEqual([]);
        expect(registryCalls(copy).length).toBeGreaterThan(0);
      });
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails graph creation when targetNames renames nx-release-publish",
    async () => {
      const files = {
        "nx.json": (nxJson: string | undefined) => {
          const config = JSON.parse(nxJson ?? "{}");
          config.plugins = [
            {
              plugin: config.plugins[0],
              options: { targetNames: { "nx-release-publish": "publish" } },
            },
          ];
          return `${JSON.stringify(config, null, 2)}\n`;
        },
      };
      await withPublishCopy({ files }, async (copy) => {
        const error = await copy.workspace.graph(copy.env).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(GraphCreationError);
        expect((error as GraphCreationError).message).toContain(
          '"targetNames" in the options of the @convesoft/nx-rust entry in nx.json names "nx-release-publish", but Nx release runs the publish target only under that name, so it cannot be renamed.',
        );
      });
    },
    HARNESS_TIMEOUT,
  );
});
