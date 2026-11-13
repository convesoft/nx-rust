---
title: "Correct EVD-CARGO-NEW: cargo reads exclude entries as paths, not globs"
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-eg9s2w
created_at: 2026-11-13T14:23:20Z
---

Goal: the "Exclude" bullet of `EVD-CARGO-NEW` (`nx-rust/docs/decisions.mara.md`) shows what it claims, that an explicit member overrides `exclude`.

Context: that bullet's experiment used `exclude = ["vendor/*"]`. Cargo does not read `exclude` entries as globs, so that entry never excluded `vendor/v`, and the run does not show an explicit member overriding `exclude`. Observed with cargo 1.100.0 on Linux on 13 November 2026, while implementing the generators (nxr-eg9s2w), in a throwaway workspace with `members = ["crates/*"]` and `exclude = ["vendor/*", "legacy"]`:

- With `vendor/v` not in `members`, `cargo metadata --no-deps` in `vendor/v` failed with "current package believes it's in a workspace when it's not": the glob entry excluded nothing.
- `cargo new --vcs none --lib legacy/old` printed "Adding `old` as member of workspace" and appended `"legacy/old"` to `members`, leaving `exclude` as it was. `cargo metadata` in `legacy/old` then reported the workspace root, so the explicit member overrode the path entry `legacy`.
- With `"legacy/old"` removed from `members` again, `cargo metadata` in `legacy/old` reported `legacy/old` as its own workspace root: the path entry excludes the folder and every folder below it.

The generators match `exclude` entries as Cargo does, as paths relative to the workspace root (`nx-rust/src/generators/crate/enclosing-workspace.ts`). `DES-GENERATORS` stays correct. It speaks of "the pattern", which reads as a glob.

- [ ] Rewrite the "Exclude" bullet of `EVD-CARGO-NEW` with the observations above, or a new run that uses a path entry
- [ ] Decide with the user whether "the pattern" in `DES-GENERATORS` should say "the entry"

Done when: the bullet records a run that shows the override, and `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation.
