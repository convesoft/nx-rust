---
title: Keep NEXTEST_TEST_THREADS from the environment out of the tests of a run that nextest ends early
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-d0t9vm
created_at: 2026-11-19T07:58:53Z
---

Goal: `nx-rust/test/nextest-runs.spec.ts` gives the same result whatever `NEXTEST_` variables the machine's environment has.

Context: the cases "fails the task of a crate whose tests did not run after a global timeout / an interrupt ended the run" set `test-threads = 1` in the fixture's `.config/nextest.toml`, so that `a`'s tests run first and the run ends before `b`'s. With `NEXTEST_TEST_THREADS=4` in the environment (as the shared tool environment of the control plane exports for collections), nextest takes the variable over the profile, `b`'s tests run in parallel and pass, and both cases fail (`passed(results)` holds `b`). Without the variable they pass. Found on 19 November 2026 while checking nxr-d0t9vm.

- [ ] Have `testEnvironment()` (or these cases) drop `NEXTEST_TEST_THREADS`, or set it to 1 for these runs
