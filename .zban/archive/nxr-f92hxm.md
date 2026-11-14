---
title: Decide how the hakari strategy handles the features that cargo-hakari leaves to the selection
status: done
type: task
tags:
  - spec
parent: nxr-9y4eh8
discovered_from: nxr-sqyv4b
created_at: 2026-11-14T15:07:40Z
closed_at: 2026-11-14T16:07:49Z
---

Goal: the `hakari` strategy of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`) covers what `EVD-HAKARI-UNIFICATION` (`nx-rust/docs/decisions.mara.md`) found, so that `RISK-HAKARI-GAPS` is mitigated before nxr-k64tm5 implements the strategy. Design changes are the maintainer's decision.

Context: the spike nxr-sqyv4b confirmed that cargo-hakari never unifies the features of members, which the design's fallback to `workspace-build` covers, and found points that the design does not cover yet:

- **Platform-specific dependencies.** A feature that only a `[target.'cfg(…)'.dependencies]` table asks for is unified only on the platforms that `platforms` in `.config/hakari.toml` lists; `cargo hakari init` leaves the list empty, and `verify` and `generate --diff` then pass. How should the plugin know that the hack crate covers the platforms it builds for (the host and any `targetTriple`), and what does it do when it does not?
- **Features set from outside the workspace.** A crate outside the workspace that depends on a member through normal or build dependencies asks features of it, and its own features follow the selection (a structural exclude); one that reaches a member only through a dev-dependency goes into the hack crate like any third-party crate. The `--no-deps` report that the plugin reads (`ADR-METADATA-NO-DEPS`) does not show either; the full report does, at the cost `EVD-CARGO-NO-DEPS` describes. Detect it, accept it as a limit, or something else?
- **What counts as "one member enables a feature of another".** Besides a `features` list: `default-features = false` on a member that has default features, `dep/feature` and `dep?/feature` strings in a member's `[features]`, renamed and optional dependencies, inherited `workspace = true` entries, `target` tables and dev-dependencies, all of which the `--no-deps` report shows.
- **How often the fallback applies.** Both workspaces with cargo-hakari that the spike examined (guppy, nextest) have such requests between members, so the `hakari` strategy would build the whole workspace there. Is that acceptable, or should member features be handled another way?
- **The drift check.** `verify` misses a member without the dependency on the hack crate; `generate --diff` and `manage-deps --dry-run` catch the stale cases the spike tried. All three need the full package graph, so they fail offline in a cold Cargo home. Under `hakari` a crate's key leaves out the other members' manifests ("Member manifests" in `DES-INPUTS`), so with a stale hack crate the key stays while the result depends on the batch: say which inputs the check has, and how it keeps crate tasks of the same run from storing results when it fails.
- **"Member manifests" in `DES-INPUTS`.** Its reason for leaving the input out under `hakari` holds only for the features the hack crate covers.

- [x] Agree each point with the maintainer
- [x] Record the decisions in Mara: `DES-UNIFICATION`, `DES-INPUTS`, `VER-BATCHING`, and the likelihood and consequence of `RISK-HAKARI-GAPS`
- [x] Bring nxr-k64tm5's task list in line with them
- [x] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided each point, the decisions are in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

The maintainer decided on 14 November 2026, choosing the option "Keep it in 0.2 with full detection": the plugin uses the hack crate only when it can show that it is safe, and otherwise falls back to `workspace-build` with a message that says why. The option not taken was moving the strategy out of 0.2. The four checks put to him are the design. The control plane decided the following within his answer: the first three checks are made at graph creation and decide the strategy for the whole workspace; the fallback warning names the check and the first crate or setting and is a keyed project warning; the third check uses only what the plugin knows and falls back where it cannot tell; the drift check is an uncached task that follows the lockfile task's pattern and runs `generate --diff` and `manage-deps --dry-run`; and the hack crate's manifest and `.config/hakari.toml` are inputs under `hakari`. All of this is recorded as the design.

- `DES-UNIFICATION` (`execution.mara.md`) states which configuration counts, the three graph-time checks and exactly which shapes fall back for crates outside the workspace (a redirection to a member, a crate without a report). It also covers the fallback and its keyed warning, which files the choice depends on and how Nx learns of a change with and without the daemon, the triple check when a task starts, the `hakari-check` drift task and what the keys hold. It now `mitigates` `RISK-HAKARI-GAPS`. The guidance of the page has a table of the checks.
- Settled here as part of the same matter: a triple that only a task names (command line, dotenv, `project.json`) fails the task before cargo runs where `platforms` lacks it, because a fallback is impossible once the key was computed under `hakari`. `featureUnification = "hakari"` without a configuration falls back with the warning, and an explicit `workspace-build` is not checked and draws no warning. `hakari-check` runs through the lockfile executor so that `init`'s empty `targetDefaults` entry covers it. These are reported to the control plane for confirmation.
- `DES-INPUTS`: "Member manifests" now gives the corrected reason, and the "Hack crate" row is new. `REQ-NO-RUST-TASK-DEPS`, `DES-TARGETS`, `DES-WORKSPACE-TARGETS`, `DES-OUTPUTS`, `DES-PROJECT-GRAPH` (cycles), `DES-LOCKFILE-HASHING` and `DES-DIAGNOSTICS` (a fallback warning, a stale hack crate, an unlisted triple, a missing dependency on `hakari-check`) are brought in line, as is the guidance of the caching, targets, workspaces and configuration pages.
- `RISK-HAKARI-GAPS` now describes what remains: flags that act on the selected crates only, exclusions in cargo-hakari's configuration, changes that the daemon's graph does not see, and misses of cargo-hakari's own checks. It is rated possible and major.
- `EVD-HAKARI-UNIFICATION` gains two points: a rerun that shows `--all-features` and `--no-default-features` act on the selected crates only, and what the sources of cargo-hakari 0.9.39 and hakari 0.18.0 say about the configuration file, the excludes and the missing `--locked` flag.
- `VER-BATCHING` has cases for each check failing, for all checks passing (the spike's central experiment), for a stale hack crate and for an unlisted triple.
- nxr-k64tm5's task list matches the design.

Filed: nxr-ytwfkc (all-features and no-default-features under `hakari`), nxr-zz6n2h (a non-host triple under `workspace-build`) and nxr-t9f8wa (exclusions in cargo-hakari's configuration), all needing a decision.

Checks: `pnpm nx format:write`, `pnpm nx format:check --all` passed; `mara schema validate` passed; `mara project validate` reported `valid: true` with complete evaluation, 0 errors and 0 warnings; `zban check` reported nothing. This is specification only, so no test run.

Later in the same branch, the control plane's decisions recorded under nxr-ytwfkc, nxr-zz6n2h and nxr-t9f8wa changed two points of this summary. A task whose triple or host `platforms` does not list now runs one crate per cargo command instead of failing. `RISK-HAKARI-GAPS` is rated unlikely and major, after a fourth graph-time check of the configuration's settings and groups of one crate for feature flags.

The maintainer refined his answer on check 2 on 14 November 2026, choosing "Keep `hakari`; that triple runs per crate (Recommended)" over the whole workspace falling back. A non-host triple that `platforms` does not list, known at graph creation, keeps the workspace on `hakari`; its tasks run one cargo command per crate, and a warning names the triple. Check 2 still requires the host's triple, and without it the workspace falls back. The independent review of the branch also extended check 1 to `default-features = false` on a member with `default = []` and to a member's dev-dependency on itself with features.
