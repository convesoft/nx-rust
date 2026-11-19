---
title: Record the context of a collection with the test tasks' dotenv files
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-d0t9vm
created_at: 2026-11-17T10:07:31Z
---

Goal: a repository whose `.env.test` (or another dotenv file that Nx loads only for `test` tasks) sets an environment input of the tests can still select affected tests.

Context: `coverage-baseline` computes the record of the baseline's context in its own task's environment, with the dotenv files that Nx loads for that task, not those of the `test` tasks ("The record's content" in `DES-BASELINE`). Where `.env.test` sets a variable that the tests hash, every affected run sees a different value and runs its full suite, naming the variable. This is safe but loses the selection; the user can work around it by putting the variable in `.env` or in the collection's environment.

- [ ] Decide whether the collection should rebuild a `test` task's environment, as a batch does (`DES-BATCH`), and for which crate where they differ
- [ ] Update `DES-BASELINE` and the tests accordingly
