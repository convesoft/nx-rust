---
title: Install the optional tools in CI so real-tool tests run there
status: todo
type: task
discovered_from: nxr-0ap8n4
created_at: 2026-11-16T20:48:18Z
---

`verification.mara.md` ("How the plugin is tested") says that CI installs every optional tool, so that the checks that need one run there. `.github/workflows/ci.yml` installs none of them: cargo-nextest, cargo-hakari, the `wasm-bindgen` CLI and the `wasm32-unknown-unknown` target are missing, so the cases of `hakari-runs.spec.ts`, `wasm-build.spec.ts` and others that need a real tool skip in CI with their warning. The wasm cases need the CLI of the version that `wasm-packages` locks (0.2.130), which `NX_RUST_TEST_WASM_BINDGEN` can name (`nx-rust/test/README.md`).

- [ ] Install `cargo-nextest`, `cargo-hakari`, `wasm-bindgen` 0.2.130 (matching `wasm-packages`'s lockfile, exported via `NX_RUST_TEST_WASM_BINDGEN` or on `PATH`), and the `wasm32-unknown-unknown` target in the Linux `Build, lint, test and format` job in `.github/workflows/ci.yml` (respecting `ADR-CI-LINUX-ONLY`)
- [ ] Keep `verification.mara.md`'s claim intact and verify that the installed tool versions and environment variables match what `hakari-runs.spec.ts`, `nextest-runs.spec.ts` and `wasm-build.spec.ts` expect

Maintainer decision (21 November 2026, from review of `nxr-bhh3mm` line 38): install the optional tools in CI so the real-tool checks run there as `verification.mara.md` states (do not weaken `verification.mara.md`). Live execution on GitHub Actions will be verified in `nxr-vqe9kb` once pushed.

Done when: `.github/workflows/ci.yml` installs the optional tools at the required versions for Linux CI, `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.
