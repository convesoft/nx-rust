---
title: Give targets whole-workspace cache keys under workspace-build
status: done
type: feature
parent: nxr-9y4eh8
related:
  - nxr-8f9dz2
created_at: 2026-11-15T15:19:21Z
closed_at: 2026-11-15T16:02:35Z
---

Goal: under the `workspace-build` strategy, the cache key of every crate target covers what a command that selects the whole workspace can read, before any such command exists, so that turning shared commands on (nxr-8f9dz2) never leaves `main` in a state where a cached result depends on something its key does not hold (`GOAL-TRUSTED-CACHE`).

Context: split from nxr-8f9dz2 on 15 November 2026 so that the graph side and the executor side can be done at the same time. This issue is the graph side and lands first; nxr-8f9dz2 is blocked by it. It changes keys only: tasks then run more often than a per-crate command strictly needs, which is allowed, and no cargo command changes here.

- [x] Under `workspace-build`, give every target of a crate that has its digest the digests of all members and the folders of the path crates outside the workspace that any member reaches ("External dependencies", "Crates outside the workspace" and "Whole-workspace builds" in `DES-INPUTS`), and drop the second half of the status note of `nx-rust/docs/caching.mara.md`; name all those digests in the targets' `metadata.cargo.digests`, so that the post-check compares every digest that the key holds ("Post-check" in `DES-LOCKFILE-HASHING`), with the `VER-CACHE-KEYS` case of a change during the run that moves only a sibling's digest
- [x] Turn the `VER-CACHE-KEYS` cases that hold under `hakari` only since nxr-ms8zzk into the cases that must differ under `workspace-build` in their fixtures: a locked version bump outside the crate's resolved dependencies, also for the crate at the root of its workspace, a change in a redirected crate for a member without registry or git dependencies, and the end-to-end lockfile case, which then runs every crate of the workspace; and add the new `workspace-build` rows (another member's package, a path crate outside the workspace that only another member reaches)
- [x] The post-check of a batched task compares every digest that its key now holds, with a real batch (`--batch`), including the change that moves only a sibling's digest (the remaining part of nxr-pht7d6 that needs no shared command; say in nxr-pht7d6 what is then left for it)

Done when: the parts of `VER-CACHE-KEYS` that cover this work pass, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

Under `workspace-build`, which every workspace uses until nxr-k64tm5, every target that reads lockfile digests (`build`, `check`, `lint`, `test` and `doc`, not `fmt-check`) now holds what a build of the whole workspace reads, beside every member's manifest:

- The digests of all members (`holdsEveryDigest` in `nx-rust/src/graph/inputs.ts`). A target's `metadata.cargo.digests` names its own member, and `everyDigest: true` marks a key that holds every member's digest. The executor takes the other members from the `members` of the lockfile task it depends on (`keyHoldsDigests` in `nx-rust/src/executors/task.ts`, `heldMembers` in `nx-rust/src/executors/digests.ts`), so the list is in the graph once per workspace, not once per target. `checkDigests` compares the crate's own digest first, alone and in a batch, so it names another member only where the crate's own held.
- The folder of each path crate outside the workspace that any member reaches, by path behind members of every kind and then normal and build dependencies, or as a redirected crate that a member may use, with the root manifest of its workspace, its declared files and the variables and commands it adds, as a crate's own path dependencies have them (`outsideCrates` and `heldFolders` in `nx-rust/src/graph/path-dependencies.ts`). A folder that the crate's inputs hold already, through its path dependencies, redirections or its edges' `^` inputs, transitively, is not named again.
- Review round: the first version left out the declared files, variables and commands, which was wrong. The reviewer showed a fork that Nx ignores, whose `runtimeInputs` hashes its manifest; changing the feature it asks of a member changed whole-workspace builds and left another member's keys alone. A declared schema file that the fork's build script reads did the same. The sibling rows that asserted that gap were changed.
- Size, on a generated workspace of 304 members: 369,968 digest entries before and 1,216 after; target metadata 12.8 MB before and 0.40 MB after; projects JSON 42.0 MB before and 29.6 MB after; graph creation 2.7 s before and 2.3 to 2.5 s after. The remaining 28.7 MB is target inputs, mostly every member's manifest on every target, which predates this issue.

Knowledge: the status note of `caching.mara.md` (second half dropped; it now says what a lockfile change costs), the milestone 0.1 sentence of "Whole-workspace builds" removed, "Crates outside the workspace", "Declared files" and "Added variables and commands" in `DES-INPUTS`, and the comparison list and order in "Post-check" of `DES-LOCKFILE-HASHING`. `VER-CACHE-KEYS` gained the declared files and added variables and commands of such crates, also one Nx cannot see. As the control plane decided, "Whole-workspace builds" and the strategy guide of `execution.mara.md` now say plainly that the key holds no other member's sources: a compile error in another member fails the test tasks of that command but is no reason to run a cached one again, and with `NX_CACHE_FAILURES=true` such a failure is stored under a key that does not hold its cause. The reviewer's reproduction is appended to nxr-s1nna8. nxr-pht7d6 has a note saying what is left for it. nxr-k64tm5 now points at this issue for the `cargo` inputs.

Tests, with the real Nx hasher and real cargo:

- `lockfile-keys.spec.ts`: these rows now differ under `workspace-build`, so they moved there: a locked bump outside the crate's resolved dependencies, also for the crate at the root of its workspace (and not for the other workspace). Siblings now differ in the git-commit, `[replace]` and newly published version rows.
- `cache-keys.spec.ts`: new rows for a path crate outside the workspace that only another member reaches: without a project, behind another one, of another workspace with its root manifest, and redirected crates for a member without registry or git dependencies. Also the reviewer's case: a fork that Nx ignores and that only `b` reaches, whose manifest is hashed only through its `runtimeInputs`; changing the feature it asks of `c` changes `a`'s `build`, `check`, `lint` and `test` keys and not `fmt-check`. The directory-source, `[replace]` and `paths` rows, and the rows about declared files and added variables and commands of crates without an edge, now differ for the other members too. In `declared-files.spec.ts`, `nx affected` selects `other`'s cached tasks as well.
- `caching.spec.ts`: inputs and metadata. `lockfile-digest.spec.ts`: `heldMembers`.
- `lockfile-runs.spec.ts`: a missing `Cargo.lock` and `nx affected` after a lockfile commit run every crate. Also new: the post-check in the workspace of `EVD-HAKARI-UNIFICATION` ("A sibling's lockfile change"), alone, with `--batch` and with `NX_CACHE_FAILURES=true`, where only `b`'s digest moves while `a:build` waits. Each new case fails without the change.

Checks on the final head: `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` passed (3 projects; 49 suites, 1661 tests passed, 1 todo); `NX_DAEMON=false pnpm nx e2e nx-rust-e2e --skip-nx-cache` passed (27 tests); `pnpm nx format:check --all` passed; `mara schema validate` and `mara project validate` reported `valid: true` with complete evaluation, 0 errors and 0 warnings; `zban check` reported nothing.

Backlog filed: nxr-s1nna8 (the redirected crates that only a member without a project may use) and nxr-enw1pg (no warning for the other members about an unseen path crate outside the workspace).
