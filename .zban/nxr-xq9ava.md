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

Goal: a lockfile change invalidates only the crates whose resolved dependencies it changes, `nx affected` still selects them, and no result is stored or restored under a key from a lockfile that cargo would still change.

Implements `REQ-EXTERNAL-DEPS` through `DES-LOCKFILE-HASHING` (`nx-rust/docs/workspaces.mara.md`), with:
- the `lockfile` rows of `DES-TARGETS` and `DES-WORKSPACE-TARGETS`;
- the exception in `REQ-NO-RUST-TASK-DEPS`;
- the lockfile rows of `DES-INPUTS`, the crate-file exclusion of `REQ-INPUT-FILES`, and the lockfile call of `DES-INVOCATION`;
- the two lockfile rows of `DES-DIAGNOSTICS`.

Checked by `VER-CACHE-KEYS`, `VER-TARGETS` and `VER-SETUP`. `EVD-CARGO-LOCK-CHECK` and `EVD-NX-24-LOCKFILE-UPDATE` record what cargo and Nx do.

- [ ] The `lockfile` target on every workspace project, and on the root crate's project where the root manifest is a package: not cached; an executor without a batch implementation; `cargo update --workspace` in the workspace root, with `--locked` in locked mode; failing with cargo's message when cargo fails
- [ ] Its inputs for `nx affected`: `Cargo.lock` with `includeIgnored`, the root manifest, and the manifests of the members and of path packages in the repository, named from the repository root; the workspace files
- [ ] After cargo, the digest per member from `Cargo.lock`: the reachable graph through every listed dependency and path package, following `replace = …`, without `[[patch.unused]]`, serialised as `DES-LOCKFILE-HASHING` says (one tab-joined line per entry with its sorted dependency strings); one output folder per workspace under `.nx/workspace-data/nx-rust/lockfile/`
- [ ] The `preTasksExecution` hook sets `NX_RUST_RUN_ID` to a new value when the command excludes task dependencies and to the empty string otherwise; an `env` input for it on every cached crate target with a digest input
- [ ] Every cached crate target other than `fmt-check` depends on its workspace's `lockfile` task and reads its digest through `dependentTasksOutputFiles`; `doc` reads all digests; no cached target that runs cargo has `Cargo.lock` as a file input
- [ ] The crate at a workspace root, standalone crates included, leaves its workspace's `Cargo.lock` out of its crate files
- [ ] The post-check after the cargo call of a cached task, in the step of `DES-BUILD-INPUT-CHECK`: the crate's digest computed again, failing the task when it differs from its digest file
- [ ] The rows of `VER-CACHE-KEYS` for the lockfile (sibling requirement, feature, `[replace]`, the registry case, an edge change between current lockfiles) and its end-to-end checks, with `--exclude-task-dependencies` among them
- [ ] The `lockfile` checks of `VER-TARGETS` and `VER-SETUP`

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
