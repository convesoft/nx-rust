---
title: Install the optional tools in CI so real-tool tests run there
status: done
type: task
discovered_from: nxr-0ap8n4
created_at: 2026-11-16T20:48:18Z
closed_at: 2026-11-21T21:01:20Z
---

`verification.mara.md` ("How the plugin is tested") says that CI installs every optional tool, so that the checks that need one run there. `.github/workflows/ci.yml` installs none of them: cargo-nextest, cargo-hakari, the `wasm-bindgen` CLI and the `wasm32-unknown-unknown` target are missing, so the cases of `hakari-runs.spec.ts`, `wasm-build.spec.ts` and others that need a real tool skip in CI with their warning. The wasm cases need the CLI of the version that `wasm-packages` locks (0.2.130), which `NX_RUST_TEST_WASM_BINDGEN` can name (`nx-rust/test/README.md`).

- [x] Install `cargo-nextest`, `cargo-hakari`, `wasm-bindgen` 0.2.130 (matching `wasm-packages`'s lockfile, exported via `NX_RUST_TEST_WASM_BINDGEN` or on `PATH`), and the `wasm32-unknown-unknown` target in the Linux `Build, lint, test and format` job in `.github/workflows/ci.yml` (respecting `ADR-CI-LINUX-ONLY`)
- [x] Keep `verification.mara.md`'s claim intact and verify that the installed tool versions and environment variables match what `hakari-runs.spec.ts`, `nextest-runs.spec.ts` and `wasm-build.spec.ts` expect

Maintainer decision (21 November 2026, from review of `nxr-bhh3mm` line 38): install the optional tools in CI so the real-tool checks run there as `verification.mara.md` states (do not weaken `verification.mara.md`). Live execution on GitHub Actions will be verified in `nxr-vqe9kb` once pushed.

Done when: `.github/workflows/ci.yml` installs the optional tools at the required versions for Linux CI, `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.

## Summary of Changes

The `Build, lint, test and format` job in `.github/workflows/ci.yml` now installs every optional tool that `verification.mara.md` ("How the plugin is tested") names, so their cases run in CI instead of skipping:

- `stable`, rustup's default and the toolchain the tests' cargo uses, gets the `wasm32-unknown-unknown` target and the `llvm-tools` component (cargo-affected's llvm-cov and llvm-profdata, which `affected-coverage.spec.ts` takes from that toolchain's sysroot).
- cargo-nextest 0.9.152, cargo-hakari 0.9.39 and wasm-bindgen 0.2.130 come from their prebuilt GitHub releases, checked against pinned SHA-256 sums, each in a folder of its own under `$RUNNER_TEMP/tools`. nextest's folder goes on `PATH`, because the specs find it only through `cargo nextest`. cargo-hakari and wasm-bindgen are named through `NX_RUST_TEST_CARGO_HAKARI` and `NX_RUST_TEST_WASM_BINDGEN`.
- cargo-affected 0.4.1, which publishes no binaries, is built with `cargo install --locked` only on a cache miss, and saved with `actions/cache/restore@v6` and `actions/cache/save@v6` right after the build, then named through `NX_RUST_TEST_CARGO_AFFECTED`.
- The job's timeout goes from 25 to 35 minutes.
- `verification.mara.md` keeps its claim and now also says how CI picks and installs the tools.

The job names, the end-to-end jobs and `.github/actions/e2e` are unchanged: no end-to-end spec mentions any of these tools.

## Decisions made

- Versions: each tool is pinned to the version the docs' evidence was gathered with (nextest 0.9.152, cargo-hakari 0.9.39, cargo-affected 0.4.1), and wasm-bindgen to 0.2.130, which `wasm-packages/rust/Cargo.lock` locks and `wasmBindgenFolder()` requires exactly. This is written in `verification.mara.md` and in the workflow's comments.
- cargo-affected and llvm-tools are installed too, although the task list named only four items, because the claim in `verification.mara.md` names cargo-affected and `affected-coverage.spec.ts` needs all three tools together.
- Each tool gets its own folder, never `~/.cargo/bin` (now recorded in `verification.mara.md`), because the cases about a missing tool hide a tool by dropping its `PATH` folder (`pathWithoutWasmBindgen()`, the "with nextest hidden" case of `missing-tools.spec.ts`). If those folders held cargo or rustc, those cases would break or skip.
- The timeout is raised to 35 minutes to make room for the newly running cases and a cold cargo-affected build.

## Checks

- Ran in the CI environment (`CI=true GITHUB_ACTIONS=true`, agent variables unset): `pnpm nx run-many -t build lint test --skip-nx-cache` passed in 7m08s. It used a private `RUSTUP_HOME` with default toolchain 1.100.0, which has wasm32 and musl, a separate `PATH` folder with cargo-nextest 0.9.152, and `NX_RUST_TEST_WASM_BINDGEN` naming a folder with wasm-bindgen 0.2.130.
- A targeted run of wasm-build, nextest-runs, missing-tools, affected-runs, test-mode, coverage-baseline and hakari-runs in that same environment: 7 suites passed, 121 tests passed and 5 skipped. The only skips were the hakari drift cases, since cargo-hakari is not on this machine. No nextest or wasm warning appeared.
- `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete, 0 errors and 0 warnings) and `zban check` passed.
- Checked by reading only, because the workflow cannot run here and its live run is nxr-vqe9kb:
  - The release URLs and archive layouts: archives downloaded to `$TMPDIR` and listed, not installed. Their SHA-256 sums match the upstream `.sha256` files for nextest and wasm-bindgen and GitHub's asset digests for all three.
  - `cargo-hakari hakari --version` prints `cargo-hakari 0.9.39`.
  - cargo-affected 0.4.1 ships a `Cargo.lock`, and its `rust-version` is 1.94.
  - The output names of `actions/cache/restore@v6`.
  - The variable names the harness reads (`harness/hakari.ts`, `harness/wasm.ts`, `harness/affected.ts`).
  - The wasm32 target and llvm-tools go to `stable`, which `rustup default stable` makes the toolchain of the tests' cargo, and no `rust-toolchain` file sits above the test working directory.
  - Neither cargo-affected nor llvm-tools could be run here, so the real `affected-coverage.spec.ts` cases and the hakari drift cases first run in nxr-vqe9kb.

Follow-up: nxr-ty0a0k (musl target and cargo-deny, which some cases still skip without; outside what `verification.mara.md` promises).
