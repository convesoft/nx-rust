---
title: Benchmark coverage collection
status: todo
type: task
tags:
  - spike
parent: nxr-m3k3w8
created_at: 2026-11-12T18:20:01Z
---

Goal: put numbers on `RISK-COVERAGE-COST` (`nx-rust/docs/decisions.mara.md`). `DES-BASELINE` runs collection on every main commit.

- [ ] Time `cargo affected collect` and `collect --diff` on a real workspace against a plain full test run
- [ ] Check whether instrumented and normal builds evict each other in one build directory
- [ ] Say whether a separate build directory for coverage builds should be the default
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
