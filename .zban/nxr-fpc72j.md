---
title: Keep a whole-workspace build from rewriting another build's files while Nx stores them, with batching off
status: todo
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-8f9dz2
created_at: 2026-11-16T14:47:51Z
---

With batching off (`--batch=false` or `NX_BATCH_MODE=false`, which `DES-BATCH` offers for a task that waits for a signal), Nx runs `build` tasks of one Cargo workspace at the same time, up to `--parallel` (3 by default), and stores each one some milliseconds after its process ends (`EVD-CARGO-ARTIFACT-WRITERS`, "When Nx stores"). Under `workspace-build`, a task run on its own still builds the whole workspace (`DES-BATCH`), and cargo links every member's executables again, fresh units included (`EVD-CARGO-ARTIFACT-WRITERS`). So a whole-workspace `build` that takes the build lock just after another task's cargo ended can replace that task's executable, with another feature set or environment, before Nx has copied it: for example a crate whose table sets `allFeatures = true` (a group of one crate since nxr-8f9dz2) beside another binary crate, or a crate whose `.env` sets `RUSTFLAGS`. Found while fixing the batch case of the same rule (`DES-BATCH`, "Files that a batch stores"), not reproduced.

- [ ] Reproduce with `nx run-many -t build --batch=false` over two binary crates, one with its own feature set, in a loop, comparing each stored executable with its own command's.
- [ ] If it reproduces, settle a remedy in Mara, for example `parallelism: false` on inferred `build` targets with batching off, or a task run on its own selecting only its crate where its options or environment differ, and weigh what each costs JS tasks and `REQ-STABLE-FEATURES`.
- [ ] Add the check to `VER-BATCHING` and a test through the real Nx.
- [ ] Remove the sentence that names this issue from `DES-BATCH` (the paragraph on a task that Nx runs on its own).
