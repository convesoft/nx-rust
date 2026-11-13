---
title: Add the shared artifact directory warning to the diagnostics
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-dp5q0f
discovered_from: nxr-kq5pm5
created_at: 2026-11-13T09:41:54Z
closed_at: 2026-11-13T16:05:38Z
---

Goal: `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) has the diagnostic that `DES-OUTPUTS` (`nx-rust/docs/caching.mara.md`) requires for workspaces that share an artifact directory.

Pull request #9 (nxr-dp5q0f) accepts `DES-DIAGNOSTICS`, so the row is added to the accepted table.

- [x] Add the row to `DES-DIAGNOSTICS`
- [x] Extend the verification that the Mara policies then require

Done when: the row is in `DES-DIAGNOSTICS`, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

- `DES-DIAGNOSTICS` has the row "An artifact directory that two or more workspaces share (`DES-OUTPUTS`)", detected when the graph is created, severity Warning. The content comes from `DES-OUTPUTS`: the plugin says so "in the same way" as for an artifact directory outside the repository, which the table already lists as a graph-time warning, and an error at that point would stop graph creation instead of leaving `doc` uncached. The row sits next to that one and keeps the table's column widths, so the formatter did not re-pad the table.
- `VER-SETUP` gains one sentence in its last paragraph: the warning names the directory and both workspaces and says that their `doc` targets are not cached. The paragraph's next sentence already requires each of its warnings at graph creation, in a task's output and from `init`. `VER-CARGO-UNCHANGED` already checked that `doc` runs uncached in that case. The Mara policies required no new relation.
- nxr-fy4t4k has a step for implementing this warning.
- nxr-jpvf82 filed: no issue had a step for the existing warning for an artifact directory outside the repository.
- No user guidance changed: the caching and targets pages already describe this notice.

Checks run: `pnpm nx format:write`; `mara schema validate`: valid; `mara project validate`: `valid: true`, evaluation complete, 0 diagnostics, 279 policy checks passed; `zban check`: no findings; `pnpm nx run-many -t build lint test`: 4 tasks succeeded; `pnpm nx format:check --all`: passed. No code changed, so the end-to-end suite was not run.
