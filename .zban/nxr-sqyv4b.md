---
title: Check what cargo-hakari unifies between workspace crates
status: todo
type: task
tags:
  - spike
parent: nxr-9y4eh8
created_at: 2026-11-12T18:20:01Z
---

Goal: confirm or refute the assumption in `RISK-HAKARI-GAPS` (`nx-rust/docs/decisions.mara.md`). The `hakari` strategy of `DES-UNIFICATION` rests on it.

- [ ] A small workspace where one member enables a feature of another member, with cargo-hakari set up
- [ ] Build two different subsets of members and compare what is recompiled
- [ ] Whether the `cargo metadata` report is enough to detect such features
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
