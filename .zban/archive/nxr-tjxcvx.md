---
title: Honour build.warnings = deny under --message-format=json
status: done
type: bug
priority: high
parent: nxr-h52ghk
discovered_from: nxr-pt464b
created_at: 2026-11-22T10:39:28Z
closed_at: 2026-11-22T12:02:07Z
---

Cites: `DES-TARGETS`, `DES-TARGET-COMMANDS`, `DES-INPUTS`, `DES-BATCH`, `REQ-CARGO-UNCHANGED`, `EVD-CARGO-TARGET-COMMANDS`.

On `1.0.0-rc.1`, under the default `workspace-build` strategy (or any multi-crate batch, `napi-build` or `wasm-build`), `sharedCommandFlags` in `nx-rust/src/executors/command.ts` passes `--keep-going --message-format=json`. Cargo 1.100 ignores `build.warnings = "deny"` and `CARGO_BUILD_WARNINGS=deny` under `--message-format=json`, so `nx lint <crate>` (and `check`, `build`, etc.) exits 0 on warnings even when `build.warnings = "deny"` is configured. (`--message-format=json-render-diagnostics` exits 101 in Cargo 1.100, but writes rendered diagnostics to unstructured stderr instead of per-crate `compiler-message` JSON.)

Maintainer decision (22 Nov 2026): do not add an `args` option to `lint`; fixing `build.warnings = "deny"` / `CARGO_BUILD_WARNINGS=deny` satisfies `mara`'s gate without splitting Cargo's build cache from plain `cargo clippy`.

- [x] Verify Cargo's `build.warnings` resolution (`.cargo/config.toml` walk, `CARGO_BUILD_WARNINGS`, values `allow`/`warn`/`deny`, Cargo 1.97+ vs Cargo 1.91) and record the empirical `--message-format=json` finding in `EVD-CARGO-TARGET-COMMANDS`
- [x] Update `DES-BATCH` / `DES-TARGETS` / `DES-INPUTS` (and user guidance if needed) to specify how JSON-parsed cargo steps honour `build.warnings = "deny"` while preserving per-crate diagnostic attribution and Cargo build-cache reuse
- [x] Implement the fix across JSON-parsed cargo steps (`check`, `lint`, `build`, `napi-build`, `wasm-build`)
- [x] Add tests with real `cargo` covering `build.warnings = "deny"` in `.cargo/config.toml` and `CARGO_BUILD_WARNINGS=deny` on single-crate `workspace-build`, multi-crate batches, and cache-key separation from allowed warnings

Done when: `build.warnings = "deny"` and `CARGO_BUILD_WARNINGS=deny` fail crates with compiler/clippy warnings under `--message-format=json`, `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check` and CI pass.

## Summary of Changes

Commands that several crates share keep `--keep-going --message-format=json`, so they still reuse the build cache of plain cargo and rust-analyzer. The plugin now applies `build.warnings` to their result itself (`DES-BATCH`, new "Denied warnings" bullet). After a step of `build`, `check`, `lint`, `napi-build` or `wasm-build` whose JSON messages report a warning that could fail a task that passed, it reads the setting as cargo does: `CARGO_BUILD_WARNINGS` from the step's environment, otherwise the first `build.warnings` in the configuration files, using the existing `buildSettings` walk (`nx-rust/src/cargo/warnings-setting.ts`). It then asks `cargo --version` whether this Cargo is 1.97 or later. A task fails when there is a warning in its own crate, in a member it reaches through path dependencies, or in a package outside the workspace when it reaches a path dependency outside the workspace (`nx-rust/src/executors/denied-warnings.ts`, wired into `group-run.ts`). `groupInvocations` now hands every group the members report it already asks for. `EVD-CARGO-TARGET-COMMANDS` records the 22 November experiments on Cargo 1.100.0, 1.97.1 and 1.91.0. Also updated: `DES-TARGET-COMMANDS` (Warnings), `DES-INPUTS` (the `CARGO_BUILD_WARNINGS` bullet), `VER-BATCHING` (new "Denied warnings" bullet) and the user guidance in `targets.mara.md#warnings`. `DES-TARGETS` says nothing about warnings and needed no change.

Checks run: `nx-rust/test/denied-warnings.spec.ts` with real cargo on Cargo 1.100.0 and on 1.91.0 (private `RUSTUP_HOME`). It also fails when the fix is disabled. Also passed: `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` (27 passed), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`. CI on the pull request covers the last `Done when` check.

## Decisions made

- The plugin learns whether warnings are denied from `CARGO_BUILD_WARNINGS`, or else from the configuration files through the existing `buildSettings` helper, plus `cargo --version` for the 1.97 boundary. It does not rerun cargo without JSON, use the unstable `cargo config get`, or switch to `json-render-diagnostics`, which loses the package of each diagnostic. If the version cannot be read, the plugin treats Cargo as honouring the setting, so unknown counts as failed. The setting is resolved lazily, only when a warning could fail a task that passed. Recorded in `DES-BATCH`.
- Attribution follows what `cargo <cmd> -p <crate>` would fail on: warnings in the crate itself, in members it reaches through normal and build path dependencies (and its own dev-dependencies under `--all-targets`), and in packages outside the workspace when it reaches a path dependency outside the workspace. If the members are unknown, every warning counts. A warning in a member the crate does not reach fails no task, as with errors. Recorded in `DES-BATCH`.
- Groups of one crate that run the plain command keep cargo's own verdict; nothing changes there.

Follow-ups: nxr-w1qhmx (the test steps under `workspace-build` fail every task on any member's denied warning, with an unclear message) and nxr-e8pebq (deferred: `build.warnings = "allow"` warnings still show in shared commands).
