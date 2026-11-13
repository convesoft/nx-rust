import type { CargoCall } from "./cargo-wrapper";
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

/** The cargo calls of tasks: every logged call but graph creation's `cargo metadata`. */
export function taskCalls(workspace: FixtureWorkspace): CargoCall[] {
  return workspace.cargoCalls().filter((call) => call.args[0] !== "metadata");
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
