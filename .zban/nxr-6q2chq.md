---
title: "0.5: Releasing with Nx release"
status: todo
type: epic
tags:
  - milestone
blocked_by:
  - nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Version and publish crates through Nx release. Specified in `nx-rust/docs/release.mara.md` (`REQ-RELEASE`, `DES-RELEASE`) with `ADR-BATCHED-PUBLISH` and `ADR-RELEASE-DEPENDENTS`; verification: `VER-RELEASE`. Publishing rests on the batch executor of milestone 0.2 (nxr-s12cpg), and the hack-crate guard on the detection of cargo-hakari configurations that milestone 0.2 brings (nxr-k64tm5).

- [ ] All child issues are closed
- [ ] The verification written with the release specification passes
- ~~0.5 is published to npm~~ Cancelled on 14 November 2026: no 0.x milestone is published on its own; publishing is decided at 1.0 (maintainer, `ADR-PUBLISHING-AT-1-0`).
- [ ] The status note of `release.mara.md` is updated
