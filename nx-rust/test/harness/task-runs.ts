import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CargoCall } from "./cargo-wrapper";
import { testEnvironment } from "./environment";
import type { FileChanges, FixtureName } from "./fixtures";
import { FixtureWorkspace, withoutColours } from "./workspace";

/** Environment variables for a command; `undefined` removes one. */
export type Env = Record<string, string | undefined>;

/**
 * Runs Nx in the workspace with static output, its colours removed. The
 * output style comes first, so that it stays an option of Nx also when
 * `args` holds `--`.
 */
export async function runNx(
  workspace: FixtureWorkspace,
  args: string[],
  env: Env = {},
): Promise<{ status: number | null; output: string }> {
  const { status, output } = await workspace.nx(["--output-style=static", ...args], env);
  return { status, output: withoutColours(output) };
}

/**
 * The cargo calls of tasks other than the lockfile task: every logged call
 * but graph creation's `cargo metadata` and the lockfile task's `cargo update
 * --workspace`, which {@link lockfileCalls} returns.
 */
export function taskCalls(workspace: FixtureWorkspace): CargoCall[] {
  return workspace
    .cargoCalls()
    .filter((call) => call.args[0] !== "metadata" && !isLockfileCall(call));
}

/** The cargo calls of lockfile tasks, `cargo update --workspace`, in the order they ran. */
export function lockfileCalls(workspace: FixtureWorkspace): CargoCall[] {
  return workspace.cargoCalls().filter(isLockfileCall);
}

function isLockfileCall(call: CargoCall): boolean {
  return call.args[0] === "update" && call.args[1] === "--workspace";
}

/**
 * The package ID specification with which the plugin's cargo commands, all
 * but `cargo fmt`, select the member `pkg` of the Cargo workspace in the
 * folder `folder` of the repository at `root` (`DES-INVOCATION`), as the
 * cargo wrapper's `calls(root)` shows it: in the form that `cargo pkgid`
 * prints, `path+file://<the member's folder>#<version>`, with `<pkg>@` before
 * the version where the folder's name is not the package name, and with
 * `{workspaceRoot}` in place of `root`, such as
 * `path+file://{workspaceRoot}/rust/crates/core#core-lib@0.1.0`. The member's
 * folder and version come from the workspace's `cargo metadata --no-deps`
 * report, which the test's cargo writes without the wrapper.
 */
export function packageSpec(root: string, folder: string, pkg: string): string {
  const report = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
    cwd: join(root, folder),
    env: testEnvironment(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (report.status !== 0) {
    throw new Error(`cargo metadata failed in ${folder}:\n${report.stderr}`);
  }
  const packages = (
    JSON.parse(report.stdout) as {
      packages: { name: string; version: string; manifest_path: string }[];
    }
  ).packages;
  const member = packages.find((candidate) => candidate.name === pkg);
  if (member === undefined) {
    throw new Error(`The workspace in ${folder} has no member named ${pkg}.`);
  }
  const memberFolder = dirname(member.manifest_path);
  const name = basename(memberFolder) === pkg ? "" : `${pkg}@`;
  const spec = `path+${pathToFileURL(memberFolder).href}#${name}${member.version}`;
  return spec.split(root).join("{workspaceRoot}");
}

/** Calls in a stable order, for runs whose tasks run in parallel. */
export function sortedCalls(calls: CargoCall[]): CargoCall[] {
  return [...calls].sort((a, b) =>
    `${a.cwd} ${a.args.join(" ")}`.localeCompare(`${b.cwd} ${b.args.join(" ")}`),
  );
}

/** Creates a fixture workspace, hands it to `test` and removes it afterwards. */
export async function inFixture(
  fixture: FixtureName,
  files: FileChanges | undefined,
  test: (workspace: FixtureWorkspace) => Promise<void>,
): Promise<void> {
  const workspace = FixtureWorkspace.create(fixture, files);
  try {
    await test(workspace);
  } finally {
    workspace.remove();
  }
}

/** Sets `targetDefaults` in a fixture copy's `nx.json`. */
export function withTargetDefaults(defaults: object): (nxJson: string) => string {
  return (nxJson) => JSON.stringify({ ...JSON.parse(nxJson), targetDefaults: defaults });
}

/** The lines of `output` that contain `text`. */
export function linesWith(output: string, text: string): string[] {
  return output.split("\n").filter((line) => line.includes(text));
}
