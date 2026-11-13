import type { CargoCall } from "./cargo-wrapper";
import type { FileChanges, FixtureName } from "./fixtures";
import { FixtureWorkspace, withoutColours } from "./workspace";

/** Environment variables for a command; `undefined` removes one. */
export type Env = Record<string, string | undefined>;

/**
 * Runs Nx in the workspace with static output, its colours removed. The
 * output style comes first, so that it stays an option of Nx also when
 * `args` holds `--`. `NX_SKIP_LOG_GROUPING` keeps that output the same in
 * GitHub Actions, where Nx would otherwise wrap each task's output in a log
 * group and start its `> nx run` line with `::group::` and a status icon.
 */
export async function runNx(
  workspace: FixtureWorkspace,
  args: string[],
  env: Env = {},
): Promise<{ status: number | null; output: string }> {
  const { status, output } = await workspace.nx(["--output-style=static", ...args], {
    NX_SKIP_LOG_GROUPING: "true",
    ...env,
  });
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
