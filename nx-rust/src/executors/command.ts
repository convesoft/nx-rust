import type { TestRunner } from "../graph/settings";
import { compilingTargets, type InferredTargetName, inferredTargetNames } from "../graph/targets";
import { wasmTriple } from "../graph/wasm";

/**
 * The options of the plugin's targets that its executors declare
 * (`DES-PLUGIN-OPTIONS`). Each takes effect only on the targets that the
 * option reference gives it ({@link optionTargets}); a task of any other
 * target ignores it with a warning line (`DES-UNKNOWN-OPTIONS`).
 */
export interface CargoTargetOptions {
  /** `--features`, joined with commas. */
  features?: string[];
  /** `--all-features`. */
  allFeatures?: boolean;
  /** `--no-default-features`. */
  noDefaultFeatures?: boolean;
  /** `--profile`. */
  profile?: string;
  /** `--target`; not on `test`, which runs on the host triple only in v1. */
  targetTriple?: string;
  /** `--all-targets` on `check` and `lint`. */
  allTargets?: boolean;
  /** `--no-deps` on `doc`. */
  noDeps?: boolean;
  /** `--bin` on `run`. */
  bin?: string;
  /** The binary's arguments on `run`, split into words (`splitWords` in `run-arguments.ts`). */
  args?: string;
  /**
   * `--test` on `test`, for `cargo test` and `cargo nextest run` alike: the
   * test target that the task runs alone (`DES-TEST-RUN`, "One test target").
   */
  test?: string;
  /** Selection of affected tests on `test`; no flag (nxr-tabkjx). */
  affectedTests?: boolean;
  /** The wasm target of `wasm-build`, the `--target` of the `wasm-bindgen` CLI; no flag of cargo. */
  wasmTarget?: string;
  /**
   * On the coverage baseline target: always collect everything, never
   * `collect --diff` (`DES-BASELINE`, the switch for nightly and full runs); no flag.
   */
  fullCollect?: boolean;
  /**
   * On the coverage baseline target: never start a full collection on its
   * own, and collect nothing where `collect --diff` cannot run
   * (`DES-BASELINE`, the switch for batched recollection); no flag.
   */
  diffOnly?: boolean;
  /**
   * On the coverage baseline target: how many commits the oldest collection
   * may lie behind `HEAD` before a full collection replaces `--diff`
   * (`DES-BASELINE`, `RISK-BASELINE-DRIFT`); no flag.
   */
  fullCollectThreshold?: number;
  /**
   * On the coverage baseline target: build the instrumented tests in a build
   * directory of their own, `target/affected/build` (`DES-BASELINE`,
   * `DES-BUILD-DIRS`); sets `CARGO_BUILD_BUILD_DIR` for the collection.
   */
  separateBuildDir?: boolean;
  /** The plugin's version, which the plugin sets for the cache key; no flag. */
  pluginVersion?: string;
}

/** The name of an option of the plugin's targets. */
export type TargetOptionName = keyof CargoTargetOptions;

// The targets that take the feature and profile options, and those that
// also take `targetTriple`: not `test` and the coverage baseline, which runs
// the tests, and not `napi-build`, which build for the host only in v1
// (`ADR-V1-SCOPE`), nor `wasm-build`, which always builds for the wasm
// triple (`DES-WASM`).
const tripleTargets = compilingTargets.filter(
  (target) =>
    target !== "test" &&
    target !== "coverage-baseline" &&
    target !== "napi-build" &&
    target !== "wasm-build",
);

/**
 * The targets that take each option, by their default names, as the option
 * reference of `DES-PLUGIN-OPTIONS` gives them. A task of another target
 * ignores the option, also where its executor's schema declares it, because
 * one schema serves every target of the cargo executor, and a target table
 * in Cargo metadata that sets it fails graph creation
 * (`DES-UNKNOWN-OPTIONS`).
 */
