---
title: Add the wasm-build target
status: todo
type: feature
parent: nxr-z9jq1n
created_at: 2026-11-12T18:20:01Z
---

Goal: a crate that produces a wasm package has a cached `wasm-build` target that JS projects can depend on.

Implements `REQ-ARTIFACT-TARGETS`, `REQ-ARTIFACT-CACHE`, `DES-ARTIFACT-STEPS` and `DES-WASM` (`nx-rust/docs/artifacts.mara.md`). Checked by `VER-ARTIFACTS`. How a crate is recognised as producing a wasm package was agreed on 2026-11-12 and is in `DES-ARTIFACT-STEPS`.

- [x] Agree with the user how a wasm crate is recognised, and record it in `DES-ARTIFACT-STEPS`
- [ ] Infer the target by that rule, with the `artifacts` override
- [ ] The compile step for the wasm triple, inside the batch
- [ ] The `wasm-bindgen` CLI step with the JS flavour flag, outputs outside Cargo's directories
- [ ] The CLI and crate version check
- [ ] Tool versions and target triple in the key; generated files as outputs, not inputs

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
