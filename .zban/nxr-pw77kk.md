---
title: Store the .wasm file of a cdylib that build compiles for a wasm triple
status: todo
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-0ap8n4
created_at: 2026-11-16T20:48:18Z
---

`targetOutputs` in `nx-rust/src/graph/outputs.ts` names a library's `cdylib` file as `lib<name>.so` and `lib<name>.dylib` (`DES-OUTPUTS`). Built for a wasm triple with `targetTriple`, such as `wasm32-unknown-unknown`, cargo writes the `cdylib` as `<name>.wasm` without the `lib` prefix (`EVD-WASM-POSTPROCESS`), so a cached `build` stores no `.wasm` file and a cache hit restores none. `wasm-build` is not concerned: its output is the package folder.

- [ ] Decide in `DES-OUTPUTS` whether `build` names `<name>.wasm` for a `cdylib` built for a wasm triple, and implement it with a test that restores the file
