---
title: Verify the split e2e CI workflow and optional-tool checks on GitHub Actions
status: done
type: task
tags:
  - maintainer
parent: nxr-nm0jd6
related:
  - nxr-ryhjf1
  - nxr-27zbta
discovered_from: nxr-vk19v5
created_at: 2026-11-21T20:37:40Z
closed_at: 2026-11-21T23:51:40Z
---

Goal: once 0.6/pre-1.0 changes are pushed to GitHub, verify the split end-to-end CI workflow from `nxr-ryhjf1` (`.github/workflows/ci.yml` and `.github/actions/e2e`) and confirm that the optional tools installed by `nxr-27zbta` run their real-tool tests in CI instead of skipping.

Context: `nxr-vk19v5` line 27 notes that `.github/workflows/ci.yml` cannot be verified until the maintainer pushes to GitHub. This task sits inside milestone 1.0 (`nxr-nm0jd6`) and is tagged `maintainer` because pushing to GitHub and inspecting branch-protection checks are maintainer actions.

- [x] Confirm `e2e-stable` and `e2e-msrv` start in parallel, `./.github/actions/e2e` resolves after checkout, and each job prints its expected `cargo --version`
- [x] Confirm the required check `End-to-end tests` reports both results and satisfies branch protection on `main`
- [x] Cancel one toolchain job (`e2e-stable` or `e2e-msrv`) once on a test PR/push and confirm `End-to-end tests` fails
- [x] Confirm the `Build, lint, test and format` job runs the real-tool tests (`cargo-nextest`, `cargo-hakari`, `wasm-bindgen`, `wasm32-unknown-unknown`) added in `nxr-27zbta` without skipping them, including the cases of `affected-coverage.spec.ts` (cargo-affected with the `llvm-tools` component, which `nxr-27zbta` also installs) and the hakari drift cases of `hakari-runs.spec.ts`, which ran nowhere before; note how long the job takes against its 35-minute limit and whether the cargo-affected build was restored from the cache on the second run

Done when: all four checks above are observed on a real GitHub Actions run and recorded in `## Summary of Changes`.

## Summary of Changes

Verified all four items on real GitHub Actions runs (`main` push run `44959483152`, PR #77 run `44959644815`, and PR #78 run `44962144921`):

- Parallel e2e & `cargo --version`: `e2e-stable` (`cargo 1.100.0 (3acc79c0c 2026-11-05)`) and `e2e-msrv` (`cargo 1.91.0 (ea2d97820 2025-10-10)`) started in parallel (within 1s), resolved `./.github/actions/e2e` after checkout, and finished in 1m 15s–1m 44s.
- Required check & branch protection: `End-to-end tests` aggregated both toolchain results (`required: true`) and satisfied branch protection on `main`, allowing PR #78 to squash-merge cleanly.
- Cancellation gate: re-running only `e2e-msrv` on PR #77 (run `44959644815`, leaving `e2e-stable` as `success`) and cancelling the run cancelled `e2e-msrv` (job `137023093697`) and caused `End-to-end tests` (job `137023140346`) to log `Cargo stable: success` / `Cargo 1.91.0: cancelled` and fail with exit code 1.
- Optional tools, duration, and `cargo-affected` cache: `nextest-runs.spec.ts`, `hakari-runs.spec.ts` (drift cases; only the optional non-host `x86_64-unknown-linux-musl` case skipped), `wasm-build.spec.ts`, and `affected-coverage.spec.ts` (`cargo-affected` + `llvm-tools`) all ran and passed. `cargo-affected` built from scratch on `main` run `44959483152` (59s) and restored from cache in 1s (`Build cargo-affected` and `Save cargo-affected` skipped) on PR #77 (`44959644815`) and PR #78 (`44962144921`). `Build, lint, test and format` took 16m 41s on green PR #78 (16m 49s on cold-cache `main`, 21m 33s on PR #77), well under the 35-minute limit.
- Discovered and fixed two CI-only test bugs in `nx-rust/test/batch-runs.spec.ts` as `nxr-7gm46w` (PR #78).
- Checks run: `pnpm nx format:check --all`, `zban check`, and CI on PR #77.
