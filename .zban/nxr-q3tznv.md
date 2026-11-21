---
title: Review the decisions made in 1.0
status: todo
type: task
tags:
  - maintainer
created_at: 2026-11-21T21:14:00Z
---

Goal: the maintainer reads, once, the decisions that the control plane made on his behalf while milestone 1.0 (nxr-nm0jd6) and the three issues that he asked for before it (nxr-hh3kwy, nxr-27zbta, nxr-c63t0r) were built, and overturns those he disagrees with. A decision he overturns becomes a new issue. This issue is never dispatched to a worker.

Each line says what was decided, which Mara items it rests on, and how to undo it. "Provisional" marks a decision of a kind the maintainer reserved for himself (anything that cannot be undone, a capability users see) that can still be undone before 1.0 and was therefore taken without stopping the work.

- [ ] Read the list below and overturn what is wrong

## Decisions

1. nxr-hh3kwy (21 November 2026): the guide's text on the warm-cache limit of the same-folder `build` refusal says what a restore really leaves, not what the first draft promised. The review showed, and a fixture with the plugin confirmed, that Nx removes no file on a restore and that a `build` stores a file left at one of its declared output paths although it did not produce it (a binary with `required-features`, after a build with the feature or a plain `cargo build --features`). So the advice "run it in a command of its own" was replaced by "a task that reads the folder should read only the files it needs", `DES-BATCH` was corrected the same way, and `DES-OUTPUTS` gained one sentence that states the limit. The limit itself was filed in the backlog as nxr-m1tfp3 and not fixed, because the issue was a change of wording and nxr-m1tfp3 is two steps from an issue of the run; the control plane recommends deciding it before 1.0, since the stored file can come from older sources than the key describes (`GOAL-TRUSTED-CACHE`). Rests on `DES-OUTPUTS`, `DES-BATCH`, `ADR-STAGED-BUILDS`. To undo: take nxr-m1tfp3 out of the backlog, or reword the guide. The fix round was verified by the control plane's own reading against the reviewer's and the worker's facts, without a second reviewer, because it changed wording only.
