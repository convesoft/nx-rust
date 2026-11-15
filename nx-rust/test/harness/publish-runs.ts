import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CargoCall } from "./cargo-wrapper";
import { testEnvironment } from "./environment";
import type { FileChanges } from "./fixtures";
import {
  type RegistryEnvOptions,
  SparseRegistry,
  type SparseRegistryOptions,
} from "./sparse-registry";
import { FixtureWorkspace, withoutColours } from "./workspace";

/**
 * A copy of the fixture `publish-crates`, committed to a git repository of
 * its own, with a harness registry of its own (`VER-RELEASE`, groups 6, 7
 * and 9). Every cargo and Nx command of a test runs with {@link env}: the
 * registry's Cargo home and variables, which the fixture's `registry` keys
 * need for every cargo command, graph creation included, and git's identity.
 */
export interface PublishCopy {
  workspace: FixtureWorkspace;
  registry: SparseRegistry;
  /** The variables of every command: the registry's, with the variant of the case, and git's. */
  env: Record<string, string | undefined>;
}

/** What {@link withPublishCopy} sets up besides the fixture. */
export interface PublishCopyOptions {
  /** Changes applied to the fixture before the first commit, also as a function of the registry, for its index URLs. */
  files?: FileChanges | ((registry: SparseRegistry) => FileChanges);
  /** The variant of the registry's variables ({@link SparseRegistry.env}). */
  registryEnv?: RegistryEnvOptions;
  /** How the registry starts. */
  registryOptions?: SparseRegistryOptions;
  /** Runs after `git init` and before the first commit, which adds every file that git does not ignore. */
  prepare?: (copy: PublishCopy) => void;
}

/** The variables that give git, also Nx's commits and tags, an identity and no outside configuration. */
export function gitVariables(workspace: FixtureWorkspace): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: "Release Test",
    GIT_AUTHOR_EMAIL: "release-test@example.com",
    GIT_COMMITTER_NAME: "Release Test",
    GIT_COMMITTER_EMAIL: "release-test@example.com",
    GIT_CONFIG_GLOBAL: join(workspace.root, "..", "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

/** Runs git in the copy and returns what it printed. */
export function git(workspace: FixtureWorkspace, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspace.root,
    env: testEnvironment(gitVariables(workspace)),
    encoding: "utf8",
  });
}

/**
 * Runs `test` in a new copy of `publish-crates` with a new harness registry,
 * and removes both afterwards.
 */
export async function withPublishCopy(
  options: PublishCopyOptions,
  test: (copy: PublishCopy) => Promise<void>,
): Promise<void> {
  const registry = await SparseRegistry.start(options.registryOptions);
  let workspace: FixtureWorkspace | undefined;
  try {
    workspace = FixtureWorkspace.create(
      "publish-crates",
      typeof options.files === "function" ? options.files(registry) : options.files,
    );
    writeFileSync(join(workspace.root, "..", "gitconfig"), "");
    const copy: PublishCopy = {
      workspace,
      registry,
      env: { ...registry.env(options.registryEnv), ...gitVariables(workspace) },
    };
    git(workspace, "init", "--quiet", "--initial-branch=main");
    options.prepare?.(copy);
    git(workspace, "add", "--all");
    git(workspace, "commit", "--quiet", "--message", "The fixture");
    await test(copy);
  } finally {
    workspace?.remove();
    await registry.remove();
  }
}

/**
 * Runs `nx release <args>` in the copy with its variables and `extra`, and
 * returns the exit status and the output without colours and without the
 * spaces that Nx leaves at the end of lines.
 */
export async function nxRelease(
  copy: PublishCopy,
  args: string[],
  extra: Record<string, string | undefined> = {},
): Promise<{ status: number | null; output: string }> {
  const { status, output } = await copy.workspace.nx(["release", ...args], {
    ...copy.env,
    ...extra,
  });
  return { status, output: withoutColours(output).replace(/[^\S\n]+$/gm, "") };
}

/** The `cargo publish` and `cargo info` calls that the wrapper logged in the copy, in order. */
export function registryCalls(copy: PublishCopy): CargoCall[] {
  return copy.workspace
    .cargoCalls()
    .filter((call) => call.args[0] === "publish" || call.args[0] === "info");
}

/** Whether a logged `cargo publish` is the probe of the target registry (`DES-RELEASE`, "Target registry"). */
export function isProbe(call: CargoCall): boolean {
  return call.args[0] === "publish" && call.args.includes("--no-verify");
}

/**
 * Every file of the copy that git tracks, or with `untracked` also every file
 * that git does not ignore, with its content; the fixture's `.gitignore`
 * leaves out `node_modules`, `.nx` and `target`.
 */
export function trackedFiles(workspace: FixtureWorkspace, untracked = true): Map<string, string> {
  const files = new Map<string, string>();
  const paths = git(
    workspace,
    "ls-files",
    "-z",
    "--cached",
    ...(untracked ? ["--others", "--exclude-standard"] : []),
  )
    .split("\0")
    .filter((path) => path !== "");
  for (const path of [...new Set(paths)].sort()) {
    files.set(path, readFileSync(join(workspace.root, path), "utf8"));
  }
  return files;
}

