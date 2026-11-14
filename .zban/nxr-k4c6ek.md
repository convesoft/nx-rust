---
title: Fail publishing early for crates that depend on a crate that is not published
status: todo
type: feature
parent: nxr-6q2chq
blocked_by:
  - nxr-m8evx2
  - nxr-k64tm5
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:48:50Z
---

Goal: the plugin never publishes a cargo-hakari hack crate, and a crate that depends with a version requirement on a crate of the repository that is not published to the registry (`publish = false`, or a `publish` list without that registry) fails before cargo runs, with guidance.

Implements the check _Unpublished dependencies_ of Checks before each call and the Hack crate paragraph of `DES-RELEASE` (`nx-rust/docs/release.mara.md`), and the Publishing point of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`). Checked by group 8 of `VER-RELEASE`. Needs the publish target and executor (nxr-m8evx2), which runs the checks before each call, and the detection of a cargo-hakari configuration that the `hakari` strategy of milestone 0.2 brings (nxr-k64tm5), for the hack crate's own message. On 14 November 2026 the control plane widened the check from the hack crate to every such dependency (nxr-672xft); `EVD-CARGO-PUBLISH` shows why: cargo packages the dependency for the registry whatever its `publish` says.

- [ ] Settle with evidence what cargo-hakari writes beyond `.config/hakari.toml` and its `hakari-package`, which `EVD-HAKARI-UNIFICATION` records from a run: the forms of the members' dependency on the hack crate in each dep-format version, and whether the generated crate sets `publish = false` (`EVD-CARGO-PUBLISH` holds only a reading of cargo-hakari 0.9.39 for these). Run cargo-hakari in a throwaway workspace, record the result as evidence and in the "Settled during implementation" list of `DES-RELEASE`
- [ ] The hack crate gets no `nx-release-publish`
- [ ] The check _Unpublished dependencies_ before each call, with and without a batch: such a crate and the crates of the call that depend on it are left out, with the message that names the crate and the dependency; for a hack crate with `publish = false`, the message also gives cargo-hakari's two ways
- [ ] With a hack crate that does not set `publish = false`, as a published stub, its dependents publish

Done when: group 8 of `VER-RELEASE` passes, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
