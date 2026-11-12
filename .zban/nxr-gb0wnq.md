---
title: Investigate distributed execution of Rust tasks
status: todo
type: task
priority: deferred
tags:
  - spike
created_at: 2026-11-12T18:20:01Z
---

v1 targets a single machine (`ADR-SINGLE-MACHINE`). `nx-rust/docs/ci.mara.md` sketches what a distributed mode might look like, and `DES-TEST-PHASES` keeps the seam for it. This issue is for after v1.

- [ ] Whether Nx computes task hashes on the main job or on agents, which decides whether agents need the compiler
- [ ] Whether Nx Cloud can pin specific targets to one machine, and on which plan
- [ ] How Nx Cloud assigns batched tasks to agents
- [ ] If it looks feasible: a draft need and decision in Mara, for the user to accept

Done when: the answers are recorded as an evidence item, and the user has decided whether to pursue a distributed mode.
