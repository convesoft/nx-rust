---
title: Decide which keys cover features that crates outside a crate's dependencies set in a whole-workspace build
status: done
type: task
tags:
  - spec
parent: nxr-9y4eh8
discovered_from: nxr-sqyv4b
created_at: 2026-11-14T15:07:49Z
closed_at: 2026-11-14T16:08:00Z
---

Goal: under the `workspace-build` and `cargo` strategies of `DES-UNIFICATION`, a crate's key changes whenever what cargo compiles for it can change (`GOAL-TRUSTED-CACHE`), or the gap is accepted as a limit. Decided before nxr-8f9dz2 builds whole workspaces. This is a design decision for the maintainer.

Context: `EVD-HAKARI-UNIFICATION` (bullet "The whole workspace without a hack crate", `nx-rust/docs/decisions.mara.md`) shows two changes that made `cargo build --workspace` compile a member `a` again with other features of a shared dependency, while `a`'s lockfile digest (`DES-LOCKFILE-HASHING`) and every member manifest stayed the same:

- a lockfile-only change of a package that only another member reaches (`cargo update -p g`, a git crate that asks for another feature of `smallvec` in its new commit);
- a change to the manifest of a path crate outside the workspace that only another member depends on, which asks a feature of a member.

The inputs of `DES-INPUTS` ("External dependencies", "Member manifests", "Path dependencies") hold neither for `a`, and `VER-CACHE-KEYS` asks that keys do not change after a locked version bump outside the crate's resolved dependencies, nor after a change in a crate that is not a dependency, apart from a member's manifest. So Nx would restore a result built with other features. Milestone 0.1 runs `cargo … -p <crate>` for each task, whose features follow from the crate's own dependencies, so today's keys are not affected; `doc` already builds with `--workspace` and hashes all members' digests. The `cargo` strategy (`resolver.feature-unification = "workspace"`) unifies over the same set by its definition; that was not run.

- [x] Agree with the maintainer what the keys of the two strategies hold for this, such as every member's digest and the folders of path crates outside the workspace that any member reaches, or record the limit as an accepted risk
- [x] Record it in Mara: `DES-INPUTS`, `VER-CACHE-KEYS`, and a risk if it is accepted
- [x] Bring nxr-8f9dz2 and nxr-k64tm5 in line where they set those inputs
- [x] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided, the decision is in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

Decided by the control plane on 14 November 2026 under `GOAL-TRUSTED-CACHE`, and recorded as such; the maintainer is told. Running more than a key promises is allowed and running less is not, so the gap is not accepted as a limit and no risk is added. Under `workspace-build` and `cargo`, a crate's key covers what can change the features that cargo compiles it with: the digests of all members, and the folders of the path crates outside the workspace that any member reaches (with the root manifest of their workspace), beside every member's manifest. Under `hakari`, with every check of nxr-f92hxm passing, the keys stay per crate, with the hack crate's manifest and `.config/hakari.toml` added.

- `DES-INPUTS` (`caching.mara.md`) has the decision in a new paragraph, "Whole-workspace builds", with its cost. The "External dependencies" row gives all members' digests under these strategies and the crate's own digest under `hakari`, and the new row "Crates outside the workspace" also covers the redirected crates that any member may use: they can switch on a member's or a shared dependency's features as well. That inclusion was settled here as part of the same matter.
- `REQ-EXTERNAL-DEPS`, `DES-LOCKFILE-HASHING` (crate targets, `nx affected`), `ADR-LOCKFILE-TASK` and the guidance of the caching, workspaces, targets and execution pages say that a lockfile change reruns every crate of the workspace under these strategies. The status note of `caching.mara.md` says what milestone 0.1's keys hold.
- `VER-CACHE-KEYS`: the rows for a locked bump outside the crate's resolved dependencies, a redirected crate for a member without registry or git dependencies, and the end-to-end lockfile case now hold under `hakari`, and for standalone crates under every strategy. The row for a change in a crate that is not a dependency now excludes path crates outside the workspace under the whole-workspace strategies. New rows say that keys differ for another member's package, for a path crate outside the workspace that only another member reaches, and under `hakari` for the hack crate's manifest and `.config/hakari.toml`.
- nxr-8f9dz2 and nxr-k64tm5 carry the matching tasks, including moving the existing cache-key tests whose rows changed.

Checks: `pnpm nx format:write`, `pnpm nx format:check --all` passed; `mara schema validate` passed; `mara project validate` reported `valid: true` with complete evaluation, 0 errors and 0 warnings; `zban check` reported nothing. This is specification only, so no test run.
