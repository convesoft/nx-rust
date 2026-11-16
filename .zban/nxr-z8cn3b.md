---
title: Count the record of a wasm cdylib among the record names that crates share
status: todo
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-0ap8n4
created_at: 2026-11-16T20:48:18Z
---

For a `cdylib` built for a wasm triple, the build input check reads the record `<name>.d` (`DES-BUILD-INPUT-CHECK`, point 1; `EVD-WASM-POSTPROCESS`). `sharedRecordNames` in `nx-rust/src/graph/build-records.ts` counts only `lib<name>.d` for a library, so a binary of another crate with the same artifact directory that has the library's name, also built for the wasm triple, writes the same `<name>.d`, and the check of `wasm-build` could read that crate's record instead (point 2, "A shared name"). Exotic: it needs a binary and a wasm library of one name in one artifact directory.

- [ ] Count `<name>.d` of a `cdylib` among the names that `sharedRecordNames` compares for the wasm triple, and test it with two such crates