// @mara implements DES-PLUGIN-OPTIONS
export const optionTargets: Readonly<Record<TargetOptionName, ReadonlySet<InferredTargetName>>> = {
  features: new Set(compilingTargets),
  allFeatures: new Set(compilingTargets),
  noDefaultFeatures: new Set(compilingTargets),
  profile: new Set(compilingTargets),
  targetTriple: new Set(tripleTargets),
  allTargets: new Set(["check", "lint"]),
  noDeps: new Set(["doc"]),
  bin: new Set(["run"]),
  args: new Set(["run"]),
  test: new Set(["test"]),
  affectedTests: new Set(["test"]),
  wasmTarget: new Set(["wasm-build"]),
  fullCollect: new Set(["coverage-baseline"]),
  diffOnly: new Set(["coverage-baseline"]),
  fullCollectThreshold: new Set(["coverage-baseline"]),
  separateBuildDir: new Set(["coverage-baseline"]),
  pluginVersion: new Set(inferredTargetNames),
};

/**
 * The option that the plugin sets itself, to carry its version into the
 * cache key where Nx has no node for its package (`DES-PLUGIN-OPTIONS`). A
 * target table in Cargo metadata may not set it.
 */
export const pluginVersionOption = "pluginVersion" satisfies TargetOptionName;

/**
 * The test target that a task of `test` runs alone, from its `test` option
 * (`DES-TEST-RUN`, "One test target"); `undefined` for every other target
 * and where the option is not set. Such a task forms a group of one crate
 * under every strategy ("Groups of one crate" in `DES-BATCH`), never selects
 * affected tests (`DES-TEST-MODE`), and with nextest runs no doctest step.
 */
// @mara implements DES-TEST-RUN
// @mara implements DES-BATCH
export function selectedTestTarget(
  target: InferredTargetName,
  options: CargoTargetOptions,
): string | undefined {
  return target === "test" ? options.test : undefined;
}

/** Whether the target with this default name takes the option `name`. */
export function targetTakes(target: InferredTargetName, name: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(optionTargets, name) &&
    optionTargets[name as TargetOptionName].has(target)
  );
}

/** How the commands of a crate's targets name the crate to cargo (`DES-INVOCATION`). */
export interface CrateSelection {
  /** The crate's real package name, which `cargo fmt -p` takes. */
  name: string;
  /**
   * The crate's package ID specification, which every other command takes
   * with `-p`; absent where the target's command takes the name
   * ({@link selectsBySpecification}).
   */
  spec?: string;
}

/** What a task's cargo command depends on besides the target's options. */
export interface CommandSubject {
  /** The default name of the task's target, which decides the command. */
  target: InferredTargetName;
  /**
   * The crates that the command selects, all of one workspace, in this
   * order: the task's own crate, or for a group of several tasks one crate
   * per task (`TERM-GROUP`). Absent for a workspace project without a crate.
   */
  crates?: readonly CrateSelection[];
  /** Whether the command runs in locked mode (`DES-INVOCATION`). */
  locked: boolean;
  /** The binary's arguments, which `run` passes after `--`; none for other targets. */
  binaryArguments?: readonly string[];
  /**
   * Whether the workspace uses the `cargo` strategy, under which every
   * command that compiles passes `--config
   * 'resolver.feature-unification="workspace"'` and `-Zfeature-unification`
   * (`DES-UNIFICATION`, "How each strategy selects").
   */
  workspaceUnification?: boolean;
  /**
   * Whether the command selects the whole workspace with `--workspace` in
   * place of its crates, as a group under `workspace-build` does on the
   * host, however many tasks it holds (`DES-UNIFICATION`, "How each
   * strategy selects"). Only the commands that compile take it:
   * {@link selectsWorkspace}.
   */
  workspace?: boolean;
  /**
   * The workspace's test runner (`REQ-TEST-RUNNER`), which decides the
   * command of `test`: `cargo test`, or `cargo nextest run` and `cargo test
   * --doc` with `nextest` ({@link cargoSteps}). Absent means `cargo`.
   */
  testRunner?: TestRunner;
}

// The per-crate targets whose commands compile the crate, and which select
// the whole workspace under `workspace-build`; `fmt` and `fmt-check` resolve
// no features and keep selecting their crates (`DES-TARGET-COMMANDS`).
const compilingCrateTargets: ReadonlySet<InferredTargetName> = new Set([
  "build",
  "check",
  "lint",
  "test",
  "napi-build",
  "wasm-build",
]);

/**
 * Whether a group of tasks of the target with this default name selects the
 * whole workspace with `--workspace` under `workspace-build` on the host:
 * `build`, `check`, `lint` and `test`, whose commands compile their crates
 * with features that the selection would otherwise narrow
 * (`DES-UNIFICATION`). `bench` never joins a batch (`DES-TARGETS`), and
 * `cargo fmt` resolves no features.
 */
