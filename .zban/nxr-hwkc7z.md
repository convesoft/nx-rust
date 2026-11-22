---
title: Attribute denied warnings per crate in the JSON compile steps and the test steps
status: todo
type: feature
priority: deferred
tags:
  - deferred
  - backlog
related:
  - nxr-w1qhmx
discovered_from: nxr-tjxcvx
created_at: 2026-11-22T12:31:29Z
---

Cites: `DES-BATCH`, `DES-TEST-RUN`, `DES-UNIFICATION`, `EVD-CARGO-TARGET-COMMANDS`, `GOAL-TRUSTED-CACHE`.

Where Cargo denies warnings (`build.warnings = "deny"`, `CARGO_BUILD_WARNINGS=deny`), a step with JSON messages fails every task that passed as soon as its messages report a warning (`DES-BATCH`, "Denied warnings", from nxr-tjxcvx), and a test step that denied warnings stop fails every test task (nxr-w1qhmx). Both fail tasks whose crate does not use the crate with the warning. The maintainer moved per-crate attribution to the backlog on 22 November 2026.

A first attempt in nxr-tjxcvx (PR #89 at 2e4ee67) attributed warnings by walking path dependencies in the `cargo metadata --no-deps` report. A review reproduced three false passes on Cargo 1.100.0, in each of which plain cargo exits with 101 under `CARGO_BUILD_WARNINGS=deny` and the Nx task exits with 0 with the cache bypassed. Any design must pass all three:

1. **Path patches.** In `patched-workspaces`, append `pub fn warns() { let unused = 1; }` to `rust/crates/model/src/lib.rs`; the workspace patches `api`'s crates.io dependency `model` to that member. `cargo check --offline --all-targets -p api` fails; `nx run api:check --skip-nx-cache` passed, because the `--no-deps` report gives `api`'s dependency no `path`.
2. **A path that leaves and re-enters the workspace.** In `batch-groups`, make `dep` depend by path on a sibling folder `outer` outside the workspace, give `outer` a path dependency on the member `base`, and add an unused variable to `base`. `cargo check --offline --all-targets -p dep` fails; `nx run dep:check --skip-nx-cache` passed, because the walk stopped outside the workspace.
3. **Feature selection.** In `workspace-tests`, add `#[cfg(not(feature = "x"))] pub fn without_x() { let unused = 1; }` to `shared`; `a` does not turn `x` on, `b` does. `cargo check --offline --all-targets -p a` fails; `nx run a:check --skip-nx-cache` passed, because its `--workspace` command turns `x` on through `b` (`DES-UNIFICATION`) and cargo reports no warning. No attribution over that command's messages can recover it.

The review also found conservative over-counts of such a walk: optional and target-specific dependencies that are not active, and a dependency's own tests compiled under `--workspace --all-targets`.

- [ ] Find a source of per-crate truth that covers the three cases (for example Cargo's unit graph once it is stable, or a per-crate command where a warning was reported), and weigh its cost against failing every task
- [ ] Propose the design in `DES-BATCH` and `DES-TEST-RUN` for the maintainer

Done when: the maintainer has decided on a design, or decided against per-crate attribution, and the decision is recorded in Mara.
