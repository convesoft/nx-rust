---
title: Document how to run checks on a machine that agents share
status: done
type: task
tags:
  - docs
created_at: 2026-11-20T11:52:11Z
closed_at: 2026-11-20T11:52:11Z
---

Goal: workers and reviewers find in AGENTS.md what the control plane had kept in its own memory about running the checks: suites one at a time, testing another Cargo version through a private rustup home, a private Nx cache directory with the daemon off, and running a test as CI runs it.

- [x] Add a "Running checks" subsection under "TypeScript and Nx" in `AGENTS.md`
- [x] Leave out what the code already handles: the Jest worker cap in `nx-rust/jest.config.cts` and the agent and CI variables that `nx-rust/test/harness/environment.ts` removes

Done when: the subsection is in `AGENTS.md`, and `pnpm nx format:check --files=AGENTS.md` and `zban check` pass.

## Summary of Changes

Added "Running checks" to `AGENTS.md` (`CLAUDE.md` links to it): run the unit and end-to-end suites one after the other; test another Cargo version through a private `RUSTUP_HOME` and never with `rustup default`; pair a private `NX_CACHE_DIRECTORY` with `NX_DAEMON=false`, and rerun once after a lone `FOREIGN KEY constraint failed`; run a test that sets CI or agent variables once the way CI runs it. Requested by the maintainer on 20 November 2026.

Checks: `pnpm nx format:check --files=AGENTS.md` passed after `format:write` added one blank line; `zban check` passed.
