import { isDeepStrictEqual } from "node:util";
import { type ConfiguredRunner, configuredRunner } from "../cargo/configured-runner";
import { hostTriple } from "../cargo/host-triple";
import { pickedTriples } from "../cargo/target-triples";
import { cargoArguments, selectsWorkspace } from "./command";
import type { PreparedTask } from "./task";

/**
 * Whether tasks whose cargo commands would differ only in the crates they
 * select share one command per step (`DES-BATCH`): the one switch of the
 * batch executor that the strategies of `DES-UNIFICATION` turn on.
 *
 * On since `workspace-build` (nxr-8f9dz2), under which every workspace runs
 * until the other strategies exist (nxr-k64tm5): {@link planGroups} makes a
 * group of `build`, `check`, `lint` or `test` select the whole workspace,
 * however many tasks it holds, and run `test` in the three steps of
 * `DES-TEST-RUN` with the selecting runner, and the tasks that cannot do so
 * form groups of one crate ("Groups of one crate" in `DES-BATCH`). The
 * tasks of one target share an environment because cargo never gets the
 * variables by which Nx names a task's project (`ADR-TASK-NAME-VARIABLES`),
 * and a `test` waits for every `build` whose executables its commands
 * replace (`ADR-WORKSPACE-TEST-EXECUTABLES`).
 */
export const groupsShareCommands = true;

/**
 * Splits the prepared tasks of a batch into groups (`TERM-GROUP`): tasks
 * share a group only where their cargo commands would be the same but for
 * the crates they select, in the same workspace root, with the same
 * environment. The command is compared as {@link cargoArguments} builds it
 * from the options that the task's target takes, so that an option that a
 * task ignores splits no group (`DES-UNKNOWN-OPTIONS`), while a feature set,
 * profile, triple or option that shapes the command, such as the switch for
 * `--all-targets`, does. Environments are compared whole, so that each
 * cargo command runs with the environment that its tasks were keyed with.
 * A task of `build`, `check`, `lint` or `test` whose own options give it a
 * feature set shares no group, even with tasks to which a configuration or
 * the command line gives the same flags (`DES-FEATURE-SETS`).
 *
 * @param shareCommands Whether tasks share a group at all
 *   ({@link groupsShareCommands}); without it every task is a group of its own.
 * @returns The groups, each with its tasks in the given order, in the order
 *   of each group's first task.
 */
// @mara implements DES-BATCH
// @mara implements DES-UNKNOWN-OPTIONS
export function formGroups<T extends PreparedTask>(
  tasks: readonly T[],
  shareCommands: boolean = groupsShareCommands,
): T[][] {
  if (!shareCommands) {
    return tasks.map((task) => [task]);
  }
  const groups: { key: GroupKey; tasks: T[] }[] = [];
  for (const task of tasks) {
    const key = groupKey(task);
    const group = key.shares
      ? groups.find((entry) => entry.key.shares && sameKey(entry.key, key))
      : undefined;
    if (group === undefined) {
      groups.push({ key, tasks: [task] });
    } else {
      group.tasks.push(task);
    }
  }
  return groups.map((group) => group.tasks);
}

/** What tasks of one group have in common. */
interface GroupKey {
  /** Whether the task can share a command at all: it selects a crate. */
  shares: boolean;
  /** The workspace root, where the command starts. */
  cwd: string;
  /** The command with every crate selection replaced by the same placeholder. */
  command: string[];
  /** The task's environment. */
  env: NodeJS.ProcessEnv;
}

// The key of a task: its command without the crate it selects, where it
// selects one, and where it runs. A task of a compiling target whose own
// options give it a feature set shares no group, so that it forms a group of
// one crate whatever else the batch holds ("Groups of one crate" in
// `DES-BATCH`).
function groupKey(task: PreparedTask): GroupKey {
  if (task.crate === undefined || (task.ownFeatureSet === true && selectsWorkspace(task.target))) {
    return { shares: false, cwd: task.cwd, command: [], env: task.env };
  }
  return {
    shares: true,
    cwd: task.cwd,
    command: cargoArguments(
      {
        target: task.target,
        crates: [{ name: "\0", spec: "\0" }],
        locked: task.locked,
        binaryArguments: task.binaryArguments,
      },
      task.options,
    ),
    env: task.env,
  };
}

function sameKey(a: GroupKey, b: GroupKey): boolean {
  return (
    a.cwd === b.cwd &&
    isDeepStrictEqual(a.command, b.command) &&
    isDeepStrictEqual(definedEntries(a.env), definedEntries(b.env))
  );
}

