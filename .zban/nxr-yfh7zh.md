---
title: Keep a later build of a batch from replacing on disk the files that a task outside the batch reads from an earlier build
status: todo
type: bug
priority: high
parent: nxr-e2z8sz
blocked_by:
  - nxr-k63csj
related:
  - nxr-fpc72j
  - nxr-5rrkay
discovered_from: nxr-k63csj
created_at: 2026-11-20T13:58:25Z
---

Goal: a cached task that depends on a crate's `build` and reads its executable never stores a result made from another build's executable (`GOAL-TRUSTED-CACHE`).

Context: found by the review of nxr-k63csj at commit f008376, in behaviour that is older than that change. Where two whole-workspace `build` groups of one workspace root are in one batch, the second is left for a following batch (`DES-BATCH`, "Files that a batch stores" and "Tasks left for a following batch"; `EVD-NX-24-BATCHES`, "Tasks left out"). Nx stores the first group's files before the second runs, so both cache entries are right. But the second build links the first group's executables again with its own environment (`EVD-CARGO-ARTIFACT-WRITERS`), and a task outside the batch that depends on the first build starts only after both, and reads the second build's file.

Reproduction of the reviewer, with the real Nx 24.0.6 and cargo: two binary crates `pa` and `pb` in one workspace; `pa` prints `plain`, or `flag` when the `RUSTFLAGS` of `pb`'s `.env` apply. A cached target `pack:pack` depends only on `pa:build`, has `pa` as an implicit project dependency and the inputs `["default", "^default"]`, and writes `dist/pa.txt` by running `rust/target/debug/pa`. `nx run-many -t build pack -p pa pb pack --parallel=3` stores `flag` for `pack`. After deleting `dist`, `nx run pack:pack` restores a `pa` that prints `plain` beside a `dist/pa.txt` that says `flag`; with `--skip-nx-cache` it writes `plain`. nxr-fpc72j describes the same replacement with batching off, and the decision that chose leaving tasks out is line 15 of nxr-5rrkay.

- [ ] Reproduce it in a test through the real Nx batch runner in a disposable workspace under `$TMPDIR`
- [ ] Settle the remedy in Mara before the code, and say what each option costs `REQ-STABLE-FEATURES`, JS tasks and build time. Options seen so far: the build of a later group selects only its own crates where its options or environment differ from an earlier group's; the batch puts the earlier group's stored files back after a later group replaced them; the batch fails such tasks with guidance instead of leaving them out (the "Undo" of nxr-5rrkay, line 15, with a row in `DES-DIAGNOSTICS`)
- [ ] Implement it, with the check in `VER-BATCHING`
- [ ] Say in the summary what the remedy means for nxr-fpc72j, and update that issue's body
- [ ] Say whether the remedy also settles nxr-f04xen (a build left for a following batch keeps its early hash), and whether that early hash can give a wrong hit; update that issue's body

Done when: the reproduction stores the right file for the outside task, Mara validation passes, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.
