import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describeList } from "./cargo-output";
import type { CargoTargetOptions } from "./command";

// The record of the context in which a coverage baseline was collected
// (`DES-BASELINE`, `ADR-AFFECTED-BASELINE-CONTEXT`): the collection target
// writes it beside cargo-affected's database, and step 1 of `DES-TEST-RUN`
// compares it with the group's context before it trusts a report. Both use
// this module, so that they read and write one format.

/** The record's file in a workspace root. */
export const contextRecordFile = join("target", "affected", "nx-rust-context.json");

/**
 * The prefixes of the variables that the toolchain input of `test` with the
 * nextest runner prints (`DES-INPUTS`), apart from `CARGO_TARGET_DIR`, which
 * says where the artifacts go and not what they are.
 */
export const contextVariablePrefixes = ["CARGO_PROFILE_", "CARGO_TARGET_", "NEXTEST_"] as const;

/**
 * Variables that a `test` task hashes and that change nothing that cargo
 * compiles or a test reads: Nx's key for its cloud cache, and the plugin's
 * mark of a run that excludes task dependencies.
 */
const notContext = new Set(["NX_CLOUD_ENCRYPTION_KEY", "NX_RUST_RUN_ID"]);

/** The context of a collection or of a test run. */
export interface BaselineContext {
  /** The format's version: 2 since the record holds the runtime inputs. */
  version: 2;
  /** The cargo options that change what is compiled or run. */
  cargo: {
    features: string[];
    allFeatures: boolean;
    noDefaultFeatures: boolean;
    profile: string | null;
    target: string | null;
  };
  /** The target triple that cargo builds for. */
  triple: string;
  /** For each environment input, the SHA-256 of its value, or `null` where it is unset. */
  env: Record<string, string | null>;
  /**
   * For each runtime input of the `test` tasks but the test mode's own, by
   * its command, the SHA-256 of what the command prints, as Nx runs it.
   */
  runtime: Record<string, string>;
}

/**
 * Whether a runtime input is the plugin's test mode command, which the
 * record leaves out: its output is the mode and the baseline, which the key
 * holds and which step 1 checks on its own (`DES-TEST-MODE`).
 */
export function isTestModeCommand(command: string): boolean {
  return command.includes("print-test-mode.js");
}

/**
 * The runtime inputs that a context holds, from the commands of the `test`
 * tasks' runtime inputs as Nx expands them: the declared `runtimeInputs`
 * and the plugin's own, such as the toolchain command, each once, sorted,
 * without the test mode command.
 */
export function contextRuntimeCommands(commands: Iterable<string>): string[] {
  return [...new Set(commands)].filter((command) => !isTestModeCommand(command)).sort();
}

/**
 * The SHA-256 of what each command prints, run as Nx runs a runtime input:
 * through `sh -c` in the repository root with the task's environment
 * (`EVD-NX-24-INPUT-SEMANTICS`); or why one cannot be run, as a command that
 * fails, which Nx cannot hash either.
 */
