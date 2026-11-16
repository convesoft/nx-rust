import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { type Lockfile, LockfileError, parseLockfile, reachedEntries } from "../cargo/lockfile";
import type { TargetCargoMetadata } from "../graph/targets";
import { type JsFlavour, jsFlavours, wasmPackageFolder, wasmTriple } from "../graph/wasm";
import {
  describeFolder,
  findExecutable,
  MissingToolError,
  requireTool,
  searchPath,
} from "../tools/optional-tools";
import { cargoEnvironment } from "./cargo-invocation";
import { describeList, reportedCdylibFiles } from "./cargo-output";
import { type GroupMember, type LiveOutput, type MemberResult, runGroup } from "./group-run";

/** What a `wasm-build` task needs beyond a `build` task, from its checks before cargo. */
export interface WasmTask {
  /** The absolute path of the crate's folder, which holds the package folder. */
  crateFolder: string;
  /** The absolute path of the `wasm-bindgen` CLI that the task runs. */
  cli: string;
  /** The CLI's version, which matches the `wasm-bindgen` crate in the lockfile. */
  version: string;
  /** The JS flavour, the CLI's `--target`. */
  flavour: JsFlavour;
}

/** Thrown by {@link prepareWasmTask} with the message with which the task fails before cargo. */
export class WasmTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WasmTaskError";
  }
}

/**
 * The checks of a `wasm-build` task before cargo runs (`DES-WASM`, "What
 * the step needs"; `DES-DIAGNOSTICS`), in this order:
 *
 * - the crate's library has the file name of another crate's file, which
 *   graph creation records ({@link TargetCargoMetadata.sharedLibrary}), so
 *   that cargo builds one `.wasm` file for both;
 * - the `jsFlavour` option is none of `bundler`, `web` and `nodejs`;
 * - the toolchain that the workspace root selects has no standard library
 *   for the wasm triple;
 * - the `wasm-bindgen` CLI is not on the task's `PATH`, as cargo looks it
 *   up in the workspace root, or does not say its version;
 * - the lockfile, which the lockfile task has brought up to date, reaches
 *   no `wasm-bindgen` crate from the crate's entry, or several versions, or
 *   one of another version than the CLI.
 *
 * The plugin installs nothing (`ADR-V1-SCOPE`).
 *
 * @param crateFolder The absolute path of the crate's folder.
 * @param cwd The absolute path of the workspace root, where cargo runs.
 * @param version The crate's version where graph creation recorded it.
 * @throws {WasmTaskError} With the message of the first check that fails.
 */
