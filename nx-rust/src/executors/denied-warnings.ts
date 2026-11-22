import type { DeniedWarnings } from "../cargo/warnings-setting";
import { type CrateOutcome, describeList, packageName } from "./cargo-output";

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
