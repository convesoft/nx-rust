---
title: Verify the split e2e CI workflow and optional-tool checks on GitHub Actions
status: todo
type: task
tags:
  - maintainer
parent: nxr-nm0jd6
related:
  - nxr-ryhjf1
  - nxr-27zbta
discovered_from: nxr-vk19v5
created_at: 2026-11-21T20:37:40Z
---

Goal: once 0.6/pre-1.0 changes are pushed to GitHub, verify the split end-to-end CI workflow from `nxr-ryhjf1` (`.github/workflows/ci.yml` and `.github/actions/e2e`) and confirm that the optional tools installed by `nxr-27zbta` run their real-tool tests in CI instead of skipping.

Context: `nxr-vk19v5` line 27 notes that `.github/workflows/ci.yml` cannot be verified until the maintainer pushes to GitHub. This task sits inside milestone 1.0 (`nxr-nm0jd6`) and is tagged `maintainer` because pushing to GitHub and inspecting branch-protection checks are maintainer actions.

- [ ] Confirm `e2e-stable` and `e2e-msrv` start in parallel, `./.github/actions/e2e` resolves after checkout, and each job prints its expected `cargo --version`
- [ ] Confirm the required check `End-to-end tests` reports both results and satisfies branch protection on `main`
- [ ] Cancel one toolchain job (`e2e-stable` or `e2e-msrv`) once on a test PR/push and confirm `End-to-end tests` fails
- [ ] Confirm the `Build, lint, test and format` job runs the real-tool tests (`cargo-nextest`, `cargo-hakari`, `wasm-bindgen`, `wasm32-unknown-unknown`) added in `nxr-27zbta` without skipping them

Done when: all four checks above are observed on a real GitHub Actions run and recorded in `## Summary of Changes`.
