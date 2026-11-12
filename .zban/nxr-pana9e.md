---
title: Check how Nx merges target defaults with inferred targets
status: todo
type: task
priority: high
tags:
  - spike
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: establish what a `targetDefaults` entry keyed by `build`, `lint` or `test` does to an inferred Rust target in Nx 24, as `RISK-TARGET-DEFAULTS` (`nx-rust/docs/decisions.mara.md`) describes. The draft `REQ-TARGET-DEFAULT-GUARD` depends on the answer.

- [ ] Whether `dependsOn`, `inputs`, `outputs` and `cache` from a target default replace, merge with or lose against inferred values
- [ ] Whether a `filter` on `plugin` or `projects` keeps a default away from this plugin's targets
- [ ] Whether the plugin can see the merged target, or only its own inferred one
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
