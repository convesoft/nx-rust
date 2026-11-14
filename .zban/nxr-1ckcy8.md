---
title: Implement the Cargo version actions for Nx release
status: todo
type: feature
parent: nxr-6q2chq
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:48:19Z
---

Goal: `nx release version` versions crates in their `Cargo.toml`, bumps their real dependents and rewrites every requirement on a bumped crate.

Implements the paragraphs Registration, Current version, Inherited versions, Dependents and Requirements of `DES-RELEASE` (`nx-rust/docs/release.mara.md`), with `ADR-RELEASE-DEPENDENTS` (`nx-rust/docs/decisions.mara.md`). Checked by groups 1, 2, 3 and 5 of `VER-RELEASE`.

- [ ] First, with a prototype of the version actions run through real Nx 24, check the assumptions of `RISK-NX-RELEASE` that concern versioning: Nx takes a `release.version.versionActions` that `createNodes` gives a project; `readDependencies` is its only source of dependents and of the order of release groups; a throw while versions are worked out leaves every file on disk unchanged; `afterAllProjectsVersioned` runs after the writes and before the commit. Record the result as an evidence item (`EVD-`), and update `RISK-NX-RELEASE`, `EVD-NX-24-RELEASE` and `DES-RELEASE` where it differs
- [ ] Settle how a manifest is edited so that only version strings change (the plugin's `smol-toml` keeps no layout when it writes; the "Settled during implementation" list of `DES-RELEASE`), with a test on manifests with comments and unusual layout, and record the choice in `DES-RELEASE`
- [ ] The version actions module, set as `release.version.versionActions` on each crate's project and on no workspace project of a root manifest without `[package]`; a crate found through its project's `metadata.cargo`
- [ ] The current version from the manifest, following `[workspace.package]`; no registry; a crate without `version` fails with its manifest named
- [ ] The check that crates inheriting one version are in one fixed group and versioned together, before anything is written
- [ ] `readDependencies` from the workspace's `cargo metadata --no-deps` report, by path, only normal and build dependencies with a version requirement. The report gives `req: "*"` both for a dependency without `version` and for `version = "*"` (`EVD-CARGO-PUBLISH`), so read the manifest to tell them apart
- [ ] Requirement rewriting in every manifest of the repository's Cargo workspaces, `[workspace.dependencies]` included, with the rules of `DES-RELEASE`: a comparison or wildcard requirement that the new version still satisfies is kept, also with `preserveMatchingDependencyRanges: false`, with an output line naming the manifest and the requirement; `excludeManifestsFromFormatting`

Done when: groups 1, 2, 3 and 5 of `VER-RELEASE` pass on cargo 1.91 and the latest stable, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
