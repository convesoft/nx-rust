import { spawnSync } from "node:child_process";
import { posix, relative, sep } from "node:path";
import { describeList, plainLine } from "./cargo-output";
import { maxFiltersetBytes } from "./command";

// Steps 1 to 3 of `DES-TEST-RUN` in affected mode: what cargo-affected
// reports, what git says changed, how the plugin widens the selection where
// coverage cannot see a change's whole effect (`ADR-AFFECTED-TESTS-WIDENING`),
// and the `-E` arguments that carry the selection to nextest. Everything here
// but the calls of git is a function of its arguments, so that the rules are
// tested without the tools.

/** One test that cargo-affected's report selects. */
export interface SelectedTest {
  /** The test binary's ID, such as `core-x` or `app::it`. */
  binary: string;
  /** The test's name. */
  name: string;
}

/** One changed file that cargo-affected's report names. */
export interface ReportedFile {
  /** The path relative to the workspace root, as cargo-affected names it with git's `diff.relative`. */
  path: string;
  /** Whether stored coverage holds rows of the file (`tracked_by_coverage`). */
  trackedByCoverage: boolean;
}

/** The parts of a report of `cargo affected status --report-json` that the plugin uses. */
export interface AffectedReport {
  /** The commits of the collections that the report rests on, with their relation to `HEAD`. */
  collectShas: { sha: string; relation: string }[];
  /** The changed files the report names. */
  changedFiles: ReportedFile[];
  /** The tests it selects. */
  selected: SelectedTest[];
}

/**
 * Reads the report of `cargo affected status --report-json <file>
 * --report-detail full` (`DES-TEST-RUN`, step 1; `EVD-CARGO-AFFECTED-REPORT`).
 * It is used only where cargo-affected exited with 0, its `schema_version` is
 * 1, `cache.status` is `hit-exact` or `hit-with-divergence` and
 * `selection.selected_tests` is a list; every other case gives the reason why
 * the group runs its full suite: the status, with the `differing_labels` of
 * the closest stored fingerprint for `miss-fingerprint`, or cargo-affected's
 * exit status and the end of its standard error. A report whose parts do not
 * have the shape that schema 1 gives them cannot be used either.
 *
 * @param exit How cargo-affected ended: its status, or why it did not run.
 * @param text The report file's text, `undefined` where there is none.
 * @param stderr cargo-affected's standard error, whose end a reason quotes.
 */
