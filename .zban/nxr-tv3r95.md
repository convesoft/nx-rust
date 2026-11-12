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
- [ ] The napi CLI version and target triple in the key; generated files as outputs, not inputs

Done when: the parts of the cited verification that cover this work pass, and `pnpm exec nx run-many -t build lint test` and `pnpm format:check` pass.
