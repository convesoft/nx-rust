---
title: Review the decisions made in 0.3
status: todo
type: task
tags:
  - maintainer
created_at: 2026-11-16T10:47:17Z
---

Goal: the maintainer reads, once, the decisions that the control plane made on his behalf while milestone 0.3 (nextest, affected tests and the coverage baseline) was built, and overturns those he disagrees with. A decision he overturns becomes a new issue. This issue is never dispatched to a worker.

Each line says what was decided, which Mara items it rests on, and how to undo it. "Provisional" marks a decision of a kind the maintainer reserved for himself that can still be undone and was therefore taken without stopping the work.

- [ ] Read the list below and overturn what is wrong

## Decisions

1. The three spikes of 0.3 (nxr-hvw1rq and nxr-3qe5zj on `RISK-CARGO-AFFECTED`, nxr-3k3z1j on `RISK-COVERAGE-COST`) were started on 16 November 2026, before the 0.2 epic closed. They measure cargo-affected, nextest and coverage collection on a real workspace and change no code that 0.2 touches; only the features of 0.3 need the batch executor. Rests on the goal that the plugin becomes usable sooner; the order of the epics stays for everything that builds on 0.2. Nothing to undo: the spikes end in evidence items.
