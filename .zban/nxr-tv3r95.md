---
title: Add the napi-build target
status: todo
type: feature
parent: nxr-z9jq1n
blocked_by:
  - nxr-v3y6cr
created_at: 2026-11-12T18:20:01Z
---

Goal: a crate that produces a Node addon has a cached `napi-build` target for the host triple.

Implements `REQ-ARTIFACT-TARGETS`, `REQ-ARTIFACT-CACHE`, `DES-ARTIFACT-STEPS` and `DES-NAPI` (`nx-rust/docs/artifacts.mara.md`). Checked by `VER-ARTIFACTS`. How a crate is recognised as producing a Node addon was agreed on 2026-11-12 and is in `DES-ARTIFACT-STEPS`.

- [x] Agree with the user how a napi crate is recognised, and record it in `DES-ARTIFACT-STEPS`
- [ ] Infer the target by that rule, with the `artifacts` override
- [ ] The compile step for the host triple, inside the batch as a group of its own kind, with `NAPI_TYPE_DEF_TMP_FOLDER` set to a folder at the group configuration's path, created empty before every compile, and `NAPI_FORCE_BUILD_<CRATE>` set to a value of this compile's own for every crate of the closure of the group's addons that depends on `napi-derive`, with or without a task in the group (`DES-NAPI`, "Compile"). Only this step sets them
- [ ] After the compile, check that every forced crate wrote its file; where one did not, fail every `napi-build` task whose addon is or depends on that crate, with the `DES-DIAGNOSTICS` row that names the crate and the two causes (no `napi_build::setup()`, no `#[napi]` item left)
- [ ] The post-processing step without `napi build`, which always runs cargo itself (`EVD-NAPI-POSTPROCESS`): copy the library that cargo reported to the `.node` file, and write `index.d.ts` and `index.js` with `readNapiConfig`, `generateTypeDef` and `writeJsBinding` of the workspace's installed `@napi-rs/cli`, from a folder of the task's own that holds only the type information of the crate and of its normal dependencies that use `napi-derive` (`DES-NAPI`, "Post-processing")
- [ ] Fail before cargo, with the rows of `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`), where `@napi-rs/cli` is of another major or older than 3.4.0 or a crate of the closure depends on `napi-derive` of another major than 3 (`DES-NAPI`, "What the step needs"; `ADR-NAPI-RS-3`), and where the crate's library has the file name of another crate's file as `DES-OUTPUTS` compares them (`DES-NAPI`, "Library names")
- [ ] Check the napi parts of `VER-ARTIFACTS`, including the cases the review of nxr-v3y6cr reproduced:
  - two addons in one batch, one depending on a library with `#[napi]` items, give the files that `napi build --platform` gives
  - a feature change and an export renamed through plain cargo are written right on the next run
  - the removed last `#[napi]` item of the library fails the addon's task and names the library
  - the library without a task in the group is still declared
  - a library whose build script skips `napi_build::setup()` fails the addon's task and names the library
  - two addons with one `[lib] name` both fail before cargo
  - after `napi-build`, plain `cargo build` compiles the napi crates and the ordinary crate that depends on the library again, and nothing else
- [ ] Run the check of `REQ-BUILD-INPUT-CHECK` and `DES-BUILD-INPUT-CHECK` after the compile step, as `build` does
- [ ] The napi CLI version and target triple in the key; generated files as outputs, not inputs
- [ ] Add the target to `inferredTargetNames` and `inferTargets` (`nx-rust/src/graph/targets.ts`), so that `targetNames` renames it with the collision check, and check the parts of `VER-TARGETS` (only on crates that produce a Node addon) and `VER-CONFIGURATION` (renaming) that cover it. `inferredTargetNames` is also the list of keys that `targetNames` accepts, so `napi-build` becomes a valid key there only when the target is added
- [ ] Count the napi CLI as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a crate has a `napi-build` target, with the fixture for that row that `VER-SETUP` asks for

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
