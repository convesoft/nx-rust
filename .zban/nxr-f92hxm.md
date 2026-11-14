---
title: Decide how the hakari strategy handles the features that cargo-hakari leaves to the selection
status: todo
type: task
tags:
  - spec
parent: nxr-9y4eh8
discovered_from: nxr-sqyv4b
created_at: 2026-11-14T15:07:40Z
---

Goal: the `hakari` strategy of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`) covers what `EVD-HAKARI-UNIFICATION` (`nx-rust/docs/decisions.mara.md`) found, so that `RISK-HAKARI-GAPS` is mitigated before nxr-k64tm5 implements the strategy. Design changes are the maintainer's decision.

Context: the spike nxr-sqyv4b confirmed that cargo-hakari never unifies the features of members, which the design's fallback to `workspace-build` covers, and found points that the design does not cover yet:

- **Platform-specific dependencies.** A feature that only a `[target.'cfg(…)'.dependencies]` table asks for is unified only on the platforms that `platforms` in `.config/hakari.toml` lists; `cargo hakari init` leaves the list empty, and `verify` and `generate --diff` then pass. How should the plugin know that the hack crate covers the platforms it builds for (the host and any `targetTriple`), and what does it do when it does not?
- **Features set from outside the workspace.** A crate outside the workspace that depends on a member through normal or build dependencies asks features of it, and its own features follow the selection (a structural exclude); one that reaches a member only through a dev-dependency goes into the hack crate like any third-party crate. The `--no-deps` report that the plugin reads (`ADR-METADATA-NO-DEPS`) does not show either; the full report does, at the cost `EVD-CARGO-NO-DEPS` describes. Detect it, accept it as a limit, or something else?
- **What counts as "one member enables a feature of another".** Besides a `features` list: `default-features = false` on a member that has default features, `dep/feature` and `dep?/feature` strings in a member's `[features]`, renamed and optional dependencies, inherited `workspace = true` entries, `target` tables and dev-dependencies, all of which the `--no-deps` report shows.
- **How often the fallback applies.** Both workspaces with cargo-hakari that the spike examined (guppy, nextest) have such requests between members, so the `hakari` strategy would build the whole workspace there. Is that acceptable, or should member features be handled another way?
- **The drift check.** `verify` misses a member without the dependency on the hack crate; `generate --diff` and `manage-deps --dry-run` catch the stale cases the spike tried. All three need the full package graph, so they fail offline in a cold Cargo home. Under `hakari` a crate's key leaves out the other members' manifests ("Member manifests" in `DES-INPUTS`), so with a stale hack crate the key stays while the result depends on the batch: say which inputs the check has, and how it keeps crate tasks of the same run from storing results when it fails.
- **"Member manifests" in `DES-INPUTS`.** Its reason for leaving the input out under `hakari` holds only for the features the hack crate covers.

- [ ] Agree each point with the maintainer
- [ ] Record the decisions in Mara: `DES-UNIFICATION`, `DES-INPUTS`, `VER-BATCHING`, and the likelihood and consequence of `RISK-HAKARI-GAPS`
- [ ] Bring nxr-k64tm5's task list in line with them
- [ ] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided each point, the decisions are in Mara, and `mara project validate` reports `valid: true`.
