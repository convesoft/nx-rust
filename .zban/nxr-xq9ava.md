---
title: Hash external dependencies per crate
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-pn1hwr
  - nxr-fy4t4k
created_at: 2026-11-12T18:20:01Z
---

Goal: a lockfile change invalidates only the crates whose resolved dependencies it changes, and `nx affected` still selects them.

Implements `REQ-EXTERNAL-DEPS` through `DES-LOCKFILE-HASHING` (`nx-rust/docs/workspaces.mara.md`), with the `lockfile` rows of `DES-TARGETS` and `DES-WORKSPACE-TARGETS`, the exception in `REQ-NO-RUST-TASK-DEPS` and the crate-file exclusion of `REQ-INPUT-FILES` and `DES-INPUTS`. Checked by `VER-CACHE-KEYS`, `VER-TARGETS` and `VER-SETUP`. `EVD-NX-24-LOCKFILE-TASK` and `EVD-CARGO-LOCKFILE` record the experiments the design rests on.

- [ ] The `lockfile` target on every workspace project, and on the root crate's project where the root manifest is a package: cached, an executor without a batch implementation, no cargo
- [ ] The digest per member from `Cargo.lock`, walked through path packages; one output folder per workspace under `.nx/workspace-data/nx-rust/lockfile/`, none inside another
- [ ] The `Cargo.lock` input of the `lockfile` task as a fileset that includes git-ignored files
- [ ] Every cached crate target depends on its workspace's `lockfile` task and reads its digest through `dependentTasksOutputFiles`, in place of the whole-lockfile input
- [ ] The crate at a workspace root, standalone crates included, leaves its workspace's `Cargo.lock` out of its crate files
- [ ] A workspace without `Cargo.lock` runs its crates' targets uncached; a lockfile that cannot be parsed fails the `lockfile` task with a message naming the file
- [ ] Matrix rows of `VER-CACHE-KEYS` for the lockfile, and its end-to-end `nx affected` checks
- [ ] The `lockfile` checks of `VER-TARGETS` and `VER-SETUP`

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