export function selectsWorkspace(target: InferredTargetName): boolean {
  return compilingCrateTargets.has(target);
}

// The cargo subcommand of each per-crate target and its own flags, before the
// package selection (`DES-TARGET-COMMANDS`).
const crateCommands: Partial<Record<InferredTargetName, readonly string[]>> = {
  build: ["build"],
  // The compile steps of `napi-build` and `wasm-build`, plain `cargo build`
  // commands (`DES-NAPI`, `DES-WASM`).
  "napi-build": ["build"],
  // `--lib`: a binary of the crate built for the wasm triple writes
  // `<name>.wasm` too, over the library's (`EVD-WASM-POSTPROCESS`).
  "wasm-build": ["build", "--lib"],
  check: ["check"],
  lint: ["clippy"],
  test: ["test"],
  "fmt-check": ["fmt", "--check"],
  fmt: ["fmt"],
  bench: ["bench"],
  run: ["run"],
};

/**
 * The arguments after `cargo` of the command that a task of an inferred
 * target runs in its workspace's root folder.
 *
 * A crate's targets select it with `-p` as {@link crateSelection} says, and
 * the workspace project's targets address the whole workspace. Apart from that,
 * a flag comes only from an option that the target takes
 * ({@link optionTargets}), so that the command is the one that a developer
 * types in the workspace root (`DES-INVOCATION`); `run` passes the binary's
 * arguments after `--`, and the lockfile task runs `cargo update
 * --workspace` (`DES-LOCKFILE-HASHING`). In locked mode every command passes `--locked`,
 * apart from `update`, whose purpose is to change `Cargo.lock`, `fmt` and
 * `fmt-check`, because `cargo fmt` rejects the flag, and `audit`, because
 * cargo-audit only reads the lockfile and has no such flag; cargo-deny takes
 * it before its `check`.
 *
 * @throws {Error} When a crate's target has no crate, or no specification
 *   where its command takes one.
 */
// @mara implements DES-INVOCATION
// @mara implements DES-TARGET-COMMANDS
// @mara implements DES-WORKSPACE-TARGETS
// @mara implements REQ-TEST-RUNNER
export function cargoArguments(subject: CommandSubject, options: CargoTargetOptions): string[] {
  const { target, crates, locked } = subject;
  const taken: CargoTargetOptions = Object.fromEntries(
    Object.entries(options).filter(([name]) => targetTakes(target, name)),
  );
  if (target === "test" && subject.testRunner === "nextest") {
    return nextestArguments(subject, taken);
  }
  const crateCommand = crateCommands[target];
  if (crateCommand !== undefined) {
    if (crates === undefined || crates.length === 0) {
      throw new Error(`The target "${target}" runs for a crate, and the project has none.`);
    }
    const formatting = target === "fmt" || target === "fmt-check";
    const binaryArguments = target === "run" ? (subject.binaryArguments ?? []) : [];
    const workspace = subject.workspace === true && selectsWorkspace(target);
    return [
      ...crateCommand,
      ...flag(taken.allTargets, "--all-targets"),
      // The compiles of the artifact targets always print cargo's JSON
      // messages, from which the plugin takes the library that it
      // post-processes (`DES-NAPI`, `DES-WASM`).
      ...(crates.length > 1 || workspace || reportsLibrary(target)
        ? sharedCommandFlags(target)
        : []),
      ...(workspace ? ["--workspace"] : crateSelection(target, crates)),
      ...(taken.test !== undefined ? ["--test", taken.test] : []),
      ...compilingFlags(taken),
      ...(target === "wasm-build" ? ["--target", wasmTriple] : []),
      ...(formatting ? [] : unificationFlags(subject)),
      ...(taken.bin !== undefined ? ["--bin", taken.bin] : []),
      ...flag(locked && !formatting, "--locked"),
      ...(binaryArguments.length > 0 ? ["--", ...binaryArguments] : []),
    ];
  }
  switch (target) {
    case "doc":
      return [
        "doc",
        ...flag(taken.noDeps, "--no-deps"),
        "--workspace",
        ...compilingFlags(taken),
        ...unificationFlags(subject),
        ...flag(locked, "--locked"),
      ];
    case "hakari-check":
      return [...hakariCheckSteps[0]];
    case "audit":
      return ["audit"];
    case "deny":
      return ["deny", ...flag(locked, "--locked"), "check"];
    case "update":
      return ["update"];
    case "lockfile":
      return ["update", "--workspace", ...flag(locked, "--locked")];
  }
  throw new Error(`nx-rust has no command for the target "${target}".`);
}

