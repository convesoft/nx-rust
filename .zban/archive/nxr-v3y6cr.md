---
title: Check that the napi CLI can post-process an existing cargo build
status: done
type: task
tags:
  - spike
parent: nxr-z9jq1n
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T11:23:37Z
---

Goal: confirm or refute the first assumption in `RISK-NAPI-TOOLING` (`nx-rust/docs/decisions.mara.md`). `DES-NAPI` needs it so that compiling stays in the batch.

- [x] Build a napi crate with plain `cargo build`, then produce the `.node` file, JS and type definitions from that build with the napi CLI
- [x] If the CLI insists on running cargo itself: what it would cost to let `napi-build` leave the batch
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [x] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

Result: the first assumption of `RISK-NAPI-TOOLING` holds, but not through `napi build`. `@napi-rs/cli` 3.10.12 and 2.18.4 always run cargo themselves, and 3.10.12 always does so for the one package and with `--target`. After a plain workspace build, that compiled 33 of 34 units again. A plain `cargo build` with `NAPI_TYPE_DEF_TMP_FOLDER` set to an existing folder writes each napi crate's type information and rebuilds only the crates whose build scripts call `napi_build::setup()`. The CLI's exported `generateTypeDef` and `writeJsBinding` (from 3.3.0) and `readNapiConfig` (from 3.4.0) then write `index.d.ts` and `index.js` byte-identical to `napi build --platform`, as long as each crate gets only its own files and those of its napi-derive dependencies. Compiling stays in the batch.

- New `EVD-NAPI-POSTPROCESS` (accepted), in `nx-rust/docs/decisions.mara.md`.
- `RISK-NAPI-TOOLING`: first assumption checked. Residual risk is drift of napi-rs's undocumented contracts; consequence lowered to minor. The `cargo test` question stays open (nxr-w7j0wn).
- `DES-NAPI` rewritten: compile, post-processing and what the step needs. Also the user guidance in `artifacts.mara.md`, a new row in `DES-DIAGNOSTICS` (`setup.mara.md`), and the napi checks in `VER-ARTIFACTS`.
- nxr-tv3r95: compile and post-processing tasks made concrete; failure checks and `VER-ARTIFACTS` checks added.
- Backlog: nxr-w2rbxq (napi-rs 2 crates).

Rejected: running `napi build` per crate outside the batch, which compiles the dependency tree a second time with per-package features. Also rejected: running `napi build` with `CARGO` set to a no-op, because the CLI reads from `target/<triple>/` and from a type-def folder whose path it hashes itself.

Checks run: `mara schema validate`, `mara project validate` (`valid: true`, `evaluation_complete: true`, no diagnostics), `pnpm nx format:check --all`, `zban check`. No test suite: documents only. Not run: macOS, other triples, napi-derive 2.

## Revision after review

The review of 39ae9e9 found six gaps, and the control plane decided them. A second experiment workspace backs the rules (`EVD-NAPI-POSTPROCESS`, last bullet). It had a napi helper, an ordinary crate that depends on it, and a helper whose build script skips `napi_build::setup()`.

- **Fresh folder and forcing.** The compile now empties the folder at the group configuration's path before every compile, and forces every napi-derive crate of the addons' closure with a new value each compile. After cargo, it fails the dependent tasks for any forced crate that wrote no file.
  - Forcing did not reach the helper that skips `setup()`; only touching its source did.
  - The helper without a task was written once forced.
  - Removing the last `#[napi]` item left no file.
  - A new folder path for each compile would rebuild every napi crate of the workspace, so the path stays per configuration.
- **Two crates with one library name.** `napi-build` fails before cargo, with a reference to `DES-OUTPUTS`.
- **Cost stated truthfully.** The napi crates and their dependents are rebuilt, and plain cargo and `napi-build` rebuild them for each other. Recorded in the new `ADR-NAPI-SHARED-BUILD-DIR` (accepted, provisional) and in the guide.
- **napi-rs 3 only.** Recorded in the new `ADR-NAPI-RS-3` (accepted, provisional); the guide states the versions in its opening.
- **Cases carried forward.** `VER-ARTIFACTS`, `DES-DIAGNOSTICS` (three rows) and nxr-tv3r95 now include the reviewer's cases.
- **New backlog issue:** nxr-f87kzs (`REQ-CARGO-UNCHANGED`'s "no files inside crates" against artifact outputs).

Checks run again: `mara schema validate`, `mara project validate`, `pnpm nx format:check --all`, `zban check`.
