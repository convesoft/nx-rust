---
title: Find why a build's OUT_DIR test sees target/ where Cargo 1.91.0 is rustup's default
status: todo
type: bug
related:
  - nxr-5rrkay
discovered_from: nxr-s12cpg
created_at: 2026-11-14T20:43:21Z
---

Goal: the build input check's test "leaves out a file generated in OUT_DIR in the build directory that a dotenv file of the task names" (`nx-rust/test/build-input-check.spec.ts`) passes, or is corrected, where the tests run with Cargo 1.91.0 as rustup's default, as the end-to-end suite is run on 1.91.0 (`REQ-COMPATIBILITY`: Cargo 1.91 and later).

Found on 14 November 2026 while nxr-s12cpg ran every spec that uses the pinned toolchain through a private `RUSTUP_HOME` whose `settings.toml` names `1.91.0-x86_64-unknown-linux-gnu` as the default (toolchains symlinked, `RUSTUP_AUTO_INSTALL=0`), at eb839af plus the toolchain fix of nxr-s12cpg. The test fails deterministically, also alone (`--testPathPatterns=build-input-check -t "leaves out a file generated in OUT_DIR"`): `nx run reader:build` succeeds with one cargo call and no failure of the check, but `rust/target/debug/libreader.d` names `rust/target/debug/build/reader-<hash>/out/lines.rs`, not a path under `rust/bd/`, which the crate's `.env` (`CARGO_BUILD_BUILD_DIR=bd`) names. With the default stable toolchain (cargo 1.100.0) the test passes. Plain `CARGO_BUILD_BUILD_DIR=bd cargo +1.91.0 build -p reader` in a copy of `undeclared-files/rust` puts the build directory in `bd/` and leaves `target/debug/build` absent, so Cargo 1.91.0 itself honours the variable; what differs in the task is not known yet.

- [ ] Find out what the task's cargo receives and does on 1.91.0 (its environment, the build directory it reports, where it writes `OUT_DIR`), and whether the plugin, the harness or Nx is involved
- [ ] Fix the cause, or the test where it expects what Cargo 1.91 does not do, and record what was found in the evidence that `DES-BUILD-INPUT-CHECK` cites, if it concerns the plugin's behaviour

Done when: the test passes with 1.91.0 and with the latest stable as rustup's default, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

Pulled back from the backlog on 20 November 2026 by the maintainer, overturning line 8 of nxr-5rrkay: Cargo 1.91 is the compatibility floor because of `build.build-dir`, and the failure is deterministic on one test, so it has to be known before 1.0 whether the plugin, Nx or the test is wrong.
