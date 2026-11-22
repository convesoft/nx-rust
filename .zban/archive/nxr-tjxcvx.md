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

Commands that several tasks share (and the compile of `napi-build` and `wasm-build`) keep `--keep-going --message-format=json`, so they still reuse the build cache of plain cargo and rust-analyzer. The plugin now applies `build.warnings` to their result itself (`DES-BATCH`, new "Denied warnings" bullet). After a JSON compile step of `build`, `check`, `lint`, `napi-build` or `wasm-build`, if the messages report a warning and a task passed, it reads the setting as cargo does: `CARGO_BUILD_WARNINGS` from the step's environment, otherwise the first `build.warnings` in the configuration files, through the existing `buildSettings` walk (`nx-rust/src/cargo/warnings-setting.ts`). It then asks `cargo --version` whether this Cargo is 1.97 or later. If so, every task of the step that passed fails, and the message names the packages with warnings and what denies them (`nx-rust/src/executors/denied-warnings.ts`, wired into `group-run.ts`). `configFiles` in `nx-rust/src/cargo/redirections.ts` now finds the Cargo home through `HOME` in the environment it is given before falling back to the process's home folder.

A first version, at 2e4ee67, attributed warnings to the crates that reach the warned package through path dependencies. The review reproduced three false passes, so it was replaced (see Decisions made, and nxr-hwkc7z).

Mara: `REQ-BATCHING` is amended by the maintainer's decision of 22 November 2026 (see below). Also updated: `DES-BATCH`, `DES-TARGET-COMMANDS`, `DES-INPUTS`, `EVD-CARGO-TARGET-COMMANDS` (the 22 November experiments and the review's feature-selection case), `VER-BATCHING` and the guidance in `targets.mara.md#warnings`. `DES-TARGETS` says nothing about warnings and needed no change.

Checks run: `nx-rust/test/denied-warnings.spec.ts` with real cargo on Cargo 1.100.0 and on 1.91.0 (private `RUSTUP_HOME`). Also passed: `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`. CI on the pull request covers the last `Done when` check. The review checked `napi-build` with a denied warning by hand with the built plugin; this branch adds no spec for it.

## Decisions made

- `REQ-BATCHING` gained one sentence, and its list of reasons a task fails now names it: where Cargo denies warnings, a step whose own diagnostics report a warning, a JSON compile step or a test step, fails every task of that step that passed. This is the maintainer's decision of 22 November 2026, word for word: "Amend `REQ-BATCHING` (my recommendation). Add one sentence: where cargo denies warnings and a step reports a warning, every task of that step that passed fails."
- The step's own command is the reference, not a cargo command of each crate alone: had cargo applied the setting, that command would have failed as a whole, and cargo does not say which crates a warning fails. This fails more tasks than needed (for example one whose crate does not use the crate with the warning), never fewer of those the command covers. Every `compiler-message` of level `warning` counts, also one without a lint code, which cargo's own count leaves out. Under `workspace-build`, a warning that only the crate's own feature selection produces is not reported (`DES-UNIFICATION`). Recorded in `DES-BATCH`.
- How the plugin learns whether warnings are denied: `CARGO_BUILD_WARNINGS`, or else the configuration files through the existing `buildSettings` helper, plus `cargo --version` for the 1.97 boundary. If the version cannot be read, the plugin treats Cargo as honouring the setting. The setting is resolved only where a warning was reported and a task passed.
- Not taken, recorded in `DES-BATCH`:
  - running cargo again without JSON messages;
  - the unstable `cargo config get`;
  - attribution by dependency reach, which the review defeated with path patches, a path that leaves and re-enters the workspace, and feature selection. That attribution is kept in the backlog as nxr-hwkc7z.
- Groups of one crate that run the plain command, and the test steps, keep cargo's own verdict.

Follow-ups: nxr-w1qhmx (rc.2: name the cause where denied warnings fail the test steps; blocked by nxr-k5y74e), nxr-hwkc7z (deferred: per-crate attribution of denied warnings) and nxr-e8pebq (deferred: `build.warnings = "allow"` warnings still show in shared commands).
