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

Note from nxr-s12cpg (14 November 2026): the batch prepares every task with the code of a task run on its own (`prepareTask` in `nx-rust/src/executors/task.ts`), so `keyHoldsDigests` already fails only its own task before any cargo call of the batch, and `runGroup` (`nx-rust/src/executors/group-run.ts`) runs `checksAfterCargo`, with `checkDigests`, for each task whose crate passed, right after its group's command. In groups of one crate, all that the batch forms until nxr-8f9dz2, both checks therefore run as for a task on its own. What stays here: the `hakari` rule of "Post-check" for a task that shared its command (every member's digests), and the batch rows of `VER-CACHE-KEYS` with real groups of several crates, which need nxr-8f9dz2's shared commands.

Note from nxr-j8mj18 (15 November 2026): under `workspace-build`, which every workspace uses until nxr-k64tm5, every target that reads digests now names every member in `metadata.cargo.digests`, the crate's own first, so the post-check of a batched task compares every digest that its key holds, also in the groups of one crate that the batch forms until nxr-8f9dz2. `lockfile-runs.spec.ts` ("fails a task whose own digest stays the same while another member's changes during the run…") checks it with a real `--batch`, in the workspace of `EVD-HAKARI-UNIFICATION`, "A sibling's lockfile change". What stays here: the `hakari` rule of "Post-check" for a task that shared its command (every member's digest although its key holds its own), and the batch rows of `VER-CACHE-KEYS` with real groups of several crates, which need nxr-8f9dz2's shared commands; under `workspace-build` and `cargo` those rows need no executor change, because the members come from the metadata.
