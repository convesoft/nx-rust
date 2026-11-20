---
title: Split monolithic modules (target-defaults, task, publish, version-actions) by concern
status: todo
type: task
parent: nxr-e2z8sz
blocked_by:
  - nxr-gtxq18
  - nxr-gp1awx
  - nxr-hjpc99
  - nxr-k63csj
  - nxr-3f5wqp
  - nxr-4sr6hd
  - nxr-qkxcmm
  - nxr-aqgka5
  - nxr-yfh7zh
related:
  - nxr-2vzmt5
created_at: 2026-11-20T10:24:50Z
---

Goal: break up the four largest monolithic modules into focused, cohesive submodules with clear boundaries and no behaviour changes.

Context: four files account for over 6,300 lines and mix multiple concerns (Nx internal loading, graph/target re-simulation, validation, planning, execution, and diagnostic formatting):
- `nx-rust/src/graph/target-defaults.ts` (2,189 lines, `DES-TARGET-DEFAULT-GUARD`)
- `nx-rust/src/executors/task.ts` (1,818 lines, `DES-BATCH`, `DES-TARGETS`)
- `nx-rust/src/release/publish.ts` (1,317 lines, `DES-RELEASE`)
- `nx-rust/src/release/version-actions.ts` (1,073 lines, `DES-RELEASE`)

Also check whether `target-defaults.ts` can drop parts of its manual layer re-simulation once `nxr-2vzmt5` (native hash-plan comparison) is decided.

- [ ] Split `nx-rust/src/graph/target-defaults.ts` into focused modules (e.g. layer rebuilding, diffing/validation, option origins, diagnostic formatting)
- [ ] Split `nx-rust/src/executors/task.ts` into focused modules (e.g. task preparation/guards, group invocation building, cargo execution & post-checks)
- [ ] Split `nx-rust/src/release/publish.ts` and `nx-rust/src/release/version-actions.ts` into focused modules (e.g. manifest/dependency checks, lockfile checks, registry/cargo invocation)
- [ ] Preserve all `// @mara implements ...` markers and verify links with `mara related` and `mara project validate`

Done when: all four areas are split cleanly with preserved Mara code links, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, and `mara project validate` pass.
