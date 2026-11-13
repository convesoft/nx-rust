---
title: Update the status lines of the two READMEs
status: todo
type: task
priority: low
tags:
  - docs
discovered_from: nxr-1bv0wm
created_at: 2026-11-13T12:30:35Z
---

Goal: the root `README.md` and `nx-rust/README.md`, which npm shows, say what the plugin does today.

Both still open with "the design is specified and the implementation has not started", while discovery (nxr-7n0nqf) and project creation (nxr-1bv0wm) work. `nx-rust/docs/workspaces.mara.md` has its own status note, kept current by the issues that change it.

- [ ] Decide with the user what the status lines say before the first release, or whether they stay until it
- [ ] Update both

Done when: both READMEs agree with the docs, and `pnpm nx format:check --all` passes.
