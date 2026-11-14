---
title: Implement the Cargo version actions for Nx release
status: done
type: feature
parent: nxr-6q2chq
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:48:19Z
closed_at: 2026-11-14T18:14:55Z
---

Goal: `nx release version` versions crates in their `Cargo.toml`, bumps their real dependents and rewrites every requirement on a bumped crate.

Implements the paragraphs Registration, Current version, Inherited versions, Dependents and Requirements of `DES-RELEASE` (`nx-rust/docs/release.mara.md`), with `ADR-RELEASE-DEPENDENTS` (`nx-rust/docs/decisions.mara.md`). Checked by groups 1, 2, 3 and 5 of `VER-RELEASE`.

- [x] First, with a prototype of the version actions run through real Nx 24, check the assumptions of `RISK-NX-RELEASE` that concern versioning: Nx takes a `release.version.versionActions` that `createNodes` gives a project; `readDependencies` is its only source of dependents and of the order of release groups; a throw while versions are worked out leaves every file on disk unchanged; `afterAllProjectsVersioned` runs after the writes and before the commit. Record the result as an evidence item (`EVD-`), and update `RISK-NX-RELEASE`, `EVD-NX-24-RELEASE` and `DES-RELEASE` where it differs
- [x] Settle how a manifest is edited so that only version strings change (the plugin's `smol-toml` keeps no layout when it writes; the "Settled during implementation" list of `DES-RELEASE`), with a test on manifests with comments and unusual layout, and record the choice in `DES-RELEASE`
- [x] The version actions module, set as `release.version.versionActions` on each crate's project and on no workspace project of a root manifest without `[package]`; a crate found through its project's `metadata.cargo`
- [x] The current version from the manifest, following `[workspace.package]`; no registry; a crate without `version` fails with its manifest named
- [x] The check that crates inheriting one version are in one fixed group and versioned together, before anything is written
- [x] `readDependencies` from the workspace's `cargo metadata --no-deps` report, by path, only normal and build dependencies with a version requirement. The report gives `req: "*"` both for a dependency without `version` and for `version = "*"` (`EVD-CARGO-PUBLISH`), so read the manifest to tell them apart
- [x] Requirement rewriting in every manifest of the repository's Cargo workspaces, `[workspace.dependencies]` included, with the rules of `DES-RELEASE`: a comparison or wildcard requirement that the new version still satisfies is kept, also with `preserveMatchingDependencyRanges: false`, with an output line naming the manifest and the requirement; `excludeManifestsFromFormatting`

Done when: groups 1, 2, 3 and 5 of `VER-RELEASE` pass on cargo 1.91 and the latest stable, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

- The version actions live in `nx-rust/src/release/` (`version-actions.ts`, `repository.ts`, `manifests.ts`, `requirements.ts`, `toml-edit.ts`); `createNodes` names them on each crate's project through `@convesoft/nx-rust/src/release/version-actions`, and none on the workspace project of a virtual manifest. `memberSpecs` shares the report request (`workspaceReport`) with them.
- The prototype through the installed Nx 24.0.6 is recorded as `EVD-NX-24-VERSION-ACTIONS`; `RISK-NX-RELEASE`, `EVD-NX-24-RELEASE`, `DES-RELEASE`, `VER-RELEASE` (git settings of its fixtures), `DES-DIAGNOSTICS` (four rows) and the release page are updated. Found: `nx release version` refuses a root `release.git`; Nx formats each changed manifest that no `manifestsToUpdate` lists; Nx replaces errors from reading a current version, so those checks run in `init`; Nx may call `updateProjectVersion` twice for a crate. Two bumps that Nx makes across release groups without `readDependencies` are recorded as known limits and filed for the maintainer's decision: nxr-5a9w1y.
- Manifests are edited by replacing only the version strings' characters at places that the plugin's own scanner finds, with a check through smol-toml that nothing else changed; no dependency was added. The choice is in `DES-RELEASE`, **Requirements**.
- Tests: `nx-rust/test/release-version.spec.ts` (groups 1, 2, 3 and 5 of `VER-RELEASE`, real `nx release version` and cargo in copies of the new fixture `release-crates`), `nx-rust/test/release-manifests.spec.ts` (scanner against every fixture manifest and unusual layouts, the requirement table) and one end-to-end test with the installed package. Seven mutations of the central behaviour each failed the intended test.
- Checks run: `pnpm nx run-many -t build lint test` (39 suites, 1295 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` on cargo 1.100.0 and again on cargo 1.91.0 through a private `RUSTUP_HOME` (27 passed each), the release test files on cargo 1.91.0 (136 passed then; 137 on 1.100.0 after a test was added), `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete, no errors or warnings) and `zban check`.
- Not part of this issue: the lockfile step (nxr-n6z9x6), the `Cargo.lock` row of the release page stays marked as not implemented.

## Summary of Changes after review

- Requirements now also cover root manifests' `[patch.<source>]` and the `[patch]` of Cargo configuration files (rewritten inside the repository, failing outside where a change is needed); a `[replace]` entry naming a bumped crate, a registry requirement that a `[patch]` redirects to it and the new version leaves, and a versioned profile spec naming it fail the run before any write (`EVD-CARGO-PATCH-AFTER-BUMP`, new). The redirected-requirement case went to the maintainer as nxr-6kmd0d.
- A reported dependency's manifest entries are found by kind, key and folder, not by the spelling of the target header; no entry fails the run.
- `EVD-NX-24-VERSION-ACTIONS` records the double write correctly (rerun with the plugin: also fixed-group crates are written twice) and the hooks used for nxr-5a9w1y.
- A writability check runs before any write; `REQ-RELEASE`, `DES-RELEASE` (**Writes**) and `RISK-NX-RELEASE` state the exact promise.
- nxr-5a9w1y implemented and closed in this branch.
- Checks on the merged tree: `pnpm nx run-many -t build lint test` (41 suites, 1364 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` on cargo 1.100.0 and 1.91.0 (27 passed each), the release specs on 1.91.0 (164 passed), `mara schema validate`, `mara project validate` (valid, complete, no errors or warnings), `zban check`. Ten new mutations each failed the intended test.

## Summary of Changes after the second review

- A file that the run would write and that a symbolic link, of its own or of a folder on its way, leads outside the repository fails the run before any write, naming the file and where it leads (`DES-RELEASE`, **Writes**, says what inside means).
- The redirected-requirement check recognises every `[patch.<source>]` key that cargo applies: `crates-io`, a registry's name (from `CARGO_REGISTRIES_<NAME>_INDEX`, the workspace's `[registries]`, or the dependency's entry), a `sparse+` index URL, a git URL; profile specs by `file://` URL count as by `path+file://` (`EVD-CARGO-PATCH-AFTER-BUMP`, second session). The graph's own `appliesTo` treats a registry name as not evaluable, which `DES-PROJECT-GRAPH` specifies, and keeps a possible-use edge; no edge is missed, so it is left as it is.
- Flaky test: not reproduced in 40 runs under load. Two causes of timing dependence were found and removed: two assertions expected Nx's separate stderr writes of one error contiguous in the harness's merged output, and the resolving `cargo metadata` of the tests waited for the machine's package cache lock, now avoided with an empty Cargo home per copy.
- The maintainer's answers are recorded in `DES-RELEASE`; nxr-6kmd0d closed.
- Checks on the final tree: `pnpm nx run-many -t build lint test` (41 suites, 1367 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e` on cargo 1.100.0 and 1.91.0 (27 passed each), the release specs on 1.91.0 (167 passed), `mara schema validate`, `mara project validate` (valid, complete, no errors or warnings), `zban check`; the release spec 20 times under load, all passed.