/**
 * The commands of `hakari-check`, after `cargo`, in the order in which it
 * runs them (`DES-UNIFICATION`, "Drift"): neither writes a file, and
 * cargo-hakari takes no `--locked`.
 */
export const hakariCheckSteps: readonly (readonly string[])[] = [
  ["hakari", "generate", "--diff"],
  ["hakari", "manage-deps", "--dry-run"],
];

/**
 * The flags with which every command that compiles resolves features for
 * the whole workspace under the `cargo` strategy (`DES-UNIFICATION`, "How
 * each strategy selects"): the setting on the command line, which stable
 * cargo ignores with a warning, and the unstable flag, which stable cargo
 * rejects, so that a task on a stable toolchain fails with cargo's error
 * instead of compiling with narrowed features.
 */
// @mara implements DES-UNIFICATION
export const workspaceUnificationFlags: readonly string[] = [
  "--config",
  'resolver.feature-unification="workspace"',
  "-Zfeature-unification",
];

// The flags of the `cargo` strategy, where the subject uses it.
function unificationFlags(subject: CommandSubject): string[] {
  return subject.workspaceUnification === true ? [...workspaceUnificationFlags] : [];
}

/**
 * The flags that a command for several crates, or for the whole workspace,
 * adds, so that cargo goes on after a crate fails and its output shows each
 * crate's result (`DES-BATCH`): `--keep-going` and JSON messages for
 * `build`, `check` and `lint`, and `--no-fail-fast` for `test`. A command
 * of a group of one crate adds none, so that it is the command that a plain
 * `cargo` of that one crate runs, apart from the compiles of `napi-build`
 * and `wasm-build`, which have no plain cargo counterpart and always add
 * them, so that cargo reports the library that they post-process
 * (`DES-NAPI`, `DES-WASM`).
 */
// @mara implements DES-BATCH
export function sharedCommandFlags(target: InferredTargetName): string[] {
  switch (target) {
    case "build":
    case "napi-build":
    case "wasm-build":
    case "check":
    case "lint":
      return ["--keep-going", "--message-format=json"];
    case "test":
      return ["--no-fail-fast"];
    default:
      return [];
  }
}

/**
 * Whether the compile of the target with this default name always prints
 * cargo's JSON messages, also for one crate: the artifact targets, which
 * take the library that cargo reports in them (`DES-NAPI`, `DES-WASM`).
 */
export function reportsLibrary(target: InferredTargetName): boolean {
  return target === "napi-build" || target === "wasm-build";
}

/**
 * Whether the command of the target with this default name selects crates
 * by their package ID specifications: every per-crate command but `cargo
 * fmt`, which takes package names only (`DES-INVOCATION`).
 */
export function selectsBySpecification(target: InferredTargetName): boolean {
  return crateCommands[target] !== undefined && target !== "fmt" && target !== "fmt-check";
}

/**
 * The arguments with which the command of the target with this default name
 * selects `crates`, all of one workspace: `-p` and each crate's package ID
 * specification, in the given order, or for `cargo fmt` `-p` and each
 * crate's package name (`DES-INVOCATION`). A bare name is not enough for the
 * other commands: cargo matches it against every package that the selection
 * reaches, where a dependency can have a member's name, also with its
 * version, and the plugin, which reads the workspace without dependencies,
 * cannot tell where that happens (`EVD-CARGO-PACKAGE-SPECS`).
 *
 * @throws {Error} When the target's command takes specifications and a
 *   crate has none.
 */
// @mara implements DES-INVOCATION
export function crateSelection(
  target: InferredTargetName,
  crates: readonly CrateSelection[],
): string[] {
  const bySpecification = selectsBySpecification(target);
  return crates.flatMap(({ name, spec }) => {
    if (!bySpecification) {
      return ["-p", name];
    }
    if (spec === undefined) {
      throw new Error(
        `The target "${target}" selects the crate ${name} by its specification, and it has none.`,
      );
    }
    return ["-p", spec];
  });
}

