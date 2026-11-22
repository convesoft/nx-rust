import type { DeniedWarnings } from "../cargo/warnings-setting";
import {
  type CommandEnd,
  type CrateOutcome,
  describeList,
  type OutputCrate,
  packageName,
  plainLine,
  readTestStep,
} from "./cargo-output";

/**
 * The packages for which a command's JSON messages report a warning: a
 * `compiler-message` whose level is `warning`, by the package ID
 * specification that the message names.
 */
export function warnedPackages(output: string): Set<string> {
  const warned = new Set<string>();
  for (const line of output.split("\n")) {
    if (!line.startsWith('{"reason":"compiler-message"')) {
      continue;
    }
    try {
      const message = JSON.parse(line) as { package_id?: unknown; message?: { level?: unknown } };
      if (message.message?.level === "warning" && typeof message.package_id === "string") {
        warned.add(message.package_id);
      }
    } catch {
      // A line cut short fails every crate already (`readJsonStep`).
    }
  }
  return warned;
}

/**
 * Fails every task that passed a step of `build`, `check`, `lint`,
 * `napi-build` or `wasm-build` with JSON messages where the messages report
 * a warning and Cargo denies warnings for the command (`DES-BATCH`, "Denied
 * warnings"). Under `--message-format=json` cargo neither fails on them nor
 * says which crates a warning would fail (`EVD-CARGO-TARGET-COMMANDS`); had
 * it applied the setting, the step's command would have failed as a whole.
 *
 * @param tasks The step's tasks, as `<project>:<target>`, in the order of
 *   `outcomes`.
 * @param denied Whether Cargo denies warnings for the command, asked only
 *   where the messages report a warning and a task passed.
 * @returns The outcomes, with each task that passed failed where warnings
 *   are denied.
 */
// @mara implements DES-BATCH
export function withDeniedWarnings(
  outcomes: readonly CrateOutcome[],
  output: string,
  tasks: readonly string[],
  denied: () => DeniedWarnings | undefined,
): CrateOutcome[] {
  if (outcomes.every((outcome) => !outcome.passed)) {
    return [...outcomes];
  }
  const warned = warnedPackages(output);
  if (warned.size === 0) {
    return [...outcomes];
  }
  const denial = denied();
  if (denial === undefined) {
    return [...outcomes];
  }
  const names = [...new Set([...warned].map((id) => `\`${packageName(id)}\``))].sort();
  return outcomes.map((outcome, index) => {
    if (!outcome.passed) {
      return outcome;
    }
    const message = `${tasks[index]}: cargo reported warnings in ${describeList(names)}, and warnings are denied: ${denial.source}. Under the JSON messages that this command reads, cargo does not fail on them and does not say which crates they would fail, while the command would have failed as a whole without those messages, so every task of the command that passed fails.`;
    return {
      passed: false,
      output: outcome.output,
      message: outcome.message === undefined ? message : `${outcome.message}\n${message}`,
    };
  });
}

/** How a step's reading asks about Cargo's `build.warnings` for its command. */
export interface StepWarnings {
  /** Whether Cargo denies warnings, for a step whose JSON messages cargo does not fail on. */
  denied: () => DeniedWarnings | undefined;
  /** What sets the warnings to `deny`, for a step whose own output says they are denied. */
  setting: () => string | undefined;
}

/**
 * Reads a `cargo test` that selects its crates with `-p` ({@link readTestStep}),
 * naming, where cargo failed and says that it denies warnings, the packages
 * with warnings and what denies them (`DES-TEST-RUN`, "Denied warnings in a
 * test step").
 */
// @mara implements DES-TEST-RUN
export function readTestStepWithWarnings(
  output: string,
  end: CommandEnd,
  crates: readonly OutputCrate[],
  setting: () => string | undefined,
): CrateOutcome[] {
  const stopped =
    end.kind === "failed" ? stoppedByWarnings(output.split("\n"), setting) : undefined;
  return readTestStep(
    output,
    end,
    crates,
    stopped === undefined
      ? undefined
      : describeStoppedByWarnings(stopped, (names) =>
          describeList(names.map((name) => `\`${name}\``)),
        ),
  );
}

/**
 * Where a test step stopped because Cargo denies warnings, as cargo's own
 * output says (`DES-TEST-RUN`, "Denied warnings in a test step").
 */
export interface StoppedByWarnings {
  /** The packages whose warnings cargo reports as denied, each once, in order. */
  packages: string[];
  /** What denies them, as `denyingSetting` names it, if anything that the plugin reads does. */
  source: string | undefined;
}

// Cargo's line after the summary of a unit whose warnings it denies.
const deniedLine = /^error: warnings are denied by `build\.warnings` configuration$/;
// Cargo's summary of a unit's warnings, which starts with `error:` where it
// denies them and with `warning:` otherwise.
const deniedSummary = /^error: `([^`]+)` \([^)]*\) generated \d+ warnings?\b/;

/**
 * Reads from a test step's text, which cargo prints without JSON messages
 * or with `json-render-diagnostics`, whether cargo stopped because it denies
 * warnings: where a line says `warnings are denied by \`build.warnings\`
 * configuration`. The packages are those of cargo's summaries that start
 * with `error:`, as `` error: `d` (lib) generated 1 warning ``; cargo starts
 * no new job after the first, so it names only the packages that it compiled
 * before it stopped. The plugin decides nothing itself: it reads cargo's
 * verdict, and `setting` only names what denies the warnings.
 *
 * @returns `undefined` where cargo does not say that warnings are denied.
 */
// @mara implements DES-TEST-RUN
export function stoppedByWarnings(
  lines: readonly string[],
  setting: () => string | undefined,
): StoppedByWarnings | undefined {
  const plain = lines.map(plainLine);
  if (!plain.some((line) => deniedLine.test(line))) {
    return undefined;
  }
  const packages = [...new Set(plain.flatMap((line) => deniedSummary.exec(line)?.[1] ?? []))];
  return { packages, source: setting() };
}

/**
 * The cause of a test step's stop by denied warnings, as a message names
 * it: the packages with warnings, as `describe` names them, and what denies
 * them, worded as the JSON compile steps' message words it
 * ({@link withDeniedWarnings}).
 */
export function describeStoppedByWarnings(
  stopped: StoppedByWarnings,
  describe: (names: readonly string[]) => string,
): string {
  const setting =
    stopped.source === undefined
      ? "warnings are denied by Cargo's build.warnings setting, as cargo says"
      : `warnings are denied: ${stopped.source}`;
  return stopped.packages.length === 0
    ? `${setting}, and cargo's output names no package with warnings; its diagnostics above show them`
    : `cargo reported warnings in ${describe(stopped.packages)}, and ${setting}`;
}
