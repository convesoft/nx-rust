---
title: "0.1: Project graph, inferred targets and caching"
status: todo
type: epic
priority: high
tags:
  - milestone
created_at: 2026-11-12T18:20:01Z
---

First releasable milestone: a repository can add the plugin and get its crates as Nx projects with a full dependency graph, inferred targets and correct caching. Each task still runs its own cargo command; batching is milestone 0.2.

Scope is described in `nx-rust/docs/product.mara.md` (Roadmap) and specified in `workspaces.mara.md`, `configuration.mara.md`, `targets.mara.md`, `caching.mara.md` and `setup.mara.md`. Verification: `VER-GRAPH`, `VER-CONFIGURATION`, `VER-TARGETS`, `VER-CACHE-KEYS`, `VER-CARGO-UNCHANGED`, `VER-SETUP`.

- [ ] All child issues are closed
- [ ] The cited verifications pass on Linux; macOS runs are deferred (`ADR-CI-LINUX-ONLY`, nxr-wfzc23)
- ~~0.1 is published to npm~~ Cancelled on 14 November 2026: no 0.x milestone is published on its own; publishing is decided at 1.0 (maintainer, `ADR-PUBLISHING-AT-1-0`).
- [ ] The status notes at the top of the pages this milestone implements are updated