/**
 * The arguments of `cargo nextest run` for the tests of a group's crates
 * (`DES-TEST-RUN`, step 3), before the plugin's tool configuration file,
 * which the group adds when it runs the step ({@link withToolConfiguration}):
 *
 * - where the command selects the whole workspace, `--workspace` and the
 *   filterset of the group's packages ({@link nextestFiltersets});
 *   otherwise each crate with `-p` and its package ID specification, as
 *   `cargo test` takes them;
 * - for several crates or the whole workspace, `--no-fail-fast`, so that a
 *   failing test does not keep the tests of another crate from running;
 *   a command of one crate is the one that a developer types;
 * - `--no-tests=pass`, because a crate without tests, or whose tests the
 *   repository's default filter leaves out, passes as it does under `cargo
 *   test`, where nextest would fail with exit code 4;
 * - `--test` for the `test` option, which nextest passes on to the `cargo
 *   test --no-run` that it builds with (`EVD-CARGO-TEST-TARGET-SELECTOR`);
 * - the feature flags, `--cargo-profile` for the `profile` option, because
 *   nextest's own `--profile` names a profile of its configuration
 *   (`EVD-NEXTEST-CARGO-FLAGS`), the flags of the `cargo` strategy
 *   ({@link workspaceUnificationFlags}), which nextest passes on to cargo,
 *   and `--locked`.
 *
 * No `--profile` and no `--ignore-default-filter`: the repository's nextest
 * configuration applies as for a plain `cargo nextest run` ("nextest's
 * configuration" in `DES-TEST-RUN`).
 */
// @mara implements DES-TEST-RUN
// @mara implements DES-PLUGIN-OPTIONS
function nextestArguments(subject: CommandSubject, taken: CargoTargetOptions): string[] {
  const crates = subject.crates ?? [];
  if (crates.length === 0) {
    throw new Error('The target "test" runs for a crate, and the project has none.');
  }
  const workspace = subject.workspace === true;
  return [
    "nextest",
    "run",
    ...(workspace ? ["--workspace"] : []),
    ...(crates.length > 1 || workspace ? ["--no-fail-fast"] : []),
    "--no-tests=pass",
    ...(workspace
      ? nextestFiltersets(crates.map((crate) => crate.name))
      : crateSelection("test", crates)),
    ...(taken.test !== undefined ? ["--test", taken.test] : []),
    ...compilingFlags(taken, "--cargo-profile"),
    ...unificationFlags(subject),
    ...flag(subject.locked, "--locked"),
  ];
}

/** The longest filterset argument that the plugin passes to nextest, in bytes. */
export const maxFiltersetBytes = 64 * 1024;

/**
 * The `-E` arguments that select a group's packages for nextest
 * (`DES-TEST-RUN`, "Under `workspace-build`"): `package(=a) | package(=b)`,
 * where `=` matches each name exactly, split into several arguments, which
 * nextest unites, so that none exceeds {@link maxFiltersetBytes}: Linux
 * refuses one argument of more than 128 KiB (`EVD-CARGO-AFFECTED-REPORT`).
 * A package name holds no character that a filterset escapes.
 *
 * In affected mode (nxr-tabkjx), each argument is intersected with a part of
 * the selection, `(<group's filterset>) & (<part>)`; that is the one place
 * where the selection joins the command.
 */
// @mara implements DES-TEST-RUN
export function nextestFiltersets(packages: readonly string[]): string[] {
  const parts: string[] = [];
  let current = "";
  for (const name of packages) {
    const term = `package(=${name})`;
    const joined = current === "" ? term : `${current} | ${term}`;
    if (current !== "" && Buffer.byteLength(joined) > maxFiltersetBytes) {
      parts.push(current);
      current = term;
    } else {
      current = joined;
    }
  }
  if (current !== "") {
    parts.push(current);
  }
  return parts.flatMap((part) => ["-E", part]);
}

/** The name under which nextest takes the plugin's tool configuration file. */
export const nextestToolName = "nx-rust";

/**
 * The arguments of a nextest step with the plugin's tool configuration file
 * (`DES-TEST-RUN`, "nextest's configuration"): `--tool-config-file
 * nx-rust:<file>` after `nextest run`. The file is written for each run, so
 * the step's arguments name it only once it exists.
 *
 * @param file The absolute path of the file.
 */
