---
title: Decide how the hakari strategy keeps member features independent of the batch under all-features and no-default-features
status: done
type: task
tags:
  - spec
parent: nxr-9y4eh8
related:
  - nxr-k64tm5
  - nxr-zz6n2h
discovered_from: nxr-f92hxm
created_at: 2026-11-14T16:03:19Z
closed_at: 2026-11-14T16:33:21Z
---

Goal: under the `hakari` strategy of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`), a crate's result does not depend on its batch when its group passes `--all-features` or `--no-default-features` (`REQ-STABLE-FEATURES`). This is a design decision for the maintainer.

Context: the bullet "Flags that act on the selected crates" of `EVD-HAKARI-UNIFICATION` (`nx-rust/docs/decisions.mara.md`) shows that cargo applies these flags to the selected crates only. A member that is built only as a dependency of another selected crate gets the features that its dependents ask for, so it, and the crate that links it, are compiled with other features when it is selected as well. The first check of `DES-UNIFICATION` reads what the manifests ask, not what a group's flags give, so a workspace that passes every check still has this gap. `DES-FEATURE-SETS` offers the all-features configuration for every workspace, and `noDefaultFeatures` is a target option. `RISK-HAKARI-GAPS` lists the gap. `--features crate/feature` was stable in the same run. The same gap applies wherever a group builds only its selected crates, such as a non-host triple (nxr-zz6n2h).

Options to weigh, none decided: also select the members that the group's crates depend on, which then runs their tests too unless they are filtered (nxr-ypa0aw decides that filtering for `workspace-build`); split a group so that no crate of a cargo call depends on another of the same call; build the whole workspace for such groups, which would need other inputs for one Nx configuration than for another, which Nx inputs cannot express; fail such groups; or accept the gap as a limit.

- [x] Agree with the maintainer how such groups are built and keyed
- [x] Record it in Mara: `DES-UNIFICATION`, `DES-FEATURE-SETS` where it applies, `VER-BATCHING`, and the rating of `RISK-HAKARI-GAPS`
- [x] Bring nxr-k64tm5 in line
- [x] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided, the decision is in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

Decided by the control plane on 14 November 2026 under `GOAL-TRUSTED-CACHE` and `REQ-STABLE-FEATURES`, and recorded as such; the maintainer is told. The decision costs speed only, never a result. A group never passes a flag whose effect on a crate depends on which other crates the same cargo command selects; where its command would, each task forms a group of one crate, as in milestone 0.1 and as plain `cargo test -p a --all-features` does.

- Experiments on cargo 1.100.0 and 1.91.0 (`EVD-HAKARI-UNIFICATION`, "Flags that act on the selected crates") found that cargo applies `--all-features`, `--no-default-features` and unqualified names in `--features` to the selected crates only. It accepts `crate/feature` only where a selected crate is that crate or depends on it directly, so it too depends on the selection. Under `resolver.feature-unification = "workspace"` (the `cargo` strategy), `--all-features` and `--no-default-features` act on every member, while `--features` is still checked against the selected crates.
- A hakari workspace built with cargo-hakari 0.9.39, in "One command per crate", showed that per-crate commands with `--all-features` give `b` the same hash, linking `a` with its default features, whether `a`'s command ran first or not. Both orders compile the same crates, and running again compiles nothing. The batched command gives `b` another hash.
- `DES-BATCH` ("Groups of one crate") and `TERM-GROUP` state the rule. Under `hakari` it applies to every feature set but the default; under `cargo` to `--features`; and to triples without whole-workspace resolution. `DES-UNIFICATION` ("Feature flags") and `DES-FEATURE-SETS` follow, the guidance of `execution.mara.md` says these configurations do not batch, `VER-BATCHING` has the "Feature flags" case, and the gap has left `RISK-HAKARI-GAPS`.
- nxr-k64tm5 carries the groups of one crate.

Checks: `pnpm nx format:write`, `pnpm nx format:check --all` passed; `mara schema validate` passed; `mara project validate` reported `valid: true` with complete evaluation, 0 errors and 0 warnings; `zban check` reported nothing. This is specification only, so no test run.
