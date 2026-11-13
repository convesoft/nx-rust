---
title: Key this repository's test and e2e targets on the installed Rust toolchains
status: todo
type: task
priority: low
tags:
  - infra
discovered_from: nxr-t9xv44
created_at: 2026-11-13T16:33:56Z
---

Goal: a local `pnpm nx test` or `pnpm nx e2e nx-rust-e2e` does not replay a cached result after the Rust toolchain changed.

Context: the `test` and `e2e` targets that `@nx/jest/plugin` infers in this repository are cached, and their inputs name no toolchain. Their results depend on it: the fixture tests and the end-to-end suite run the real `cargo` that rustup's default chooses, and some fixture tests are skipped when toolchain 1.91.0 is not installed (`pinnedToolchainAvailable()` in `nx-rust/test`). So after `rustup default 1.91.0`, `rustup update` or installing 1.91.0, Nx replays the earlier result. Found in nxr-t9xv44, whose second CI run of the suite passes `--skip-nx-cache` for this reason. CI is not affected otherwise: each job starts with an empty Nx cache and there is no remote cache.

- [ ] Choose how the targets are keyed, for example a runtime input on `cargo --version` and `rustup toolchain list` in `nx.json`, and check with `nx show project` that both targets get it
- [ ] Check that changing the default toolchain makes `test` and `e2e` run again, and that an unchanged toolchain still hits the cache
- [ ] Drop `--skip-nx-cache` from the second end-to-end run in `.github/workflows/ci.yml` if the new input makes it unneeded

Done when: both targets miss the cache after a toolchain change and hit it otherwise, and CI passes.
