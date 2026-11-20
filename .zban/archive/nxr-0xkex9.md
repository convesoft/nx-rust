---
title: Say in the status lines that milestones 0.1 to 0.5 are implemented
status: done
type: task
tags:
  - docs
created_at: 2026-11-20T10:09:01Z
closed_at: 2026-11-20T10:12:14Z
---

Goal: no page says that only milestone 0.1 is implemented, or that a feature of 0.2 to 0.5 is still to come. The epics of 0.1 to 0.5 are closed; what is left of v1 is 1.0, which checks the open assumptions and decides on publishing (`ADR-PUBLISHING-AT-1-0`). The maintainer asked for this on 20 November 2026.

Text only, no code. The package is still not published to npm: the lines that say so stay true and stay (nxr-g5dfee changes them when it is published).

- [x] `README.md`: the status line, the feature list ("from milestone 0.2", "From milestone 0.4") and what the roadmap table needs to show which milestones are done
- [x] `nx-rust/README.md`: the status line ("Next on the roadmap") and the feature list
- [x] `nx-rust/docs/index.mara.md`, `product.mara.md` (status note and roadmap) and `setup.mara.md` (status note, including which optional tools the implemented features use)
- [x] `AGENTS.md`: the project paragraph
- [x] Every other status note or sentence in `nx-rust/docs/` that announces a feature of 0.1 to 0.5 as coming, for example `targets.mara.md` ("until its guard arrives with milestone 0.5"), checked against what `main` does
- [x] Sentences that compare with milestone 0.1 as history ("as in milestone 0.1" in `execution.mara.md`) stay

Done when: `git grep -n -i -E "milestone 0\.1 is implemented|still to come|arrives? with milestone"` finds no stale line outside `.zban/`, and `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.

## Summary of Changes

Status lines now say that milestones 0.1 to 0.5 are implemented on `main`, that 1.0 is what is left of v1, and that the package is still not published to npm: `README.md` (status note, feature list, roadmap table with a Status column), `nx-rust/README.md` (status note, feature list), `AGENTS.md` (project paragraph), and in `nx-rust/docs/` the status notes of `index`, `product` (plus the roadmap Status column), `setup`, `targets` (the hack-crate guard exists: `release.mara.md` "Hack crate" and `src/graph/targets.ts`), `configuration` (`affectedTests`, `artifacts` and `NX_RUST_TEST_MODE` are read by `src/`), and the "from milestone 0.3" in `workspaces`. History sentences comparing with 0.1 stay. Checks run: `pnpm nx format:write`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid), `zban check`, and the grep of the Done-when line (no stale line).
