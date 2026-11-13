---
title: Add the shared artifact directory warning to the diagnostics
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-dp5q0f
discovered_from: nxr-kq5pm5
created_at: 2026-11-13T09:41:54Z
---

Goal: `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) has the diagnostic that `DES-OUTPUTS` (`nx-rust/docs/caching.mara.md`) requires for workspaces that share an artifact directory.

Pull request #9 (nxr-dp5q0f) accepts `DES-DIAGNOSTICS`, so the row is added to the accepted table.

- [ ] Add the row to `DES-DIAGNOSTICS`
- [ ] Extend the verification that the Mara policies then require

Done when: the row is in `DES-DIAGNOSTICS`, and `mara schema validate` and `mara project validate` report `valid: true`.
