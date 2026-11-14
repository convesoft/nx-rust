---
title: Add the nx-release-publish target and its batched executor
status: todo
type: feature
parent: nxr-6q2chq
blocked_by:
  - nxr-5fp9d3
  - nxr-s12cpg
  - nxr-52c1bx
  - nxr-n6z9x6
created_at: 2026-11-12T18:20:01Z
---

Goal: `nx release publish` publishes the crates of each Cargo workspace with one `cargo publish` call, and its dry run checks the whole set.

Implements the paragraphs Publish target, Batch, the check _Dependencies published first_ of Checks before each call, Dry run, Existing versions, Tracked files, Credentials and tree, Options and Without a batch of `DES-RELEASE` (`nx-rust/docs/release.mara.md`), with `ADR-BATCHED-PUBLISH` (`nx-rust/docs/decisions.mara.md`) and the row and sentences of `DES-TARGETS` and `DES-PLUGIN-OPTIONS` that name `nx-release-publish`. Checked by groups 6 and 7 of `VER-RELEASE`. Rests on the batch executor of milestone 0.2 (nxr-s12cpg), on the harness registry (nxr-52c1bx) and on the lockfile step (nxr-n6z9x6), because group 6 starts with a version run that brings `Cargo.lock` up to date.

Until 14 November 2026 this issue bundled the whole release implementation and planned that `targetNames` renames the publish target. The specification (nxr-5fp9d3) split the work into nxr-1ckcy8 (version actions), nxr-n6z9x6 (lockfile), this issue and the hack-crate guard, and fixed the name: Nx release runs the target only as `nx-release-publish`, so `targetNames` does not apply to it and rejects it as a key (`DES-PLUGIN-OPTIONS`, "Target names").

- [ ] Check the assumption of `RISK-NX-RELEASE` that Nx hands the `nx-release-publish` tasks of one release group to one batch, through real Nx 24, and record it in evidence and the risk
- [ ] The target `nx-release-publish` on every crate without `publish = false` (the `crate-shapes` fixture has such a crate), not cached, with no `dependsOn`; `targetNames` with the key `nx-release-publish` fails graph creation with the message of `DES-PLUGIN-OPTIONS`
- [ ] The executor `@convesoft/nx-rust:release-publish` with a batch implementation and `preferBatch: true`: one `cargo publish --locked` per workspace with a `-p` per crate, workspaces with a dependency's workspace first, one result per task from cargo's output, a result for every task received and no throw (`EVD-NX-24-BATCHES`), `--dry-run` passed through
- [ ] The registry lookup of `DES-RELEASE`: `cargo info <name>@<version> --registry <registry> --locked` in the workspace root, never `--offline`, exit 0 found, exit 101 with "could not find" missing, anything else a failure with cargo's message (`EVD-CARGO-PUBLISH`); settle with evidence how the executor learns the name of the registry that cargo publishes a call to (the "Settled during implementation" list) and record it in `DES-RELEASE`
- [ ] The check _Dependencies published first_ before each call, with and without a batch, across workspaces and release groups: crates left out with the crates of the call that depend on them, and the message that names the dependency, its version and the crate that needs it
- [ ] Existing versions left out with a message, through the same lookup
- [ ] The dry run's limit: a crate whose dependency another call would publish is not handed to cargo, and its task succeeds with the "not verified" message naming the dependency, its version and `<project>:nx-release-publish`
- [ ] `--locked` on every `cargo publish` and `cargo info`, whatever the `locked` option says; a stale lockfile fails with cargo's message and the line that points to `nx release version`
- [ ] The options of `DES-RELEASE`: `dryRun`, `registry` failing before cargo runs, `firstRelease` and `nxReleaseVersionData` accepted; `tag`, `access` and `otp` ignored with a line; no token and no `--allow-dirty`, and the line about committing the new versions after cargo's refusal of uncommitted changes
- [ ] Outside a batch, as with `NX_BATCH_MODE=false`, a task runs the same checks and publishes its own crate
- [ ] `init` adds the empty `targetDefaults` entry keyed by `@convesoft/nx-rust:release-publish`, as `DES-GENERATORS` asks for each executor of `DES-TARGETS`; bring "three empty entries" and the examples in `setup.mara.md` and `targets.mara.md`, and `VER-SETUP`, up to date

Done when: groups 6 and 7 of `VER-RELEASE` pass on cargo 1.91 and the latest stable, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
