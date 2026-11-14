---
title: Key this repository's test and e2e targets on the installed Rust toolchains
status: done
type: task
priority: low
tags:
  - infra
discovered_from: nxr-t9xv44
created_at: 2026-11-13T16:33:56Z
closed_at: 2026-11-14T10:13:52Z
---

Goal: a local `pnpm nx test` or `pnpm nx e2e nx-rust-e2e` does not replay a cached result after the Rust toolchain changed.

Context: the `test` and `e2e` targets that `@nx/jest/plugin` infers in this repository are cached, and their inputs name no toolchain. Their results depend on it: the fixture tests and the end-to-end suite run the real `cargo` that rustup's default chooses, and some fixture tests are skipped when toolchain 1.91.0 is not installed (`pinnedToolchainAvailable()` in `nx-rust/test`). So after `rustup default 1.91.0`, `rustup update` or installing 1.91.0, Nx replays the earlier result. Found in nxr-t9xv44, whose second CI run of the suite passes `--skip-nx-cache` for this reason. CI is not affected otherwise: each job starts with an empty Nx cache and there is no remote cache.

- [x] Choose how the targets are keyed, for example a runtime input on `cargo --version` and `rustup toolchain list` in `nx.json`, and check with `nx show project` that both targets get it
- [x] Check that changing the default toolchain makes `test` and `e2e` run again, and that an unchanged toolchain still hits the cache
- [x] Drop `--skip-nx-cache` from the second end-to-end run in `.github/workflows/ci.yml` if the new input makes it unneeded

Done when: both targets miss the cache after a toolchain change and hit it otherwise, and CI passes.

## Summary of Changes

`nx.json` has a named input `rustToolchains` with the runtime input `export RUSTUP_AUTO_INSTALL=0; cargo --version; env -u RUSTUP_TOOLCHAIN cargo --version; rustup toolchain list`, and `targetDefaults` add it to the `test` and `e2e` targets after the inputs that `@nx/jest/plugin` infers (`["...", "rustToolchains"]`). `pnpm nx show project` lists it last in the inputs of `@convesoft/nx-rust:test` and of `nx-rust-e2e:e2e`.

- The first `cargo --version` names the cargo that a test gets when it runs cargo with its own environment, `RUSTUP_TOOLCHAIN` included. The second names the cargo of rustup's default, which the commands of the test harness run, since `testEnvironment()` drops `RUSTUP_TOOLCHAIN`. Without that variable both lines are the same.
- `rustup toolchain list` changes when a toolchain such as 1.91.0 is installed or removed, which decides whether `pinnedToolchainAvailable()` skips tests, and when the default changes.
- `RUSTUP_AUTO_INSTALL=0` keeps rustup from installing a toolchain that the command selects. The command printed the same text on two runs with unchanged toolchains.
- In a throwaway workspace with a runtime input reading a file outside it, Nx 24.0.6 evaluated the input afresh on every run, with the daemon on as well, so the key follows a toolchain change without a daemon restart.
- `.github/workflows/ci.yml`: the second end-to-end step (Cargo 1.91.0) no longer passes `--skip-nx-cache`, and its comment says why it does not replay the first step's result. No job or step was renamed, added or removed.

Checks, without changing the machine's default toolchain. A private `RUSTUP_HOME` linked `~/.rustup/toolchains` and `update-hashes` and had a `settings.toml` of its own with the default 1.91.0. All runs used `NX_DAEMON=false`.

- The runtime command printed `cargo 1.91.0 (ea2d97820 2025-10-10)` twice and `1.91.0-x86_64-unknown-linux-gnu (active, default)` with the private `RUSTUP_HOME`, against cargo 1.100.0 and `stable-… (active, default)` without it. With `RUSTUP_TOOLCHAIN=1.91.0`, only the first line and the `(active)` marker changed.
- `pnpm nx e2e nx-rust-e2e`: on stable and unchanged, it replayed from the cache. With the private `RUSTUP_HOME` it ran (30 passed on cargo 1.91.0). Run again the same way, it replayed. Back on stable, it replayed the earlier stable result.
- `pnpm nx test @convesoft/nx-rust --testPathPatterns=split-words`, five runs with the same overrides: stable ran, stable hit the cache, 1.91.0 ran, 1.91.0 hit, stable hit. One spec file keeps the runs short. The overrides were the same in all five, so only the toolchain differed.
- `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, the final `pnpm nx e2e nx-rust-e2e` and `zban check` pass. The `Done when` item "CI passes" is covered by CI on this issue's pull request.
