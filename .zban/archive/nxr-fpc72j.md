---
title: Keep a whole-workspace build from rewriting another build's files while Nx stores them, with batching off
status: done
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-8f9dz2
created_at: 2026-11-16T14:47:51Z
closed_at: 2026-11-20T20:41:38Z
---

With batching off (`--batch=false` or `NX_BATCH_MODE=false`, which `DES-BATCH` offers for a task that waits for a signal), Nx runs `build` tasks of one Cargo workspace at the same time, up to `--parallel` (3 by default), and stores each one some milliseconds after its process ends (`EVD-CARGO-ARTIFACT-WRITERS`, "When Nx stores"). Under `workspace-build`, a task run on its own still builds the whole workspace (`DES-BATCH`), and cargo links every member's executables again, fresh units included (`EVD-CARGO-ARTIFACT-WRITERS`). So a whole-workspace `build` that takes the build lock just after another task's cargo ended can replace that task's executable, with another feature set or environment, before Nx has copied it: for example a crate whose table sets `allFeatures = true` (a group of one crate since nxr-8f9dz2) beside another binary crate, or a crate whose `.env` sets `RUSTFLAGS`. Found while fixing the batch case of the same rule (`DES-BATCH`, "Files that a batch stores"), not reproduced.

- [x] Reproduce with `nx run-many -t build --batch=false` over two binary crates, one with its own feature set, in a loop, comparing each stored executable with its own command's.
- [x] If it reproduces, settle a remedy in Mara, for example `parallelism: false` on inferred `build` targets with batching off, or a task run on its own selecting only its crate where its options or environment differ, and weigh what each costs JS tasks and `REQ-STABLE-FEATURES`.
- [x] Add the check to `VER-BATCHING` and a test through the real Nx.
- [x] Remove the sentence that names this issue from `DES-BATCH` (the paragraph on a task that Nx runs on its own).

## Findings from nxr-yfh7zh (20 November 2026)

- The replacement also happens without any race, after Nx has stored the build: with batching off and `--parallel=1`, `nx run-many -t build pack -p pa pb pack --batch=false`, where a cached JS target `pack` depends on `pa:build` and `pb:build` and records what `rust/target/debug/pa` prints, stored `plain flag` for `pack`, because `pb`'s whole-workspace build (another environment through `pb`'s `.env`) linked `pa` again before `pack` ran. With `pack` depending only on `pa:build`, the result depended on the order Nx chose. (`EVD-BATCH-FILES-ON-DISK`, last row of its table.) A `test` links the executables again too, batched or not; that case is nxr-5hzxra.
- nxr-yfh7zh fixed this for batches only (`DES-BATCH`, "Files that a batch leaves on disk"): each group of `build`, `napi-build` and `wasm-build` keeps the declared outputs of the command's other `build` tasks under a hard link and puts them back after its commands. That is safe in a batch because Nx starts no other discrete task while a batch runs. A task run on its own (`runTask` in `nx-rust/src/executors/task.ts`) does not keep files: it cannot tell which builds of the command have ended, and with `--parallel` above 1 it could put an older file back over one that a `build` running beside it has just written, before Nx stores it. `DES-BATCH`'s paragraph on tasks run on their own now names both cases and this issue.
- Remedies to weigh here, beyond those above: keep only the files of builds that the task depends on, which have ended by construction (it does not help a task outside the plugin that depends on another build); or `parallelism: false` on inferred `build` with batching off, after which keeping the files of every other build would be safe as in a batch.
- [x] Settle the sequential case together with the race

Note from nxr-yfh7zh, phase 1 (20 November 2026): with staged builds (`ADR-STAGED-BUILDS`), a whole-workspace build run on its own writes no other crate's files at all, so neither the race nor the sequential case can occur for builds. A throwaway prototype stored `plain` in the sequential case (`EVD-STAGED-BUILDS`). nxr-yfh7zh's phase 2 closes this issue if a test shows it; a `test` run on its own stays a stated limit (`ADR-TEST-AFTER-BUILD`).

## Summary of Changes

Settled by nxr-yfh7zh. The sequential case reproduced (`pack` stored `plain flag` with `--batch=false --parallel=1`); the race was never reproduced. The remedy is the maintainer's staged builds (`ADR-STAGED-BUILDS`, `DES-BATCH` "Staged builds"), which apply to a task run on its own as in a batch: a whole-workspace `build`, and every `napi-build` and `wasm-build` compile, build in a stage and move only their own crates' files into the artifact directory. No build writes another task's executable at any moment, so neither the race nor the sequential case can occur, without `parallelism: false` and without changing which crates a build selects (`REQ-STABLE-FEATURES`). The sentence of `DES-BATCH` that named this issue now states the guarantee. A `test` run on its own stays a stated limit (`ADR-TEST-AFTER-BUILD`).

Checks: "leave pa's own file to a task that runs after pb's build, and store each build's own, with batching off and --parallel=1 / --parallel=3 (nxr-fpc72j)" in `nx-rust/test/batch-builds.spec.ts`, through the real Nx and cargo; `pack` stores `plain` and each build restores its own executable. `VER-BATCHING` ("Staged builds") names them.
