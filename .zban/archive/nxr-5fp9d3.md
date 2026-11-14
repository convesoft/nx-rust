---
title: Specify the release flow
status: done
type: task
tags:
  - spec
parent: nxr-6q2chq
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-14T15:50:30Z
---

Goal: turn the draft items `REQ-RELEASE` and `DES-RELEASE` (`nx-rust/docs/release.mara.md`) into accepted knowledge. `DES-RELEASE` lists the points the design has to cover.

- [x] Read how `@monodon/rust` 3.0.0 implements Nx release `VersionActions` for `Cargo.toml`
- [x] Answer each point in `DES-RELEASE` with the user: version bumps, dependents, `Cargo.lock`, publish order, the hack-crate dependency
- [x] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [x] Add or extend the verification that the Mara policies then require
- [x] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

The research of 14 November 2026 (Nx 24.0.6 `nx release`, `@monodon/rust` 3.0.0, Cargo measured on 1.91.0 and 1.100.0) prepared the options; the maintainer answered the same day. Word for word, the options chosen:

- Publishing order (D1): "One `cargo publish` per workspace (Recommended)".
- Shared versions (D2): "Require one fixed release group (Recommended)".
- Dependents (D3, D3a, D3b; settles nxr-jhdr3x): "Bump real dependents; rewrite everywhere (Recommended)".
- The hack crate (D6): "Fail early with guidance (Recommended)".

Settled by the control plane, following the research's recommendations, because they are minor or follow from the measured facts: how requirements are rewritten (D4: a matching requirement kept while `preserveMatchingDependencyRanges` is on, any other rewritten with its operator kept, a compound or comparison requirement the new version leaves fails naming its manifest, only version strings change, manifests excluded from Nx's formatting); `Cargo.lock` (D5: `cargo update --workspace` per changed workspace, a cargo failure fails the release, nothing in a dry run); napi and wasm npm publishing stays out (D7, `ADR-V1-SCOPE`); the current version from the manifest, `git-tag` as Nx provides it, no `registry` resolver; no version actions on the workspace project; the target name `nx-release-publish` fixed, so `targetNames` does not apply to it; existing versions left out with a message; no token and no `--allow-dirty`. Settled here as wording or as the safe consequence: a dedicated executor `@convesoft/nx-rust:release-publish`; `--locked` never passed to the release's `cargo update`; only lockfiles that git does not ignore are returned for staging; a `registry` option fails the task before cargo runs until its mapping is decided (nxr-fwxn1r), because ignoring it would publish elsewhere.

What changed:

