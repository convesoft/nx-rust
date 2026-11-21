---
title: "0.6: Architecture cleanup and hardening"
status: done
type: epic
tags:
  - milestone
created_at: 2026-11-20T10:22:55Z
closed_at: 2026-11-21T18:32:50Z
---

Clean up fragile internal workarounds, consolidate private Nx adapter code, and fix concrete resolution and performance papercuts ahead of 1.0.

Findings from an architecture review of `nx-rust/src/` after milestones 0.1–0.5 (`GOAL-TRUSTED-CACHE`, `RISK-UPSTREAM-CHANGES`). Any child issue that changes specified behaviour updates the relevant Mara items (`DES-BATCH`, `DES-TARGET-DEFAULT-GUARD`, `DES-INPUTS`, `DES-TEST-MODE`, `DES-METADATA-REPORT`) before code changes land.

- [x] All child issues are closed
- [x] `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass
- [x] `mara schema validate`, `mara project validate` and `zban check` pass

## Summary of Changes

All 23 child issues are closed and integrated on `main` by squash merges, one per issue: the 9 issues of the architecture review, the 7 issues that work on them discovered, and the 7 test-runtime issues that the maintainer added on 20 November 2026. Four issues without this parent closed with them: nxr-f04xen, nxr-fpc72j and nxr-j55xdy in nxr-yfh7zh, and nxr-nbdazw in nxr-5hzxra. Nothing is pushed to `origin/main`; the backup branch is `origin/integration`.

- Private Nx parts sit behind one bridge with tripwire tests (nxr-gtxq18), and the four largest modules are split by concern (nxr-w6117m).
- Batches: environments are built without changing `process.env` (nxr-4sr6hd); the dotenv check is static and follows the installed `dotenv-expand` (nxr-qkxcmm); whole-workspace builds and artifact compiles build in a stage, so that no build replaces another task's files (nxr-yfh7zh); a test or bench batch puts the builds' files back (nxr-5hzxra); the build input check reads a fresh workspace context after each group's cargo call (nxr-1tmme6).
- Also from the review: `cargo metadata` runs concurrently for independent Cargo workspaces (nxr-gp1awx), the plugin's entry state no longer depends on how Nx calls its hooks (nxr-hjpc99), the handling of tasks that a batch does not report was reviewed (nxr-k63csj), the folder listing of one check is read once (nxr-3f5wqp), and the runtime-input scripts read multi-line variables whole and warn when one of them fails, in place of a silent fallback (nxr-aqgka5).
- Tests: nxr-krddfp, nxr-11vr5k, nxr-ryhjf1, nxr-yatbsx, nxr-gabd3d, nxr-h411yj, nxr-7v04ge, nxr-04ezzm, nxr-rqhs7j; nxr-v67m3s and nxr-ffjvc9 closed with a finding and no change of code.

Rejected along the way: keeping and putting back files for build groups (a window remains while the later build runs); a file walk of the plugin's own for the build input check; observing `dotenv-expand` through a proxy; a layout-aware stripper of cargo's build directory in the test harness; a memo of baseline hashes in the cache-key test; one shared `HashPlanInspector` per batch group (kept on the branch `kept/nxr-ffjvc9-shared-inspector`); expanding a build's outputs in the plugin to find the files a test batch keeps.

Decisions made for the maintainer are listed in nxr-vk19v5, lines 1 to 35.

Checks run on 21 November 2026 at 12e7309 in the integration checkout, uncached: `pnpm nx run-many -t build lint test` (80 suites, 2100 tests passed, 61 skipped, 6 todo), `pnpm nx e2e nx-rust-e2e` on the installed cargo and on Cargo 1.91 (27 passed each), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` with a fresh code index (valid, evaluation complete, no errors or warnings) and `zban check`. Not checked: the CI workflow of nxr-ryhjf1, which runs only once the maintainer pushes.

## After the milestone: architecture audit

One auditor read the whole repository at 54adf17 on 21 November 2026 and returned 14 findings. None is a defect that a realistic setup reaches, so all 14 are in the backlog, where nothing starts without the maintainer: nxr-aa287j, nxr-es2rrj, nxr-2m21ya, nxr-rxetx7, nxr-peg4yx and nxr-8jv932 (shared code to create or unify), nxr-rarqzn (the same in the tests), nxr-mdpha2 and nxr-f2j7ec (cleanups on top of it), and nxr-95a32m, nxr-n83w5r, nxr-xccm6a, nxr-y7pxgd and nxr-28vt4j (pure splits). Their order is in their `blocked_by` edges. Recommended: one cleanup epic that takes these 14 as children, before or beside 1.0.
