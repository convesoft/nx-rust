import type { InferredTargetName } from "../graph/targets";

/**
 * The options of the plugin's targets that its executors declare
 * (`DES-PLUGIN-OPTIONS`). Each option that switches a flag of the cargo
 * command takes effect only on the targets that the option reference gives
 * it; on any other target the command leaves it out.
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
  /** Selection of affected tests on `test`; no flag (nxr-tabkjx). */
  affectedTests?: boolean;
  /** The plugin's version, which the plugin sets for the cache key; no flag. */
  pluginVersion?: string;
}

/** What a task's cargo command depends on besides the target's options. */
export interface CommandSubject {
  /** The default name of the task's target, which decides the command. */
  target: InferredTargetName;
  /** The crate's real package name; absent for a workspace project without a crate. */
  packageName?: string;
  /** Whether the command runs in locked mode (`DES-INVOCATION`). */
  locked: boolean;
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

// The targets that take the feature and profile options, and those that
// also take `targetTriple` (`DES-PLUGIN-OPTIONS`).
const compilingTargets = new Set<InferredTargetName>([
  "build",
  "check",
  "lint",
  "test",
  "bench",
  "run",
  "doc",
]);
const tripleTargets = new Set<InferredTargetName>([
  "build",
  "check",
  "lint",
  "bench",
  "run",
  "doc",
]);

/**
 * The arguments after `cargo` of the command that a task of an inferred
 * target runs in its workspace's root folder.
 *
 * A crate's targets select it with `-p` and its real package name, and the
 * workspace project's targets address the whole workspace. Apart from that,
 * a flag comes only from an option of the target, so that the command is the
 * one that a developer types in the workspace root (`DES-INVOCATION`). In
 * locked mode every command passes `--locked`, apart from `update`, whose
 * purpose is to change `Cargo.lock`, `fmt` and `fmt-check`, because
 * `cargo fmt` rejects the flag, and `audit`, because cargo-audit only reads
 * the lockfile and has no such flag; cargo-deny takes it before its `check`.
 *
 * @throws {Error} When a crate's target has no package name.
 */
// @mara implements DES-INVOCATION
// @mara implements DES-TARGET-COMMANDS
// @mara implements DES-WORKSPACE-TARGETS
// @mara implements REQ-TEST-RUNNER
export function cargoArguments(subject: CommandSubject, options: CargoTargetOptions): string[] {
  const { target, packageName, locked } = subject;
  const crateCommand = crateCommands[target];
  if (crateCommand !== undefined) {
    if (packageName === undefined) {
      throw new Error(`The target "${target}" runs for a crate, and the project has none.`);
    }
    const formatting = target === "fmt" || target === "fmt-check";
    return [
      ...crateCommand,
      ...flag((target === "check" || target === "lint") && options.allTargets, "--all-targets"),
      "-p",
      packageName,
      ...compilingFlags(target, options),
      ...(target === "run" && options.bin !== undefined ? ["--bin", options.bin] : []),
      ...flag(locked && !formatting, "--locked"),
    ];
  }
  switch (target) {
    case "doc":
      return [
        "doc",
        ...flag(options.noDeps, "--no-deps"),
        "--workspace",
        ...compilingFlags(target, options),
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

// The feature, profile and triple flags, on the targets that take them.
function compilingFlags(target: InferredTargetName, options: CargoTargetOptions): string[] {
  if (!compilingTargets.has(target)) {
    return [];
  }
  const features = options.features ?? [];
  return [
    ...(features.length > 0 ? ["--features", features.join(",")] : []),
    ...flag(options.allFeatures, "--all-features"),
    ...flag(options.noDefaultFeatures, "--no-default-features"),
    ...(options.profile !== undefined ? ["--profile", options.profile] : []),
    ...(tripleTargets.has(target) && options.targetTriple !== undefined
      ? ["--target", options.targetTriple]
      : []),
  ];
}

function flag(on: boolean | undefined, name: string): string[] {
  return on === true ? [name] : [];
}
