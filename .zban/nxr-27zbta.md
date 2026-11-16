---
title: Install the optional tools in CI, or say in verification.mara.md which checks CI skips
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-0ap8n4
created_at: 2026-11-16T20:48:18Z
---

`verification.mara.md` ("How the plugin is tested") says that CI installs every optional tool, so that the checks that need one run there. `.github/workflows/ci.yml` installs none of them: cargo-nextest, cargo-hakari, the `wasm-bindgen` CLI and the `wasm32-unknown-unknown` target are missing, so the cases of `hakari-runs.spec.ts`, `wasm-build.spec.ts` and others that need a real tool skip in CI with their warning. The wasm cases need the CLI of the version that `wasm-packages` locks (0.2.130), which `NX_RUST_TEST_WASM_BINDGEN` can name (`nx-rust/test/README.md`).

- [ ] Either install the tools in the CI job, at the versions the fixtures need, or correct the sentence in `verification.mara.md`
