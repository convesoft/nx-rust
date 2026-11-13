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
- [ ] The compile step for the host triple, inside the batch
- [ ] The napi CLI step: `.node` file, JS and type definitions
- [ ] Run the check of `REQ-BUILD-INPUT-CHECK` and `DES-BUILD-INPUT-CHECK` after the compile step, as `build` does
- [ ] The napi CLI version and target triple in the key; generated files as outputs, not inputs
- [ ] Add the target to `inferredTargetNames` and `inferTargets` (`nx-rust/src/graph/targets.ts`), so that `targetNames` renames it with the collision check, and check the parts of `VER-TARGETS` (only on crates that produce a Node addon) and `VER-CONFIGURATION` (renaming) that cover it. `inferredTargetNames` is also the list of keys that `targetNames` accepts, so `napi-build` becomes a valid key there only when the target is added
- [ ] Count the napi CLI as needed in `init`'s table of tools (`nx-rust/src/tools/optional-tools.ts`) where a crate has a `napi-build` target, with the fixture for that row that `VER-SETUP` asks for

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