export function withToolConfiguration(args: readonly string[], file: string): string[] {
  return [
    ...args.slice(0, 2),
    "--tool-config-file",
    `${nextestToolName}:${file}`,
    ...args.slice(2),
  ];
}

/**
 * The feature, profile and triple flags, from the options that the target
 * takes; the profile goes with `profileFlag`, which nextest calls
 * `--cargo-profile`.
 */
export function compilingFlags(taken: CargoTargetOptions, profileFlag = "--profile"): string[] {
  const features = taken.features ?? [];
  return [
    ...(features.length > 0 ? ["--features", features.join(",")] : []),
    ...flag(taken.allFeatures, "--all-features"),
    ...flag(taken.noDefaultFeatures, "--no-default-features"),
    ...(taken.profile !== undefined ? [profileFlag, taken.profile] : []),
    ...(taken.targetTriple !== undefined ? ["--target", taken.targetTriple] : []),
  ];
}

function flag(on: boolean | undefined, name: string): string[] {
  return on === true ? [name] : [];
}

/**
 * What a step of a group reads from cargo's output (`DES-BATCH`): one
 * command of the target (`command`), or one of the three steps of `test`
 * with the `cargo` runner under `workspace-build` (`DES-TEST-RUN`, "Under
 * `workspace-build`"): the build of every test executable (`tests-build`),
 * the test binaries through the selecting runner (`test-binaries`) and the
 * doctests (`doctests`); or, with the nextest runner, `cargo nextest run`
 * for several crates or the whole workspace (`nextest`), whose results come
 * from its JUnit report, and the doctests.
 */
export type StepKind = "command" | "tests-build" | "test-binaries" | "doctests" | "nextest";

/** One cargo command of a group, in the order in which the group runs them. */
export interface CargoStep {
  /** What the step is, which decides how its output is read. */
  kind: StepKind;
  /** The arguments after `cargo`. */
  args: string[];
  /**
   * On a `nextest` step: the arguments of `cargo nextest list
   * --message-format json` with the step's selection and flags
   * ({@link nextestListArguments}), which the group runs where nextest
   * exits with 100 to learn which tests the run was to run.
   */
  listArgs?: string[];
}

/**
 * The arguments of `cargo nextest list --message-format json` for the tests
 * that a `cargo nextest run` with `runArgs` is to run (`DES-TEST-RUN`, step
 * 4): the same selection, filtersets, feature and profile flags and
 * `--locked`, without the flags that only a run takes, `--no-fail-fast` and
 * `--no-tests`. nextest gives each test of the list a `filter-match` after
 * the same filters, the repository's default filter among them, and with the
 * same environment the same profile applies (`EVD-NEXTEST-RUNNER-STEPS`).
 */
// @mara implements DES-TEST-RUN
export function nextestListArguments(runArgs: readonly string[]): string[] {
  return [
    "nextest",
    "list",
    "--message-format",
    "json",
    ...runArgs.slice(2).filter((arg) => arg !== "--no-fail-fast" && !arg.startsWith("--no-tests")),
  ];
}

/** The selecting runner of the test binaries' step (`DES-TEST-RUN`, "The runner program"). */
export interface SelectingRunner {
  /** The host's triple, as `rustc -vV` names it in the workspace root with the group's environment. */
  host: string;
  /** The runner's program and its arguments, by absolute paths: Node and the script. */
  command: readonly string[];
}

