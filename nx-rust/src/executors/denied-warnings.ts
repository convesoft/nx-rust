import { dirname, resolve } from "node:path";
import type { CargoPackage } from "../cargo/metadata";
import type { DeniedWarnings } from "../cargo/warnings-setting";
import { type CrateOutcome, describeList, type OutputCrate, packageName } from "./cargo-output";

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

/** The packages whose warnings a plain cargo command of one crate would show. */
interface Reach {
  /** The members that the crate reaches through path dependencies, itself included, by ID. */
  members: Set<string>;
  /**
   * Whether the crate may reach a package outside the workspace that cargo
   * reports warnings for: it reaches a path dependency outside the
   * workspace, whose own dependencies the plugin does not know, or the
   * plugin does not know its dependencies at all.
   */
  outside: boolean;
}

// The members that `crate` reaches through path dependencies: normal and
// build dependencies, and its own dev-dependencies where the command
// compiles its tests. Cargo shows warnings for path packages only and caps
// the lints of registry and git dependencies (`EVD-CARGO-TARGET-COMMANDS`).
function reach(
  crate: OutputCrate,
  members: readonly CargoPackage[] | undefined,
  withDevDependencies: boolean,
): Reach {
  if (crate.package === undefined || members === undefined) {
    return { members: new Set([crate.spec]), outside: true };
  }
  const byFolder = new Map(
    members.map((member) => [resolve(dirname(member.manifest_path)), member] as const),
  );
  const reached = new Set<string>([crate.package.id]);
  let outside = false;
  const pending: { pkg: CargoPackage; root: boolean }[] = [{ pkg: crate.package, root: true }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const dependency of next.pkg.dependencies) {
      if (
        dependency.path === undefined ||
        (dependency.kind === "dev" && !(next.root && withDevDependencies))
      ) {
        continue;
      }
      const member = byFolder.get(resolve(dependency.path));
      if (member === undefined) {
        outside = true;
      } else if (!reached.has(member.id)) {
        reached.add(member.id);
        pending.push({ pkg: member, root: false });
      }
    }
  }
  return { members: reached, outside };
}

/**
 * Fails each crate that passed a step of `build`, `check`, `lint`,
 * `napi-build` or `wasm-build` with JSON messages where Cargo denies
 * warnings and the messages report a warning that a plain cargo command of
 * the crate alone would fail on (`DES-BATCH`, "Denied warnings"): in the
 * crate itself, in a member that it reaches through path dependencies, or
 * in a package outside the workspace where it may reach one. Under
 * `--message-format=json` cargo itself does not fail on them
 * (`EVD-CARGO-TARGET-COMMANDS`).
 *
 * @param members Every member of the workspace, as the group's report of
 *   the members gives them; where they are unknown, every warning counts.
 * @param withDevDependencies Whether the command compiles the crates'
 *   tests, as with `--all-targets`, so that their dev-dependencies count.
 * @param denied Whether Cargo denies warnings for the command, asked only
 *   where a crate that passed may fail on a warning.
 * @returns The outcomes, with each crate that fails on warnings failed.
 */
// @mara implements DES-BATCH
export function withDeniedWarnings(
  outcomes: readonly CrateOutcome[],
  output: string,
  crates: readonly OutputCrate[],
  members: readonly CargoPackage[] | undefined,
  withDevDependencies: boolean,
  denied: () => DeniedWarnings | undefined,
): CrateOutcome[] {
  const warned = warnedPackages(output);
  const memberIds = new Set((members ?? []).map((member) => member.id));
  const failing = crates.map((crate, index) => {
    if (!outcomes[index].passed || warned.size === 0) {
      return [];
    }
    const reached = reach(crate, members, withDevDependencies);
    return [...warned].filter(
      (id) => reached.members.has(id) || (reached.outside && !memberIds.has(id)),
    );
  });
  if (failing.every((ids) => ids.length === 0)) {
    return [...outcomes];
  }
  const denial = denied();
  if (denial === undefined) {
    return [...outcomes];
  }
  return outcomes.map((outcome, index) => {
    const ids = failing[index];
    if (ids.length === 0) {
      return outcome;
    }
    const crate = crates[index];
    const names = [...new Set(ids.map((id) => `\`${packageName(id)}\``))].sort();
    const message = `${crate.task}: cargo reported warnings in ${describeList(names)}, and warnings are denied: ${denial.source}. cargo does not fail on warnings under the JSON messages that this command reads to tell its crates apart, so the task fails as a cargo command of ${crate.name} alone would.`;
    return {
      passed: false,
      output: outcome.output,
      message: outcome.message === undefined ? message : `${outcome.message}\n${message}`,
    };
  });
}
