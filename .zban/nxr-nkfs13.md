---
title: test-after-build.spec.ts expects a continuous build's cargo call that Nx may stop before it starts
status: todo
type: bug
parent: nxr-9y4eh8
related:
  - nxr-621hvq
discovered_from: nxr-1ckcy8
created_at: 2026-11-14T20:13:11Z
---

Goal: the test of nxr-621hvq for a continuous `build` passes whatever the machine's load.

The case "fails its test before cargo runs where build is itself continuous, so that test depends on it only as a continuous dependency" in `nx-rust/test/test-after-build.spec.ts` runs `nx run app:test` with `app:build` made continuous, and expects, besides the guard's failure of `app:test`, that the cargo wrapper logged exactly `build -p <app's spec>`. Nx starts the continuous `build` beside `test`; the guard fails `test` before cargo, and Nx then ends the run and stops the continuous task. Whether `build`'s executor reached `cargo build` by then depends on timing.

Seen on 14 November 2026 in `pnpm nx run-many -t build lint test` on the branch of nxr-1ckcy8 after merging the local `main` at ae31618, with a load average of about 40 on 32 cores: the wrapper had logged no call (`Array []`), and only this test failed (1387 passed). The same file alone passed 3 of 3 right afterwards. nxr-1ckcy8 does not touch the executors or this test.

- [ ] Make the case independent of whether the continuous `build` started cargo before Nx stopped it: for example assert the guard's message, the status and that no `cargo test` ran, and accept `build`'s call or its absence, or wait in the fixture until the continuous task has started cargo
- [ ] Run the file repeatedly under load (beside a full `run-many`) and record the result in the summary
