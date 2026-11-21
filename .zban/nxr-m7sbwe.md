---
title: Test suite optimizations
status: todo
type: epic
priority: low
created_at: 2026-11-21T20:30:37Z
---

Rebalance `nx-rust/test/` from an inverted test pyramid (~1,469 real Nx + Cargo subprocess tests taking 97.7% of runtime) toward fast in-process unit tests backed by real-process checks at every Nx, Cargo, daemon and plugin-worker boundary.

Baseline measured at `54adf17` (`pnpm nx test nx-rust --skip-nx-cache`, `maxWorkers = 3`): 80 suites, 2,100 passed (61 skipped for optional tools, 6 todo), 1,090.9 suite-seconds (365.5 s wall time). Pure in-process unit suites (20 files, 474 tests) take 7.2 s (0.7%), Cargo-only suites (5 files, 157 tests) take 18.4 s (1.7%), and real Nx + Cargo integration suites (55 files, 1,469 tests) take 1,065.3 s (97.7%). Projected reduction across all child issues: ~425 suite-seconds saved (~3m 40s wall time locally, plus ~25–35 s in CI where optional-tool suites run), with ~310 rule/validation permutations moved to in-process unit tests and ~260 redundant Nx/daemon spawns removed.

Timing relative to 1.0 (`nxr-nm0jd6`) is left to the maintainer. Unlike the 0.6 test-runtime issues (summarised in `nxr-vk19v5` line 35), each child issue here explicitly updates the relevant `VER-*` item in `nx-rust/docs/verification.mara.md` alongside its test changes and verifies the remaining boundary tests with temporary mutations, following the pattern established in `nxr-yatbsx`.

- [ ] All child issues are closed
- [ ] `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass
- [ ] `mara schema validate`, `mara project validate` and `zban check` pass
