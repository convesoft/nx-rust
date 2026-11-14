import { satisfies } from "../cargo/version-req";

/**
 * What becomes of a version requirement on a crate whose version changes
 * (`DES-RELEASE`, "Requirements"):
 *
 * - `keep`: a bare, `^`, `~` or `=` requirement that the new version
 *   satisfies, while Nx's `preserveMatchingDependencyRanges` is on, or one
 *   that already names the new version;
 * - `rewrite`: such a requirement, rewritten to the new version with its
 *   operator kept;
 * - `keep-other`: a requirement of another form, such as a comparison or a
 *   wildcard, that the new version satisfies, which is kept whatever
 *   `preserveMatchingDependencyRanges` says and named in the output;
 * - `fail`: a requirement of another form that the new version leaves,
 *   `leaves` being `false` where the plugin cannot tell, as for a
 *   pre-release.
 */
export type RequirementChange =
  | { kind: "keep" }
  | { kind: "rewrite"; requirement: string }
  | { kind: "keep-other" }
  | { kind: "fail"; leaves: boolean };

// A bare, `^`, `~` or `=` requirement with one to three numbers: the forms
// that the new version can replace without inventing bounds.
const rewritable =
  /^\s*(\^|~|=)?\s*\d+(?:\.\d+(?:\.\d+(?:-[0-9A-Za-z.-]+)?)?)?(?:\+[0-9A-Za-z.-]+)?\s*$/;

/**
 * What becomes of `requirement`, as written in a manifest, when the crate it
 * names gets `newVersion` ({@link RequirementChange}).
 *
 * @param preserveMatching Nx's `preserveMatchingDependencyRanges`.
 */
// @mara implements DES-RELEASE
export function requirementChange(
  requirement: string,
  newVersion: string,
  preserveMatching: boolean,
): RequirementChange {
  const form = rewritable.exec(requirement);
  const matches = satisfies(requirement, newVersion);
  if (form === null) {
    return matches === true ? { kind: "keep-other" } : { kind: "fail", leaves: matches === false };
  }
  const rewritten = `${form[1] ?? ""}${newVersion}`;
  if (matches === true && (preserveMatching || requirement.trim() === rewritten)) {
    return { kind: "keep" };
  }
  // A pre-release on either side gives no answer; the requirement is
  // rewritten then, because one that names the new version accepts it.
  return { kind: "rewrite", requirement: rewritten };
}
