---
title: Specify the option reference
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T12:13:50Z
---

Goal: turn the draft item `DES-PLUGIN-OPTIONS` (`nx-rust/docs/configuration.mara.md`) into accepted knowledge. The option names in it are proposals, apart from `testRunner` and `affectedTests`.

- [x] Answer the open questions in the item with the user: final option names, including the proposed `artifacts` and `locked`, and which options a crate may set. Settled on 2026-11-12: tags add up, and `targetNames` covers every inferred target. Answered on 2026-11-13: the twelve questions of the decision brief, each with the recommended option
- [x] Name the three target options that `DES-TARGET-COMMANDS` and `DES-WORKSPACE-TARGETS` describe without a name: `allTargets` (on by default for `check` and `lint`), `noDeps` (on by default for `doc`) and `bin` (the binary `run` starts), agreed with nxr-kq5pm5
- [x] Record the experiments behind the answers as accepted evidence items
- [x] Add the graph-creation errors of the answers to `DES-DIAGNOSTICS` as rows
- [x] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [x] Add or extend the verification that the Mara policies then require
- [x] Bring the user guidance at the top of the page in line with the items
- [x] Update the task lists of nxr-xyq7c8, nxr-fy4t4k, nxr-tabkjx and nxr-kmdpgj

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

- `DES-PLUGIN-OPTIONS` is accepted, without an `Open:` paragraph. It has the settings of milestone 0.1 with the places each can be set and its default, the nine target options (`features`, `allFeatures`, `noDefaultFeatures`, `profile`, `targetTriple`, `allTargets`, `noDeps`, `bin`, `affectedTests`), the three environment variables, precedence (with where Nx's `targetDefaults` and a project's own files sit, from `EVD-NX-TARGET-DEFAULTS`), the merge of `targets.<name>` by Nx's rule with `"..."` and two errors, `implicitDependencies`, added inputs and unknown keys. Later features add their rows.
- Accepted items changed as agreed: `DES-METADATA-TABLES` (rows and the add-up sentence, which names tags, `implicitDependencies`, `envInputs` and `runtimeInputs`), the precedence sentence of `REQ-METADATA-OVERRIDES`, `DES-INPUTS` (added inputs go into the crate's named input), `DES-PROJECT-GRAPH` (prefix and `name`), `DES-TEST-RUN` (opt-out), `DES-FEATURE-SETS` (`targetTriple`), `DES-INVOCATION` (one sentence on locked mode and the uncached check), the option names in `DES-TARGET-COMMANDS` and `DES-WORKSPACE-TARGETS`, five error rows in `DES-DIAGNOSTICS`, and the five matching cases in the list of `init` failures in `VER-SETUP`, as the authors of #9 and #12 did for theirs.
- New evidence: `EVD-NX-24-OPTION-SEMANTICS`, `EVD-CARGO-NX-TABLES`, `EVD-CARGO-LOCKED-CHECK`, and after the review `EVD-NEXTEST-CARGO-FLAGS` and `EVD-NX-24-ENTRY-CONTEXT`.
- Verification extended: `VER-CONFIGURATION`, `VER-CACHE-KEYS`, `VER-TESTING`.
- Guidance: `configuration.mara.md` (status note, overview, changing an inferred target, prefix, options of targets, all settings), `caching.mara.md`, `ci.mara.md`, `testing.mara.md`, `artifacts.mara.md`, `workspaces.mara.md`, and as a consequence of the names `targets.mara.md` and one sentence in `execution.mara.md`.
- Settled as following from the answers: `implicitDependencies` add up across the tables like tags, because "additions only" excludes a lower level removing what a higher one added; a setting placed at a level the reference does not give it counts as an unknown key; unknown keys of the `project` sub-table fail like those of the workspace table; `features`, `allFeatures`, `noDefaultFeatures`, `profile` and `targetTriple` are options of the targets whose cargo command takes the flag, and `targetTriple` is none of `test`'s.
- Settled on 2026-11-13 by the orchestrator from answer 6 ("for additions only"): any `implicitDependencies` entry starting with `!` fails graph creation, whatever it names.
- Left out because their pull requests have not merged: `fileInputs` (nxr-qv2cq5, #15), `args` of `run` (#12), the workspace target `lockfile` (nxr-pn1hwr), and `REQ-UNKNOWN-METADATA-OPTIONS` and `DES-UNKNOWN-OPTIONS` (#12). Whichever of this change and #15 merges second adds `fileInputs` to the add-up sentence.
- nxr-a2zwp9, filed for the `VER-SETUP` list, was deleted again: the list is updated here instead.
- Review of #16 at 29a2782, six defects, each reproduced before the fix:
  - Excluded files (the maintainer's decision): a negated pattern in the repository's own configuration removes files from a target's key on the repository's responsibility. `REQ-INPUT-FILES`, `ADR-DECLARED-INPUTS` and `DES-INPUTS` each gained one sentence, `DES-PLUGIN-OPTIONS` and the guidance state the cost, and `VER-CACHE-KEYS` has the case.
  - The prefix applies to a root manifest's own crate unless it sets `name`; only a workspace project of its own goes without it (`DES-PLUGIN-OPTIONS`, `DES-PROJECT-GRAPH`, guidance, `VER-CONFIGURATION`).
  - "A different executor" everywhere; a repeated inferred executor is accepted.
  - `profile` is passed as `--cargo-profile` to `cargo nextest run` and as `--profile` to `cargo test --doc`.
  - Entries that split a workspace and disagree on `testRunner`, `affectedTests` or `featureUnification` fail graph creation unless the workspace table sets it (the maintainer's decision); an entry without the option counts as giving its default. New row in `DES-DIAGNOSTICS`, cases in `VER-SETUP` and `VER-CONFIGURATION`; nxr-xyq7c8 and nxr-jb6g5y gained steps.
  - Nx's own flags qualified by command in `EVD-NX-24-OPTION-SEMANTICS`.
  - `VER-SETUP` also names an unknown key in the `project` sub-table.
- Checks: on the final commit, `pnpm nx format:write`; `mara schema validate` (valid); `mara project validate` (`valid: true`, evaluation complete, 0 errors, 0 warnings); `zban check` (no findings); `pnpm nx run-many -t build lint test` (passed); `pnpm nx format:check --all` (passed). The end-to-end suite was not run, because no code changed.
