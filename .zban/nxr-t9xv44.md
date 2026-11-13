---
title: Run the end-to-end suite on Cargo 1.91 as well as on the latest stable Cargo
status: todo
type: task
tags:
  - infra
parent: nxr-w9qa5f
discovered_from: nxr-q6cxt3
created_at: 2026-11-13T15:26:27Z
---

Goal: CI establishes `REQ-COMPATIBILITY` for the oldest supported Cargo, as the first paragraph of `VER-SETUP` (`nx-rust/docs/verification.mara.md`) asks: "The end-to-end suite runs on Linux against the oldest supported Nx and Cargo and the latest of each."

Context: the `e2e` job in `.github/workflows/ci.yml` installs only the stable toolchain, so the suite never runs with Cargo 1.91. With Nx, only 24.0.6 is supported and installed, so oldest and latest coincide for now. The harness drops `RUSTUP_TOOLCHAIN` from every command it runs (`nx-rust/test/harness/environment.ts`), so a variable set on the job does not reach the fixtures; `rustup default` does. The job names are required status checks of `main`: a matrix that renames the job, or a second job, needs the branch protection changed as well (`CLAUDE.md`, "Commits"), which only the maintainer can do. The `check` job already installs 1.91.0 for the `different-toolchains` fixture.

- [ ] Choose with the maintainer between a second run of the suite in the existing job (time limit 20 minutes) and a matrix or second job with the branch protection updated
- [ ] Run the suite with Cargo 1.91.0 as the default toolchain and with the latest stable
- [ ] Note in `VER-SETUP` or the CI workflow which toolchains the runs use

Done when: CI runs the end-to-end suite on both toolchains and both pass, and `zban check` passes.
