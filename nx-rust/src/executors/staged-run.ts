import {
  type CargoDirectories,
  DirectoryReportError,
  reportedDirectories,
} from "../cargo/directories";
import { physicalPath } from "../graph/real-path";
import { type GroupMember, type LiveOutput, type MemberResult, runGroup } from "./group-run";
import type { GroupSelection } from "./groups";
import { runNapiGroup } from "./napi-build";
import {
  createStage,
  moveStagedFiles,
  removeStage,
  type Stage,
  StageError,
  stagedFinalFiles,
  stagesCommand,
  withStage,
} from "./stage";
import { runWasmGroup } from "./wasm-build";

/**
 * Runs a group of tasks with the runner of its target, in a batch or as a
 * task run on its own: `runNapiGroup` for `napi-build`, `runWasmGroup` for
 * `wasm-build` and `runGroup` for every other target (`DES-NAPI`,
 * `DES-WASM`). A whole-workspace `build` and every compile of `napi-build`
 * and `wasm-build` build in a stage of their own (`DES-BATCH`, "Staged
 * builds"): a `build` moves its own crates' final artifacts and records out
 * of it right after cargo, before the checks that read them, and a
 * `napi-build` or `wasm-build` post-processes and checks from the stage. The
 * stage is removed once the group is done, whatever happened. Where the
 * stage cannot be made, every task fails before cargo; where a file of a
 * task's crate cannot be moved, the task fails.
 *
 * @returns One result per member, in order.
 */
// @mara implements DES-BATCH
export async function runTargetGroup(
  members: readonly GroupMember[],
  selection: GroupSelection,
  verbose: boolean,
  live: LiveOutput = "none",
): Promise<MemberResult[]> {
  const [first] = members;
  const target = first?.prepared.target;
  if (first === undefined || !stagesCommand(target, selection)) {
    return runner(target)(members, verbose, live);
  }
  let stage: Stage;
  try {
    stage = createStage(
      first.invocation.inputCheck?.directories ??
        first.invocation.directories ??
        physicalDirectories(first.invocation.cwd, first.prepared.env),
    );
  } catch (error) {
    if (!(error instanceof StageError) && !(error instanceof DirectoryReportError)) {
      throw error;
    }
    return members.map((member) => ({
      success: false,
      output: stageMessage(member.prepared.task, [error.message]),
    }));
  }
  const staged = members.map((member) => ({
    ...member,
    invocation: withStage(member.invocation, stage, target !== "build"),
  }));
  // A `build` moves its own crates' files right after cargo, inside the
  // step, so that the checks after cargo read them where they belong.
  const moveProblems = new Map<string, string[]>();
  const packageIds = new Set(
    staged.flatMap((member) =>
      member.invocation.package === undefined ? [] : [member.invocation.package.id],
    ),
  );
  const observe =
    target !== "build"
      ? undefined
      : (_step: unknown, output: string): void => {
          for (const [id, problems] of moveStagedFiles(
            stage,
            stagedFinalFiles(output, stage, packageIds),
          )) {
            moveProblems.set(id, [...(moveProblems.get(id) ?? []), ...problems]);
          }
        };
  let results: MemberResult[];
  let removal: string | undefined;
  try {
    results =
      target === "build"
        ? await runGroup(staged, verbose, live, observe)
        : await runner(target)(staged, verbose, live);
  } finally {
    removal = removeStage(stage);
  }
  return staged.map((member, index) => {
    const { success, output } = results[index];
    const problems = moveProblems.get(member.invocation.package?.id ?? "") ?? [];
    return {
      success: success && problems.length === 0,
      output: [
        ...(output === "" ? [] : [output]),
        ...(problems.length > 0 ? [stageMessage(member.prepared.task, problems)] : []),
        ...(removal === undefined ? [] : [`${member.prepared.task}: warning: ${removal}.`]),
      ].join("\n"),
    };
  });
}

function runner(
  target: string | undefined,
): (
  members: readonly GroupMember[],
  verbose: boolean,
  live: LiveOutput,
) => Promise<MemberResult[]> {
  return target === "napi-build"
    ? runNapiGroup
    : target === "wasm-build"
      ? runWasmGroup
      : (members, verbose, live) => runGroup(members, verbose, live);
}

/**
 * The message of a task whose staged group could not make its stage, get
 * Cargo's directories for it, or move a file of the task's crate out of it
 * (`DES-BATCH`, "Staged builds"; `DES-DIAGNOSTICS`).
 */
// @mara implements DES-DIAGNOSTICS
export function stageMessage(task: string, problems: readonly string[]): string {
  return `${task}: @convesoft/nx-rust builds this task's cargo command in a stage of its own, in the artifact directory, and moves only the task's own files out of it, so that it replaces no file of another crate's build; ${problems.join("; ")}. The task fails, so that Nx stores no result for it. Check that the artifact directory can be written to and has space, and run the command again.`;
}

// Cargo's directories in the workspace root with the group's environment,
// as physical paths, for a staged group whose command had no report of them.
function physicalDirectories(cwd: string, env: NodeJS.ProcessEnv): CargoDirectories {
  const reported = reportedDirectories(cwd, env);
  return { artifact: physicalPath(reported.artifact), build: physicalPath(reported.build) };
}
