---
title: Make the hold check of test-after-build.spec.ts able to fail without the test-on-build dependency
status: todo
type: bug
parent: nxr-e2z8sz
discovered_from: nxr-11vr5k
created_at: 2026-11-20T18:24:46Z
---

Goal: the two cases "runs its test only once its build has ended…" in `nx-rust/test/test-after-build.spec.ts` fail when the plugin no longer makes `test` wait for `build` (`DES-TARGETS`, checked by `VER-TARGETS`).

Context: found in nxr-11vr5k on Nx 24.0.6. With a temporary mutation that made `testBuilds` in `nx-rust/src/graph/targets.ts` return `[]`, so that there is no dependency and no guard, both cases still passed: in the default run (`run-many -t build test -p app`, batches preferred), Nx did not start `app:test` while the held `app:build` waited, not within 8 s or 20 s. The `early` check and the later assertions on the order of calls never saw the missing dependency. Other cases of the file did fail under the mutation. With `--batch=false` added, Nx started `app:test` before the first 50 ms poll of `hold.held()`.

- [ ] Decide how the cases should show the ordering, for example a run with per-task scheduling (`--batch=false`) beside the default run, or an assertion on the task graph, without changing what `VER-TARGETS` says
- [ ] Show with the mutation above that both cases then fail

Done when: both cases fail under the mutation, pass without it, and `pnpm nx run-many -t build lint test` passes.
