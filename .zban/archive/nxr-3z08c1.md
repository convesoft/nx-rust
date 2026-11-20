---
title: Remove the provisional mark from the sentence added to REQ-NO-RUST-TASK-DEPS
status: done
type: task
tags:
  - docs
related:
  - nxr-bhh3mm
discovered_from: nxr-qw96ne
created_at: 2026-11-20T11:52:11Z
closed_at: 2026-11-20T11:56:45Z
---

Goal: `REQ-NO-RUST-TASK-DEPS` in `nx-rust/docs/targets.mara.md` no longer calls its sentence about a replaced `build` provisional.

The maintainer confirmed line 12 of nxr-bhh3mm on 20 November 2026: it matches line 13 and `REQ-MIXED-PROJECTS`. nxr-qw96ne left this mark because line 12 was not among the confirmed lines then. Text only.

- [x] Remove the note "(Provisional until the maintainer has reviewed the decisions made in 0.4: …)" after that sentence; the sentence itself stays as it is
- [x] Remove any matching mark in `ADR-NO-RUST-BUILD-DEPS` and `DES-TARGETS`, which line 12 names, and say there, where the item records who decided, that the maintainer confirmed it on 20 November 2026

Done when: `git grep -n -i "provisional" -- nx-rust/docs nx-rust/src` finds no mark that belongs to line 12, and `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.

## Summary of Changes

Removed the note "(Provisional until the maintainer has reviewed the decisions made in 0.4: …)" after the sentence on a replaced `build` in `REQ-NO-RUST-TASK-DEPS` (`nx-rust/docs/targets.mara.md`); the sentence is unchanged. `ADR-NO-RUST-BUILD-DEPS` and `DES-TARGETS` carry no provisional mark or reference to the maintainer's review for that decision, so they are unchanged. `git grep -n -i "provisional" -- nx-rust/docs nx-rust/src` now finds nothing at all.

Checks: `pnpm nx format:write`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check` pass. No tests run (text only).
