---
title: "0.1: Project graph, inferred targets and caching"
status: done
type: epic
priority: high
tags:
  - milestone
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-14T14:50:36Z
---

First releasable milestone: a repository can add the plugin and get its crates as Nx projects with a full dependency graph, inferred targets and correct caching. Each task still runs its own cargo command; batching is milestone 0.2.

Scope is described in `nx-rust/docs/product.mara.md` (Roadmap) and specified in `workspaces.mara.md`, `configuration.mara.md`, `targets.mara.md`, `caching.mara.md` and `setup.mara.md`. Verification: `VER-GRAPH`, `VER-CONFIGURATION`, `VER-TARGETS`, `VER-CACHE-KEYS`, `VER-CARGO-UNCHANGED`, `VER-SETUP`.

- [x] All child issues are closed
- [x] The cited verifications pass on Linux; macOS runs are deferred (`ADR-CI-LINUX-ONLY`, nxr-wfzc23)
- ~~0.1 is published to npm~~ Cancelled on 14 November 2026: no 0.x milestone is published on its own; publishing is decided at 1.0 (maintainer, `ADR-PUBLISHING-AT-1-0`).
- [x] The status notes at the top of the pages this milestone implements are updated

## Summary of Changes

Closed on 14 November 2026 by the control plane, which the maintainer authorized that day to close a milestone epic once none of its items remains and its own checks are verified. What was verified:

- All 74 child issues are closed (`zban list --parent nxr-w9qa5f` lists none; 74 files in `.zban/archive/` name this epic as parent).
- The cited verifications pass on Linux: both CI jobs ("Build, lint, test and format" and "End-to-end tests", the latter on the latest stable Cargo and on 1.91.0) passed on `main` be233c8, the last commit that changes code or tests (https://github.com/convesoft/nx-rust/actions/runs/43603275203); the commit after it changes text only. The tests of `VER-GRAPH`, `VER-CONFIGURATION`, `VER-TARGETS`, `VER-CACHE-KEYS`, `VER-CARGO-UNCHANGED` and `VER-SETUP` run in those jobs. CI does not run the Mara validation (nxr-0x99we); `mara schema validate` and `mara project validate` were run locally at every merge and report `valid: true` with complete evaluation. macOS runs stay deferred (nxr-wfzc23).
- The status notes of the pages this milestone implements were brought up to date by nxr-2v14h1 (pull request #72) and nxr-nz89fw: the note of `workspaces.mara.md` is removed, and those of `configuration.mara.md`, `targets.mara.md`, `caching.mara.md` and `setup.mara.md` name only what later milestones bring.
- Publishing: cancelled as a check of this milestone (`ADR-PUBLISHING-AT-1-0`).
