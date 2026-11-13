---
title: Run the end-to-end suite on Cargo 1.91 as well as on the latest stable Cargo
status: done
type: task
tags:
  - infra
parent: nxr-w9qa5f
discovered_from: nxr-q6cxt3
created_at: 2026-11-13T15:26:27Z
closed_at: 2026-11-13T16:36:04Z
---

Goal: CI establishes `REQ-COMPATIBILITY` for the oldest supported Cargo, as the first paragraph of `VER-SETUP` (`nx-rust/docs/verification.mara.md`) asks: "The end-to-end suite runs on Linux against the oldest supported Nx and Cargo and the latest of each."

Context: the `e2e` job in `.github/workflows/ci.yml` installs only the stable toolchain, so the suite never runs with Cargo 1.91. With Nx, only 24.0.6 is supported and installed, so oldest and latest coincide for now. The harness drops `RUSTUP_TOOLCHAIN` from every command it runs (`nx-rust/test/harness/environment.ts`), so a variable set on the job does not reach the fixtures; `rustup default` does. The job names are required status checks of `main`, and the branch protection names them (`CLAUDE.md`, "Commits"). The `check` job already installs 1.91.0 for the `different-toolchains` fixture.

- [x] Decided (review of pull request #27): run the suite a second time inside the existing `e2e` job, not in a new job or a matrix, so that the required check names and the branch protection stay as they are. Install Cargo 1.91.0 in that job, and mind its time limit of 20 minutes
- [x] Run the suite with Cargo 1.91.0 as the default toolchain and with the latest stable
- [x] Note in `VER-SETUP` or the CI workflow which toolchains the runs use

Done when: CI runs the end-to-end suite on both toolchains and both pass, and `zban check` passes.

## Summary of Changes

- The `e2e` job of `.github/workflows/ci.yml` installs 1.91.0 next to stable, both with `clippy` and `rustfmt`, and runs the suite twice as two steps: first with `rustup default stable`, then with `rustup default 1.91.0`. Each step prints `cargo --version`. The job and its name are unchanged, and no matrix or job was added. The second run passes `--skip-nx-cache`, because Nx caches the `e2e` target and the toolchain is not one of its inputs (follow-up nxr-9d3fwa). It also runs when the stable run failed, so that one CI run reports both toolchains, but not when an earlier step failed. A comment above the job says which toolchains the runs use and why `rustup default` chooses them. `VER-SETUP` already asks for the oldest and the latest Cargo, so Mara is unchanged.
- Locally, `pnpm nx e2e nx-rust-e2e` passed with the latest stable (cargo 1.100.0, 33 s) and, through a private `RUSTUP_HOME` whose default was 1.91.0 and whose toolchains were the machine's, with cargo 1.91.0 (17 of 17 tests, 27 s). The machine's default toolchain was not changed. A control run with that home's default set to 1.89 failed in `nx add` with the plugin's "needs Cargo 1.91 or later" error, which shows that the default toolchain reaches the fixtures.
- Checks run: `pnpm nx run-many -t build lint test --skip-nx-cache` (399 tests passed), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete, no errors or warnings) and `zban check`, all passing.
- CI on the pull request covers the remaining part of "Done when": its `End-to-end tests` job runs the suite on both toolchains.
