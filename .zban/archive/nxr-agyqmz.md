---
title: Fail a build that read a repository file outside its inputs
status: done
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-d371vy
  - nxr-kmdpgj
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T12:05:38Z
closed_at: 2026-11-13T22:41:38Z
---

Goal: after every successful cargo call, fresh or not, a `build` task compares the dependency files of the cargo targets it built with its inputs and fails when one names an uncovered repository file.

Implements `REQ-BUILD-INPUT-CHECK` through `DES-BUILD-INPUT-CHECK` (`nx-rust/docs/caching.mara.md`) and the task-time row in `DES-DIAGNOSTICS`. Evidence on the `.d` files: `EVD-CARGO-DEP-INFO`. Checked by `VER-BUILD-INPUT-CHECK`, apart from its batch paragraph, which needs the batch executor (nxr-s12cpg) and has its own issue.

- [x] Name the records as point 1 of `DES-BUILD-INPUT-CHECK` gives them, skipping those of point 2, and read them as point 3 describes
- [x] Resolve and filter the recorded paths as points 4 and 5 say, links, case and directories included
- [x] Compare them with Nx's matching of the task's inputs and fail the task as points 6 and 7 say
- [x] The cases of `VER-BUILD-INPUT-CHECK` apart from its batch paragraph, in an end-to-end fixture

Done when: `VER-BUILD-INPUT-CHECK` passes without its batch paragraph, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

- Graph creation gives each crate's `build` target `metadata.cargo.records`: the artifact and build directories as the system reaches them, the library's name and whether it is a proc macro, the binaries with their required features, the crate's features, and the record names that another crate with the same artifact directory shares (`nx-rust/src/graph/build-records.ts`).
- After a successful cargo call of `build`, the executor names the records from that metadata and the task's features, profile and triple (`nx-rust/src/executors/build-records.ts`), then reads and resolves their paths, enumerates recorded folders from Nx's own file list, and compares them with the files that Nx's `HashPlanInspector` gives for the task (`input-check.ts`, `nx-task-files.ts`). Where a record names a path relative to `build.dep-info-basedir`, the folder comes from the record's own artifact path, or else from Cargo's configuration (`nx-rust/src/cargo/dep-info-basedir.ts`). The lockfile digest post-check and this check run in one step after cargo (`checksAfterCargo` in `task.ts`), digests first, and a failed task prints both messages.
- New fixture `undeclared-files` and `nx-rust/test/build-input-check.spec.ts`, with every case of `VER-BUILD-INPUT-CHECK` but the batch paragraph and the macOS case. `build` refuses the profiles `test` and `bench` before cargo runs (`DES-OUTPUTS`), so for them the spec checks the names against what a real `cargo build --profile test|bench` writes. The spec also builds every other fixture through Nx (`name-collision` with one crate renamed) and checks that the check fails none of them.
- The status note of `caching.mara.md` no longer says that the check is missing.
- Checks run: `pnpm nx run-many -t build lint test` (passed), `pnpm nx format:check --all` (passed), `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), `mara schema validate` and `mara project validate` (`valid: true`, evaluation complete), `zban check` (no problems), and the new spec once with `CI=true GITHUB_ACTIONS=true` and the agent variables removed (29 passed).
- Found on the way: Nx 24.0.6 does not match a `fileInputs` fileset whose fixed part lies above other projects' folders, such as `../*/**`, against those projects' files (nxr-1by7h4).
