---
title: Say in the caching guide that nx affected does not see environment or toolchain changes
status: todo
type: task
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-5p9zq5
created_at: 2026-11-13T08:39:54Z
---

Goal: users of `nx affected` know which changes it cannot see, as found in `EVD-NX-24-INPUT-SEMANTICS` and recorded in `RISK-NX-INPUT-SEMANTICS` (`nx-rust/docs/decisions.mara.md`).

Context: task-based affected selects tasks by changed files only, so a change that reaches a task only through an `env` or `runtime` input (for example a toolchain update without a change to a toolchain file) selects nothing, although it changes the cache keys. The user guide in `nx-rust/docs/caching.mara.md` does not say so. Whether `ADR-DECLARED-INPUTS` gets the matching clarification is a maintainer decision raised from nxr-5p9zq5; word the guide so that it fits either way.

- [ ] Add a short note to the user-facing part of `nx-rust/docs/caching.mara.md`, with what a pipeline can do about it (run the affected targets for all projects after a toolchain update)
- [ ] `pnpm nx format:write`, then `mara project validate` reports `valid: true`

Done when: the note is in the guide and the checks above pass.
