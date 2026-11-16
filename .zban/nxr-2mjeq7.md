---
title: Add cargo-hakari's ways where cargo refuses a crate whose dependency on the hack crate has no version (dep-format 1)
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-k4c6ek
created_at: 2026-11-16T18:15:59Z
---

Under `dep-format-version = "1"`, `cargo hakari manage-deps` gives each member `workspace-hack = { path = "…" }` without a version requirement (`EVD-HAKARI-PUBLISHING`). `DES-RELEASE` leaves a dependency without a version requirement to cargo, which refuses the crate before it uploads anything of its call, with its own message that does not mention cargo-hakari. The check _Unpublished dependencies_ and its cargo-hakari guidance (**Hack crate**) cover dep-format 2 to 4 only.

Low priority: `cargo hakari init` 0.9.39 writes dep-format 4, so only a configuration that sets 1 by hand or keeps it from an old cargo-hakari reaches this, and cargo's own message already stops the upload and names the dependency.

- [ ] Decide in `DES-RELEASE` whether a crate whose normal dependency on the hack crate has no version requirement fails before cargo with the hack crate's message, or keeps cargo's refusal with a line that adds cargo-hakari's ways
- [ ] Implement it, with a case in group 8 of `VER-RELEASE`
