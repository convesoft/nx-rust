---
title: Fail publishing early for crates that depend on a crate that is not published
status: done
type: feature
parent: nxr-6q2chq
blocked_by:
  - nxr-m8evx2
  - nxr-k64tm5
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:48:50Z
closed_at: 2026-11-16T18:52:58Z
---

Goal: the plugin never publishes a cargo-hakari hack crate, and a crate that depends with a version requirement on a crate of the repository that is not published to the registry that its entry points to (`publish = false`, or a `publish` list without that registry) fails before cargo uploads anything, with guidance.

Implements the check _Unpublished dependencies_ of Checks before each call and the Hack crate paragraph of `DES-RELEASE` (`nx-rust/docs/release.mara.md`), and the Publishing point of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`). Checked by group 8 of `VER-RELEASE`. Needs the publish target and executor (nxr-m8evx2), which runs the checks before each call, and the detection of a cargo-hakari configuration that the `hakari` strategy of milestone 0.2 brings (nxr-k64tm5), for the hack crate's own message. On 14 November 2026 the control plane widened the check from the hack crate to every such dependency (nxr-672xft); `EVD-CARGO-PUBLISH` shows why: cargo packages the dependency for the registry whatever its `publish` says.

- [x] Settle with evidence what cargo-hakari writes beyond `.config/hakari.toml` and its `hakari-package`, which `EVD-HAKARI-UNIFICATION` records from a run: the forms of the members' dependency on the hack crate in each dep-format version, and whether the generated crate sets `publish = false` (`EVD-CARGO-PUBLISH` holds only a reading of cargo-hakari 0.9.39 for these). Run cargo-hakari in a throwaway workspace, record the result as evidence and in the "Settled during implementation" list of `DES-RELEASE`
- [x] The hack crate gets no `nx-release-publish`
- [x] The check _Unpublished dependencies_ before each call, with and without a batch, against the registry that the dependency's entry points to (Where a dependency points in `DES-RELEASE`, which nxr-m8evx2 implements): such a crate and the crates of the call that depend on it are left out, with the message that names the crate and the dependency and gives the remedies of `DES-RELEASE`, the `registry` key among them; for a hack crate with `publish = false`, the message also gives cargo-hakari's two ways
- [x] With a hack crate that does not set `publish = false`, as a published stub, its dependents publish

Done when: group 8 of `VER-RELEASE` passes, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

A run of cargo-hakari 0.9.39 in a throwaway workspace (offline, own Cargo home) settled what it writes (`EVD-HAKARI-PUBLISHING`): `init` gives the hack crate `publish = false`, which `generate` keeps; `manage-deps` writes `{ path = … }` under dep-format 1 and `{ version = "0.1", path = … }` under 2 to 4, in each member's own `[dependencies]`, without a `registry` key. `hackCrateName` in `nx-rust/src/graph/unification.ts` recognises the hack crate from the configuration whatever the strategy; `inferTargets` gives it no `nx-release-publish`. The publish executor (`nx-rust/src/release/publish.ts`) runs the check _Unpublished dependencies_ before each call, with and without a batch and in a dry run (`unpublishedMessage`): a crate whose normal or build dependency with a version requirement is not published to the registry its entry points to fails before cargo, and the crates of its call that depend on it are left out; the message names both crates and gives the remedies, the `registry` key where the dependency has a `publish` list, and cargo-hakari's two ways for a hack crate. Where a stub hack crate's version is not in the registry, the message of _Dependencies published first_ says to publish the stub once outside Nx. `DES-RELEASE` (Unpublished dependencies, Hack crate, Settled during implementation), `VER-RELEASE` group 8, `EVD-CARGO-PUBLISH` and the release guide, whose status note now says releasing is implemented, are updated. Backlog: nxr-2mjeq7 (guidance under dep-format 1).

Tests: `release-unpublished.spec.ts` (group 8: `publish = false` with an unrelated crate of that name in the registry, with a batch, without one and in dry runs, a dependent of the same call left out; a `publish` list without the registry; the hack crate with `publish = false`; the stub before and after it is in the registry; the files that the real cargo-hakari writes, skipped without the tool) and a case in `hakari-graph.spec.ts` (no target for the hack crate without `publish = false`, under `workspace-build` and with `.guppy/hakari.toml`).

Checks on the final head: `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` with cargo-hakari 0.9.39 through `NX_RUST_TEST_CARGO_HAKARI`, 59 suites, 1831 passed, 1 todo; `release-unpublished.spec.ts` without the tool 4 passed, 1 skipped; `NX_DAEMON=false pnpm nx e2e nx-rust-e2e --skip-nx-cache` 27 of 27 on Cargo 1.100.0 and 27 of 27 on 1.91.0 through a private `RUSTUP_HOME`; the release, publish-output and hakari-graph specs on 1.91.0, 9 suites, 279 passed; `pnpm nx format:check --all`; `mara schema validate`; `mara project validate` (valid, evaluation complete); `zban check`.

Rejected: recognising the hack crate only under the `hakari` strategy (publishing does not depend on the strategy); giving the `registry` key remedy for `publish = false`, which no registry allows.
