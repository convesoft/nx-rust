---
title: Review the decisions made in 0.4
status: todo
type: task
tags:
  - maintainer
created_at: 2026-11-16T10:47:20Z
---

Goal: the maintainer reads, once, the decisions that the control plane made on his behalf while milestone 0.4 (napi and wasm artifacts) was built, and overturns those he disagrees with. A decision he overturns becomes a new issue. This issue is never dispatched to a worker.

Each line says what was decided, which Mara items it rests on, and how to undo it. "Provisional" marks a decision of a kind the maintainer reserved for himself that can still be undone and was therefore taken without stopping the work.

- [ ] Read the list below and overturn what is wrong

## Decisions

1. The spike nxr-v3y6cr (`RISK-NAPI-TOOLING`: whether the napi CLI can post-process an existing cargo build) was started on 16 November 2026, before the 0.2 epic closed. It tries the napi CLI on a small crate and changes no code that 0.2 touches. Rests on the goal that the plugin becomes usable sooner; the order of the epics stays for everything that builds on 0.2. Nothing to undo: the spike ends in an evidence item.
