---
title: Specify per-crate lockfile hashing
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T12:00:56Z
---

Goal: turn the draft item `DES-LOCKFILE-HASHING` (`nx-rust/docs/workspaces.mara.md`) into accepted knowledge, so that `REQ-EXTERNAL-DEPS` can be met. Until then the whole `Cargo.lock` is an input, which is correct but invalidates every crate on any dependency update.

- [x] Answer the open questions in the item with the user: what a node's hash covers, what a node is called when one crate name has several locked versions or sits in the lockfiles of two workspaces, features, and the key of workspace-level tasks. Locked versions come from `Cargo.lock`, because the graph's report is `--no-deps`
- [x] Check what the Nx `externalDependencies` input and an external node's `hash` do in Nx 24
- [x] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [x] Add or extend the verification that the Mara policies then require
- [x] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

On 2026-11-13 the maintainer answered the nine questions of the decision brief, each with the recommended option, and named the task `lockfile`. After the review of pull request #14 he also decided two more points: a stale lockfile falls back to the whole lockfile, and the plugin carries its own version where Nx has no npm node for it. The checks of Nx 24.0.6 and cargo 1.100.0 behind the design are recorded as `EVD-NX-24-EXTERNAL-NODES`, `EVD-NX-24-PLUGIN-VERSION`, `EVD-NX-24-LOCKFILE-TASK` and `EVD-CARGO-LOCKFILE`.

- `DES-LOCKFILE-HASHING` is rewritten and accepted:
  - One cached `lockfile` task per workspace writes a digest per crate into `.nx/workspace-data/nx-rust/lockfile/`, and every cached crate target depends on it and hashes its own digest. There are no external nodes in v1.
  - The task compares every lockfile entry with the dependencies the manifests declare, which the plugin passes as an option of the task. Where anything does not match or cannot be decided, every crate of the workspace gets one digest over the whole lockfile and the declarations. A stale entry for one crate changed what cargo built for its sibling, so the fallback applies to the whole workspace.
- `ADR-LOCKFILE-TASK` supersedes `ADR-EXTERNAL-NODES`, which is retired, and so is `TERM-EXTERNAL-NODE`.
- Accepted items changed:
  - `REQ-EXTERNAL-DEPS`, `REQ-INPUT-FILES` and `REQ-NO-RUST-TASK-DEPS`
  - `DES-INPUTS`: digest, member manifests, the plugin package or its version, and the root crate's own lockfile left out
  - `DES-PROJECT-GRAPH` ("External crates" and "Cycles"), `DES-METADATA-REPORT` (one sentence beside main's)
  - `DES-TARGETS`, `DES-WORKSPACE-TARGETS`, `DES-OUTPUTS`, `DES-BUILD-DIRS`, `REQ-CARGO-UNCHANGED`
  - `ADR-NO-RUST-BUILD-DEPS`, `ADR-ALL-DEP-KINDS`
  - two rows of `DES-DIAGNOSTICS`
  - `VER-TARGETS`, `VER-CACHE-KEYS` and `VER-SETUP`
- Guidance updated in `workspaces.mara.md`, `caching.mara.md` (new "Lockfile changes" section), `targets.mara.md` and `product.mara.md`.
- Updated issues: nxr-xq9ava, nxr-fy4t4k, nxr-1bv0wm and nxr-ym403k. The follow-ups filed earlier were settled in this pull request and removed: nxr-5yw5p3, nxr-vxjvzg and nxr-6cm44q.
- Rejected: external nodes alone, because `nx affected` ignores them after a change to `Cargo.lock`; external nodes with a constant-output task, because they invalidate JS targets; a digest in a target option, which `nx affected` never selects; the whole lockfile; and a fallback only for the crate whose entry is stale.

Checks run on the final commit: `pnpm nx format:write` (exit 0), `mara schema validate` (valid), `mara project validate` (`valid: true`, evaluation complete, 0 errors, 0 warnings), `zban check` (exit 0), `pnpm nx run-many -t build lint test --skip-nx-cache` (exit 0, 6 suites, 63 tests passed) and `pnpm nx format:check --all` (exit 0). The end-to-end suite was not run because no plugin behaviour changed.
