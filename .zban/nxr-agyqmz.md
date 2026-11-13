---
title: Fail a build that read a repository file outside its inputs
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-d371vy
  - nxr-kmdpgj
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T12:05:38Z
---

Goal: after every successful cargo call, fresh or not, a `build` task compares the dependency files of the cargo targets it built with its inputs and fails when one names an uncovered repository file.

Implements `REQ-BUILD-INPUT-CHECK` through `DES-BUILD-INPUT-CHECK` (`nx-rust/docs/caching.mara.md`) and the task-time row in `DES-DIAGNOSTICS`. Evidence on the `.d` files: `EVD-CARGO-DEP-INFO`. Checked by `VER-BUILD-INPUT-CHECK`, apart from its batch paragraph, which needs the batch executor (nxr-s12cpg) and has its own issue.

- [ ] Name the records that `cargo build -p <crate>` exports from the metadata report and the task's features, profile and triple, skipping those the design cannot name with certainty, and parse them, with escaped spaces and `build.dep-info-basedir`
- [ ] Resolve recorded paths (links, case) and compare them with Nx's matching of the task's inputs
- [ ] Leave out paths outside the repository and in the workspace's build or artifact directory
- [ ] Compare the rest with the task's file inputs, enumerating recorded directories with Cargo's directories and what Nx ignores pruned
- [ ] Fail the task with the files and the `fileInputs` line to add
- [ ] End-to-end fixture for the cases of `VER-BUILD-INPUT-CHECK`

Done when: `VER-BUILD-INPUT-CHECK` passes without its batch paragraph, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
