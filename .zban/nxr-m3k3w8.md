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
- [ ] 0.3 is published to npm
- [ ] The status notes of `testing.mara.md` and `ci.mara.md` are updated
