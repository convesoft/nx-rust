---
title: Find out which fileInputs patterns Nx matches against the files of other projects
status: todo
type: bug
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-agyqmz
created_at: 2026-11-13T22:17:22Z
---

Goal: a `fileInputs` pattern that names files of other Nx projects covers them in the key, or `DES-INPUTS` and the user guide say which patterns do not.

Observed while writing the tests of nxr-agyqmz, with the `nx` 24.0.6 package of this repository and `HashPlanInspector.inspectTaskInputs` on a copy of the `declared-files` fixture (the check of `DES-BUILD-INPUT-CHECK` compares with the same matching). Each pattern was the only `fileInputs` entry of `rust/crates/api/Cargo.toml`:

- `../app/src/main.rs` and `../app/**` matched `rust/crates/app/src/main.rs`, a file of the project `app`.
- `../*/**`, `../*/**/*`, `../*/src/**`, `../*/src/main.rs` and `../a*/src/main.rs` matched no file of `app` or `other`; `rust/crates/api` files and member manifests appeared only through other inputs.
- In `undeclared-files`, `../**` from `rust/crates/reader` (`{workspaceRoot}/rust/crates/**`) matched no source file of the other member crates either.
- `../../../*/banner.txt` matched `docs/banner.txt`, a file of no project.

So a declared fileset whose fixed part does not lie in a project's folder seems to reach only files of no project. A user who declares `../*/**` to cover sibling crates gets a key that misses them, and the build check then fails the build (correctly, since the key misses the files).

- [ ] Find in the Nx 24 source how an `includeIgnored` fileset under `{workspaceRoot}` is matched against project files, and confirm with an experiment
- [ ] Record what was found as evidence in Mara (`EVD-NX-24-FILE-INPUTS` or a new item) and decide with the user whether `declaredFiles` should rewrite such patterns, warn, or only document the limit
- [ ] Update `DES-INPUTS` and the "Files outside the crate" guidance in `caching.mara.md` accordingly

Done when: the decision is in Mara, implemented if it changes behaviour, and `pnpm nx run-many -t build lint test` passes.