/** The lines of `output` that a task printed with `label`, the task's own lines, and the cargo lines between them are not told apart. */
export function taskLines(output: string, label: string): string[] {
  return output.split("\n").filter((line) => line.includes(label));
}

/** The uploads of every registry of the copy's server as `<registry>:<crate>@<version>`, in order of arrival per registry. */
export function uploadNames(copy: PublishCopy): string[] {
  return copy.registry
    .allUploads()
    .map(
      (upload) => `${upload.registry ?? SparseRegistry.registryName}:${upload.name}@${upload.vers}`,
    );
}

/** The crates that a logged `cargo publish` selects with `-p`, sorted. */
export function selectedCrates(args: readonly string[]): string[] {
  return args.filter((_, index) => args[index - 1] === "-p").sort();
}

/** The `cargo publish` calls other than probes that the wrapper logged in the copy, as their folder, flags and sorted crates. */
export function publishCalls(
  copy: PublishCopy,
): { cwd: string; flags: string[]; crates: string[] }[] {
  return registryCalls(copy)
    .filter((call) => call.args[0] === "publish" && !isProbe(call))
    .map((call) => ({
      cwd: call.cwd,
      flags: call.args.filter((arg, index, args) => arg !== "-p" && args[index - 1] !== "-p"),
      crates: selectedCrates(call.args),
    }));
}

/** A change of the fixture's `nx.json` that gives it these independent release groups. */
export function withReleaseGroups(groups: Record<string, string[]>): FileChanges {
  return {
    "nx.json": (nxJson) => {
      const config = JSON.parse(nxJson ?? "{}");
      config.release.groups = Object.fromEntries(
        Object.entries(groups).map(([name, projects]) => [
          name,
          { projects, projectsRelationship: "independent" },
        ]),
      );
      return `${JSON.stringify(config, null, 2)}\n`;
    },
  };
}

/** A change that replaces `from` with `to` in each of `files`. */
export function replacing(files: readonly string[], from: string, to: string): FileChanges {
  return Object.fromEntries(
    files.map((file) => [
      file,
      (content: string | undefined) => (content ?? "").split(from).join(to),
    ]),
  );
}

/** The manifests of `publish-crates` whose entries name the harness registry. */
export const registryKeyManifests = ["rust/Cargo.toml", "tools/Cargo.toml"];

/**
 * Runs cargo in a folder of the copy with the copy's variables and returns
 * its exit status and output, as for regenerating a lockfile in `prepare`.
 */
export function cargoIn(
  copy: PublishCopy,
  folder: string,
  ...args: string[]
): { status: number | null; output: string } {
  const run = spawnSync("cargo", args, {
    cwd: join(copy.workspace.root, folder),
    env: testEnvironment(copy.env),
    encoding: "utf8",
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

/**
 * A change that adds the crate `pub-plain` to the `rust/` workspace, without
 * a `publish` list or dependencies; give the copy's `prepare` a
 * {@link cargoIn} `generate-lockfile` in `rust` with it.
 */
export const plainCrate: FileChanges = {
  "rust/crates/plain/Cargo.toml": [
    "[package]",
    'name = "pub-plain"',
    'version = "0.1.0"',
    'description = "A crate of the publishing tests without a publish list"',
    "edition.workspace = true",
    "license.workspace = true",
    "",
  ].join("\n"),
  "rust/crates/plain/src/lib.rs": "pub fn plain() -> u32 {\n    4\n}\n",
};

/** A change that gives a crate's manifest a `publish` list, or replaces the one it has. */
export function publishList(manifest: string, list: readonly string[]): FileChanges {
  return {
    [manifest]: (content) => {
      const line = `publish = ${JSON.stringify(list)}`;
      const text = content ?? "";
      return /^publish = .*$/m.test(text)
        ? text.replace(/^publish = .*$/m, line)
        : text.replace(/^(license(\.workspace)? = .*)$/m, `$1\n${line}`);
    },
  };
}

/** Changes applied in order, as one. */
export function allOf(...changes: FileChanges[]): FileChanges {
  const merged: FileChanges = {};
  for (const change of changes) {
    for (const [file, value] of Object.entries(change)) {
      const before = merged[file];
      if (before === undefined) {
        merged[file] = value;
      } else {
        merged[file] = (content) => {
          const first = typeof before === "function" ? before(content) : before;
          return typeof value === "function" ? value(first ?? undefined) : value;
        };
      }
    }
  }
  return merged;
}

/**
 * The variables with which cargo reads `publish-crates` without the
 * harness's registry: its entries name `nx-rust-test`, and cargo refuses a
 * manifest whose `registry` key no configuration names. The index lies on a
 * port of the loopback interface that nothing serves, and cargo works
 * offline, which the fixture allows, because it has path dependencies only.
 */
export const offlineRegistryKeyEnv: Readonly<Record<string, string>> = {
  CARGO_REGISTRIES_NX_RUST_TEST_INDEX: "sparse+http://127.0.0.1:9/index/",
  CARGO_NET_OFFLINE: "true",
};
