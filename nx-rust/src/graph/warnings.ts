import { createHash } from "node:crypto";
import type { Input } from "./inputs";
import { realPath } from "./real-path";

/**
 * The name of the named input that holds a digest of a project's warnings
 * (`DES-DIAGNOSTICS`, "Warnings where they are seen"). No target names it:
 * Nx hashes a project's named inputs into the key of each of its tasks and
 * of the tasks that depend on it all the same (`EVD-NX-24-WARNING-CHANNELS`).
 */
export const warningsInputName = "nx-rust-warnings";

/**
 * The named input that holds the digest of a project's warnings, which the
 * executor prints at the start of each of the project's tasks, so that the
 * tasks' keys change with them and a cache hit replays the warnings of the
 * graph that the command uses (`DES-DIAGNOSTICS`, "Warnings where they are
 * seen"). A project without warnings gets none, so that its keys are the
 * keys it has without the plugin's warnings.
 *
 * The digest is the value of the input's only entry, a command that prints
 * it: Nx hashes the entries of named inputs, not their names. Since no
 * target names the input, Nx never runs the command.
 *
 * @param repositoryRoot The absolute path of the repository root.
 */
// @mara implements DES-DIAGNOSTICS
export function warningsInput(
  warnings: readonly string[],
  repositoryRoot: string,
): Record<string, Input[]> {
  return warnings.length === 0
    ? {}
    : { [warningsInputName]: [{ runtime: `echo ${warningsDigest(warnings, repositoryRoot)}` }] };
}

/**
 * The digest of a project's warnings: SHA-256 over the warnings, each once
 * and sorted, with the paths inside the repository written relative to its
 * root, so that checkouts of one repository in different folders get one
 * digest. A path outside the repository, such as the Cargo home's, stays as
 * it is: it names the cause.
 *
 * @param repositoryRoot The absolute path of the repository root; its real
 *   path counts too, as cargo reports paths through symbolic links resolved.
 */
export function warningsDigest(warnings: readonly string[], repositoryRoot: string): string {
  const roots = [...new Set([repositoryRoot, realPath(repositoryRoot)])].sort(
    (a, b) => b.length - a.length,
  );
  const relative = (warning: string) =>
    roots.reduce((text, root) => withRelativePaths(text, root), warning);
  const normalised = [...new Set(warnings.map(relative))].sort(compare);
  return createHash("sha256").update(JSON.stringify(normalised)).digest("hex");
}

// The text with every path below `root` written relative to it, and `root`
// itself as `.`. A path that only starts or ends with the same characters,
// such as `/repo-old` or `/old/repo` beside `/repo`, is no path below it.
function withRelativePaths(text: string, root: string): string {
  if (root === "/" || root === "") {
    return text;
  }
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`(?<![\\w.-])${escaped}/`, "g"), "")
    .replace(new RegExp(`(?<![\\w.-])${escaped}(?![\\w.-])`, "g"), ".");
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
