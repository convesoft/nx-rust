---
title: Reconcile "no files inside crates" in REQ-CARGO-UNCHANGED with the files artifact targets generate
status: done
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-v3y6cr
created_at: 2026-11-16T11:55:46Z
closed_at: 2026-11-19T15:30:26Z
---

Goal: make the requirements agree on whether the plugin writes files into a crate's folder.

`REQ-CARGO-UNCHANGED` (`nx-rust/docs/caching.mara.md`) says "The plugin generates no files inside crates". `DES-ARTIFACT-STEPS`, `DES-NAPI` and `REQ-ARTIFACT-CACHE` have `napi-build` write the `.node` file, `index.js` and `index.d.ts` into the crate's folder, as `napi build --platform` does, and `wasm-build` writes its JS glue in the source tree. The sentence predates the artifact designs; it probably means files the user did not ask for, but it reads as a contradiction. Changing a requirement's text needs the maintainer.

- [x] Propose wording to the maintainer (for instance: no files inside crates apart from the outputs of an artifact target the user runs) and apply it

## Summary of Changes

- `REQ-CARGO-UNCHANGED` (`nx-rust/docs/caching.mara.md`): "The plugin generates no files inside crates." now excepts the outputs of an artifact target that the user runs, naming the `.node` file, `index.js` and `index.d.ts` of `napi-build` (DES-NAPI) and the `pkg` folder of `wasm-build` (DES-WASM). The maintainer approved the wording on 19 November 2026.
- The principles table of `nx-rust/docs/product.mara.md` now says "no generated files inside crates apart from artifact outputs".
- Left as they are: `setup.mara.md` (`nx add` writes nothing into crates, still true), `VER-CARGO-UNCHANGED` (its cycle runs `build test lint` only, no artifact target), the READMEs and AGENTS.md (no such sentence).
- Checks: `pnpm nx format:write`, `mara schema validate`, `mara project validate` (valid, evaluation complete), `zban check`, `pnpm nx format:check --all`. No tests: text only.
