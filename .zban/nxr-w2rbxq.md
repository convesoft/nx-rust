---
title: Build napi-rs 2 crates in napi-build
status: todo
type: feature
priority: deferred
tags:
  - backlog
discovered_from: nxr-v3y6cr
created_at: 2026-11-16T11:23:15Z
---

Goal: decide whether `napi-build` should also serve crates built with `napi-derive` 2, which `DES-NAPI` (`nx-rust/docs/artifacts.mara.md`) leaves out: such a crate fails before cargo with a message.

Context: `EVD-NAPI-POSTPROCESS` found that `napi-derive` 2 pairs with `@napi-rs/cli` 2, which exports no functions and always runs cargo itself, and writes its type information to a single file named by `TYPE_DEF_TMP_PATH` instead of a folder. Supporting it would need a second post-processing path. Only worth doing if users of the plugin still have napi-rs 2 addons.

- [ ] Find out whether any user needs it, and agree the answer with the maintainer
- [ ] If so, design the path in `DES-NAPI` with an evidence item for napi-derive 2 and `@napi-rs/cli` 2
