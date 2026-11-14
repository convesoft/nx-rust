---
title: Key the compiler that RUSTC or CARGO_BUILD_RUSTC names
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-0haa7z
created_at: 2026-11-13T15:20:15Z
closed_at: 2026-11-14T09:15:35Z
---

Goal: the toolchain in a task's key is the compiler that cargo uses for the task, also when `RUSTC` or `CARGO_BUILD_RUSTC` names one, or the knowledge base states where it is not.

Concerns `REQ-TOOLCHAIN-KEY`, the toolchain and environment inputs of `DES-INPUTS` (`nx-rust/docs/caching.mara.md`), `ADR-WORKSPACE-ROOT` (`nx-rust/docs/decisions.mara.md`) and `RISK-UNDECLARED-INPUTS`.

Observed while researching nxr-0haa7z on 2026-11-13, with rustup 1.29.3 and the toolchains 1.98.1 (pinned by the workspace's `rust-toolchain.toml`) and 1.97.1, not yet recorded as evidence: with `RUSTC` or `CARGO_BUILD_RUSTC` set to the 1.97.1 `rustc`, `cargo build -v` in the workspace root compiled with 1.97.1 and passed that path to build scripts as `RUSTC`, while `rustc -Vv` in the same folder and environment reported 1.98.1. The `env` inputs hash only the variable's text, so an update of the compiler at that path, such as `rustup update stable` for a channel's path, changes no key. `build.rustc` in a `.cargo/config.toml` should behave the same way; that was not tried.

- [x] Reproduce the observation and record it as an evidence item, also for `build.rustc`
- [x] Propose to the maintainer how the toolchain input follows these settings, or which of them stay a stated limit, and update the items
- [x] Extend `VER-CACHE-KEYS` with the cases the answer covers
- [x] Implement the decided rule, with tests on the real hasher and real Nx runs for the two reproduced restores (added to this issue's scope by the maintainer)

Done when: the maintainer has decided, the items say what the key holds in each case, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

**Maintainer's decision (14 November 2026).** The maintainer chose "Ask cargo's compiler, cheap (Recommended)", design A1 of the research: the toolchain input asks the compiler that cargo will run in the workspace root, from `RUSTC`, else `CARGO_BUILD_RUSTC`, else `build.rustc` (resolved at graph creation as cargo resolves it), else `rustc`, and on `doc` and `test` the rustdoc chosen the same way; keys stay the same where none of these is set. Agreed limits: `build.rustc` / `build.rustdoc` outside the repository are read at graph creation (under the daemon a change counts once the graph is created again), a `CARGO_HOME` that only a task's dotenv sets is not followed, and a wrapper counts by its name only. The proposal step is done.

**Knowledge.** New `EVD-CARGO-COMPILER-SELECTION` (which compiler and rustdoc cargo 1.100.0 runs for each setting, rerun with 1.100.0, 1.97.1 and 1.91.0; include with 1.91 vs later; doctests use `RUSTDOC`; what the keys held before; the two end-to-end restores). Updated `DES-INPUTS` (Toolchain row, the paragraph after the table, new "What the toolchain input does not follow"), `REQ-TOOLCHAIN-KEY`, `ADR-WORKSPACE-ROOT`, `ADR-GRAPH-NO-TOOLCHAIN-INSTALL`, `RISK-HOST-ENVIRONMENT`, `VER-CACHE-KEYS` and the user guide in `caching.mara.md`.

**Implementation.** The toolchain command keeps `rustc -Vv` (the toolchain of the task's cargo, and of a rustdoc no setting names) and adds `-Vv` of the compiler that `RUSTC`, `CARGO_BUILD_RUSTC` or `build.rustc` names, and on `doc` and `test` of the rustdoc that `RUSTDOC`, `CARGO_BUILD_RUSTDOC` or `build.rustdoc` names, all in the same shell. An empty variable or a missing program yields a fresh random value, as a missing toolchain does. `build.rustc` / `build.rustdoc` are read with the precedence that #59 uses for `build.target`, now shared in `nx-rust/src/cargo/build-settings.ts`; where only an included file sets one, both Cargo 1.91's and later versions' compilers are asked.

**Checks run.**
- Before the fix (command printing what 2d02d59's prints): the nine new key and run tests failed, both runs restored `[local cache]` with the old compiler's binary.
- After: `pnpm nx run-many -t build lint test` (33 suites, 1015 passed, 1 todo), `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings), `zban check`.
- Keys unchanged without settings: Nx's hasher on every cached task of `subfolder-workspace` and `two-workspaces` (43 tasks, with and without a `CARGO_PROFILE_` variable) gave every input the same value before and after, apart from the harness's per-run `nx.json`.
- The tests that need a second toolchain run where rustup has 1.91.0 (CI installs it) and skip elsewhere.

Follow-up: nxr-v71mk3 (one reader of the configuration chain for `dep-info-basedir.ts` too).
