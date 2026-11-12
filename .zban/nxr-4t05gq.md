---
title: Measure baseline drift and choose a default threshold
status: todo
type: task
priority: low
tags:
  - spike
parent: nxr-m3k3w8
created_at: 2026-11-12T18:20:01Z
---

Goal: put numbers on `RISK-BASELINE-DRIFT` (`nx-rust/docs/decisions.mara.md`): how selection gets noisier as the baseline falls behind. So far this is inferred from how cargo-affected stores its data.

- [ ] For one change, compare the selection against baselines 1, 10, 50 and 200 commits back
- [ ] Propose a default for the full-recollect threshold of `DES-BASELINE`
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
