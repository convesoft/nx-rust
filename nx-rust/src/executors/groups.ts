import { isDeepStrictEqual } from "node:util";
import { cargoArguments } from "./command";
import type { PreparedTask } from "./task";

/**
 * Whether tasks whose cargo commands would differ only in the crates they
 * select share one command per step (`DES-BATCH`): the one switch of the
 * batch executor that the strategies of `DES-UNIFICATION` turn on.
 *
 * Off until the first strategy that resolves features for the whole
 * workspace is implemented (nxr-8f9dz2, `workspace-build`), so that every
 * task forms a group of one crate ("Groups of one crate" in `DES-BATCH`)
 * and runs the command that it runs on its own: `cargo test -p a -p b`
 * gives `a` other features than `cargo test -p a`, which the keys do not
 * know (`ADR-WORKSPACE-FEATURES`). The code that runs a group of several
 * crates, {@link runGroup} in `group-run.ts`, is in place and tested with
 * groups that the tests form with this switch on.
 */
export const groupsShareCommands = false;

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
    const group = key.shares ? groups.find((entry) => sameKey(entry.key, key)) : undefined;
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
// selects one, and where it runs.
function groupKey(task: PreparedTask): GroupKey {
  if (task.crate === undefined) {
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
