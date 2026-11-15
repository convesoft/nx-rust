---
title: Update Cargo.lock after nx release version
status: done
type: feature
parent: nxr-6q2chq
blocked_by:
  - nxr-1ckcy8
  - nxr-52c1bx
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:48:27Z
closed_at: 2026-11-14T21:36:13Z
---

Goal: after `nx release version`, each changed Cargo workspace's `Cargo.lock` is current and part of Nx's release commit.

Implements the Lockfile paragraph of `DES-RELEASE` (`nx-rust/docs/release.mara.md`). Checked by group 4 of `VER-RELEASE`. Needs the version actions module (nxr-1ckcy8), which records the workspaces whose manifests it changed, and the harness registry (nxr-52c1bx) for the cases with a newer registry version and with the registry stopped.

- [x] `afterAllProjectsVersioned` in the version actions module runs `cargo update --workspace` in the root folder of each workspace whose manifests the run changed, online and never with `--locked`, also in locked mode
- [x] It returns the lockfiles that cargo changed and that git does not ignore, paths as Nx expects them, and runs nothing in a dry run
- [x] A cargo failure fails the release with a message that names the workspace and carries cargo's message

Done when: group 4 of `VER-RELEASE` passes on cargo 1.91 and the latest stable, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

- `afterAllProjectsVersioned` in `nx-rust/src/release/version-actions.ts` runs `cargo update --workspace` in each workspace whose lockfile the run makes stale, with the command's environment, never `--locked` or `--offline`; returns the changed lockfiles that git does not ignore; runs nothing in a dry run; on a cargo failure goes on, then fails naming each workspace with cargo's message, the files written and lockfiles updated, and how to go back (`git checkout --`) or on.
- Workspaces: those whose manifests or Cargo configuration files the run changed, and those whose lockfile locks a bumped crate by path at its old version (a correction that cargo forced: such a workspace keeps its manifests while `--locked` refuses its lockfile; `EVD-CARGO-LOCKFILE-UPDATE`, new). A workspace without a `Cargo.lock` gets none, pending nxr-4717pj. The lockfiles are checked before any write (inside the repository through links, writable).
- `DES-RELEASE` (Lockfile, Writes), `REQ-RELEASE`, `RISK-NX-RELEASE`, `VER-RELEASE` (group 4, intro), `DES-DIAGNOSTICS` and the release page (status note) updated.
- Tests: `nx-rust/test/release-lockfile.spec.ts` (group 4, against a `SparseRegistry` per case, every command with its variables); the versioning spec and the end-to-end release test run the step offline with an empty Cargo home. Ten mutations: nine failed the intended test; returning an ignored lockfile changes nothing, because Nx's `gitAdd` leaves it out itself.
- Checks on the head after merging the local `main` at 235ef48 (and before that at c281c10, with the same results): `pnpm nx run-many -t build lint test` (44 suites, 1395 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` on cargo 1.100.0 and 1.91.0 through a private `RUSTUP_HOME` (27 passed each), the release specs on 1.91.0 (174 passed), `mara schema validate`, `mara project validate` (valid, complete, no errors or warnings), `zban check`.

## Summary of Changes (review of 2c7008e)

- Symbolic links: the version actions read and write each file inside the repository in Nx's tree at its real path (`treePath`), list that path in `manifestsToUpdate` and the recovery message, and the lockfile step returns each changed lockfile at its real path. With the reviewed code, Nx committed the unchanged link paths and left out the linked manifest, configuration file and lockfile, and oxfmt reformatted the linked manifest (`EVD-NX-24-VERSION-ACTIONS`).
- Only absence is absence: a lockfile of any workspace that cannot be read or is no valid TOML stops the run before any write, naming it; a manifest or configuration file that exists but cannot be read is reported with the reason (Nx's tree reads it as missing, so it is read from disk again); a Cargo configuration file that cannot be read is no longer called "no valid TOML". A `.cargo` folder that may not be searched still counts as absent, as for cargo 1.100.0 and 1.91.0 (`EVD-CARGO-LOCKFILE-UPDATE`).
- Recovery commands: `git checkout --` (only files git tracks; untracked ones named to take back by hand; `--literal-pathspecs` for pattern characters) and `(cd <folder> && cargo update --workspace)` per failed workspace, each on its own line, quoted with `shellWord` from `cargo-invocation.ts`.
- Decisions recorded in `DES-RELEASE` (control plane's, maintainer told): path-locked workspaces count as stale; no lockfile is created where none exists (nxr-4717pj, closed).
- Tests: a linked lockfile, an unreadable and an invalid lockfile, a failure in `tools space` with a linked manifest and an untracked lockfile whose printed commands run through `sh`, a linked manifest and config file under oxfmt, unit tests of `treePath` and the read failures with Nx's `FsTree`. Eleven mutations each failed the intended test.
- Checks on the final tree, with the local `main` at 185ebc8 merged (run by the control plane): `pnpm nx run-many -t build lint test` (45 suites, 1435 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` on cargo 1.100.0 and 1.91.0 (27 passed each), the three release specs on 1.91.0 (186 passed), `mara schema validate`, `mara project validate` (valid, evaluation complete, no diagnostics), `zban check`.
