import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  allOf,
  cargoIn,
  type FileChanges,
  git,
  HARNESS_TIMEOUT,
  isProbe,
  nxRelease,
  plainCrate,
  publishCalls,
  type PublishCopy,
  publishList,
  registryCalls,
  registryKeyManifests,
  replacing,
  trackedFiles,
  uploadNames,
  withPublishCopy,
  withReleaseGroups,
} from "./harness";

// Checks group 9 of VER-RELEASE: which registry the plugin's publish
// executor publishes each crate to, and when it refuses to, with the real Nx
// and cargo, in copies of the fixture publish-crates. The harness serves
// three registries on one server, its own and `alpha` and `beta`
// (`SparseRegistry`), and every Cargo home that a case chooses replaces
// crates.io with the harness's own and makes the server the proxy, which
// refuses every other host. Where a case leaves `CARGO_REGISTRY_DEFAULT`
// unset, the executor probes cargo; a case that names crates.io leaves it
// replaced, so that no lookup goes there. No test reaches a real registry,
// and no cargo call that the wrapper logs carries `--registry crates-io`.

const base = "pub-base:nx-release-publish";
const core = "pub-core:nx-release-publish";
const tool = "pub-tool:nx-release-publish";
const plain = "pub-plain:nx-release-publish";

/** The fixture with every entry on a crate of the repository naming `name` in place of the harness registry. */
function entriesNaming(name: string): FileChanges {
  return replacing(registryKeyManifests, 'registry = "nx-rust-test"', `registry = "${name}"`);
}

/** Regenerates the lockfile of `rust/` after a change of its members, before the first commit. */
function relock(copy: PublishCopy): void {
  const { status, output } = cargoIn(copy, "rust", "generate-lockfile");
  expect({ status, output }).toMatchObject({ status: 0 });
}

/** Checks that no cargo call that the wrapper logged carried `--registry crates-io`. */
function expectNoCratesIoFlag(copy: PublishCopy): void {
  for (const call of copy.workspace.cargoCalls()) {
    expect(call.args.join(" ")).not.toContain("--registry crates-io");
  }
}

/** The publish and lookup calls that name a registry with `--registry`, as that name. */
function namedRegistries(copy: PublishCopy): string[] {
  return registryCalls(copy)
    .filter((call) => !isProbe(call))
    .map((call) => call.args[call.args.indexOf("--registry") + 1] ?? "(none)");
}

