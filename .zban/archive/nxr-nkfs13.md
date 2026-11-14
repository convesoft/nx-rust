---
title: test-after-build.spec.ts expects a continuous build's cargo call that Nx may stop before it starts
status: done
type: bug
parent: nxr-9y4eh8
related:
  - nxr-621hvq
discovered_from: nxr-1ckcy8
created_at: 2026-11-14T20:13:11Z
closed_at: 2026-11-14T21:32:20Z
---

Goal: the test of nxr-621hvq for a continuous `build` passes whatever the machine's load.

The case "fails its test before cargo runs where build is itself continuous, so that test depends on it only as a continuous dependency" in `nx-rust/test/test-after-build.spec.ts` runs `nx run app:test` with `app:build` made continuous, and expects, besides the guard's failure of `app:test`, that the cargo wrapper logged exactly `build -p <app's spec>`. Nx starts the continuous `build` beside `test`; the guard fails `test` before cargo, and Nx then ends the run and stops the continuous task. Whether `build`'s executor reached `cargo build` by then depends on timing.

Seen on 14 November 2026 in `pnpm nx run-many -t build lint test` on the branch of nxr-1ckcy8 after merging the local `main` at ae31618, with a load average of about 40 on 32 cores: the wrapper had logged no call (`Array []`), and only this test failed (1387 passed). The same file alone passed 3 of 3 right afterwards. nxr-1ckcy8 does not touch the executors or this test.

- [x] Make the case independent of whether the continuous `build` started cargo before Nx stopped it: for example assert the guard's message, the status and that no `cargo test` ran, and accept `build`'s call or its absence, or wait in the fixture until the continuous task has started cargo
- [x] Run the file repeatedly under load (beside a full `run-many`) and record the result in the summary

## Summary of Changes

- The continuous-`build` case in `nx-rust/test/test-after-build.spec.ts` now asserts status 1, the guard's message and no `cargo test` call, and no longer the `build -p` call, which depends on whether Nx stopped the continuous `build` before its executor reached cargo. That the run holds `app:build`, reached only as a continuous dependency, comes from the task graph of `nx run app:test --graph=<file>` (new `taskGraph` helper), which does not race.
- The other cases were checked for the same kind of dependence and need no change: their `build -p` calls belong to a non-continuous `build`, which Nx runs to the end after `test` fails; their ordered call lists follow from the dependencies under test; no case asserts output of a task that Nx stops.
- Runs: the file 20 times beside a looping full `pnpm nx run-many -t build lint test` in the same worktree, before (0 of 20 failed, load average 19 to 39) and after (20 of 20 passed, load average 16 to 74); part of each series had two such loops. The reported failure did not recur before the change. A deliberate reproduction through a held `cargo metadata` hung Nx's hashing instead (the artifact-folder runtime input calls `cargo metadata` with the task's environment) and was dropped. The three guard mutations still fail exactly the tests they failed before.
- Checks, after merging the local `main` at c281c10: `pnpm nx run-many -t build lint test` (43 suites, 1388 passed, 1 todo), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (`valid: true`, evaluation complete; no Mara file changed on this branch), `zban check`. The end-to-end suite was not run: only this spec file changed.
