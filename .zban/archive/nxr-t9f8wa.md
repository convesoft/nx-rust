---
title: Decide whether the hakari strategy falls back where cargo-hakari's configuration excludes packages
status: done
type: task
tags:
  - spec
parent: nxr-9y4eh8
related:
  - nxr-k64tm5
discovered_from: nxr-f92hxm
created_at: 2026-11-14T16:03:35Z
closed_at: 2026-11-14T16:33:41Z
---

Goal: the `hakari` strategy of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`) relies on the hack crate only where cargo-hakari's configuration leaves nothing that a crate's features depend on to the selection. Whether to add a check is the maintainer's decision.

Context: cargo-hakari's configuration has `traversal-excludes` and `final-excludes`, which leave workspace members or third-party packages out of unification (the bullet "The configuration" of `EVD-HAKARI-UNIFICATION`, read in the sources of cargo-hakari 0.9.39 and hakari 0.18.0, not run). The features of an excluded third-party package, and those that only an excluded member asks for, would then follow the selection, and the drift check passes because the hack crate matches its configuration. The checks of `DES-UNIFICATION` do not read these settings; `RISK-HAKARI-GAPS` lists the gap. Graph creation reads the configuration for `platforms` anyway, so a check would cost no extra call. Whether `resolver` or `unify-target-host` values that differ from the workspace's also leave features to the selection is not known.

- [x] Find out, in a scratch workspace, what each of these settings leaves to the selection
- [x] Agree with the maintainer whether the strategy falls back for them, and with which message
- [x] Record it in Mara: `DES-UNIFICATION`, `DES-DIAGNOSTICS`, `VER-BATCHING`, an evidence item or `EVD-HAKARI-UNIFICATION`, and the rating of `RISK-HAKARI-GAPS`
- [x] Bring nxr-k64tm5 in line
- [x] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided, the decision is in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

Decided by the control plane on 14 November 2026 under `GOAL-TRUSTED-CACHE` and `REQ-STABLE-FEATURES`, and recorded as such; the maintainer is told. Unknown means fallback. It is a fourth check at graph creation in `DES-UNIFICATION`: the workspace falls back to `workspace-build` with the warning naming the setting, unless every key of cargo-hakari's configuration has a value that experiments with cargo-hakari itself showed to leave nothing to the selection.

- Experiments with cargo-hakari 0.9.39, built into a private scratch folder, are recorded in `EVD-HAKARI-UNIFICATION` ("Settings of the configuration"). A fixture with normal, build and dev-dependencies, a `cfg(unix)` table and a crate used on host and target was generated per setting and built in three selections, with and without `--target`.
  - **Leave features to the selection:** `traversal-excludes` and `final-excludes`, of a member and of a third-party crate, and `workspace-hack-line-style = "version-only"`. `generate --diff` and `verify` passed in each.
  - **Same in every selection:** `resolver` "1", "2" and "3", against workspace resolvers 1, 2 and 3; `unify-target-host` "none", "auto", "unify-if-both" and "replicate-target-on-host"; `dep-format-version` "1" to "4"; `exact-versions` and `output-single-feature`; and `workspace-hack-line-style` "full" and "workspace-dotted". `verify` failed with `unify-target-host = "none"` and `output-single-feature = true` although the features were the same.
- Accepted are those values, with `hakari-package` naming a member, `platforms`, and empty excludes and `registries`. Non-empty excludes, `version-only`, a non-empty `registries` (not tried) and every other key or value fall back.
- `DES-DIAGNOSTICS` names the setting in the fallback warning, `VER-BATCHING` has the cases, and the gap has left `RISK-HAKARI-GAPS`, which is now rated unlikely and major. nxr-k64tm5 carries the fourth check.

Checks: `pnpm nx format:write`, `pnpm nx format:check --all` passed; `mara schema validate` passed; `mara project validate` reported `valid: true` with complete evaluation, 0 errors and 0 warnings; `zban check` reported nothing. This is specification only, so no test run.