// @mara implements DES-TEST-RUN
export function readAffectedReport(
  exit: { code: number | null; signal?: string | null; failure?: string },
  text: string | undefined,
  stderr: string,
): { report: AffectedReport } | { problem: string } {
  if (exit.failure !== undefined) {
    return { problem: `cargo affected status could not run: ${exit.failure}` };
  }
  if (exit.code !== 0) {
    const tail = stderrTail(stderr);
    return {
      problem: `cargo affected status ${exit.signal ? `was stopped by ${exit.signal}` : `exited with status ${exit.code}`}${tail === "" ? "" : ` (${tail})`}`,
    };
  }
  if (text === undefined) {
    return { problem: "cargo affected status wrote no report" };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      problem: `cargo-affected's report is no JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  const root = record(data);
  if (root?.schema_version !== 1) {
    return {
      problem: `cargo-affected's report has the schema_version ${JSON.stringify(root?.schema_version ?? null)}, and this version of @convesoft/nx-rust reads only 1`,
    };
  }
  const cache = record(root.cache);
  const status = cache?.status;
  if (status !== "hit-exact" && status !== "hit-with-divergence") {
    const labels =
      status === "miss-fingerprint"
        ? (record(list(cache?.stored_fingerprints)?.[0])?.differing_labels as unknown)
        : undefined;
    const differing =
      Array.isArray(labels) &&
      labels.length > 0 &&
      labels.every((label) => typeof label === "string")
        ? `, which differs from the baseline's in ${describeList(labels as string[])}`
        : "";
    return {
      problem: `cargo-affected cannot select with the baseline: its cache status is ${typeof status === "string" ? status : JSON.stringify(status ?? null)}${differing}`,
    };
  }
  const selection = record(root.selection);
  const tests = list(selection?.selected_tests);
  if (tests === undefined) {
    return { problem: "cargo-affected's report holds no list of selected tests" };
  }
  const selected: SelectedTest[] = [];
  for (const entry of tests) {
    const test = record(entry);
    if (typeof test?.binary_id !== "string" || typeof test.test_name !== "string") {
      return {
        problem: "cargo-affected's report names a selected test without binary_id or test_name",
      };
    }
    selected.push({ binary: test.binary_id, name: test.test_name });
  }
  const files = list(selection?.changed_files);
  if (files === undefined) {
    return { problem: "cargo-affected's report holds no list of changed files" };
  }
  const changedFiles: ReportedFile[] = [];
  for (const entry of files) {
    const file = record(entry);
    if (typeof file?.path !== "string" || typeof file.tracked_by_coverage !== "boolean") {
      return {
        problem: "cargo-affected's report names a changed file without path or tracked_by_coverage",
      };
    }
    changedFiles.push({ path: file.path, trackedByCoverage: file.tracked_by_coverage });
  }
  const shas = list(cache?.collect_shas);
  if (shas === undefined) {
    return { problem: "cargo-affected's report names no collections (cache.collect_shas)" };
  }
  const collectShas: { sha: string; relation: string }[] = [];
  for (const entry of shas) {
    const sha = record(entry);
    if (typeof sha?.sha !== "string" || typeof sha.relation !== "string") {
      return { problem: "cargo-affected's report names a collection without sha or relation" };
    }
    collectShas.push({ sha: sha.sha, relation: sha.relation });
  }
  return { report: { collectShas, changedFiles, selected } };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function list(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

// The last lines of a tool's standard error, on one line.
function stderrTail(stderr: string): string {
  return stderr
    .trim()
    .split("\n")
    .slice(-3)
    .map((line) => plainLine(line).trim())
    .join(" ");
}

/**
 * The commits of the report's collections whose rows the selection uses:
 * those whose relation to `HEAD` is `equal` or `reachable`.
 */
export function usableCollections(report: AffectedReport): string[] {
  return report.collectShas
    .filter((entry) => entry.relation === "equal" || entry.relation === "reachable")
    .map((entry) => entry.sha);
}

/**
 * Why the report cannot stand for the task's key, or `undefined`: a
 * collection that the report names and that the commits read before the
 * run do not hold, as after a collection that ran meanwhile
 * (`DES-TEST-MODE`, "Between hashing and the run").
 */
export function collectionsProblem(
  report: AffectedReport,
  commits: readonly string[],
): string | undefined {
  const known = new Set(commits);
  const unknown = report.collectShas.map((entry) => entry.sha).filter((sha) => !known.has(sha));
  return unknown.length === 0
    ? undefined
    : `cargo-affected's report rests on the collection ${describeList(unknown)}, which the baseline did not hold when the task started, so a collection changed it meanwhile`;
}

/**
 * The arguments after `cargo` of step 1 of `DES-TEST-RUN`: `affected status
 * --report-json <file> --report-detail full --` and the cargo arguments of
 * step 3, from its `cargo nextest run` command, without the flags that only a
 * run takes, `--no-fail-fast` and `--no-tests`, since cargo-affected passes
 * them to `cargo nextest list`.
 *
 * @param runArgs The arguments of the group's `cargo nextest run`, without the
 *   plugin's tool configuration.
 */
// @mara implements DES-TEST-RUN
export function affectedStatusArguments(runArgs: readonly string[], reportFile: string): string[] {
  return [
    "affected",
    "status",
    "--report-json",
    reportFile,
    "--report-detail",
    "full",
    "--",
    ...runArgs.slice(2).filter((arg) => arg !== "--no-fail-fast" && !arg.startsWith("--no-tests")),
  ];
}

/**
 * The variables that set git's `diff.relative` for cargo-affected's process
 * alone, added after any `GIT_CONFIG_<n>` that `env` already has
 * (`DES-TEST-RUN`, step 1): without it, cargo-affected selects nothing in a
 * workspace below the top of its git repository (`EVD-CARGO-AFFECTED-REPORT`).
 */
// @mara implements DES-TEST-RUN
export function diffRelativeVariables(env: NodeJS.ProcessEnv): Record<string, string> {
  const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? "", 10);
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  return {
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${n}`]: "diff.relative",
    [`GIT_CONFIG_VALUE_${n}`]: "true",
  };
}

/** What git says changed against the report's collections, by paths relative to the repository root. */
export interface ChangedFiles {
  /** Every changed path, both ends of a rename and deleted files included. */
  files: string[];
  /** The top of the git repository, absolute. */
  top: string;
}

/**
 * The changed files of the whole repository, as git itself names them
 * (`DES-TEST-RUN`, step 1, "Changed files"): for each commit, `git diff --raw
 * --no-renames -z <commit>`, which compares it with the working tree, staged
 * and unstaged changes alike, and once `git ls-files --others
 * --exclude-standard -z` for the untracked files that git does not ignore,
 * all from the top of the repository with `core.quotePath=false`. A changed
 * submodule gives a problem, since git does not name the files that changed
 * inside it. The paths are made relative to `repositoryRoot`, the folder of
 * Nx's workspace, which may lie below the top of the git repository.
 */
// @mara implements DES-TEST-RUN
export function gitChangedFiles(
  workspaceRoot: string,
  repositoryRoot: string,
  commits: readonly string[],
  env: NodeJS.ProcessEnv,
): ChangedFiles | { problem: string } {
  const topRun = git(["rev-parse", "--show-toplevel"], workspaceRoot, env);
  if ("problem" in topRun) {
    return topRun;
  }
  const top = topRun.stdout.replace(/\n$/, "");
  const files = new Set<string>();
  for (const commit of commits) {
    const diff = git(
      [
        "-c",
        "core.quotePath=false",
        "diff",
        "--raw",
        "--no-renames",
        "--no-relative",
        "-z",
        commit,
      ],
      top,
      env,
    );
    if ("problem" in diff) {
      return diff;
    }
    const entries = parseRawDiff(diff.stdout);
    if ("problem" in entries) {
      return entries;
    }
    const submodule = entries.find((entry) => entry.submodule);
    if (submodule !== undefined) {
      return {
        problem: `the submodule ${submodule.path} changed against the collection ${commit}, and git does not name the files that changed inside it`,
      };
    }
    for (const entry of entries) {
      files.add(entry.path);
    }
  }
  const untracked = git(
    ["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard", "-z"],
    top,
    env,
  );
  if ("problem" in untracked) {
    return untracked;
  }
  for (const path of untracked.stdout.split("\0")) {
    if (path !== "") {
      files.add(path);
    }
  }
  return {
    top,
    files: [...files].map((path) => toRepositoryPath(top, repositoryRoot, path)).sort(),
  };
}

/** A path from the top of the git repository as a path relative to Nx's workspace root, with `/`. */
export function toRepositoryPath(top: string, repositoryRoot: string, path: string): string {
  const full = posix.join(top.split(sep).join("/"), path);
  return relative(repositoryRoot, full).split(sep).join("/");
}

/**
 * The entries of `git diff --raw -z` output: each a status line
 * `:<mode> <mode> <object> <object> <status>` and a path, NUL-separated; a
 * mode `160000` marks a submodule.
 */
export function parseRawDiff(
  output: string,
): { path: string; submodule: boolean }[] | { problem: string } {
  const parts = output.split("\0");
  const entries: { path: string; submodule: boolean }[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const head = parts[index];
    if (head === "") {
      continue;
    }
    const match = /^:(\d{6}) (\d{6}) \S+ \S+ ([A-Z])\d*$/.exec(head);
    const path = parts[index + 1];
    if (match === null || path === undefined || path === "") {
      return {
        problem: `git diff --raw printed a line that @convesoft/nx-rust does not read: ${JSON.stringify(head)}`,
      };
    }
    entries.push({ path, submodule: match[1] === "160000" || match[2] === "160000" });
    index += 1;
  }
  return entries;
}

/**
 * Of `paths`, relative to the top of the git repository, those that git
 * ignores (`git check-ignore -z --stdin`), which git cannot say changed
 * (`DES-TEST-RUN`, step 1). Tracked files are never ignored.
 */
// @mara implements DES-TEST-RUN
export function gitIgnored(
  top: string,
  paths: readonly string[],
  env: NodeJS.ProcessEnv,
): string[] | { problem: string } {
  if (paths.length === 0) {
    return [];
  }
  const run = spawnSync("git", ["check-ignore", "-z", "--stdin"], {
    cwd: top,
    env,
    input: `${paths.join("\0")}\0`,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error !== undefined) {
    return { problem: `git could not be started (${run.error.message})` };
  }
  // 1: none of them is ignored.
  if (run.status === 1) {
    return [];
  }
  if (run.status !== 0) {
    return {
      problem: `git check-ignore exited with status ${run.status} (${stderrTail(run.stderr)})`,
    };
  }
  return run.stdout.split("\0").filter((path) => path !== "");
}

function git(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): { stdout: string } | { problem: string } {
  const run = spawnSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error !== undefined) {
    return { problem: `git could not be started (${run.error.message})` };
  }
  if (run.status !== 0) {
    return {
      problem: `\`git ${args.filter((arg) => arg !== "-c" && !arg.startsWith("core.")).join(" ")}\` exited with status ${run.status} (${stderrTail(run.stderr)})`,
    };
  }
  return { stdout: run.stdout };
}

