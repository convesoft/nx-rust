---
title: "0.3: nextest, affected tests and the coverage baseline"
status: todo
type: epic
tags:
  - milestone
blocked_by:
  - nxr-9y4eh8
created_at: 2026-11-12T18:20:01Z
---

Add the nextest runner, selection of affected tests inside the single `test` target, and the workspace-level target that maintains the coverage baseline.

Specified in `nx-rust/docs/testing.mara.md` and `ci.mara.md`: `REQ-TEST-RUNNER`, `REQ-DOCTESTS`, `REQ-AFFECTED-TESTS`, `REQ-TEST-MODE-KEY`, `REQ-SELECTION-SAFETY`, `REQ-BASELINE`. Verification: `VER-TESTING`.

- [ ] All child issues are closed
- [ ] `VER-TESTING` passes
- ~~0.3 is published to npm~~ Cancelled on 14 November 2026: no 0.x milestone is published on its own; publishing is decided at 1.0 (maintainer, `ADR-PUBLISHING-AT-1-0`).
- [ ] The status notes of `testing.mara.md` and `ci.mara.md` are updated
