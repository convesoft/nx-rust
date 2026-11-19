---
title: Leave NEXTEST_ variables that change nothing that runs out of the baseline's context record
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-d0t9vm
created_at: 2026-11-17T10:07:31Z
---

Goal: a pull request pipeline does not need to copy the collection step's `NEXTEST_TEST_THREADS` to keep its selection.

Context: the record of the baseline's context holds every `NEXTEST_` variable (`DES-BASELINE`, `DES-TEST-RUN` step 1, `baseline-context.ts`), so a collection run with `NEXTEST_TEST_THREADS=4`, as the CI guide recommends for memory, makes every affected run without that value take the full suite. The guide in `ci.mara.md` tells users to set the same value in both pipelines. Variables such as `NEXTEST_TEST_THREADS` or `NEXTEST_HIDE_PROGRESS_BAR` change how tests run, not which code they cover; others, such as `NEXTEST_PROFILE`, can change the filter.

- [ ] Decide which `NEXTEST_` variables may stay out of the record without loosening `GOAL-TRUSTED-CACHE` or `REQ-SELECTION-SAFETY`
- [ ] Update `ADR-AFFECTED-BASELINE-CONTEXT`, `DES-BASELINE` and `baseline-context.ts` if any