/** A member of the workspace, as step 2 of `DES-TEST-RUN` needs to know it. */
export interface WideningMember {
  /** The package name. */
  name: string;
  /** Its folder, relative to the repository root, with `/`. */
  folder: string;
  /** Whether it is a proc-macro crate. */
  procMacro: boolean;
  /**
   * The paths, relative to the repository root, that are its build script:
   * the file of its `custom-build` target, and the folder that holds it where
   * that is not the member's own folder, such as `build/`.
   */
  buildScript: string[];
  /** Whether it has a binary target, whose program its integration tests can start. */
  hasBinary: boolean;
  /** The members that it depends on, by a Cargo dependency of any kind. */
  dependsOn: string[];
}

/** A crate of the group: its package name and whether it opts out of selection. */
export interface WideningCrate {
  name: string;
  optedOut: boolean;
}

/** What step 2 needs besides the report and the changed files. */
export interface WideningContext {
  /** The workspace's root folder, relative to the repository root, `""` for the root itself. */
  workspaceFolder: string;
  /** Every member of the workspace. */
  members: readonly WideningMember[];
  /** The group's crates. */
  crates: readonly WideningCrate[];
  /**
   * The crates, among the group's and the members with a binary target,
   * whose `test` task has `path` among its inputs (`DES-INPUTS`), dependency
   * sources reached through `^` included; `undefined` where the plugin cannot
   * tell, which runs the full suite.
   */
  owners(path: string): readonly string[] | undefined;
  /**
   * Whether the `test` task of the group's crate `crate` has a file below
   * `folder` among its inputs, other than the manifest there, which every
   * crate's `test` holds.
   */
  holdsFileBelow(crate: string, folder: string): boolean;
  /** Whether a `fileInputs` pattern of any crate of the workspace matches `path`. */
  declared(path: string): boolean;
}