export function runtimeContext(
  commands: readonly string[],
  repositoryRoot: string,
  env: NodeJS.ProcessEnv,
): { runtime: Record<string, string> } | { problem: string } {
  const runtime: Record<string, string> = {};
  for (const command of commands) {
    const run = spawnSync("sh", ["-c", command], {
      cwd: repositoryRoot,
      env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (run.error !== undefined || run.status !== 0) {
      return {
        problem: `the runtime input \`${command}\` ${run.error === undefined ? `exited with status ${run.status}` : `could not run (${run.error.message})`}, so the plugin cannot compare it with the baseline's`,
      };
    }
    runtime[command] = createHash("sha256").update(run.stdout).digest("hex");
  }
  return { runtime };
}

/** The cargo options of `options` that the record holds, in a fixed form. */
export function cargoContext(options: CargoTargetOptions): BaselineContext["cargo"] {
  return {
    features: [...new Set(options.features ?? [])].sort(),
    allFeatures: options.allFeatures === true,
    noDefaultFeatures: options.noDefaultFeatures === true,
    profile: options.profile ?? null,
    target: options.targetTriple ?? null,
  };
}

/**
 * The names of the environment inputs that a context holds: `names`, the
 * environment inputs of the `test` tasks as Nx expands them, and every
 * variable of `env` whose name starts with one of
 * {@link contextVariablePrefixes}, without the variables that change
 * nothing that is compiled or run.
 */
export function contextVariables(names: Iterable<string>, env: NodeJS.ProcessEnv): string[] {
  const all = new Set<string>(names);
  for (const name of Object.keys(env)) {
    if (
      env[name] !== undefined &&
      name !== "CARGO_TARGET_DIR" &&
      contextVariablePrefixes.some((prefix) => name.startsWith(prefix))
    ) {
      all.add(name);
    }
  }
  return [...all].filter((name) => !notContext.has(name)).sort();
}

/** The SHA-256 of each variable's value in `env`, `null` for an unset one. */
export function environmentContext(
  names: readonly string[],
  env: NodeJS.ProcessEnv,
): Record<string, string | null> {
  return Object.fromEntries(
    names.map((name) => {
      const value = env[name];
      return [name, value === undefined ? null : createHash("sha256").update(value).digest("hex")];
    }),
  );
}

/** Writes the record into the workspace root, for the collection target and the tests. */
export function writeContextRecord(workspaceRoot: string, context: BaselineContext): void {
  const file = join(workspaceRoot, contextRecordFile);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(context, null, 2)}\n`);
}

/** The record in a workspace root, or why there is none that can be read. */
export function readContextRecord(
  workspaceRoot: string,
): { context: BaselineContext } | { problem: string } {
  let text: string;
  try {
    text = readFileSync(join(workspaceRoot, contextRecordFile), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? {
          problem: `the baseline has no record of the context it was collected in (${contextRecordFile}), which the collection target writes after a successful collection`,
        }
      : {
          problem: `the record of the baseline's context, ${contextRecordFile}, cannot be read (${(error as Error).message})`,
        };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { problem: `the record of the baseline's context, ${contextRecordFile}, is no JSON` };
  }
  const record = data as (Partial<Omit<BaselineContext, "version">> & { version?: unknown }) | null;
  if (record?.version === 1) {
    return {
      problem: `the record of the baseline's context, ${contextRecordFile}, is of the form of version 1, which holds no runtime inputs; collect the baseline again`,
    };
  }
  const cargo = record?.cargo;
  const env = record?.env;
  const runtime = record?.runtime;
  if (
    record?.version !== 2 ||
    typeof record.triple !== "string" ||
    typeof cargo !== "object" ||
    cargo === null ||
    !Array.isArray(cargo.features) ||
    !cargo.features.every((feature) => typeof feature === "string") ||
    typeof cargo.allFeatures !== "boolean" ||
    typeof cargo.noDefaultFeatures !== "boolean" ||
    !(cargo.profile === null || typeof cargo.profile === "string") ||
    !(cargo.target === null || typeof cargo.target === "string") ||
    typeof env !== "object" ||
    env === null ||
    !Object.values(env).every((value) => value === null || typeof value === "string") ||
    typeof runtime !== "object" ||
    runtime === null ||
    !Object.values(runtime).every((value) => typeof value === "string")
  ) {
    return {
      problem: `the record of the baseline's context, ${contextRecordFile}, is not of the form that this version of @convesoft/nx-rust writes`,
    };
  }
  return { context: record as BaselineContext };
}

/**
 * What differs between the record of a baseline and the group's context, one
 * phrase each, such as "--features (a against b)" or "the variable FOO";
 * empty where they are equal (`ADR-AFFECTED-BASELINE-CONTEXT`). A variable
 * that the group has among its inputs and that the record does not hold, or
 * that has a prefix of {@link contextVariablePrefixes} in either, counts by
 * its value, an unset one being a value of its own; so does a runtime input
 * of the group that the record does not hold, by the hash of its output.
 */
// @mara implements DES-TEST-RUN
export function contextDifferences(record: BaselineContext, current: BaselineContext): string[] {
  const differences: string[] = [];
  const option = (name: string, collected: unknown, now: unknown) => {
    if (JSON.stringify(collected) !== JSON.stringify(now)) {
      differences.push(`${name} (${show(collected)} at the collection, ${show(now)} now)`);
    }
  };
  option("--features", record.cargo.features, current.cargo.features);
  option("--all-features", record.cargo.allFeatures, current.cargo.allFeatures);
  option("--no-default-features", record.cargo.noDefaultFeatures, current.cargo.noDefaultFeatures);
  option("the profile", record.cargo.profile, current.cargo.profile);
  option("--target", record.cargo.target, current.cargo.target);
  option("the target triple", record.triple, current.triple);
  const names = new Set([
    ...Object.keys(current.env),
    ...Object.keys(record.env).filter((name) =>
      contextVariablePrefixes.some((prefix) => name.startsWith(prefix)),
    ),
  ]);
  const variables = [...names]
    .sort()
    .filter(
      (name) => (record.env[name] ?? null) !== (current.env[name] ?? null) || !(name in record.env),
    );
  if (variables.length > 0) {
    differences.push(
      `the ${variables.length === 1 ? "variable" : "variables"} ${describeList(variables)}`,
    );
  }
  const commands = Object.keys(current.runtime)
    .sort()
    .filter((command) => record.runtime[command] !== current.runtime[command]);
  if (commands.length > 0) {
    differences.push(
      `the output of the runtime ${commands.length === 1 ? "input" : "inputs"} ${describeList(commands.map((command) => `\`${command}\``))}`,
    );
  }
  return differences;
}

function show(value: unknown): string {
  if (value === null || value === false) {
    return "none";
  }
  if (value === true) {
    return "set";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "none" : value.join(",");
  }
  return String(value);
}
