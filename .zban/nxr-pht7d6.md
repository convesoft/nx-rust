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

`DES-LOCKFILE-HASHING` ("Post-check") puts the check after the last cargo call of the task's group, and `DES-BATCH` runs each call once for the whole group. nxr-xq9ava implemented the checks for the executor's single-task path only, because the cargo executor has no batch implementation yet:

- before cargo runs, `keyHoldsDigests` in `nx-rust/src/executors/task.ts` fails a task whose task graph holds no dependency on its workspace's lockfile task in a run that does not exclude task dependencies (`NX_RUST_RUN_ID` empty);
- after the call, `checkDigests` in `nx-rust/src/executors/digests.ts` computes each digest that the target's `metadata.cargo.digests` names again and fails the task when it differs from its digest file.

- [ ] In the batch implementation, run the first check for each task of a batch before its group's call, failing only that task
- [ ] Run `checkDigests` for each task of a group right after the group's last call, a group of one crate included, beside the check of `DES-BUILD-INPUT-CHECK` where that exists, on the digests that "Post-check" in `DES-LOCKFILE-HASHING` names: every digest that the task's key holds (every member's under `cargo` and `workspace-build`), and under `hakari` every member's for a task that shared its command; a mismatch fails only the tasks whose compared digests changed
- [ ] Cover both in the batch cases of `VER-CACHE-KEYS` (the post-check row) with a real batch, including the change that moves only a sibling's digest

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