/** What a crate of the group runs in affected mode. */
export type CrateSelection =
  /** Every test, with why. */
  | { kind: "all"; reasons: string[] }
  /** The selected tests, by binary ID, and every integration test where `integration` names why. */
  | { kind: "some"; tests: Map<string, Set<string>>; integration?: string };

/** The selection of a group after step 2, or why it runs its full suite. */
export type GroupSelectionResult =
  | { kind: "full"; reason: string }
  | { kind: "selection"; crates: Map<string, CrateSelection> };

/**
 * Step 2 of `DES-TEST-RUN` (`ADR-AFFECTED-TESTS-WIDENING`): widens the
 * tests that cargo-affected selected where coverage cannot see a changed
 * file's whole effect.
 *
 * - Coverage narrows a changed file only where it is a `.rs` file inside the
 *   workspace folder that the report lists with `tracked_by_coverage: true`,
 *   lies in the folder of a member that is not a proc-macro crate, the
 *   deepest such folder, is neither that member's build script nor in a
 *   folder of its own that holds it, and no `fileInputs` pattern of any crate
 *   matches it.
 * - Every other changed file adds every test of each crate of the group whose
 *   `test` task has it among its inputs; one that is an input of no crate of
 *   the group adds nothing, and one that the plugin cannot place runs the
 *   full suite.
 * - Where a changed file is among the inputs of the `test` task of a member
 *   with a binary target, narrowing or not, that member runs every test of
 *   its integration test targets, and each crate of the group that depends
 *   on it, by a Cargo dependency of any kind or a declared input that reaches
 *   its folder (which an Nx dependency gives through `^`), runs all its tests.
 * - A crate that opts out runs all its tests; the selected tests of the
 *   report count only for the group's other crates, by the package that the
 *   binary ID names before its first `::`.
 *
 * @param changed The changed files, relative to the repository root.
 */
