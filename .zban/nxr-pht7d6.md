---
title: Run the lockfile task's checks per task in a batch
status: todo
type: task
parent: nxr-9y4eh8
blocked_by:
  - nxr-s12cpg
discovered_from: nxr-xq9ava
created_at: 2026-11-13T19:32:54Z
---

Goal: a cached task that runs in a batch is checked against its workspace's lockfile digests as a single task is, so that a batch stores no result under a key that does not describe the `Cargo.lock` cargo used.

`DES-LOCKFILE-HASHING` ("Post-check") puts the check after the cargo call of the task's group, and `DES-BATCH` runs one call per group. nxr-xq9ava implemented the checks for the executor's single-task path only, because the cargo executor has no batch implementation yet:

- before cargo runs, `keyHoldsDigests` in `nx-rust/src/executors/task.ts` fails a task whose task graph holds no dependency on its workspace's lockfile task in a run that does not exclude task dependencies (`NX_RUST_RUN_ID` empty);
- after the call, `checkDigests` in `nx-rust/src/executors/digests.ts` computes each digest that the target's `metadata.cargo.digests` names again and fails the task when it differs from its digest file.

- [ ] In the batch implementation, run the first check for each task of a batch before its group's call, failing only that task
- [ ] Run `checkDigests` for each task of a group right after the group's call, beside the check of `DES-BUILD-INPUT-CHECK` where that exists; a mismatch fails only the tasks whose digests changed
- [ ] Cover both in the batch cases of `VER-CACHE-KEYS` (the post-check row) with a real batch

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