/**
 * The steps of a group's cargo commands (`DES-BATCH`): one command, as
 * {@link cargoArguments} builds it, for every target but `hakari-check`,
 * which runs the two commands of {@link hakariCheckSteps}, `test` with the
 * nextest runner, and `test` with the `cargo` runner on a group that selects
 * the whole workspace.
 *
 * With the `cargo` runner, such a group has three steps (`DES-TEST-RUN`,
 * "Under `workspace-build`"):
 *
 * 1. `cargo test --workspace --no-run`, which compiles every test executable,
 *    the binaries that integration tests use and every example;
 * 2. `cargo test --workspace --tests --no-fail-fast
 *    --message-format=json-render-diagnostics` with the selecting runner
 *    through `--config 'target.<host>.runner=[…]'`, in TOML strings;
 * 3. `cargo test --workspace --doc --no-fail-fast`, without the runner.
 *
 * With the nextest runner, every group has two (`DES-TEST-RUN`, steps 3 and
 * 5): `cargo nextest run` ({@link cargoArguments}), which builds every test
 * binary before it runs one, and `cargo test --doc` for the doctests, which
 * nextest does not run (`REQ-DOCTESTS`), selecting the crates as the first
 * step does: `--workspace`, or each crate with `-p`. The first step is a
 * `nextest` step where it selects several crates or the whole workspace,
 * whose results the group reads from nextest's JUnit report, and otherwise
 * the plain command of one crate. Both pass `--no-fail-fast` where they
 * select more than one crate.
 *
 * Each step passes the same feature and profile flags and `--locked` as
 * the others, so that every step resolves the same features
 * (`REQ-STABLE-FEATURES`) and reuses what the steps before it compiled; the
 * profile is `--cargo-profile` for nextest and `--profile` for cargo
 * (`EVD-NEXTEST-CARGO-FLAGS`).
 *
 * @param runner The selecting runner, which a `test` group of the `cargo`
 *   runner that selects the whole workspace needs.
 * @throws {Error} As {@link cargoArguments} does, and for such a group
 *   without a runner.
 */
// @mara implements DES-TEST-RUN
// @mara implements DES-UNIFICATION
// @mara implements REQ-DOCTESTS
// @mara implements DES-TEST-PHASES
export function cargoSteps(
  subject: CommandSubject,
  options: CargoTargetOptions,
  runner?: SelectingRunner,
): CargoStep[] {
  if (subject.target === "hakari-check") {
    return hakariCheckSteps.map((args) => ({ kind: "command", args: [...args] }));
  }
  if (subject.target === "test" && subject.testRunner === "nextest") {
    const taken: CargoTargetOptions = Object.fromEntries(
      Object.entries(options).filter(([name]) => targetTakes("test", name)),
    );
    const crates = subject.crates ?? [];
    const shared = subject.workspace === true || crates.length > 1;
    if (taken.test !== undefined && shared) {
      throw new Error(
        "A test task with the test option runs in a group of one crate, which selects that crate alone.",
      );
    }
    const run: CargoStep = shared
      ? {
          kind: "nextest",
          args: cargoArguments(subject, options),
          listArgs: nextestListArguments(cargoArguments(subject, options)),
        }
      : { kind: "command", args: cargoArguments(subject, options) };
    // A plain `cargo test --test <name>` runs no doctest, and `cargo test
    // --doc` rejects `--test` beside it (`DES-TEST-RUN`, "One test target").
    if (taken.test !== undefined) {
      return [run];
    }
    return [
      run,
      {
        kind: "doctests",
        args: [
          "test",
          ...(subject.workspace === true ? ["--workspace"] : crateSelection("test", crates)),
          "--doc",
          ...(shared ? ["--no-fail-fast"] : []),
          ...compilingFlags(taken),
          ...unificationFlags(subject),
          ...flag(subject.locked, "--locked"),
        ],
      },
    ];
  }
  if (!(subject.target === "test" && subject.workspace === true)) {
    return [{ kind: "command", args: cargoArguments(subject, options) }];
  }
  if (selectedTestTarget("test", options) !== undefined) {
    throw new Error(
      "A test task with the test option runs in a group of one crate, which selects that crate alone.",
    );
  }
  if (runner === undefined) {
    throw new Error("A test group that selects the whole workspace needs the selecting runner.");
  }
  const taken: CargoTargetOptions = Object.fromEntries(
    Object.entries(options).filter(([name]) => targetTakes("test", name)),
  );
  const tail = [...compilingFlags(taken), ...flag(subject.locked, "--locked")];
  const toml = `[${runner.command.map((word) => JSON.stringify(word)).join(", ")}]`;
  return [
    { kind: "tests-build", args: ["test", "--workspace", "--no-run", ...tail] },
    {
      kind: "test-binaries",
      args: [
        "test",
        "--workspace",
        "--tests",
        "--no-fail-fast",
        "--message-format=json-render-diagnostics",
        ...tail,
        "--config",
        `target.${runner.host}.runner=${toml}`,
      ],
    },
    { kind: "doctests", args: ["test", "--workspace", "--doc", "--no-fail-fast", ...tail] },
  ];
}
