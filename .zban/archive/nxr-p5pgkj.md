---
title: Say in the caching guide that nx affected does not see environment or toolchain changes
status: done
type: task
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-5p9zq5
created_at: 2026-11-13T08:39:54Z
closed_at: 2026-11-14T07:53:45Z
---

Goal: users of `nx affected` know which changes it cannot see, as found in `EVD-NX-24-INPUT-SEMANTICS` and recorded in `RISK-NX-INPUT-SEMANTICS` (`nx-rust/docs/decisions.mara.md`).

Context: task-based affected selects tasks by changed files only, so a change that reaches a task only through an `env` or `runtime` input (for example a toolchain update without a change to a toolchain file) selects nothing, although it changes the cache keys. The user guide in `nx-rust/docs/caching.mara.md` does not say so. `ADR-DECLARED-INPUTS` already states this, as the maintainer agreed on 2026-11-13 in nxr-5p9zq5; the guide should agree with it.

- [x] Add a short note to the user-facing part of `nx-rust/docs/caching.mara.md`, with what a pipeline can do about it (run the affected targets for all projects after a toolchain update)
- [x] `pnpm nx format:write`, then `mara project validate` reports `valid: true`

Done when: the note is in the guide and the checks above pass.

## Summary of Changes

The user-facing part of `nx-rust/docs/caching.mara.md` ("What is in a cache key", after the `envInputs` and `runtimeInputs` paragraph) now says that `nx affected` selects tasks by changed files only, so a change that reaches a task only through an environment variable or a command's output, such as a new `RUSTFLAGS` or a toolchain update without a change to a `rust-toolchain.toml`, changes keys but selects no task. It gives what a pipeline can do: run the targets for every project with `nx run-many` after such a change, which restores the tasks whose keys stayed the same, or pin the toolchain to a version in `rust-toolchain.toml`, so that an update is a commit `nx affected` sees. This agrees with `ADR-DECLARED-INPUTS` and `RISK-NX-INPUT-SEMANTICS`. No decision was needed.

Checks: `pnpm nx format:write`, `pnpm nx format:check --all`, `mara schema validate` and `mara project validate` (`valid: true`, evaluation complete, no errors or warnings), `pnpm nx run-many -t build lint test` and `zban check` pass.
