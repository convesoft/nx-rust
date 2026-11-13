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

The design follows the maintainer's decisions of 2026-11-13: the nine answers of the first brief; the task name `lockfile`; the plugin carrying its own version where Nx has no npm node for it; and, after the research on how cargo judges the lockfile, letting cargo update a stale lockfile first.

- `DES-LOCKFILE-HASHING` is accepted:
  - Each workspace has one uncached `lockfile` task. It runs `cargo update --workspace`, with `--locked` in locked mode, so that a current lockfile stays as it is and a stale or missing one is updated as the crates' own cargo commands would update it.
  - It then writes, into `.nx/workspace-data/nx-rust/lockfile/`, one digest per crate over the reachable part of the lockfile's graph, each entry with its dependency strings, following `replace`.
  - Every cached crate target other than `fmt-check` depends on it and hashes its digest. None takes `Cargo.lock` as a plain file input.
  - After each cargo call, the executor checks the crate's digest again and fails the task if it no longer matches.
  - A run that excludes task dependencies runs no lockfile task; the `preTasksExecution` hook then sets `NX_RUST_RUN_ID` to a new value, so that its crate tasks get keys that never repeat.
  - Where Nx has no npm node for the plugin, its version reaches the keys through the target option `pluginVersion`.
  - There are no external nodes in v1.
- `ADR-LOCKFILE-TASK` supersedes `ADR-EXTERNAL-NODES`; both that decision and `TERM-EXTERNAL-NODE` are retired.
- Accepted items changed:
  - `REQ-EXTERNAL-DEPS`, `REQ-INPUT-FILES`, `REQ-NO-RUST-TASK-DEPS`, `REQ-NO-MANIFEST-WRITES`, `REQ-CARGO-UNCHANGED`
  - `DES-INPUTS`, `DES-INVOCATION`, `DES-OUTPUTS`, `DES-BUILD-DIRS`, `DES-TARGETS`, `DES-WORKSPACE-TARGETS`, `DES-DIAGNOSTICS`
  - `DES-PROJECT-GRAPH` ("External crates", "Cycles"), `DES-METADATA-REPORT` (one sentence)
  - `ADR-NO-RUST-BUILD-DEPS`, `ADR-ALL-DEP-KINDS`
  - `VER-TARGETS`, `VER-CACHE-KEYS`, `VER-SETUP`
- Evidence: `EVD-NX-24-EXTERNAL-NODES`, `EVD-NX-24-PLUGIN-VERSION`, `EVD-NX-24-LOCKFILE-TASK`, `EVD-CARGO-LOCKFILE`, `EVD-CARGO-LOCK-CHECK` and `EVD-NX-24-LOCKFILE-UPDATE`.
- Guidance updated in `workspaces.mara.md`, `caching.mara.md`, `targets.mara.md`, `ci.mara.md` and `product.mara.md`.
- Issues: nxr-xq9ava has the implementation steps, nxr-fy4t4k the plugin-package input, nxr-ym403k a replaced `lockfile` target. nxr-p5ybc0 has a step for `paths` overrides and the path packages reached through `[patch]` or `[replace]`, and nxr-d3087e one for target defaults that drop the lockfile task.
- Rejected:
  - external nodes, because `nx affected` ignores them after a change to `Cargo.lock`, and they invalidate JS targets;
  - a digest in a target option;
  - the whole lockfile;
  - a comparison of manifests with lockfile entries written by the plugin, which missed cases that cargo catches;
  - failing on a stale lockfile;
  - running a stale workspace's crates uncached;
  - a cached lockfile task, because cargo's verdict depends on files outside the repository.

Checks run on the final commit: `pnpm nx format:write` (exit 0), `mara schema validate` (valid), `mara project validate` (`valid: true`, evaluation complete, 0 errors, 0 warnings), `zban check` (exit 0), `pnpm nx run-many -t build lint test --skip-nx-cache` (exit 0, 8 suites, 158 tests passed) and `pnpm nx format:check --all` (exit 0). The end-to-end suite was not run because no plugin behaviour changed.
