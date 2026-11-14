---
title: Check what cargo-hakari unifies between workspace crates
status: done
type: task
tags:
  - spike
parent: nxr-9y4eh8
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-14T15:08:35Z
---

Goal: confirm or refute the assumption in `RISK-HAKARI-GAPS` (`nx-rust/docs/decisions.mara.md`). The `hakari` strategy of `DES-UNIFICATION` rests on it.

- [x] A small workspace where one member enables a feature of another member, with cargo-hakari set up
- [x] Build two different subsets of members and compare what is recompiled
- [x] Whether the `cargo metadata` report is enough to detect such features
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [x] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

Experiments with cargo 1.100.0 (the central case also with 1.91.0) and cargo-hakari 0.9.39, recorded as `EVD-HAKARI-UNIFICATION` (accepted, supports `RISK-HAKARI-GAPS`). With a current workspace-hack crate, the features of third-party crates were the same in every selection for normal, build and dev-dependencies, but not for the following, and `cargo hakari verify` passed in each case: a member's features enabled by another member (binary `a` printed `c[fa]` after `-p a` and `c[cdef,fa,fb]` after `-p a -p b`); features asked for only in a `cfg(unix)` table while `platforms` was empty, which is what `cargo hakari init` writes; and a crate outside the workspace that depends on a member through normal or build dependencies (one that reaches a member only through a dev-dependency is unified, as the review found and a rerun confirmed). The `--no-deps` report shows every request from one member to another but not those from crates outside the workspace. The drift check needs `generate --diff` and `manage-deps --dry-run`, because `verify` passes with a member that does not depend on the hack crate, and all three need the full package graph.

Knowledge changed: `RISK-HAKARI-GAPS` rewritten with likelihood `likely` and consequence `major`; the closing sentence of `DES-UNIFICATION` and the definition `TERM-HACK-CRATE` now say what the hack crate leaves out. The design itself is unchanged: nxr-f92hxm asks the maintainer to decide the `hakari` design points, and nxr-ms8zzk the keys under `workspace-build` and `cargo` for features that crates outside a crate's dependencies enable. nxr-k64tm5 and nxr-8f9dz2 now wait on them.

Checks run: `pnpm nx format:write`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete, no diagnostics) and `zban check`. No test suite ran: the change touches knowledge only.