// @mara implements DES-WASM
// @mara implements DES-DIAGNOSTICS
export function prepareWasmTask(
  task: string,
  crate: string,
  metadata: TargetCargoMetadata,
  crateFolder: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: { jsFlavour?: unknown },
  repositoryRoot: string,
  version?: string,
): WasmTask {
  if (metadata.sharedLibrary !== undefined) {
    throw new WasmTaskError(
      `${task}: the library of ${crate} has the file name of another crate's library: ${metadata.sharedLibrary}. Cargo builds one file for crates whose libraries share a file name, so that the wasm package could hold the other crate's functions. The task does not run, so that Nx stores no result for it. Give the crates different [lib] names in their Cargo.toml.`,
    );
  }
  const flavour = options.jsFlavour;
  if (typeof flavour !== "string" || !(jsFlavours as readonly string[]).includes(flavour)) {
    throw new WasmTaskError(
      `${task}: the option jsFlavour is ${JSON.stringify(flavour)}, but wasm-build writes the JS flavours ${describeList(jsFlavours.map((name) => `"${name}"`))} of the wasm-bindgen CLI. Set jsFlavour to one of them.`,
    );
  }
  const workspace = describeFolder(relative(repositoryRoot, cwd) || ".");
  const neededBy = `the wasm-build target of the crate ${crate} in the Cargo workspace in ${workspace}`;
  const context = { workspaceRoot: repositoryRoot, workspaces: [], env, folder: cwd };
  try {
    requireTool("wasm-target", neededBy, context);
    requireTool("wasm-bindgen", neededBy, context);
  } catch (error) {
    throw error instanceof MissingToolError
      ? new WasmTaskError(`${task}: ${error.message}`)
      : error;
  }
  const cli = findExecutable("wasm-bindgen", searchPath(env, cwd)) as string;
  const run = spawnSync(cli, ["--version"], { cwd, env, encoding: "utf8" });
  const cliVersion = /^wasm-bindgen (\S+)/m.exec(run.stdout ?? "")?.[1];
  if (run.status !== 0 || cliVersion === undefined) {
    throw new WasmTaskError(
      `${task}: the wasm-bindgen CLI at ${cli} did not print its version with --version, so wasm-build cannot tell whether it matches the wasm-bindgen crate in Cargo.lock. The task does not run, so that Nx stores no result for it.${run.stderr ? `\n${run.stderr.trim()}` : ""}`,
    );
  }
  const locked = lockedVersions(join(cwd, "Cargo.lock"), crate, version);
  if (typeof locked === "string") {
    throw new WasmTaskError(
      `${task}: ${locked} The task does not run, so that Nx stores no result for it.`,
    );
  }
  if (locked.length === 0) {
    throw new WasmTaskError(
      `${task}: ${crate} reaches no wasm-bindgen crate in Cargo.lock, so the wasm-bindgen CLI cannot post-process its library. The task does not run, so that Nx stores no result for it. Add wasm-bindgen to the crate's dependencies, or remove "wasm" from the artifacts of its [package.metadata.nx].`,
    );
  }
  if (locked.length > 1) {
    throw new WasmTaskError(
      `${task}: ${crate} reaches the wasm-bindgen crate in the versions ${describeList(locked)} in Cargo.lock, and one wasm-bindgen CLI can post-process only one of them. The task does not run, so that Nx stores no result for it. Make the crates of the workspace use one version of wasm-bindgen.`,
    );
  }
  if (locked[0] !== cliVersion) {
    throw new WasmTaskError(
      `${task}: the wasm-bindgen CLI is ${cliVersion}, but Cargo.lock locks the wasm-bindgen crate of ${crate} at ${locked[0]}, and the CLI post-processes only the version it was released with. The task does not run, so that Nx stores no result for it. Install the matching CLI with \`cargo install --locked wasm-bindgen-cli --version ${locked[0]}\`.`,
    );
  }
  return { crateFolder, cli, version: cliVersion, flavour: flavour as JsFlavour };
}

/**
 * The versions of `wasm-bindgen` that the crate's entry reaches in the
 * lockfile ({@link reachedEntries}), sorted, or why the lockfile cannot
 * tell. The entry is the one without a source of the crate's name and
 * `version`, or the only one of its name where the version is unknown.
 */
function lockedVersions(
  path: string,
  crate: string,
  version: string | undefined,
): string[] | string {
  let lockfile: Lockfile;
  try {
    lockfile = parseLockfile(readFileSync(path, "utf8"));
  } catch (error) {
    return `wasm-build cannot read the version of the wasm-bindgen crate from ${path}: ${error instanceof Error ? error.message : String(error)}.`;
  }
  const own = lockfile.entries.filter(
    (entry) =>
      entry.name === crate &&
      entry.source === undefined &&
      (version === undefined || entry.version === version),
  );
  if (own.length !== 1) {
    return `wasm-build cannot tell the entry of ${crate} in ${path}, which has ${own.length} entries of that name, so it cannot read the version of the wasm-bindgen crate.`;
  }
  try {
    return [
      ...new Set(
        reachedEntries(lockfile, own[0])
          .filter((entry) => entry.name === "wasm-bindgen")
          .map((entry) => entry.version),
      ),
    ].sort();
  } catch (error) {
    if (error instanceof LockfileError) {
      return `wasm-build cannot read the version of the wasm-bindgen crate from ${path}: ${error.message}.`;
    }
    throw error;
  }
}