// An environment's variables that have a value, in a fixed order.
function definedEntries(env: NodeJS.ProcessEnv): [string, string][] {
  return Object.entries(env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * How the commands of a group select its crates (`DES-UNIFICATION`, "How
 * each strategy selects"):
 *
 * - `workspace`: the whole workspace with `--workspace`, as a group of
 *   `build`, `check`, `lint` or `test` does under `workspace-build` on the
 *   host, however many tasks it holds, with the host's triple, which the
 *   selecting runner of `test` needs (`DES-TEST-RUN`);
 * - `alone`: a group of one crate, which selects that crate with `-p` and
 *   runs the command that a plain cargo of that crate runs ("Groups of one
 *   crate" in `DES-BATCH`), with the line that says why where the task's
 *   output names it;
 * - `crates`: each crate with `-p`, as `cargo fmt` takes them, which
 *   resolves no features, and the workspace project's targets, which select
 *   no crate.
 */
export type GroupSelection =
  | { kind: "workspace"; host?: string }
  | { kind: "alone"; note?: string }
  | { kind: "crates" };

/** A group of tasks and how its commands select its crates. */
export interface PlannedGroup<T extends PreparedTask> {
  tasks: T[];
  selection: GroupSelection;
}

/**
 * Decides how each group selects its crates ({@link GroupSelection}), and
 * splits a group whose command would pass a flag whose effect on a crate
 * depends on the selection, or set a runner where the user may have
 * configured one, into groups of one crate, one per task ("Groups of one
 * crate" in `DES-BATCH`). Under `workspace-build`, the strategy of every
 * workspace until the others exist (nxr-k64tm5), those are:
 *
 * - a group of `build`, `check`, `lint` or `test` that builds for a
 *   triple other than the host's, from its `targetTriple` option or from
 *   `build.target` in Cargo's configuration and `CARGO_BUILD_TARGET`, or
 *   for a triple whose folder the plugin cannot name, because the whole
 *   workspace may not build for it (`DES-FEATURE-SETS`);
 * - a group of `test` on the host where a runner for the host is or may be
 *   configured ({@link configuredRunner}), whose tasks say so at the top of
 *   their output (`DES-TEST-RUN`, "A runner the user configured");
 * - a task whose own options give it a feature set, which {@link formGroups}
 *   puts in a group of its own, so that its command writes only its crate's
 *   files and its result does not depend on what else the batch holds
 *   (`DES-FEATURE-SETS`).
 *
 * The host's triple is the one that `rustc -vV` names in the workspace root
 * with the group's environment; where it names none, the group's tasks form
 * groups of one crate, which cost speed and never a result. Every other
 * group of those targets selects the whole workspace, however many tasks it
 * holds, with its feature flags acting on every member (`DES-FEATURE-SETS`).
 * A group decides this once, with the files as they are when the batch forms
 * it: the tasks of a group share their workspace root, environment and
 * command options, which are all that the decision reads.
 *
 * @param shareCommands Whether groups share commands at all ({@link groupsShareCommands}).
 */
// @mara implements DES-BATCH
// @mara implements DES-UNIFICATION
// @mara implements DES-FEATURE-SETS
// @mara implements DES-TEST-RUN
export function planGroups<T extends PreparedTask>(
  groups: readonly T[][],
  shareCommands: boolean = groupsShareCommands,
): PlannedGroup<T>[] {
  const hosts = new Map<string, string | undefined>();
  const host = (task: PreparedTask): string | undefined => {
    const key = JSON.stringify([task.cwd, definedEntries(task.env)]);
    if (!hosts.has(key)) {
      hosts.set(key, hostTriple(task.cwd, task.env));
    }
    return hosts.get(key);
  };
  return groups.flatMap((tasks): PlannedGroup<T>[] => {
    const [first] = tasks;
    if (first === undefined) {
      return [];
    }
    const selection = shareCommands
      ? groupSelection(first, () => host(first))
      : { kind: "alone" as const };
    return selection.kind === "alone"
      ? tasks.map((task) => ({
          tasks: [task],
          selection:
            selection.note === undefined
              ? { kind: "alone" }
              : { kind: "alone", note: noteFor(task, selection.note) },
        }))
      : [{ tasks: [...tasks], selection }];
  });
}

// The note of a group of one crate with the task's name in front, which
// names the reason with `{crate}` in place of the crate.
function noteFor(task: PreparedTask, note: string): string {
  return `${task.task}: ${note.split("{crate}").join(task.crate ?? "")}`;
}

/**
 * How a group whose first task is `task` selects its crates
 * ({@link planGroups}): the note of a group of one crate holds `{crate}`
 * where it names the crate.
 */
export function groupSelection(task: PreparedTask, host: () => string | undefined): GroupSelection {
  if (task.crate === undefined || !selectsWorkspace(task.target)) {
    return { kind: "crates" };
  }
  // A crate whose own options give it a feature set selects only its crate,
  // whatever else the batch holds, so that its command writes no other
  // crate's files and its result depends on nothing else that runs.
  if (task.ownFeatureSet === true) {
    return { kind: "alone" };
  }
  const option = task.options.targetTriple;
  const picked =
    typeof option === "string" && option !== ""
      ? { kind: "triples" as const, triples: [option] }
      : pickedTriples(task.cwd, task.env);
  if (picked.kind === "unnamed") {
    return { kind: "alone" };
  }
  if (picked.kind === "triples" && picked.triples.length > 0) {
    const triple = host();
    if (triple === undefined || picked.triples.some((picked) => picked !== triple)) {
      return { kind: "alone" };
    }
  }
  if (task.target !== "test") {
    return { kind: "workspace" };
  }
  const triple = host();
  if (triple === undefined) {
    return {
      kind: "alone",
      note: "this task runs the tests of {crate} in cargo commands of its own, because `rustc -vV` names no host triple in the workspace root, which @convesoft/nx-rust needs to pass its selecting runner to cargo.",
    };
  }
  const runner: ConfiguredRunner | undefined = configuredRunner(task.cwd, task.env, triple);
  if (runner !== undefined) {
    return {
      kind: "alone",
      note: `this task runs the tests of {crate} in a cargo command of its own, without @convesoft/nx-rust's selecting runner, because a runner for the host ${triple} is or may be configured: ${runner.source} ${runner.detail}. Your runner then applies as in a plain \`cargo test -p {crate}\`, and the tests of the crates in this run do not share a cargo command.`,
    };
  }
  return { kind: "workspace", host: triple };
}
