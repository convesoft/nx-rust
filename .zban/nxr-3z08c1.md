---
title: Remove the provisional mark from the sentence added to REQ-NO-RUST-TASK-DEPS
status: todo
type: task
tags:
  - docs
related:
  - nxr-bhh3mm
discovered_from: nxr-qw96ne
created_at: 2026-11-20T11:52:11Z
---

Goal: `REQ-NO-RUST-TASK-DEPS` in `nx-rust/docs/targets.mara.md` no longer calls its sentence about a replaced `build` provisional.

The maintainer confirmed line 12 of nxr-bhh3mm on 20 November 2026: it matches line 13 and `REQ-MIXED-PROJECTS`. nxr-qw96ne left this mark because line 12 was not among the confirmed lines then. Text only.

- [ ] Remove the note "(Provisional until the maintainer has reviewed the decisions made in 0.4: …)" after that sentence; the sentence itself stays as it is
- [ ] Remove any matching mark in `ADR-NO-RUST-BUILD-DEPS` and `DES-TARGETS`, which line 12 names, and say there, where the item records who decided, that the maintainer confirmed it on 20 November 2026

Done when: `git grep -n -i "provisional" -- nx-rust/docs nx-rust/src` finds no mark that belongs to line 12, and `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.
