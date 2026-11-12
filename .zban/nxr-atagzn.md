---
title: Track the stabilisation of Cargo's feature-unification setting
status: todo
type: task
priority: low
tags:
  - spike
parent: nxr-nm0jd6
created_at: 2026-11-12T18:20:01Z
---

Goal: know when `resolver.feature-unification` is stable and whether its name or values changed, as `RISK-UPSTREAM-CHANGES` (`nx-rust/docs/decisions.mara.md`) asks. The `cargo` strategy of `DES-UNIFICATION` stays experimental until then.

- [ ] Record the state of the Cargo tracking issue and the first stable version, if any
- [ ] If it is stable: propose making `cargo` the default strategy where the toolchain supports it, as a decision for the user
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
