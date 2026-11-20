---
title: Run one cargo call per environment dump in batch-runs and pre-warm the workspace-tests and batch-groups builds
status: todo
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-4sr6hd
  - nxr-yfh7zh
  - nxr-qkxcmm
  - nxr-h411yj
  - nxr-krddfp
created_at: 2026-11-20T16:38:27Z
---

Goal: the environment-dump tests of `batch-runs.spec.ts` keep every way of running and stop paying for crates, doctests and a test runner that the dumps do not need, and `workspace-build.spec.ts` and `batch-runs.spec.ts` reuse a pre-warmed `target/` (`VER-BATCHING`). No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026, measured at 9d3430a: `nx-rust/test/batch-runs.spec.ts` took 116.2 s for 27 tests, of which the three `environmentDumps` tests took 50.5 s (lines 502-570 at 33.77 s, 572-613 at 10.81 s, 771-795 at 5.91 s). `batch-groups` has five library crates under `workspace-build`, so each of the 40 `dumpsOfRuns` invocations runs three cargo commands (`test --workspace --no-run`, `test --workspace --tests` with the Node `test-runner.js`, `test --workspace --doc` with rustdoc) and a forced recompile of `build.rs`. `nx-rust/test/workspace-build.spec.ts` took 44.6 s for 17 tests, each compiling the six crates of `workspace-tests` cold. The issue waits for the issues that change `batch-runs.spec.ts`, `dotenv-equivalence.spec.ts` and the batch executor, and for nxr-krddfp, whose helper for a template `target/` it reuses.

- [ ] Change the `environmentDumps` overlay (`batch-runs.spec.ts`, lines 423-570, 572-613 and 771-795) so that `rust/Cargo.toml` lists only `members = ["crates/indep"]` and `rust/crates/indep/src/lib.rs` is removed, keeping `build.rs`, `tests/environment.rs` and `src/main.rs`. Each of the 40 runs then makes one `cargo test` call instead of three
- [ ] Keep all 11 `waysOfRunning`: the maintainer decided on 20 November 2026 that the matrix is not narrowed
- [ ] Reuse the template-`target/` helper of nxr-krddfp for `workspace-tests` in `workspace-build.spec.ts` and for `batch-groups` in `batch-runs.spec.ts`, leaving out every test that checks what a first compile does
- [ ] Show that the dump tests still fail when a batch and a single run differ in a variable, and give the timings before and after

Done when: both specs pass with unchanged assertions, the timings are reported, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
