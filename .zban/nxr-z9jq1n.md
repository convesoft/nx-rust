---
title: "0.4: napi and wasm artifacts"
status: todo
type: epic
tags:
  - milestone
blocked_by:
  - nxr-9y4eh8
created_at: 2026-11-12T18:20:01Z
---

Build Node addons for the host triple and wasm packages for the browser as named targets that JS projects depend on.

Specified in `nx-rust/docs/artifacts.mara.md`: `REQ-ARTIFACT-TARGETS`, `REQ-ARTIFACT-CACHE`, `DES-ARTIFACT-STEPS`, `DES-WASM`, `DES-NAPI`, and the draft `REQ-MIXED-PROJECTS`. Verification: `VER-ARTIFACTS`.

- [ ] All child issues are closed
- [ ] `VER-ARTIFACTS` passes
- ~~0.4 is published to npm~~ Cancelled on 14 November 2026: no 0.x milestone is published on its own; publishing is decided at 1.0 (maintainer, `ADR-PUBLISHING-AT-1-0`).
- [ ] The status note of `artifacts.mara.md` is updated