// @mara implements DES-TEST-RUN
// @mara implements REQ-SELECTION-SAFETY
export function widenSelection(
  report: AffectedReport,
  changed: readonly string[],
  context: WideningContext,
): GroupSelectionResult {
  const crates = new Map<string, CrateSelection>();
  const groupNames = new Set(context.crates.map((crate) => crate.name));
  const whole = (name: string, reason: string) => {
    const current = crates.get(name);
    if (current?.kind === "all") {
      if (!current.reasons.includes(reason)) {
        current.reasons.push(reason);
      }
    } else {
      crates.set(name, { kind: "all", reasons: [reason] });
    }
  };
  const integration = (name: string, reason: string) => {
    const current = crates.get(name) ?? { kind: "some", tests: new Map<string, Set<string>>() };
    if (current.kind === "some" && current.integration === undefined) {
      current.integration = reason;
    }
    crates.set(name, current);
  };
  for (const crate of context.crates) {
    if (crate.optedOut) {
      whole(crate.name, "its option affectedTests is false");
    }
  }
  const reported = new Map(report.changedFiles.map((file) => [file.path, file]));
  const members = [...context.members].sort((a, b) => b.folder.length - a.folder.length);
  const binaries = context.members.filter((member) => member.hasBinary);
  for (const path of changed) {
    const owners = context.owners(path);
    if (owners === undefined) {
      return {
        kind: "full",
        reason: `@convesoft/nx-rust cannot tell which crates' test inputs hold the changed file ${path}`,
      };
    }
    const why = narrowsWhy(path, reported, members, context);
    if (why !== undefined) {
      for (const owner of owners) {
        if (groupNames.has(owner)) {
          whole(owner, `${path} changed, ${why}`);
        }
      }
    }
    // Programs that tests start (`ADR-AFFECTED-TESTS-WIDENING`).
    for (const binary of binaries.filter((member) => owners.includes(member.name))) {
      if (groupNames.has(binary.name)) {
        integration(
          binary.name,
          `${path} changed, which is an input of ${binary.name}, whose integration tests can start its binary`,
        );
      }
      for (const crate of context.crates) {
        if (crate.name === binary.name) {
          continue;
        }
        const member = context.members.find((entry) => entry.name === crate.name);
        if (
          member?.dependsOn.includes(binary.name) === true ||
          context.holdsFileBelow(crate.name, binary.folder)
        ) {
          whole(
            crate.name,
            `${path} changed, which is an input of ${binary.name}, whose binary its tests can start`,
          );
        }
      }
    }
  }
  for (const test of report.selected) {
    const name = packageOf(test.binary);
    if (!groupNames.has(name)) {
      continue;
    }
    const current = crates.get(name) ?? { kind: "some", tests: new Map<string, Set<string>>() };
    if (current.kind === "some") {
      const tests = current.tests.get(test.binary) ?? new Set<string>();
      tests.add(test.name);
      current.tests.set(test.binary, tests);
    }
    crates.set(name, current);
  }
  return { kind: "selection", crates };
}

/** The package of a binary ID: the part before its first `::` (`EVD-CARGO-AFFECTED-REPORT`). */
export function packageOf(binary: string): string {
  const at = binary.indexOf("::");
  return at === -1 ? binary : binary.slice(0, at);
}

// Why a changed file widens, or `undefined` where coverage narrows it.
function narrowsWhy(
  path: string,
  reported: ReadonlyMap<string, ReportedFile>,
  members: readonly WideningMember[],
  context: WideningContext,
): string | undefined {
  const inWorkspace =
    context.workspaceFolder === "" || path.startsWith(`${context.workspaceFolder}/`);
  if (!inWorkspace) {
    return "which lies outside the workspace folder";
  }
  if (!path.endsWith(".rs")) {
    return "which is no Rust source, and coverage cannot show what reads it";
  }
  const member = members.find((entry) => path.startsWith(`${entry.folder}/`));
  if (member === undefined) {
    return "which lies in the folder of no member";
  }
  if (member.procMacro) {
    return `which is source of the proc-macro crate ${member.name}, whose effect on other crates coverage does not record`;
  }
  if (member.buildScript.some((script) => path === script || path.startsWith(`${script}/`))) {
    return `which is the build script of ${member.name}`;
  }
  if (context.declared(path)) {
    return "which a fileInputs pattern declares";
  }
  const relativePath =
    context.workspaceFolder === "" ? path : path.slice(context.workspaceFolder.length + 1);
  if (reported.get(relativePath)?.trackedByCoverage !== true) {
    return "for which the baseline holds no coverage";
  }
  return undefined;
}

/** The longest `-E` arguments together, in bytes, before the selection names whole binaries. */
export const maxSelectionBytes = 512 * 1024;