describe("the registries of nx release publish", () => {
  it(
    "publishes every crate to the registry that CARGO_REGISTRY_DEFAULT names, without a probe, and fails a crate whose publish list leaves it out",
    async () => {
      const files = allOf(entriesNaming("alpha"), publishList("tools/Cargo.toml", ["beta"]));
      await withPublishCopy({ files, registryEnv: { registryDefault: "alpha" } }, async (copy) => {
        const { status, output } = await nxRelease(copy, ["publish"]);

        expect({ status, output }).toMatchObject({ status: 1 });
        expect(registryCalls(copy).filter(isProbe)).toEqual([]);
        expect(new Set(namedRegistries(copy))).toEqual(new Set(["alpha"]));
        expect(uploadNames(copy)).toEqual(["alpha:pub-base@0.1.0", "alpha:pub-core@0.1.0"]);
        expect(
          copy.registry
            .uploads("alpha")[1]
            .metadata.deps.map((dependency) => dependency.registry ?? null),
        ).toEqual([null]);
        expect(output).toContain(
          `${tool}: CARGO_REGISTRY_DEFAULT names the registry \`alpha\`, which the publish list of pub-tool in tools/Cargo.toml, ["beta"], leaves out, so cargo would refuse to publish it`,
        );
        expectNoCratesIoFlag(copy);
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "without a default, asks cargo once per workspace and publish list, publishes the crates of each registry with a call of their own, and fails a crate for crates.io that the configuration replaces",
    async () => {
      const files = allOf(
        entriesNaming("alpha"),
        plainCrate,
        publishList("rust/crates/base/Cargo.toml", ["alpha"]),
        publishList("rust/crates/core/Cargo.toml", ["alpha"]),
        publishList("rust/crates/private/Cargo.toml", ["beta"]),
        withReleaseGroups({ crates: ["pub-base", "pub-core", "pub-private", "pub-plain"] }),
      );
      await withPublishCopy(
        { files, registryEnv: { registryDefault: null, home: "no-default" }, prepare: relock },
        async (copy) => {
          const dryRun = await nxRelease(copy, [
            "publish",
            "--dry-run",
            "--projects",
            "pub-base,pub-core,pub-private",
          ]);
          expect(dryRun).toMatchObject({ status: 0 });
          expect(
            registryCalls(copy)
              .filter(isProbe)
              .map((call) => call.args),
          ).toEqual([
            [
              "publish",
              "--dry-run",
              "--no-verify",
              "--locked",
              "-p",
              expect.stringMatching(/^pub-(base|core)$/),
            ],
            ["publish", "--dry-run", "--no-verify", "--locked", "-p", "pub-private"],
          ]);
          expect(copy.registry.allUploads()).toEqual([]);
          copy.workspace.cargo.clear();

          const { status, output } = await nxRelease(copy, ["publish"]);

          expect({ status, output }).toMatchObject({ status: 1 });
          expect(registryCalls(copy).filter(isProbe)).toHaveLength(3);
          expect(publishCalls(copy)).toEqual([
            {
              cwd: "rust",
              flags: ["publish", "--locked", "--registry", "alpha"],
              crates: ["pub-base", "pub-core"],
            },
            {
              cwd: "rust",
              flags: ["publish", "--locked", "--registry", "beta"],
              crates: ["pub-private"],
            },
          ]);
          expect(uploadNames(copy)).toEqual([
            "alpha:pub-base@0.1.0",
            "alpha:pub-core@0.1.0",
            "beta:pub-private@0.1.0",
          ]);
          // The crate in beta depends on alpha's crate.
          expect(
            copy.registry.uploads("beta")[0].metadata.deps.map((dependency) => dependency.registry),
          ).toEqual([copy.registry.named.alpha.indexUrl]);
          expect(output).toContain("crates-io is replaced with remote registry nx-rust-test");
          expect(output).toContain(
            "Publish pub-plain to crates.io from a job whose Cargo configuration does not replace crates.io",
          );
          expect(output).toMatch(
            new RegExp(
              `${plain}: cargo could not tell which registry it would publish pub-plain to`,
            ),
          );
          expectNoCratesIoFlag(copy);
        },
      );
    },
    HARNESS_TIMEOUT * 3,
  );

  it(
    "sends a crate without a list to registry.default from a configuration file, and fails a crate whose list leaves that registry out with cargo's message",
    async () => {
      const files = allOf(
        entriesNaming("alpha"),
        plainCrate,
        publishList("rust/crates/base/Cargo.toml", ["alpha"]),
        withReleaseGroups({ crates: ["pub-base", "pub-plain"] }),
        { "rust/.cargo/config.toml": '[registry]\ndefault = "beta"\n' },
      );
      await withPublishCopy(
        { files, registryEnv: { registryDefault: null, home: "no-default" }, prepare: relock },
        async (copy) => {
          const { status, output } = await nxRelease(copy, ["publish"]);

          expect({ status, output }).toMatchObject({ status: 1 });
          expect(uploadNames(copy)).toEqual(["beta:pub-plain@0.1.0"]);
          expect(output).toContain(
            "The registry `beta` is not listed in the `package.publish` value in Cargo.toml.",
          );
          expect(output).toContain(
            `${base}: cargo could not tell which registry it would publish pub-base to`,
          );
        },
      );
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "probes in a folder of its own outside the repository, so that tracked files under target/package and build.build-dir stay as they are",
    async () => {
      const tracked = {
        "rust/target/package/pub-base-0.1.0.crate": "tracked under target\n",
        "rust/target/package/tmp-crate/pub-base-0.1.0.crate": "tracked under target\n",
        "rust/bdir/package/pub-base-0.1.0.crate": "tracked under the build directory\n",
        "rust/.cargo/config.toml": '[build]\nbuild-dir = "bdir"\n',
      };
      const files = allOf(
        entriesNaming("alpha"),
        publishList("rust/crates/base/Cargo.toml", ["alpha"]),
        tracked,
      );
      await withPublishCopy(
        {
          files,
          registryEnv: { registryDefault: null, home: "no-default" },
          prepare: (copy) => git(copy.workspace, "add", "--force", ...Object.keys(tracked)),
        },
        async (copy) => {
          // The version is in alpha already, so no publish call follows the probe.
          copy.registry.seed(
            { name: "pub-base", version: "0.1.0", source: "pub fn base() -> u32 {\n    1\n}\n" },
            { crateFile: true, registry: "alpha" },
          );
          const files = trackedFiles(copy.workspace, false);
          const temporary = join(copy.workspace.root, "..", "probe-tmp");
          mkdirSync(temporary);

          const { status, output } = await nxRelease(copy, ["publish", "--projects", "pub-base"], {
            TMPDIR: temporary,
          });

          expect({ status, output }).toMatchObject({ status: 0 });
          expect(registryCalls(copy).filter(isProbe)).toHaveLength(1);
          expect(publishCalls(copy)).toEqual([]);
          expect(output).toContain(`${base}: pub-base 0.1.0 is in the registry \`alpha\` already`);
          // Cargo writes files of its own into its build directory, which
          // publishing may change; the tracked files there stay as they were.
          expect(trackedFiles(copy.workspace, false)).toEqual(files);
          expect(git(copy.workspace, "diff", "--stat")).toBe("");
          expect(readdirSync(temporary)).toEqual([]);
        },
      );
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails a crate whose dependency's entry has no registry key while both go to alpha, also where alpha replaces crates.io",
    async () => {
      const noKey = allOf(
        entriesNaming("alpha"),
        replacing(["rust/Cargo.toml"], ', registry = "alpha" }', " }"),
      );
      for (const files of [
        noKey,
        allOf(noKey, { "rust/.cargo/config.toml": '[source.crates-io]\nreplace-with = "alpha"\n' }),
      ]) {
        await withPublishCopy(
          { files, registryEnv: { registryDefault: "alpha" } },
          async (copy) => {
            const { status, output } = await nxRelease(copy, [
              "publish",
              "--projects",
              "pub-base,pub-core",
            ]);

            expect({ status, output }).toMatchObject({ status: 1 });
            expect(output).toContain(
              `${core}: pub-core depends on pub-base through the entry in rust/Cargo.toml, which points to crates.io, while pub-base is published to the registry \`alpha\`, and @convesoft/nx-rust cannot establish that these are one registry: the entry has no \`registry\` key`,
            );
            expect(output).toContain('add `registry = "alpha"` to that entry');
            expect(copy.registry.uploads("alpha").map((upload) => upload.name)).not.toContain(
              "pub-core",
            );
          },
        );
      }
    },
    HARNESS_TIMEOUT * 3,
  );

  it(
    "fails an upload to alpha with cargo's message when only CARGO_REGISTRY_TOKEN holds alpha's token",
    async () => {
      await withPublishCopy(
        { files: entriesNaming("alpha"), registryEnv: { registryDefault: "alpha" } },
        async (copy) => {
          const { status, output } = await nxRelease(copy, ["publish", "--projects", "pub-base"], {
            CARGO_REGISTRIES_ALPHA_TOKEN: undefined,
            CARGO_REGISTRY_TOKEN: copy.registry.named.alpha.token,
          });

          expect({ status, output }).toMatchObject({ status: 1 });
          expect(output).toContain("CARGO_REGISTRIES_ALPHA_TOKEN");
          expect(copy.registry.allUploads()).toEqual([]);
        },
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails each crate's task that receives nx release publish --registry before cargo runs, also in a dry run",
    async () => {
      await withPublishCopy({}, async (copy) => {
        for (const args of [[], ["--dry-run"]]) {
          copy.workspace.cargo.clear();
          const { status, output } = await nxRelease(copy, [
            "publish",
            "--registry",
            "https://npm.example.com/",
            ...args,
          ]);

          expect({ status, output }).toMatchObject({ status: 1 });
          for (const task of [base, core, tool]) {
            expect(output).toContain(
              `${task}: the option \`registry\` (https://npm.example.com/) was passed to \`nx release publish\`, and nx-rust does not map it to a Cargo registry.`,
            );
          }
          expect(output).toContain(
            'Cargo chooses the registry itself: set `publish = ["<name>"]` in the crate\'s Cargo.toml or `registry.default` in .cargo/config.toml, or run `CARGO_REGISTRY_DEFAULT=<name> nx release publish` for one run. Dependencies on crates of this repository then need `registry = "<name>"` in their entries.',
          );
          expect(output).toContain(
            "To give npm packages alone a registry, publish them in a run of their own (`nx release publish --groups <group> --registry <url>`) or set it in .npmrc.",
          );
          expect(registryCalls(copy)).toEqual([]);
          expect(copy.registry.allUploads()).toEqual([]);
        }
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails a task that gets registry from a targetDefaults entry keyed by nx-release-publish, and publishes with the empty entry keyed by its executor",
    async () => {
      const withDefaults = (defaults: object): FileChanges => ({
        "nx.json": (nxJson) =>
          `${JSON.stringify({ ...JSON.parse(nxJson ?? "{}"), targetDefaults: defaults }, null, 2)}\n`,
      });
      const npmEntry = {
        "nx-release-publish": { options: { registry: "https://npm.example.com/" } },
      };
      await withPublishCopy({ files: withDefaults(npmEntry) }, async (copy) => {
        const { status, output } = await nxRelease(copy, ["publish", "--projects", "pub-base"]);

        expect({ status, output }).toMatchObject({ status: 1 });
        expect(output).toContain(
          `${base}: the option \`registry\` (https://npm.example.com/) comes from the workspace's configuration, and nx-rust does not map it to a Cargo registry.`,
        );
        expect(output).toContain(
          `Run \`nx show target ${base} --json\` and look under \`sourceMap\``,
        );
        expect(output).toContain('the empty entry keyed by "@convesoft/nx-rust:release-publish"');
        expect(registryCalls(copy)).toEqual([]);
      });
      await withPublishCopy(
        { files: withDefaults({ ...npmEntry, "@convesoft/nx-rust:release-publish": {} }) },
        async (copy) => {
          const { status, output } = await nxRelease(copy, ["publish", "--projects", "pub-base"]);

          expect({ status, output }).toMatchObject({ status: 0 });
          expect(uploadNames(copy)).toEqual(["nx-rust-test:pub-base@0.1.0"]);
        },
      );
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails a crate for alpha where the Cargo home replaces alpha with beta, because the lookup asked beta",
    async () => {
      await withPublishCopy(
        {
          files: entriesNaming("alpha"),
          registryEnv: { registryDefault: "alpha", home: "alpha-replaced" },
        },
        async (copy) => {
          copy.registry.seed(
            { name: "pub-base", version: "0.1.0", source: "pub fn base() -> u32 {\n    1\n}\n" },
            { crateFile: true, registry: "beta" },
          );

          const { status, output } = await nxRelease(copy, ["publish", "--projects", "pub-core"]);

          expect({ status, output }).toMatchObject({ status: 1 });
          expect(output).toMatch(
            /pub-core:nx-release-publish: `cargo info pub-(core|base)@0\.1\.0 --registry alpha --locked`, run in the folder rust, showed `beta` in place of the registry `alpha`/,
          );
          expect(output).toContain("without a source replacement for the registry you publish to");
          expect(copy.registry.allUploads()).toEqual([]);
          expect(publishCalls(copy)).toEqual([]);
        },
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "publishes to alpha where a second name gives alpha's index in the environment, because cargo shows alpha in every line",
    async () => {
      const files = allOf(
        entriesNaming("alpha"),
        publishList("rust/crates/base/Cargo.toml", ["alpha"]),
      );
      await withPublishCopy(
        {
          files,
          registryEnv: { registryDefault: null, home: "no-default", aliases: { alias: "alpha" } },
        },
        async (copy) => {
          const { status, output } = await nxRelease(copy, ["publish", "--projects", "pub-base"]);

          expect(output).toContain("Updating `alpha` index");
          expect(output).not.toContain("`alias`");
          expect({ status, output }).toMatchObject({ status: 1 });
          expect(output).toContain("multiple registries are configured with the same index url");
          expect(copy.registry.allUploads()).toEqual([]);
        },
      );
    },
    HARNESS_TIMEOUT,
  );

  it(
    "fails a crate whose dependency in another workspace is on a registry name that the two workspaces configure differently, and publishes both once the environment gives the index",
    async () => {
      const files = (registry: {
        spare: { indexUrl: string };
        named: { beta: { indexUrl: string } };
      }) =>
        allOf(entriesNaming("shared"), {
          "rust/.cargo/config.toml": `[registries.shared]\nindex = "${registry.spare.indexUrl}"\n`,
          "tools/.cargo/config.toml": `[registries.shared]\nindex = "${registry.named.beta.indexUrl}"\n`,
        });
      await withPublishCopy({ files, registryEnv: { registryDefault: "shared" } }, async (copy) => {
        const shared = {
          CARGO_REGISTRIES_SHARED_TOKEN: copy.registry.spare.token,
          CARGO_REGISTRIES_SHARED_CREDENTIAL_PROVIDER: "cargo:token",
        };
        // beta has a copy of the version that pub-tool would resolve there.
        copy.registry.seed(
          { name: "pub-core", version: "0.1.0", source: "pub fn core() -> u32 {\n    2\n}\n" },
          { crateFile: true, registry: "beta" },
        );

        const first = await nxRelease(copy, ["publish"], shared);

        expect(first).toMatchObject({ status: 1 });
        expect(uploadNames(copy)).toEqual(["spare:pub-base@0.1.0", "spare:pub-core@0.1.0"]);
        expect(first.output).toContain(
          `${tool}: pub-tool depends on pub-core through the entry in tools/Cargo.toml, which points to the registry \`shared\`, while pub-core is published to the registry \`shared\`, and @convesoft/nx-rust cannot establish that these are one registry: the two crates lie in different Cargo workspaces`,
        );
        expect(first.output).toContain(
          "give the registry's index in the environment as CARGO_REGISTRIES_SHARED_INDEX, so that it is the same for every workspace, or keep both crates in one Cargo workspace",
        );

        const second = await nxRelease(copy, ["publish"], {
          ...shared,
          CARGO_REGISTRIES_SHARED_INDEX: copy.registry.spare.indexUrl,
        });

        expect(second).toMatchObject({ status: 0 });
        expect(uploadNames(copy)).toEqual([
          "spare:pub-base@0.1.0",
          "spare:pub-core@0.1.0",
          "spare:pub-tool@0.1.0",
        ]);
        expect(
          copy.registry
            .uploads("spare")[2]
            .metadata.deps.map((dependency) => dependency.registry ?? null),
        ).toEqual([null]);
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails every task offline after a run that filled the cache, because the lookups do not show which registry they asked",
    async () => {
      await withPublishCopy({}, async (copy) => {
        expect(await nxRelease(copy, ["publish", "--projects", "pub-base"])).toMatchObject({
          status: 0,
        });
        copy.workspace.cargo.clear();

        const { status, output } = await nxRelease(copy, ["publish"], {
          CARGO_NET_OFFLINE: "true",
        });

        expect({ status, output }).toMatchObject({ status: 1 });
        for (const [task, crate] of [
          [base, "pub-base"],
          [core, "pub-core"],
          [tool, "pub-tool"],
        ]) {
          expect(output).toContain(
            `${task}: \`cargo info ${crate}@0.1.0 --registry nx-rust-test --locked\`, run in the folder ${crate === "pub-tool" ? "tools" : "rust"}, showed no line that starts with Updating in place of the registry \`nx-rust-test\``,
          );
        }
        expect(output).toContain(
          "and publish online: offline, as with CARGO_NET_OFFLINE=true or net.offline, cargo does not show which registry it asked",
        );
        expect(publishCalls(copy)).toEqual([]);
        expect(uploadNames(copy)).toEqual(["nx-rust-test:pub-base@0.1.0"]);
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails every crate for crates.io where the Cargo home replaces crates.io, because the lookup shows the replacement",
    async () => {
      await withPublishCopy({ registryEnv: { registryDefault: "crates-io" } }, async (copy) => {
        const { status, output } = await nxRelease(copy, ["publish"]);

        expect({ status, output }).toMatchObject({ status: 1 });
        for (const task of [base, core, tool]) {
          expect(output).toContain(`${task}: \`cargo info `);
        }
        expect(output).toContain(
          "`cargo info pub-base@0.1.0 --index sparse+https://index.crates.io/ --locked`, run in the folder rust, showed `nx-rust-test` in place of crates.io",
        );
        expect(output).toContain(
          "Publish pub-base to crates.io from a job whose Cargo configuration does not replace crates.io",
        );
        expect(publishCalls(copy)).toEqual([]);
        expect(copy.registry.allUploads()).toEqual([]);
        // The lookups went to the replacement; nothing asked for another host.
        expect(copy.registry.requests().filter((request) => request.method === "CONNECT")).toEqual(
          [],
        );
        expectNoCratesIoFlag(copy);
      });
    },
    HARNESS_TIMEOUT,
  );
});
