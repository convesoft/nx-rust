---
title: "0.6: Architecture cleanup and hardening"
status: todo
type: epic
tags:
  - milestone
created_at: 2026-11-20T10:22:55Z
---

Clean up fragile internal workarounds, consolidate private Nx adapter code, and fix concrete resolution and performance papercuts ahead of 1.0.

Findings from an architecture review of `nx-rust/src/` after milestones 0.1–0.5 (`GOAL-TRUSTED-CACHE`, `RISK-UPSTREAM-CHANGES`). Any child issue that changes specified behaviour updates the relevant Mara items (`DES-BATCH`, `DES-TARGET-DEFAULT-GUARD`, `DES-INPUTS`, `DES-TEST-MODE`, `DES-METADATA-REPORT`) before code changes land.

- [ ] All child issues are closed
- [ ] `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass
- [ ] `mara schema validate`, `mara project validate` and `zban check` pass

## Handoff (2026-11-20T20:55:17Z)

- Paused on 20 November 2026 in the evening at the maintainer's request; the orchestrator thread "nx-rust 0.6: Architecture cleanup and hardening" continues it. The full resume note is `~/.local/state/zban-orchestrator/nx-rust/pause-2026-11-20.md`, with `ledger.md` and `audit-notes.md` beside it; the orchestrator's rules are in `~/Work/github.com/araketski/skills/skills/zban-orchestrator/SKILL.md`.
- Integration branch `main`, clean, never pushed to `origin/main`; its tip at the pause is the commit that carries this note; the backup is `origin/integration`.
- Done: ten children are integrated and archived (nxr-gtxq18, nxr-gp1awx, nxr-hjpc99, nxr-k63csj, nxr-3f5wqp, nxr-4sr6hd, nxr-aqgka5, nxr-1tmme6, nxr-krddfp, nxr-11vr5k).
- In progress, each in a worktree under `~/.t3/worktrees/nx-rust/` with everything committed and nothing running: nxr-qkxcmm (branch `refactor/simplify-dotenv-check`, head 47a2220: reviewed and re-checked, one last wording round held, then gate checks and integration); nxr-yfh7zh (branch `fix/batch-output-replacement`, head 1f62a00: staged builds implemented and wired, full suites, the Cargo 1.91 run, the closing summary and the squash message still to do, then a fresh first review at xhigh); nxr-v67m3s (branch `perf/memoize-cache-key-baselines`, head 277007f: the memo was removed by the orchestrator's decision, the summary, squash message, merge and checks still to do; the remaining plugin-copy change showed no measurable gain, so decide tomorrow whether to keep it or close the issue with the finding alone).
- Next, as blockers close: nxr-7v04ge (ready, test-only), nxr-5hzxra and nxr-h411yj and nxr-ryhjf1 (after nxr-yfh7zh), nxr-gabd3d, nxr-w6117m (after nxr-yfh7zh and nxr-qkxcmm), then nxr-ffjvc9 and nxr-yatbsx.
- Decided by the maintainer on 20 November 2026 and recorded in Mara in the branches: the static dotenv check with cycles allowed (nxr-qkxcmm); staged build artifacts, and putting builds' files back after test batches (nxr-yfh7zh, nxr-5hzxra).
- Open with the maintainer, none blocking: whether nxr-c63t0r leaves the backlog; the residual risk of the static dotenv check; the provisional `--nx-bail` behaviour of staged builds (line 22 of nxr-vk19v5); the test-runtime issues save far less than the audit estimated.
- Rejected approaches so far: keeping and putting back files for build groups (a window remains while the later build runs); a file walk of the plugin's own for the build input check; observing dotenv-expand through a proxy (it copies the environment before expanding); a layout-aware stripper of cargo's build directory in the test harness; a memo of baseline hashes in the cache-key test.
- Files touched tonight in the integration checkout: tracker files under `.zban/` only.
