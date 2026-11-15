---
title: Close the remaining gaps of the target-default guard around other plugins and extra targets
status: done
type: bug
priority: low
parent: nxr-9y4eh8
discovered_from: nxr-gyyhdj
created_at: 2026-11-15T10:39:53Z
closed_at: 2026-11-15T12:06:56Z
---

Goal: `DES-TARGET-DEFAULT-GUARD` has no case left in which an inferred target loses an input, an output or a dependency, or gains caching, without an error or a warning that the executor backs, and it blames the entry that Nx really applied.

Context: found while nxr-gyyhdj and nxr-6prnx1 were fixed and reviewed (15 November 2026). The first four were found by reading the code and were not run; the fifth was reproduced by the reviewer. None is a regression of that work. Each needs a second Nx plugin or an extra target, so they are rare; the second one can end in a stale cache hit and is why this is a bug.

- [x] Reproduce each case with the real Nx in both plugin modes (`NX_ISOLATE_PLUGINS` true and false), and drop from this list what does not reproduce
- [x] Extra targets that a crate declares in its Cargo tables are compared as if the plugin had inferred them: an ordinary entry such as `"e2e": { "cache": true }` probably fails graph creation for a crate that defines `e2e`, and where another plugin turns caching on for such a target, the warning has nothing behind it, because the executor is not the plugin's
- [x] Another plugin replaces the `inputs` or `outputs` of an inferred target and no `targetDefaults` entry is involved: the guard only warns, with empty `targetDefaults` it says nothing, and nothing at run time stops a stale hit. Decide with the maintainer whether this is an error, a warning that the executor backs, or outside what the guard promises, and record it in `DES-TARGET-DEFAULT-GUARD`
- [x] The digest of warnings that `createNodes` computes (`targetDefaultCauses`) does not consider the source that `filter.plugin` compares with, so a warning can be missing on a cache hit
- [x] An addition to `dependsOn` is never blamed on an entry where the rebuild does not reproduce the field; it stays a warning either way
- [x] Misleading attribution: with a plugin `other` registered before nx-rust, an executor-keyed entry `[{ "filter": { "plugin": "other" }, "inputs": ["default"] }]` beside `"check": [{ "filter": { "projects": ["api"] }, "inputs": ["default"] }]` blames `check` for `api`, although Nx selects the executor key (`nx-rust/src/graph/target-defaults.ts`, about line 329). Graph creation still fails
- [x] Tests in `target-defaults.spec.ts` for each case that is fixed, and `VER-TARGET-DEFAULT-GUARD` updated

Done when: each case above is fixed, decided or shown not to reproduce, the decisions are in Mara, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Notes

Reproduced on 15 November 2026 with Nx 24.0.6, cargo 1.100.0, `NX_DAEMON=false`, with `NX_ISOLATE_PLUGINS` true and false, at commit 0016c40. All five cases reproduce in both modes; none is dropped:

- Extra targets: `api`'s table defines `e2e` with `executor = "nx:run-commands"`. `"e2e": { "cache": true }` failed graph creation ("turns on caching for e2e"), an entry replacing the table's `inputs`/`outputs` failed as replacing them, and another plugin's `cache: true` drew the unattributed warning. A table in the `command` form was not affected (its record has no executor, so the executors differ and nothing was compared).
- Other layers: reproduced with stale hits (`EVD-NX-24-PLUGIN-NODES`, "Other layers"); decided below.
- Digest: plugin `other` before nx-rust gives `api` a `check` with the cargo executor; an entry `check: [{ filter: { plugin: "other" }, dependsOn: ["...", "^check"] }]` added to a file that `nx.json` extends left `api:check` a cache hit whose replayed output lacked the warning.
- `dependsOn` additions: with another plugin tagging only `api`, `check: { dependsOn: ["...", "^check"] }` was named for the other crates and drew "cannot tell which configuration changed it" for `api`.
- Attribution: the issue's example named only the entry keyed `check`.

Other layers: the maintainer decided the open question on 15 November 2026, recorded in `DES-TARGET-DEFAULT-GUARD` ("Other layers").

## Summary of Changes

All five cases are closed in this branch. Each case's reason is in `DES-TARGET-DEFAULT-GUARD`, and the checks are in `VER-TARGET-DEFAULT-GUARD`.

