---
title: Find why a build's OUT_DIR test sees target/ where Cargo 1.91.0 is rustup's default
status: done
type: bug
related:
  - nxr-5rrkay
discovered_from: nxr-s12cpg
created_at: 2026-11-14T20:43:21Z
closed_at: 2026-11-20T10:51:59Z
---

Goal: the build input check's test "leaves out a file generated in OUT_DIR in the build directory that a dotenv file of the task names" (`nx-rust/test/build-input-check.spec.ts`) passes, or is corrected, where the tests run with Cargo 1.91.0 as rustup's default, as the end-to-end suite is run on 1.91.0 (`REQ-COMPATIBILITY`: Cargo 1.91 and later).

Found on 14 November 2026 while nxr-s12cpg ran every spec that uses the pinned toolchain through a private `RUSTUP_HOME` whose `settings.toml` names `1.91.0-x86_64-unknown-linux-gnu` as the default (toolchains symlinked, `RUSTUP_AUTO_INSTALL=0`), at eb839af plus the toolchain fix of nxr-s12cpg. The test fails deterministically, also alone (`--testPathPatterns=build-input-check -t "leaves out a file generated in OUT_DIR"`): `nx run reader:build` succeeds with one cargo call and no failure of the check, but `rust/target/debug/libreader.d` names `rust/target/debug/build/reader-<hash>/out/lines.rs`, not a path under `rust/bd/`, which the crate's `.env` (`CARGO_BUILD_BUILD_DIR=bd`) names. With the default stable toolchain (cargo 1.100.0) the test passes. Plain `CARGO_BUILD_BUILD_DIR=bd cargo +1.91.0 build -p reader` in a copy of `undeclared-files/rust` puts the build directory in `bd/` and leaves `target/debug/build` absent, so Cargo 1.91.0 itself honours the variable; what differs in the task is not known yet.

- [x] Find out what the task's cargo receives and does on 1.91.0 (its environment, the build directory it reports, where it writes `OUT_DIR`), and whether the plugin, the harness or Nx is involved
- [x] Fix the cause, or the test where it expects what Cargo 1.91 does not do, and record what was found in the evidence that `DES-BUILD-INPUT-CHECK` cites, if it concerns the plugin's behaviour

Done when: the test passes with 1.91.0 and with the latest stable as rustup's default, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

Pulled back from the backlog on 20 November 2026 by the maintainer, overturning line 8 of nxr-5rrkay: Cargo 1.91 is the compatibility floor because of `build.build-dir`, and the failure is deterministic on one test, so it has to be known before 1.0 whether the plugin, Nx or the test is wrong.

## Summary of Changes

Cause: Cargo 1.91.0, not the plugin, Nx or the harness. The task's cargo received `CARGO_BUILD_BUILD_DIR=bd` from the crate's `.env`, ran in `rust/` and put `OUT_DIR` in `rust/bd` (seen through the build script's environment in a harness run). Cargo 1.91.0 stores a target's dependency paths relative to the build directory and, when it exports `target/debug/libreader.d`, joins them to the artifact directory instead (`output_depinfo.rs` of cargo 0.92.0 passes `host_root()`; 0.93.0, Rust 1.92, passes `host_build_root()`, rust-lang/cargo#16092). Plain `cargo +1.91.0 build -p reader` gives the same misplaced path with the variable relative or absolute and with `build-dir` in `.cargo/config.toml`; 1.97.1, 1.98.1, 1.99.0 and 1.100.0 name `bd/...`. Recorded in `EVD-CARGO-DEP-INFO`, with a sentence in `DES-BUILD-INPUT-CHECK` point 4 and `VER-BUILD-INPUT-CHECK`.

The plugin needs no change: the misplaced path lies in the artifact directory and the real one in the build directory, both left out, so the check compares the same files on every supported Cargo. The test's assumption was wrong for 1.91: its build script now also names the generated file with `rerun-if-changed`, which 1.91 exports with its real path, and the test expects the include's path below `target` before Cargo 1.92 and below `bd` from 1.92 on. Without the plugin's build-directory exclusion the test now fails on 1.91.0 too.

Checks: `pnpm nx run-many -t build lint test` on the default toolchain (cargo 1.100.0): 8 tasks succeeded, 68 suites, 1984 tests passed, 62 skipped, 6 todo. `nx-rust/test/build-input-check.spec.ts` with 1.91.0 as rustup's default through a private `RUSTUP_HOME`: 49 of 49 passed; the changed test alone also passed with 1.100.0, and failed on both with the exclusion of the build directory removed. `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check` passed. The end-to-end suite was not run: the built plugin did not change.
