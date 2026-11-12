---
title: Measure the cost of cargo affected status
status: todo
type: task
tags:
  - spike
parent: nxr-m3k3w8
created_at: 2026-11-12T18:20:01Z
---

Goal: confirm or refute the second assumption in `RISK-CARGO-AFFECTED` (`nx-rust/docs/decisions.mara.md`): that asking for the selection is cheap although it lists tests through nextest, which needs built test binaries.

- [ ] Time `status` on a real workspace with a warm and with a cold build directory
- [ ] Compare with the time the selected tests save
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
