---
title: Honour build.warnings = deny under --message-format=json
status: todo
type: bug
priority: high
parent: nxr-h52ghk
discovered_from: nxr-pt464b
created_at: 2026-11-22T10:39:28Z
---

Cites: `DES-TARGETS`, `DES-TARGET-COMMANDS`, `DES-INPUTS`, `DES-BATCH`, `REQ-CARGO-UNCHANGED`, `EVD-CARGO-TARGET-COMMANDS`.

On `1.0.0-rc.1`, under the default `workspace-build` strategy (or any multi-crate batch, `napi-build` or `wasm-build`), `sharedCommandFlags` in `nx-rust/src/executors/command.ts` passes `--keep-going --message-format=json`. Cargo 1.100 ignores `build.warnings = "deny"` and `CARGO_BUILD_WARNINGS=deny` under `--message-format=json`, so `nx lint <crate>` (and `check`, `build`, etc.) exits 0 on warnings even when `build.warnings = "deny"` is configured. (`--message-format=json-render-diagnostics` exits 101 in Cargo 1.100, but writes rendered diagnostics to unstructured stderr instead of per-crate `compiler-message` JSON.)

Maintainer decision (22 Nov 2026): do not add an `args` option to `lint`; fixing `build.warnings = "deny"` / `CARGO_BUILD_WARNINGS=deny` satisfies `mara`'s gate without splitting Cargo's build cache from plain `cargo clippy`.

- [ ] Verify Cargo's `build.warnings` resolution (`.cargo/config.toml` walk, `CARGO_BUILD_WARNINGS`, values `allow`/`warn`/`deny`, Cargo 1.97+ vs Cargo 1.91) and record the empirical `--message-format=json` finding in `EVD-CARGO-TARGET-COMMANDS`
- [ ] Update `DES-BATCH` / `DES-TARGETS` / `DES-INPUTS` (and user guidance if needed) to specify how JSON-parsed cargo steps honour `build.warnings = "deny"` while preserving per-crate diagnostic attribution and Cargo build-cache reuse
- [ ] Implement the fix across JSON-parsed cargo steps (`check`, `lint`, `build`, `napi-build`, `wasm-build`)
- [ ] Add tests with real `cargo` covering `build.warnings = "deny"` in `.cargo/config.toml` and `CARGO_BUILD_WARNINGS=deny` on single-crate `workspace-build`, multi-crate batches, and cache-key separation from allowed warnings

Done when: `build.warnings = "deny"` and `CARGO_BUILD_WARNINGS=deny` fail crates with compiler/clippy warnings under `--message-format=json`, `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check` and CI pass.
