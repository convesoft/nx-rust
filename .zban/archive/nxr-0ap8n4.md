---
title: Add the wasm-build target
status: done
type: feature
parent: nxr-z9jq1n
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T21:14:54Z
---

Goal: a crate that produces a wasm package has a cached `wasm-build` target that JS projects can depend on.

Implements `REQ-ARTIFACT-TARGETS`, `REQ-ARTIFACT-CACHE`, `DES-ARTIFACT-STEPS` and `DES-WASM` (`nx-rust/docs/artifacts.mara.md`). Checked by `VER-ARTIFACTS`. How a crate is recognised as producing a wasm package was agreed on 2026-11-12 and is in `DES-ARTIFACT-STEPS`.

- [x] Agree with the user how a wasm crate is recognised, and record it in `DES-ARTIFACT-STEPS`
- [x] Infer the target by that rule, with the `artifacts` override
- [x] The compile step for the wasm triple, inside the batch
- [x] The `wasm-bindgen` CLI step with the JS flavour flag, outputs outside Cargo's directories
- [x] The CLI and crate version check
- [x] Run the check of `REQ-BUILD-INPUT-CHECK` and `DES-BUILD-INPUT-CHECK` after the compile step, as `build` does
- [x] Tool versions and target triple in the key; generated files as outputs, not inputs
- [x] Add the target to `inferredTargetNames` and `inferTargets` (`nx-rust/src/graph/targets.ts`), so that `targetNames` renames it with the collision check, and check the parts of `VER-TARGETS` (only on crates that produce a wasm package) and `VER-CONFIGURATION` (renaming) that cover it. `inferredTargetNames` is also the list of keys that `targetNames` accepts, so `wasm-build` becomes a valid key there only when the target is added
- [x] Count the `wasm-bindgen` CLI and the wasm target as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a crate has a `wasm-build` target, with the fixture for that row that `VER-SETUP` asks for
- [x] Check the consumer part of `VER-ARTIFACTS` for `wasm-build` (added by nxr-ym403k, `DES-MIXED-PROJECTS` "Consumers"): a JS project in a fixture whose `build` depends on the crate's `wasm-build` and has the artifact's outputs as a `dependentTasksOutputFiles` input gets a new key when only `RUSTFLAGS` changes, and without that input it does not. Where the wasm crate also has a `package.json`, the project is the one of `VER-MIXED-PROJECTS`

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

`wasm-build` is inferred on crates that produce a wasm package (cdylib with a direct normal dependency on `wasm-bindgen`, or `artifacts = ["wasm"]`), runs `@convesoft/nx-rust:cargo-outputs`, compiles with `cargo build --target wasm32-unknown-unknown --keep-going --message-format=json` in the batch (one crate per command under `workspace-build`; `-p` per crate under `hakari` where `platforms` lists host and wasm triple, else one per crate; `-p` under `cargo`), runs the lockfile post-check and the build input check after it, and then `wasm-bindgen --target <jsFlavour> --out-dir <crate>/pkg` on the `.wasm` file that cargo's `compiler-artifact` message of this compile reports. Before cargo it fails for a missing wasm target, a missing CLI, a CLI version other than the lockfile's `wasm-bindgen`, an invalid `jsFlavour` and a shared `[lib]` name. Key: build's inputs, options, the CLI's version (runtime input) and `WASM_BINDGEN_ANYREF`/`EXTERNREF`/`MULTI_VALUE`; output `pkg`, left out of the named input `default`. init counts the CLI and the wasm target as needed per crate with `wasm-build`. Same defect fixed: the build input check now names `<name>.d` for a cdylib built for a wasm triple (it read nothing before). Knowledge: `DES-WASM` rewritten (provisional: feature/profile options, `jsFlavour` default `bundler`, folder `pkg`), new `EVD-WASM-POSTPROCESS`, `DES-BUILD-INPUT-CHECK` point 1 corrected, rows in `DES-INPUTS`, `DES-OUTPUTS`, `DES-DIAGNOSTICS`, `DES-PLUGIN-OPTIONS`, `DES-BATCH`. Fixture `wasm-packages` with a local registry; tests in `wasm-build.spec.ts` and `init.spec.ts`.

Review fixes of 02ed6a2: the key now tells an unset `WASM_BINDGEN_ANYREF`, `WASM_BINDGEN_EXTERNREF` and `WASM_BINDGEN_MULTI_VALUE` from an empty one through one line per variable in the runtime input that prints the CLI version (the CLI acts on presence, Nx 24 hashes unset and empty `env` inputs alike); the wasm compile passes `--lib` in every group form, so a binary of the crate no longer overwrites the library's `.wasm`, the JSON reading expects the library unit alone and the build input check names no binary record. `napi-build` checked and unchanged: on the host the library and a binary of one crate have different file names. Recorded in `DES-WASM`, the `DES-INPUTS` row and `EVD-WASM-POSTPROCESS`.

Checks on the final head c68f0b0 (local `main` 78d1b22 merged, unchanged since): `NX_DAEMON=false pnpm nx run-many -t build lint test --skip-nx-cache` with the private `wasm-bindgen` 0.2.130 on `PATH` and a private `RUSTUP_HOME` whose default is 1.100.0: 64 suites, 1937 passed, 18 skipped, 3 todo; `wasm-build.spec.ts` alone 15 of 15, none skipped; `pnpm nx format:check --all`; `wasm-build.spec.ts` and `build-input-check.spec.ts` on Cargo 1.91.0 via a private `RUSTUP_HOME`: 55 passed, 7 skipped (the wasm real-tool cases), 1 failed, the known OUT_DIR case of nxr-8paqsn; `mara schema validate`, `mara project validate` (valid, evaluation complete, no diagnostics), `zban check`. Before the review, on 02ed6a2: `NX_DAEMON=false pnpm nx e2e nx-rust-e2e --skip-nx-cache` on cargo 1.100.0, 27 of 27 (not rerun after the fixes; the control plane runs it on both Cargo versions).

Known limits, filed: nxr-pw77kk (build for a wasm triple stores no `.wasm`), nxr-z8cn3b (wasm cdylib record among shared names), nxr-27zbta (CI installs no optional tool). The `cargo` strategy needs nightly and was covered by unit tests only.
