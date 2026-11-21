import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  allOf,
  type CargoCall,
  cargoIn,
  git,
  HARNESS_TIMEOUT,
  isProbe,
  nxRelease,
  plainCrate,
  publishCalls,
  type PublishCopy,
  publishList,
  registryCalls,
  trackedFiles,
  withPublishCopy,
  withReleaseGroups,
  removeSharedRegistry,
} from "./harness";

// Checks group 6 of VER-RELEASE: `nx release publish --dry-run` with the
// plugin's publish executor, with the real Nx and cargo, in copies of the
// fixture publish-crates, each with an empty harness registry
// (`SparseRegistry`), whose server the file's tests share, and whose variables every command gets: crates.io replaced
// by the registry, its proxy, which refuses every other host, and
// `CARGO_REGISTRY_DEFAULT`, which chooses the target registry, so that the
// executor runs no probe. No test reaches a real registry, and no cargo call
// that the wrapper logs carries `--registry crates-io`. The cases of a
// crate's dotenv file leave `CARGO_REGISTRY_DEFAULT` unset, so that the
// file's value reaches the task.

/**
 * The cargo calls that the wrapper logged in the copy other than those of
 * graph creation, which name the manifest with `--manifest-path`. The
 * version actions, which Nx loads in its own process for every release
 * command, ask once for the report of each Cargo workspace in its root
 * folder, as the executor asks for its own reports, without
 * `--manifest-path`.
 */
function nonGraphCargoCalls(copy: PublishCopy): CargoCall[] {
  return copy.workspace
    .cargoCalls()
    .filter((call) => !(call.args[0] === "metadata" && call.args.includes("--manifest-path")));
}

/** The report of each Cargo workspace of the fixture, as the version actions ask for it. */
const versionActionReports: CargoCall[] = ["rust", "tools"].map((cwd) => ({
  cwd,
  args: ["metadata", "--format-version", "1", "--no-deps"],
}));

/** Bumps `pub-base` to 0.2.0, which bumps `pub-core` and `pub-tool` as its dependents, and commits and tags it. */
async function bumpBase(copy: PublishCopy): Promise<void> {
  const { status, output } = await nxRelease(copy, ["version", "0.2.0", "--projects", "pub-base"]);
  expect({ status, output }).toMatchObject({ status: 0 });
}

afterAll(removeSharedRegistry);