- **Other layers** (the maintainer's decision of 15 November 2026, in `DES-TARGET-DEFAULT-GUARD`, "Other layers"):
  - An inferred `inputs`, `outputs` or `dependsOn` entry that the merged target lacks fails graph creation, unless a `targetDefaults` entry is blamed for it or the crate folder's own `project.json` or `package.json` explains it. This holds also without `targetDefaults`.
  - The message names the lost entries and the plugins listed after nx-rust, and gives the fixes: an `exclude` on that plugin, `"..."` in its lists, the change in the crate's `project.json`, and a referenced project's final name.
  - Caching that another layer turns on keeps the warning, which the executor backs; that is the complete answer for caching.
  - An added dependency keeps its warning, because an addition costs only time.
  - A renamed reference to another plugin's project that the rebuild cannot prove now fails as a loss. The fix is one line: name the project by its final name.
  - `DES-DIAGNOSTICS` has the new error row.
- **Extra targets:** the guard and the warning digest look only at inferred targets.
- **Attribution:** one rebuild per possible source plugin, and every entry whose rebuild gives the merged field is named.
- **Added dependencies:** blamed on every element that may apply and lists them.
- **Digest:** counts every possible source plugin.
- **Knowledge:** `EVD-NX-24-PLUGIN-NODES` holds the runs and Nx source lines. The targets, configuration and caching guides say what another plugin may do, and how to state an intended change.

Checks run on the final head (d0095e1, local `main` merged, already up to date):

- `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache`: 45 suites; 1514 tests passed, 1 todo.
- `pnpm nx format:check --all`: passed.
- `NX_DAEMON=false pnpm nx e2e nx-rust-e2e --skip-nx-cache`: 27 passed.
- `mara schema validate`: passed.
- `mara project validate`: `valid: true`, evaluation complete, no diagnostics.
- `zban check`: passed.

Rejected approaches:

- Proving renamed references from the renamed project's own files. The one-line fix makes it unnecessary.
- Keeping the unbacked warning for lost inputs or outputs. It is replaced by the decided error.

## Summary of the last round

The maintainer's rule now covers what a list means, as the control plane decided after the review of ce7a20e. It is recorded in `DES-TARGET-DEFAULT-GUARD`, "Other layers".

- **The comparison:** each of `inputs`, `outputs` and `dependsOn` is compared with every rebuild from nx-rust's node, `targetDefaults` and the crate folder's own files, with `inputs` expanded through the named inputs as Nx's task hasher expands them.
- **What counts as narrowing:** a lost entry, an added negated pattern, or a named input defined anew. Each is an error unless the crate's own files or `nx.json` explain it.
- **What only widens, and is not reported:** added inputs without negations, added outputs without `!`, and added dependencies (their warning stays).
- **Corrections in Mara:** the sentence that added inputs only widen is corrected, and the `rust-alias` circumvention is recorded as a limit.
- **No false error from the installed JS plugins:** `@nx/js/typescript`, `@nx/jest/plugin` and `@nx/oxlint` in a crate's folder define no named input and replace `lint` and `test` whole.
- **Filed:** nxr-wqwn7w, a `targetDefaults` entry that adds a negated pattern, which the `targetDefaults` rules do not catch.

Checks on 35fcb44 (local `main` 0016c40 contained):

- `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache`: 45 suites; 1536 tests passed, 1 todo.
- `pnpm nx format:check --all`: passed.
- `NX_DAEMON=false pnpm nx e2e nx-rust-e2e --skip-nx-cache`: 27 passed.
- `mara schema validate`: passed.
- `mara project validate`: `valid: true`, evaluation complete, no diagnostics.
- `zban check`: passed.

Against the guard of ce7a20e, 4 of the 22 new tests fail (the two errors, each in both modes). The other 18, which must stay quiet, pass before and after.

Rejected approaches:

- Separate special cases for negations and named inputs, instead of one comparison.
- Comparing only against the rebuild without `targetDefaults`, which would blame a `targetDefaults` negation on another plugin.

## Known limits of the comparison

The comparison of meaning covers three things: lost entries, added negated patterns, and named inputs defined anew. It reads them as the JS helpers of Nx's task hasher expand inputs, which is what the review's two reproductions needed. That is an approximation of the native hash plan that Nx actually hashes with (`RISK-GUARD-HASH-PLAN`).

The re-check of 3e710b1 found cases it gets wrong:

- **Losses that pass (stale hits):** a self input written as `{ "input": <name>, "dependencies": false }`, and a dependency's `default` defined anew while `^default` reads it. Both need a second plugin contributing these particular forms to a crate's own project.
- **False refusals:** negated patterns that the native plan does not apply, such as one under `{workspaceRoot}` or one for the dependencies. The offered fixes get past them.
- **Absent inputs:** for a target without `inputs`, the native plan differs from the guard's reading.

These are filed as nxr-2vzmt5: compare the native planner's plans, or else close the cases one by one. This text-only pass corrected `DES-TARGET-DEFAULT-GUARD`, `EVD-NX-24-PLUGIN-NODES` and the targets guide, and added the risk. No code changed.
