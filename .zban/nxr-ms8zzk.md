---
title: Decide which keys cover features that crates outside a crate's dependencies set in a whole-workspace build
status: todo
type: task
tags:
  - spec
parent: nxr-9y4eh8
discovered_from: nxr-sqyv4b
created_at: 2026-11-14T15:07:49Z
---

Goal: under the `workspace-build` and `cargo` strategies of `DES-UNIFICATION`, a crate's key changes whenever what cargo compiles for it can change (`GOAL-TRUSTED-CACHE`), or the gap is accepted as a limit. Decided before nxr-8f9dz2 builds whole workspaces. This is a design decision for the maintainer.

Context: `EVD-HAKARI-UNIFICATION` (bullet "The whole workspace without a hack crate", `nx-rust/docs/decisions.mara.md`) shows two changes that made `cargo build --workspace` compile a member `a` again with other features of a shared dependency, while `a`'s lockfile digest (`DES-LOCKFILE-HASHING`) and every member manifest stayed the same:

- a lockfile-only change of a package that only another member reaches (`cargo update -p g`, a git crate that asks for another feature of `smallvec` in its new commit);
- a change to the manifest of a path crate outside the workspace that only another member depends on, which asks a feature of a member.

The inputs of `DES-INPUTS` ("External dependencies", "Member manifests", "Path dependencies") hold neither for `a`, and `VER-CACHE-KEYS` asks that keys do not change after a locked version bump outside the crate's resolved dependencies, nor after a change in a crate that is not a dependency, apart from a member's manifest. So Nx would restore a result built with other features. Milestone 0.1 runs `cargo … -p <crate>` for each task, whose features follow from the crate's own dependencies, so today's keys are not affected; `doc` already builds with `--workspace` and hashes all members' digests. The `cargo` strategy (`resolver.feature-unification = "workspace"`) unifies over the same set by its definition; that was not run.

- [ ] Agree with the maintainer what the keys of the two strategies hold for this, such as every member's digest and the folders of path crates outside the workspace that any member reaches, or record the limit as an accepted risk
- [ ] Record it in Mara: `DES-INPUTS`, `VER-CACHE-KEYS`, and a risk if it is accepted
- [ ] Bring nxr-8f9dz2 and nxr-k64tm5 in line where they set those inputs
- [ ] `pnpm nx format:write`, then `mara schema validate` and `mara project validate` report `valid: true`

Done when: the maintainer has decided, the decision is in Mara, and `mara project validate` reports `valid: true`.
