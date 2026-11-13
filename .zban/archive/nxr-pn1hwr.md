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

The maintainer answered the nine questions of the decision brief on 2026-11-13, each with the recommended option, and named the task `lockfile`. The checks of Nx 24.0.6 and cargo 1.100.0 run for this issue are recorded as `EVD-NX-24-EXTERNAL-NODES`, `EVD-NX-24-LOCKFILE-TASK` and `EVD-CARGO-LOCKFILE`.

- `DES-LOCKFILE-HASHING` is rewritten and accepted: one cached `lockfile` task per workspace writes a digest per crate into `.nx/workspace-data/nx-rust/lockfile/`, and every cached crate target depends on it and hashes its own digest. There are no external nodes in v1.
- `ADR-LOCKFILE-TASK` supersedes `ADR-EXTERNAL-NODES`, which is retired, and so is `TERM-EXTERNAL-NODE`.
- Changed accepted items: `REQ-EXTERNAL-DEPS`, the "External crates" paragraph of `DES-PROJECT-GRAPH`, one sentence of `DES-METADATA-REPORT`, `REQ-INPUT-FILES`, `DES-INPUTS` (digest, member manifests, plugin package, root-crate lockfile), `REQ-NO-RUST-TASK-DEPS`, `DES-TARGETS`, `DES-WORKSPACE-TARGETS`, `VER-TARGETS`, `VER-CACHE-KEYS` (new rows and the end-to-end `nx affected` checks), `VER-SETUP`, and two rows of `DES-DIAGNOSTICS` (no `Cargo.lock`, an unparsable one), added after #9 had made that item accepted.
- Guidance updated in `workspaces.mara.md`, `caching.mara.md` (new "Lockfile changes" section), `targets.mara.md` and `product.mara.md`.
- The digest location was chosen by experiment: `.nx/workspace-data`, the artifact directory and `node_modules/.cache` all cached and restored the digests, but Nx ignores a dependency's output outside the repository, which rules out an artifact directory that lies outside it.
- Updated issues: nxr-xq9ava (task list), nxr-fy4t4k (plugin package and member manifests), nxr-1bv0wm (no external nodes), nxr-ym403k (a replaced `lockfile` target).
- Follow-ups: nxr-vxjvzg (no npm node for the plugin package), nxr-6cm44q (remaining sentences and `DES-OUTPUTS`).
- Rejected: external nodes alone, because `nx affected` ignores them after a change to `Cargo.lock`; external nodes with a constant-output task, because they invalidate JS targets; a digest in a target option; and the whole lockfile.

Checks run: `mara schema validate` (valid), `mara project validate` (`valid: true`, evaluation complete, 0 errors, 0 warnings), `zban check` (exit 0), `pnpm nx format:write`, `pnpm nx format:check --all` (exit 0), and `pnpm nx run-many -t build lint test` (4 tasks succeeded, 21 tests passed).