describe("nx release publish --dry-run", () => {
  it(
    "verifies a crate and its dependent of one workspace with one call, and says that a dependent in another workspace was not verified",
    async () => {
      await withPublishCopy({}, async (copy) => {
        await bumpBase(copy);
        const files = trackedFiles(copy.workspace);
        copy.workspace.cargo.clear();

        const { status, output } = await nxRelease(copy, ["publish", "--dry-run"]);

        expect({ status, output }).toMatchObject({ status: 0 });
        expect(registryCalls(copy).filter(isProbe)).toEqual([]);
        // Neither new version is in the registry; cargo verifies both against each other.
        expect(publishCalls(copy)).toEqual([
          {
            cwd: "rust",
            flags: ["publish", "--dry-run", "--locked", "--registry", "nx-rust-test"],
            crates: ["pub-base", "pub-core"],
          },
        ]);
        expect(output).toContain("Uploading pub-core v0.1.1");
        expect(output).toContain("warning: aborting upload due to dry run");
        expect(output).toContain(
          "pub-tool:nx-release-publish: pub-tool 0.1.1 was not verified, because it needs pub-core 0.1.1, which pub-core:nx-release-publish would publish in another cargo call",
        );
        for (const call of registryCalls(copy)) {
          expect(call.args).toContain("--locked");
          expect(call.args).toEqual(expect.arrayContaining(["--registry", "nx-rust-test"]));
        }
        expect(copy.registry.allUploads()).toEqual([]);
        // Manifests, lockfiles and every other tracked file stay as they were.
        expect(trackedFiles(copy.workspace)).toEqual(files);
        expect(git(copy.workspace, "status", "--porcelain")).toBe("");
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "says that a dependent in another release group was not verified, naming the task that would publish its dependency, which the command's specifier versions too",
    async () => {
      const files = withReleaseGroups({ base: ["pub-base"], users: ["pub-core", "pub-tool"] });
      await withPublishCopy({ files }, async (copy) => {
        await bumpBase(copy);
        copy.workspace.cargo.clear();

        const { status, output } = await nxRelease(copy, ["publish", "--dry-run"]);

        expect({ status, output }).toMatchObject({ status: 0 });
        // The group of pub-base comes first, and pub-base is verified alone.
        expect(publishCalls(copy)).toEqual([
          {
            cwd: "rust",
            flags: ["publish", "--dry-run", "--locked", "--registry", "nx-rust-test"],
            crates: ["pub-base"],
          },
        ]);
        expect(output).toContain(
          "pub-core:nx-release-publish: pub-core 0.2.0 was not verified, because it needs pub-base 0.2.0, which pub-base:nx-release-publish would publish in another cargo call",
        );
        expect(output).toContain(
          "pub-tool:nx-release-publish: pub-tool 0.2.0 was not verified, because it needs pub-core 0.2.0, which pub-core:nx-release-publish would publish in another cargo call",
        );
        expect(copy.registry.allUploads()).toEqual([]);
      });
    },
    HARNESS_TIMEOUT * 2,
  );

  it(
    "fails each task of a workspace whose committed bump left Cargo.lock stale, dry or real, with cargo's message and the way to bring it up to date",
    async () => {
      await withPublishCopy({}, async (copy) => {
        // A bump written by hand and committed without the lockfile.
        const before = copy.workspace.files();
        writeFileSync(
          join(copy.workspace.root, "rust/crates/base/Cargo.toml"),
          before["rust/crates/base/Cargo.toml"].replace('version = "0.1.0"', 'version = "0.2.0"'),
        );
        writeFileSync(
          join(copy.workspace.root, "rust/Cargo.toml"),
          before["rust/Cargo.toml"].replace('version = "0.1.0"', 'version = "0.2.0"'),
        );
        git(
          copy.workspace,
          "commit",
          "--quiet",
          "--all",
          "--message",
          "A bump without the lockfile",
        );
        const files = trackedFiles(copy.workspace);

        for (const args of [["--dry-run"], []]) {
          const { status, output } = await nxRelease(copy, [
            "publish",
            "--projects",
            "pub-base,pub-core",
            ...args,
          ]);

          expect({ status, output }).toMatchObject({ status: 1 });
          expect(output).toContain("--locked was passed to prevent this");
          for (const task of ["pub-base:nx-release-publish", "pub-core:nx-release-publish"]) {
            expect(output).toContain(
              `${task}: Cargo.lock of the Cargo workspace in the folder rust does not match its manifests, and @convesoft/nx-rust passes --locked, so that publishing changes no tracked file. Run \`nx release version\`, which brings Cargo.lock up to date`,
            );
          }
          expect(copy.registry.allUploads()).toEqual([]);
          expect(trackedFiles(copy.workspace)).toEqual(files);
        }
      });
    },
    HARNESS_TIMEOUT * 2,
  );
  describe("a crate whose dotenv file builds its registry from another variable", () => {
    // Nothing in the command's environment or Cargo's configuration chooses
    // a registry, so the value of the crate's dotenv file reaches its task.
    const noDefault = { registryDefault: null, home: "no-default" } as const;
    const modes: Record<string, string>[] = [{}, { NX_BATCH_MODE: "false" }];
    const dotenvFile = "rust/crates/base/.env.nx-release-publish";

    it(
      "fails the crate's task before any cargo command, alone and in a batch, where the variable's value depends on how the task runs",
      async () => {
        const files = allOf(publishList("rust/crates/base/Cargo.toml", ["official"]), {
          [dotenvFile]: "CARGO_REGISTRY_DEFAULT=team-${NX_TASK_TARGET_CONFIGURATION}\n",
        });
        await withPublishCopy({ files, registryEnv: noDefault }, async (copy) => {
          for (const mode of modes) {
            copy.workspace.cargo.clear();

            const { status, output } = await nxRelease(
              copy,
              ["publish", "--dry-run", "--projects", "pub-base"],
              { NX_TASK_TARGET_CONFIGURATION: "release", ...mode },
            );

            expect({ mode, status, output }).toMatchObject({ mode, status: 1 });
            expect(output).toContain(
              `pub-base:nx-release-publish: ${dotenvFile} makes Nx look up NX_TASK_TARGET_CONFIGURATION where it expands CARGO_REGISTRY_DEFAULT, and NX_TASK_TARGET_CONFIGURATION has a value there that depends on how the task runs`,
            );
            // Neither the expanded value nor the placeholder of a batch
            // reaches a diagnostic, and the executor runs no cargo command:
            // the only calls besides graph creation's are the version
            // actions' reports, one per workspace.
            expect(output).not.toContain("team-");
            expect(nonGraphCargoCalls(copy)).toEqual(versionActionReports);
            expect(copy.registry.allUploads()).toEqual([]);
          }
        });
      },
      HARNESS_TIMEOUT * 2,
    );

    it(
      "fails that crate and its dependents in a batch, where it depends on another crate of the repository, and verifies an unrelated crate beside it, which without a batch stops by the accepted rule for a crate of another run",
      async () => {
        const coreFile = "rust/crates/core/.env.nx-release-publish";
        const refusal = `pub-core:nx-release-publish: ${coreFile} makes Nx look up NX_TASK_TARGET_CONFIGURATION where it expands CARGO_REGISTRY_DEFAULT`;
        const files = allOf(
          plainCrate,
          withReleaseGroups({ crates: ["pub-base", "pub-core", "pub-tool", "pub-plain"] }),
          {
            [coreFile]: "CARGO_REGISTRY_DEFAULT=team-${NX_TASK_TARGET_CONFIGURATION}\n",
          },
        );
        const relock = (copy: PublishCopy) => {
          const { status, output } = cargoIn(copy, "rust", "generate-lockfile");
          expect({ status, output }).toMatchObject({ status: 0 });
        };
        const run = (copy: PublishCopy, mode: Record<string, string>) =>
          nxRelease(copy, ["publish", "--dry-run", "--projects", "pub-core,pub-plain,pub-tool"], {
            NX_TASK_TARGET_CONFIGURATION: "release",
            ...mode,
          });
        await withPublishCopy(
          { files, registryEnv: { registryDefault: null, home: "default" }, prepare: relock },
          async (copy) => {
            // In a batch, pub-core is a task of this run that failed: it
            // stops neither pub-plain nor the run, and pub-tool, which needs
            // it, fails before its call.
            const batch = await run(copy, {});

            expect(batch).toMatchObject({ status: 1 });
            expect(batch.output).toContain(refusal);
            expect(batch.output).toContain(
              "pub-tool:nx-release-publish: pub-tool needs pub-core 0.1.0, which pub-core:nx-release-publish would publish, and that task failed in this run, so @convesoft/nx-rust can tell neither where pub-core goes nor whether it is there",
            );
            expect(batch.output).not.toContain("team-");
            expect(batch.output).not.toContain("uploads nothing of this run");
            expect(publishCalls(copy)).toEqual([
              {
                cwd: "rust",
                flags: ["publish", "--dry-run", "--locked", "--registry", "nx-rust-test"],
                crates: ["pub-plain"],
              },
            ]);
            expect(batch.output).toContain("Uploading pub-plain v0.1.0");

            // Without a batch, pub-core's task is one of another run, whose
            // environment the task of pub-plain cannot rebuild, so the checks
            // before the first call stop every task, as for any crate of
            // another run that depends on a crate of the repository and whose
            // dotenv files give other Cargo settings (`DES-RELEASE`, "Checks
            // before the first call"). This pins that accepted rule; it is not
            // a defect.
            copy.workspace.cargo.clear();
            const alone = await run(copy, { NX_BATCH_MODE: "false" });

            expect(alone).toMatchObject({ status: 1 });
            expect(alone.output).toContain(refusal);
            expect(alone.output).not.toContain("team-");
            expect(alone.output).toContain(
              "pub-plain:nx-release-publish: @convesoft/nx-rust uploads nothing of this run",
            );
            expect(alone.output).toContain(
              "pub-core:nx-release-publish: pub-core depends on pub-base, and Nx runs pub-core:nx-release-publish on its own, so @convesoft/nx-rust cannot rebuild its environment",
            );
            expect(publishCalls(copy)).toEqual([]);
            expect(copy.registry.allUploads()).toEqual([]);
          },
        );
      },
      HARNESS_TIMEOUT * 2,
    );

    it(
      "verifies the crate, alone and in a batch, where no variable that the file refers to depends on how the task runs",
      async () => {
        const files = {
          [dotenvFile]: "CARGO_REGISTRY_DEFAULT=${NX_RUST_TEST_TEAM:-nx-rust-test}\n",
        };
        await withPublishCopy({ files, registryEnv: noDefault }, async (copy) => {
          for (const mode of modes) {
            copy.workspace.cargo.clear();

            const { status, output } = await nxRelease(
              copy,
              ["publish", "--dry-run", "--projects", "pub-base"],
              { NX_TASK_TARGET_CONFIGURATION: "release", ...mode },
            );

            expect({ mode, status, output }).toMatchObject({ mode, status: 0 });
            expect(registryCalls(copy).filter(isProbe)).toEqual([]);
            expect(publishCalls(copy)).toEqual([
              {
                cwd: "rust",
                flags: ["publish", "--dry-run", "--locked", "--registry", "nx-rust-test"],
                crates: ["pub-base"],
              },
            ]);
            expect(copy.registry.allUploads()).toEqual([]);
          }
        });
      },
      HARNESS_TIMEOUT * 2,
    );
  });
});
