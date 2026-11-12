---
title: Check that cargo-affected's report is enough to filter and map tests
status: todo
type: task
priority: high
tags:
  - spike
parent: nxr-m3k3w8
created_at: 2026-11-12T18:20:01Z
---

Goal: confirm or refute the first assumption in `RISK-CARGO-AFFECTED` (`nx-rust/docs/decisions.mara.md`). Steps 3 and 4 of `DES-TEST-RUN` rest on it.

- [ ] Run `cargo affected status --report-json <path> --report-detail full` on a real workspace
- [ ] Build a nextest filter from the listed tests and run exactly those tests
- [ ] Map each selected test, and each nextest result, to its crate
- [ ] Read `cache.status` for every way selection can be refused
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
