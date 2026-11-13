---
title: Reconcile one cargo call per group with the steps of a test run
status: todo
type: task
tags:
  - spec
parent: nxr-9y4eh8
discovered_from: nxr-kq5pm5
created_at: 2026-11-13T10:56:01Z
---

Goal: the batching items and the test design agree on how many commands one group of `test` tasks runs.

Context: the paragraph on groups in `DES-BATCH` (`nx-rust/docs/execution.mara.md`) says that each group is one cargo call, and `REQ-BATCHING` and `TERM-GROUP` speak of a single cargo invocation per group. `DES-TEST-RUN` (`nx-rust/docs/testing.mara.md`) has a group run a selection step, one nextest run and a separate doctest invocation. The review of pull request #8 found this; it predates that pull request.

- [ ] Agree with the maintainer which items change and how, and record it in Mara
- [ ] Bring the "What forms a group" guidance in `execution.mara.md` in line, and extend `VER-BATCHING` or `VER-TESTING` if the policies then require it

Done when: the items agree, and `mara schema validate` and `mara project validate` report `valid: true`.
