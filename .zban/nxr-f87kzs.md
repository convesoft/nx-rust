---
title: Reconcile "no files inside crates" in REQ-CARGO-UNCHANGED with the files artifact targets generate
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-v3y6cr
created_at: 2026-11-16T11:55:46Z
---

Goal: make the requirements agree on whether the plugin writes files into a crate's folder.

`REQ-CARGO-UNCHANGED` (`nx-rust/docs/caching.mara.md`) says "The plugin generates no files inside crates". `DES-ARTIFACT-STEPS`, `DES-NAPI` and `REQ-ARTIFACT-CACHE` have `napi-build` write the `.node` file, `index.js` and `index.d.ts` into the crate's folder, as `napi build --platform` does, and `wasm-build` writes its JS glue in the source tree. The sentence predates the artifact designs; it probably means files the user did not ask for, but it reads as a contradiction. Changing a requirement's text needs the maintainer.

- [ ] Propose wording to the maintainer (for instance: no files inside crates apart from the outputs of an artifact target the user runs) and apply it