- `release.mara.md`: `REQ-RELEASE` and `DES-RELEASE` rewritten and accepted, `Open:` removed; the user guidance rewritten (status: specified, milestone 0.5, publishing rests on 0.2's batching). `DES-RELEASE` states its dependencies on milestone 0.2 (`ADR-BATCH-EXECUTOR`, the spike on `RISK-BATCH-BEHAVIOUR`, the hakari detection of `DES-UNIFICATION`), what a publish task does without a batch, and lists the points the implementation settles with evidence.
- `decisions.mara.md`: `ADR-BATCHED-PUBLISH` and `ADR-RELEASE-DEPENDENTS` with their rejected alternatives; `RISK-NX-RELEASE` (Nx read, not run) and `RISK-REGISTRY-BEHAVIOUR` (crates.io's own checks and delays); `EVD-CARGO-PUBLISH` and `EVD-NX-24-RELEASE`.
- `verification.mara.md`: `VER-RELEASE` (accepted, test), the eight groups of cases, against a local registry in the harness.
- Sentences the decisions touch: the Publishing point of `DES-UNIFICATION` and the hakari list in the guidance of `execution.mara.md`; `TERM-HACK-CRATE`; `DES-TARGETS` (row, the one name `targetNames` cannot change, existence, executor) and the targets table of the guidance; `DES-PLUGIN-OPTIONS` (`targetNames` row, the key `nx-release-publish`, `release` stays an unknown key because release configuration stays in `nx.json` and `project.json`) and the target-name guidance; `DES-PROJECT-GRAPH` (points to `ADR-RELEASE-DEPENDENTS`); `DES-OUTPUTS` and the caching guidance (the target's name). `DES-METADATA-TABLES` needed no sentence: the unknown-key rule lives in `DES-PLUGIN-OPTIONS`.

Measurements rerun for `EVD-CARGO-PUBLISH` with cargo 1.100.0 and 1.91.0, `RUSTUP_AUTO_INSTALL=0`, scratch workspaces and a private Cargo home against a read-only local sparse registry, nothing uploaded: the multi-crate `cargo publish --dry-run` succeeds for a dependent whose dependency's new version is not in the registry while `-p` of the dependent alone fails ("no matching package", or "failed to select a version" with an older version in the index), also with `--no-verify`; `cargo update --workspace` changes only the bumped members' version lines and keeps a registry pin although a newer version is in the index; after an inherited version is bumped without its requirements, `cargo metadata` and `cargo update --workspace` fail; the dependency fields of the `--no-deps` report. Correction to the research: `cargo metadata --no-deps` still succeeds in that state, so the project graph is still created while every resolving cargo command fails. Also measured: `registry.default` lets a test registry stand in for crates.io without `--registry`; cargo 1.89 rejects several `-p` on `cargo publish`.

What the research could not find out, and where it went: crates.io's own checks and delays, `RISK-REGISTRY-BEHAVIOUR`; Cargo 1.90, below the supported 1.91 and recorded as such in `EVD-CARGO-PUBLISH`; `nx release` with a prototype, `RISK-NX-RELEASE` and the first step of nxr-1ckcy8; cargo-hakari run, a step of nxr-k4c6ek; the TOML editing approach, a step of nxr-1ckcy8; `cargo info` as an existence check, a step of nxr-m8evx2; mapping Nx's `--registry`, nxr-fwxn1r.

Implementation filed under the 0.5 epic: nxr-1ckcy8 (version actions), nxr-n6z9x6 (lockfile; blocked by nxr-1ckcy8 and nxr-52c1bx), nxr-m8evx2 repurposed as the publish target and executor (blocked by nxr-s12cpg and nxr-52c1bx; its plan to rename the target through `targetNames` is dropped), nxr-k4c6ek (hack-crate guard; blocked by nxr-m8evx2 and nxr-k64tm5), nxr-52c1bx (local registry in the harness). Decisions for the maintainer: nxr-fwxn1r (`--registry` mapping), nxr-672xft (whether the early failure covers dependencies on other `publish = false` crates).

Checks: `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation, 0 errors and 0 warnings; `pnpm nx format:check --all` passes; `zban check` reports no problems. No tests: this is specification only.

After merging the local `main` at 3445ae7, whose spike nxr-sqyv4b ran cargo-hakari 0.9.39 (`EVD-HAKARI-UNIFICATION`): `DES-RELEASE` names the hack crate by `hakari-package` in `.config/hakari.toml`, its list of points settled during implementation keeps only the dependency forms and whether the generated crate sets `publish = false`, and nxr-k4c6ek is narrowed the same way. The `TERM-HACK-CRATE` conflict was resolved by keeping the spike's definition and adding this change's two sentences. The checks above were run again on the merged tree with the same results.

### Review of fbf23d4 (14 November 2026)

An independent review confirmed the four maintainer choices and the measured batch ordering, verification before upload, rejection of existing versions and partial-publish retry, and found six problems and one fold-in. The control plane decided each on 14 November 2026, the maintainer is told, and they are recorded as its decisions in the items:

1. A publish call could upload a dependent before its dependency's new version exists (cargo needs only a matching registry version). Now a check before each call, with and without a batch, across workspaces and release groups: every normal or build dependency with a version requirement on a crate of the repository that the call does not publish must have its version in the registry, or the crate's task fails before any upload and says which dependency to publish first. The lookup is `cargo info <name>@<version> --registry <registry> --locked` in the workspace root, never `--offline`. Calls of one batch run with a dependency's workspace first. `VER-RELEASE` group 7 has the reviewer's case.
2. A dry run cannot verify across cargo calls. A crate whose dependency another call would publish is not handed to cargo in a dry run; its task succeeds and says that it was not verified, naming the dependency, its version and the task that would publish it. A dependency can cross release groups, because the fixed-group rule binds only crates that share an inherited version. `VER-RELEASE` group 6 has both cases, and the guidance says what a dry run shows.
3. A dry run could rewrite a stale tracked `Cargo.lock`. Every `cargo publish` and `cargo info` now passes `--locked`, so publishing never changes a tracked file; a stale lockfile fails before any upload, pointing to `nx release version`. Group 6 checks manifests and lockfiles byte for byte after a dry run and a failed run.
4. The documented sequence left out the commit (`nx release version` defaults to no commit and no tag, with changes staged). The guidance shows `nx release` and `release.git` with commit and tag; a dirty tree fails with cargo's message and a line about committing; `VER-RELEASE` states the fixture's commit configuration.
5. A comparison or wildcard requirement that the new version still satisfies is kept, also with `preserveMatchingDependencyRanges: false`, and the output names it; group 3 has the case.
6. nxr-m8evx2 is now blocked by nxr-n6z9x6.
7. nxr-672xft folded in and closed: the early failure covers every dependency with a version requirement on a crate of the repository that is not published to the registry, not only the hack crate, which keeps its own guidance. nxr-k4c6ek carries the step.

Also from the review's notes: nxr-1ckcy8 now says that `req: "*"` stands for both an omitted version and `version = "*"`; `EVD-CARGO-PUBLISH` and `VER-RELEASE` group 4 no longer claim that only version lines change in `Cargo.lock`; dev-dependencies cause no bump by choice, while cargo keeps a versioned one in the packaged manifest.

Each cargo statement written was reproduced on cargo 1.100.0 and 1.91.0 against a local sparse registry with a publish endpoint, recorded as the second session of `EVD-CARGO-PUBLISH`; Nx's git defaults are added to `EVD-NX-24-RELEASE` from the installed package. The local `main` at ab99f3a (the batch spike, the harness's cargo wrapper, the batching rule) was merged, keeping both sides; `DES-RELEASE` now cites `EVD-NX-24-BATCHES`. Checks after the merge and the changes: `pnpm nx format:check --all` passes; `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation and no diagnostics; `zban check` reports no problems. No test suite ran: knowledge and issues only.
