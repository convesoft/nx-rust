---
title: Fail a build that read a repository file outside its inputs
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-d371vy
  - nxr-kmdpgj
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T12:05:38Z
---

Goal: after every successful cargo call, fresh or not, a `build` task compares the dependency files of the cargo targets it built with its inputs and fails when one names an uncovered repository file.

Implements `REQ-BUILD-INPUT-CHECK` through `DES-BUILD-INPUT-CHECK` (`nx-rust/docs/caching.mara.md`) and the task-time row in `DES-DIAGNOSTICS`. Evidence on the `.d` files: `EVD-CARGO-DEP-INFO`. Checked by `VER-BUILD-INPUT-CHECK`, apart from its batch paragraph, which needs the batch executor (nxr-s12cpg) and has its own issue.

- [ ] Name the records as point 1 of `DES-BUILD-INPUT-CHECK` gives them, skipping those of point 2, and read them as point 3 describes
- [ ] Resolve and filter the recorded paths as points 4 and 5 say, links, case and directories included
- [ ] Compare them with Nx's matching of the task's inputs and fail the task as points 6 and 7 say
- [ ] The cases of `VER-BUILD-INPUT-CHECK` apart from its batch paragraph, in an end-to-end fixture

Done when: `VER-BUILD-INPUT-CHECK` passes without its batch paragraph, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.
