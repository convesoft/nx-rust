---
title: Add the lockfile messages to DES-DIAGNOSTICS
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
blocked_by:
  - nxr-dp5q0f
discovered_from: nxr-pn1hwr
created_at: 2026-11-13T11:59:56Z
---

Goal: `DES-DIAGNOSTICS` lists the two messages that `DES-LOCKFILE-HASHING` gives about `Cargo.lock`, once nxr-dp5q0f has accepted that item. Pull request #9 had not merged when nxr-pn1hwr closed, so the rows were not written into the draft.

- [ ] A row for a workspace without `Cargo.lock`: a warning when the graph is created that its crates' cached targets run uncached until the file exists
- [ ] A row for a `Cargo.lock` that cannot be parsed: the `lockfile` task fails with a message that names the file
- [ ] Check that `VER-SETUP` still covers both

Done when: both rows are in the accepted `DES-DIAGNOSTICS`, and `mara schema validate` and `mara project validate` report `valid: true`.
