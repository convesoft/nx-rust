import { type InferredTargetName, inferredTargetNames } from "../graph/targets";

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
  /** Selection of affected tests on `test`; no flag (nxr-tabkjx). */
  affectedTests?: boolean;
  /** The plugin's version, which the plugin sets for the cache key; no flag. */
  pluginVersion?: string;
}

/** The name of an option of the plugin's targets. */
export type TargetOptionName = keyof CargoTargetOptions;

// The targets that take the feature and profile options, and those that
// also take `targetTriple`.
const compilingTargets: readonly InferredTargetName[] = [
  "build",
  "check",
  "lint",
  "test",
  "bench",
  "run",
  "doc",
];
const tripleTargets = compilingTargets.filter((target) => target !== "test");

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
  affectedTests: new Set(["test"]),
  pluginVersion: new Set(inferredTargetNames),
};

/**
 * The option that the plugin sets itself, to carry its version into the
 * cache key where Nx has no node for its package (`DES-PLUGIN-OPTIONS`). A
 * target table in Cargo metadata may not set it.
 */
export const pluginVersionOption = "pluginVersion" satisfies TargetOptionName;

/** Whether the target with this default name takes the option `name`. */
export function targetTakes(target: InferredTargetName, name: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(optionTargets, name) &&
    optionTargets[name as TargetOptionName].has(target)
  );
}

/** What a task's cargo command depends on besides the target's options. */
export interface CommandSubject {
  /** The default name of the task's target, which decides the command. */
  target: InferredTargetName;
  /** The crate's real package name; absent for a workspace project without a crate. */
  packageName?: string;
  /** Whether the command runs in locked mode (`DES-INVOCATION`). */
  locked: boolean;
  /** The binary's arguments, which `run` passes after `--`; none for other targets. */
  binaryArguments?: readonly string[];
}

// The cargo subcommand of each per-crate target and its own flags, before the
// package selection (`DES-TARGET-COMMANDS`).
const crateCommands: Partial<Record<InferredTargetName, readonly string[]>> = {
  build: ["build"],
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
 * A crate's targets select it with `-p` and its real package name, and the
 * workspace project's targets address the whole workspace. Apart from that,
 * a flag comes only from an option that the target takes
 * ({@link optionTargets}), so that the command is the one that a developer
 * types in the workspace root (`DES-INVOCATION`); `run` passes the binary's
 * arguments after `--`. In locked mode every command passes `--locked`,
 * apart from `update`, whose purpose is to change `Cargo.lock`, `fmt` and
 * `fmt-check`, because `cargo fmt` rejects the flag, and `audit`, because
 * cargo-audit only reads the lockfile and has no such flag; cargo-deny takes
 * it before its `check`.
 *
 * @throws {Error} When a crate's target has no package name.
 */
// @mara implements DES-INVOCATION
// @mara implements DES-TARGET-COMMANDS
// @mara implements DES-WORKSPACE-TARGETS
// @mara implements REQ-TEST-RUNNER
export function cargoArguments(subject: CommandSubject, options: CargoTargetOptions): string[] {
  const { target, packageName, locked } = subject;
  const taken: CargoTargetOptions = Object.fromEntries(
    Object.entries(options).filter(([name]) => targetTakes(target, name)),
  );
  const crateCommand = crateCommands[target];
  if (crateCommand !== undefined) {
    if (packageName === undefined) {
      throw new Error(`The target "${target}" runs for a crate, and the project has none.`);
    }
    const formatting = target === "fmt" || target === "fmt-check";
    const binaryArguments = target === "run" ? (subject.binaryArguments ?? []) : [];
    return [
      ...crateCommand,
      ...flag(taken.allTargets, "--all-targets"),
      "-p",
      packageName,
      ...compilingFlags(taken),
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
        ...flag(locked, "--locked"),
      ];
    case "audit":
      return ["audit"];
    case "deny":
      return ["deny", ...flag(locked, "--locked"), "check"];
    case "update":
      return ["update"];
  }
  throw new Error(`nx-rust has no command for the target "${target}".`);
}

// The feature, profile and triple flags, from the options that the target takes.
function compilingFlags(taken: CargoTargetOptions): string[] {
  const features = taken.features ?? [];
  return [
    ...(features.length > 0 ? ["--features", features.join(",")] : []),
    ...flag(taken.allFeatures, "--all-features"),
    ...flag(taken.noDefaultFeatures, "--no-default-features"),
    ...(taken.profile !== undefined ? ["--profile", taken.profile] : []),
    ...(taken.targetTriple !== undefined ? ["--target", taken.targetTriple] : []),
  ];
}

function flag(on: boolean | undefined, name: string): string[] {
  return on === true ? [name] : [];
}
