---
title: Record the decisions the first feature issues need
status: done
type: task
priority: high
tags:
  - docs
discovered_from: nxr-mma78k
created_at: 2026-11-12T20:48:07Z
closed_at: 2026-11-12T20:50:44Z
---


The review of 2026-11-12 found four points that discovery (nxr-7n0nqf) and project creation (nxr-1bv0wm) would hit and that no blocker in the backlog covered. The user agreed to the recommended answer for each on 2026-11-12, and asked for the untracked handoff notes file to be deleted.

- [x] The graph is built from `cargo metadata --no-deps`: a decision, an evidence item for what that report holds, and `DES-METADATA-REPORT`
- [x] `exclude` is Nx's own filter on the plugin entry, not an option of the plugin (`DES-DISCOVERY`, `REQ-SKIP-CRATES`)
- [x] External nodes are created together with per-crate lockfile hashing, because their identity is open (`DES-PROJECT-GRAPH`, `ADR-EXTERNAL-NODES`)
- [x] The workspace project is named only after the spike on two projects in one folder: nxr-n3d954 moves into 0.1 and blocks the naming
- [x] Blockers and steps of the affected issues are adjusted
- [x] `Nx Cargo plugin design handoff notes.md` is deleted, and `pnpm format:check` passes
- [x] `mara schema validate` and `mara project validate` report `valid: true`, and `zban check` reports no errors

Done when: the checks above pass.

## Summary of Changes

- `cargo metadata --no-deps`: new decision `ADR-METADATA-NO-DEPS`, new evidence `EVD-CARGO-NO-DEPS` from an experiment with cargo 1.99.1, and `DES-METADATA-REPORT` says what the report holds and that a path dependency outside the workspace gets a report of its own. `DES-INVOCATION` and `VER-CARGO-UNCHANGED` no longer say that graph creation can change `Cargo.lock`. `REQ-METADATA-DISK-CACHE` lost its network question and now asks whether the cache is still worth having.
- `exclude`: `DES-DISCOVERY`, `REQ-SKIP-CRATES`, `DES-PLUGIN-OPTIONS` and the guidance say it is Nx's own filter on the plugin entry.
- External nodes: `DES-PROJECT-GRAPH`, `ADR-EXTERNAL-NODES`, `TERM-EXTERNAL-NODE` and `DES-LOCKFILE-HASHING` say the nodes come with per-crate hashing and that their name is open.
- Workspace project: `RISK-MIXED-PROJECT-MERGE` now also threatens `REQ-WORKSPACE-PROJECT`. The spike nxr-n3d954 moved into 0.1, the new issue nxr-gdt96k decides the name and blocks nxr-1bv0wm.
- Issues updated: nxr-7n0nqf, nxr-1bv0wm (retitled, no external nodes), nxr-xq9ava, nxr-pn1hwr, nxr-m4mvjy, nxr-kq5pm5.
- `Nx Cargo plugin design handoff notes.md` deleted at the user's request.

Checks run: `mara schema validate` (valid) and `mara project validate` (`valid: true`, evaluation complete, 0 errors, 0 warnings), `zban check` (no findings), `pnpm format:check` (clean, for the first time), `pnpm exec nx run-many -t build lint test` (succeeded). No code changed, so the end-to-end suite was not run. Nothing is committed.