/**
 * Runs a group of `wasm-build` tasks (`DES-WASM`): the group's compile for
 * the wasm triple, as a group of `build` runs it, with the checks after
 * cargo of `build` ({@link runGroup}); then, for each task whose crate
 * passed, the `wasm-bindgen` CLI on the `.wasm` file that cargo reported for
 * the crate's `cdylib` in this compile, into the crate's package folder,
 * which it empties first. A task fails where cargo reported no such file
 * for its crate, or more than one, and where the CLI fails.
 *
 * @returns One result per member, in order.
 */
// @mara implements DES-WASM
// @mara implements DES-ARTIFACT-STEPS
export async function runWasmGroup(
  members: readonly GroupMember[],
  verbose = false,
  live: LiveOutput = "none",
): Promise<MemberResult[]> {
  // The compile's output, whose JSON messages report the `.wasm` files.
  let compileOutput = "";
  const compiled = await runGroup(members, verbose, live, (_step, output) => {
    compileOutput = output;
  });
  const libraries = reportedCdylibFiles(compileOutput, /\.wasm$/);
  return members.map((member, index) => {
    const result = compiled[index];
    if (!result.success) {
      return result;
    }
    const written = postProcess(member, libraries.get(member.invocation.package?.id ?? "") ?? []);
    return {
      success: written.success,
      output: [...(result.output === "" ? [] : [result.output]), written.output].join("\n"),
    };
  });
}

/**
 * Writes a task's package (`DES-WASM`, "Post-processing"): removes the
 * package folder of an earlier run, then runs the `wasm-bindgen` CLI with
 * the task's JS flavour on the file that cargo reported in this compile,
 * with the environment that cargo had, so that it writes the package
 * folder anew.
 */
// @mara implements DES-WASM
function postProcess(
  member: GroupMember,
  reported: readonly string[],
): { success: boolean; output: string } {
  const { prepared, invocation } = member;
  const wasm = prepared.wasm as WasmTask;
  const task = prepared.task;
  const fail = (message: string) => ({
    success: false,
    output: `${task}: ${message} The task does not run, so that Nx stores no result for it.`,
  });
  if (reported.length !== 1) {
    return fail(
      reported.length === 0
        ? `cargo reported no .wasm file of the cdylib of ${prepared.crate ?? "the crate"} in this compile for ${wasmTriple}, so wasm-build has no file to give the wasm-bindgen CLI. Give the crate's [lib] table crate-type = ["cdylib"].`
        : `cargo reported ${reported.length} .wasm files of the cdylib of ${prepared.crate ?? "the crate"} in this compile, ${reported.map((file) => relative(invocation.cwd, file)).join(" and ")}, so wasm-build cannot tell which one is the package's.`,
    );
  }
  const folder = join(wasm.crateFolder, wasmPackageFolder);
  rmSync(folder, { recursive: true, force: true });
  const run = spawnSync(wasm.cli, ["--target", wasm.flavour, "--out-dir", folder, reported[0]], {
    cwd: invocation.cwd,
    env: cargoEnvironment(invocation, prepared.env),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const said = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  if (run.status !== 0) {
    rmSync(folder, { recursive: true, force: true });
    return fail(
      `the wasm-bindgen CLI ${wasm.version} failed on ${relative(invocation.cwd, reported[0])}${run.error === undefined ? ` with status ${run.status}` : `: ${run.error.message}`}.${said === "" ? "" : `\n${said}`}`,
    );
  }
  let files: string[];
  try {
    files = readdirSync(folder).sort();
  } catch {
    files = [];
  }
  // The CLI names the module after the file it reads (`EVD-WASM-POSTPROCESS`).
  const module = `${basename(reported[0], ".wasm")}_bg.wasm`;
  if (!files.includes(module)) {
    rmSync(folder, { recursive: true, force: true });
    return fail(
      `the wasm-bindgen CLI ${wasm.version} ended without error but wrote no ${module} into ${wasmPackageFolder}/.${said === "" ? "" : `\n${said}`}`,
    );
  }
  return {
    success: true,
    output: [
      ...(said === "" ? [] : [said]),
      `${task}: wrote ${wasmPackageFolder}/ with ${describeList(files)}.`,
    ].join("\n"),
  };
}
