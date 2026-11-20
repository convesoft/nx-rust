---
title: Review and harden unreported-task deferral in batch.ts
status: done
type: task
priority: low
parent: nxr-e2z8sz
related:
  - nxr-5rrkay
  - nxr-fpc72j
created_at: 2026-11-20T10:24:51Z
closed_at: 2026-11-20T13:32:04Z
---

Goal: verify or replace the batch executor's unreported-task deferral pattern so it is either explicitly guarded against Nx batch-runner changes or replaced by a documented contract.

Context: in `nx-rust/src/executors/batch.ts`, when two groups in one batch would write to the same stored artifact files (`writesStoredFiles`), the batch intentionally omits the second group from yielded `BatchReport` results (`deferred`) so Nx's orchestrator treats them as unfinished and schedules a follow-up batch after storing the first group's outputs (`DES-BATCH`, `EVD-NX-24-BATCHES`, `RISK-UPSTREAM-CHANGES`).

- [x] Verify how Nx 24's batch runner handles omitted tasks across edge cases (all-deferred guards, `--output-style`, TUI, `--skip-nx-cache`, dependent tasks outside the batch) and document the exact invariants
- [x] Decide whether to keep unreported-task deferral with stronger regression tests or replace it with an explicit strategy (e.g. failing with guidance or staging outputs) and coordinate with `nxr-fpc72j` and `nxr-5rrkay`
- [x] Update `DES-BATCH` and `VER-BATCHING` if the strategy changes

Done when: the batch deferral behaviour is either hardened with explicit tests or replaced cleanly, Mara validation passes, and `pnpm nx run-many -t build lint test` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

Kept the deferral, as nxr-5rrkay decided, and hardened it. Nx 24.0.6 runs a batch in waves (`applyFromCacheOrRunBatch`): it keeps every task a batch process leaves out incomplete, stores what the process reported, and only then starts a new process with the rest. Run with a real cargo and the real Nx, across the edge cases this issue names, the deferral lost no task and caused no hang, and each build's own cache entry held the files that its own command wrote. Two limits remain, recorded in `DES-BATCH` ("Tasks left for a following batch") and filed after the review. First, a later wave replaces on disk the files of an earlier one, so a cached task outside the batch that depends on an earlier build and starts after the batch can store what it made of the later build's files (nxr-yfh7zh). Second, a build left out keeps the hash Nx computed in the first wave, which cost a cache miss in the run on record; that it never gives a wrong hit is not shown (nxr-f04xen). `EVD-NX-24-BATCHES` ("Tasks left out") records the reading, the runs and the review's reproductions.

- `nx-rust/src/executors/batch.ts`: as a batch ends, `unreportedProblems` fails any task that the batch neither reported nor left for a following batch. Where the batch reported no task at all, it also fails the tasks it left, which Nx would otherwise start again without end. Only a fault of the plugin causes either case. The task then fails without running, so Nx stores no successful result for it, and the message says so. Doc comments now agree with the behaviour.
- `nx-rust/test/batch-deferral.spec.ts` (new, real Nx and cargo): the static, stream and stream-without-prefixes styles and GitHub Actions' grouping. A dependent inside the batch, deferred twice, so three batch processes run. Discrete JS and `test` tasks outside the batch that depend on a deferred task wait through every wave. The test does not check what such a task reads of an earlier build, which is the limit of nxr-yfh7zh. A failed first group, with and without `--nx-bail`. Unit tests of `unreportedProblems`.
- `nx-rust/test/harness/workspace.ts`: `nxInTerminal` takes an optional terminal size.
- Mara: in `DES-BATCH`, a new paragraph "Tasks left for a following batch" with the invariants. Also `EVD-NX-24-BATCHES`, a new row in `DES-DIAGNOSTICS`, and new checks in `VER-BATCHING`.

## Decisions made

- Keep deferring rather than fail with guidance or stage outputs, as nxr-5rrkay decided. No run showed a lost task, a hang or a wrong entry for a build. The two limits above concern a task outside the batch and the key of a deferred build, and are left to nxr-yfh7zh and nxr-f04xen.
- The run-time check covers only what the batch process can see: no task is left unreported unless deferred, and no batch defers without reporting a task. Whether Nx stores a wave before the next one starts cannot be checked from inside the batch. It is left to the Nx major gate (`REQ-COMPATIBILITY`) and to the regression tests, with no gate on Nx's patch version.
- The terminal UI is in the evidence but not in the regression tests: under the harness it does not exit on its own, with a deferred task or without one (nxr-h411yj).
- nxr-fpc72j is unchanged: the waves exist only for batches, and nothing found here bears on batching off.

## Checks run

- After merging `main` at 9d3430a: `pnpm nx run-many -t build lint test`: passed (73 suites, 2036 tests).
- `pnpm nx format:check --all`: passed.
- `pnpm nx e2e nx-rust-e2e`: passed (27 tests).
- `batch-deferral.spec.ts` in the CI environment (`env -u CLAUDECODE -u CLAUDE_CODE -u AI_AGENT -u CODEX_THREAD_ID CI=true GITHUB_ACTIONS=true pnpm nx test nx-rust --testPathPatterns=batch-deferral --skip-nx-cache`): passed (11 tests).
- `mara schema validate`: valid. `mara project validate`: valid, evaluation complete.
- `zban check`: no problems reported (exit 0).
