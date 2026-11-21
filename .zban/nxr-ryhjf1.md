---
title: Cut the startup overhead of the end-to-end suite and run its two toolchains in parallel in CI
status: in-progress
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-aqgka5
  - nxr-yfh7zh
created_at: 2026-11-20T16:38:09Z
---

Goal: the end-to-end suite spends its time in Nx and cargo, not in starting pnpm and fetching package metadata again, and CI runs it for the installed cargo and for Cargo 1.91 at the same time (`VER-SETUP`, `REQ-COMPATIBILITY`). No `VER-` item changes.

Context: from the maintainer's audit of the test suites on 20 November 2026. `nx-rust-e2e` runs twice in a row in CI (`stable` and `1.91.0`), wipes pnpm's cache in every run, calls `pnpm exec nx` more than 25 times and runs `nx add` six times. It waits for nxr-aqgka5, which changes `nx-rust-e2e/src/nx-rust.spec.ts`.

- [ ] Call Nx directly: change `nx()` and `nxResult()` (`nx-rust-e2e/src/nx-rust.spec.ts`, lines 1179-1204) from `pnpm exec nx ...` to `process.execPath` with `node_modules/nx/dist/bin/nx.js`, as `FixtureWorkspace.nx` does. Keep `pnpm exec nx add` for the `nx add` calls only
- [ ] Keep pnpm's metadata cache for outside packages: `tools/scripts/start-local-registry.ts` (lines 25-27) wipes the whole `pnpm_config_cache_dir` in every run, so `nx` and its dependencies are fetched again through the local registry. Either publish `@convesoft/nx-rust` under a version of its own for each run (for example `0.0.0-e2e.<time>-<pid>` under the dist-tag `e2e`) or purge only the plugin's entry, so that a stale build of the plugin can never be installed
- [ ] The `cargo clean` in the middle of the suite (line 648): check whether deleting only the final artifacts keeps the same cache-restore assertion without a full recompile of `subfolder-workspace`; keep `cargo clean` if the assertion would prove less
- [ ] CI (`.github/workflows/ci.yml`, lines 68-101): run the `stable` and `1.91.0` end-to-end runs as two parallel matrix jobs behind a light aggregating job whose `name:` stays `End-to-end tests` (`if: always()`, failing unless both matrix jobs succeeded), so that the required check on `main` keeps its name. Linux only (`ADR-CI-LINUX-ONLY`); no macOS job. The workflow cannot be run from a worktree: say in the summary that it is checked only once the maintainer pushes, and check its syntax locally as far as that goes
- [ ] Give the timings before and after

Done when: the end-to-end suite passes locally on the installed cargo and on Cargo 1.91 (private `RUSTUP_HOME`, as `AGENTS.md` describes), the timings are reported, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.