/**
 * A name or binary ID as the equality matcher of a nextest filterset takes
 * it: `\`, `/`, `)` and `,` escaped with `\` (`EVD-CARGO-AFFECTED-REPORT`).
 */
export function filtersetEscape(value: string): string {
  return value.replace(/[\\/),]/g, (character) => `\\${character}`);
}

/**
 * The `-E` arguments that carry a group's selection to nextest (`DES-TEST-RUN`,
 * step 3), each `(<filterset of its crates>) & (<parts>)`, which nextest
 * unites and intersects with the repository's default filter: a part is
 * `binary_id(=<id>) & (test(=<name>) | …)` for the selected tests of one
 * binary, `package(=<name>)` for a crate that runs all its tests, and
 * `package(=<name>) & kind(test)` for the integration tests of a crate with a
 * binary. No argument exceeds 64 KiB; where they would exceed 512 KiB
 * together, each binary's part names the binary only, which runs more tests
 * and never fewer. An empty list means that no test is selected.
 */
// @mara implements DES-TEST-RUN
export function selectionFiltersets(crates: ReadonlyMap<string, CrateSelection>): string[] {
  const detailed = filtersetArguments(selectionParts(crates, false));
  const total = detailed.reduce((sum, arg) => sum + Buffer.byteLength(arg), 0);
  const args =
    total > maxSelectionBytes ? filtersetArguments(selectionParts(crates, true)) : detailed;
  return args.flatMap((arg) => ["-E", arg]);
}

// The parts of the selection, each with its package; a binary's tests are
// split so that no part alone fills an argument.
function selectionParts(
  crates: ReadonlyMap<string, CrateSelection>,
  wholeBinaries: boolean,
): { pkg: string; part: string }[] {
  const parts: { pkg: string; part: string }[] = [];
  const budget = maxFiltersetBytes / 2;
  for (const [name, selection] of [...crates].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const pkg = `package(=${filtersetEscape(name)})`;
    if (selection.kind === "all") {
      parts.push({ pkg, part: pkg });
      continue;
    }
    if (selection.integration !== undefined) {
      parts.push({ pkg, part: `${pkg} & kind(test)` });
    }
    for (const [binary, tests] of [...selection.tests].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      const id = `binary_id(=${filtersetEscape(binary)})`;
      if (wholeBinaries) {
        parts.push({ pkg, part: id });
        continue;
      }
      let current: string[] = [];
      let size = 0;
      for (const test of [...tests].sort()) {
        const term = `test(=${filtersetEscape(test)})`;
        if (current.length > 0 && size + term.length + 3 > budget) {
          parts.push({ pkg, part: `${id} & (${current.join(" | ")})` });
          current = [];
          size = 0;
        }
        current.push(term);
        size += term.length + 3;
      }
      if (current.length > 0) {
        parts.push({ pkg, part: `${id} & (${current.join(" | ")})` });
      }
    }
  }
  return parts;
}

// Joins parts into arguments of at most 64 KiB, each intersected with the
// filterset of the packages of its parts.
function filtersetArguments(parts: readonly { pkg: string; part: string }[]): string[] {
  const args: string[] = [];
  let packages: string[] = [];
  let terms: string[] = [];
  // The length of `(<packages>) & ((<term>) | …)` in bytes.
  let packageBytes = 0;
  let termBytes = 0;
  const flush = () => {
    if (terms.length > 0) {
      args.push(`(${packages.join(" | ")}) & (${terms.map((term) => `(${term})`).join(" | ")})`);
    }
    packages = [];
    terms = [];
    packageBytes = 0;
    termBytes = 0;
  };
  for (const { pkg, part } of parts) {
    const addsPackage = !packages.includes(pkg);
    const nextPackageBytes = packageBytes + (addsPackage ? Buffer.byteLength(pkg) + 3 : 0);
    const nextTermBytes = termBytes + Buffer.byteLength(part) + 5;
    if (terms.length > 0 && nextPackageBytes + nextTermBytes + 8 > maxFiltersetBytes) {
      flush();
      packages = [pkg];
      terms = [part];
      packageBytes = Buffer.byteLength(pkg) + 3;
      termBytes = Buffer.byteLength(part) + 5;
      continue;
    }
    if (addsPackage) {
      packages.push(pkg);
    }
    terms.push(part);
    packageBytes = nextPackageBytes;
    termBytes = nextTermBytes;
  }
  flush();
  return args;
}
