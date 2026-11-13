---
title: Check how Nx merges target defaults with inferred targets
status: in-progress
type: task
priority: high
tags:
  - spike
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: establish what a `targetDefaults` entry keyed by `build`, `lint` or `test` does to an inferred Rust target in Nx 24, as `RISK-TARGET-DEFAULTS` (`nx-rust/docs/decisions.mara.md`) describes. The draft `REQ-TARGET-DEFAULT-GUARD` depends on the answer.

- [x] Whether `dependsOn`, `inputs`, `outputs` and `cache` from a target default replace, merge with or lose against inferred values
- [x] Whether a `filter` on `plugin` or `projects` keeps a default away from this plugin's targets
- [x] Whether the plugin can see the merged target, or only its own inferred one
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

Note (2026-11-13): `EVD-NX-TARGET-DEFAULTS` is accepted and `RISK-TARGET-DEFAULTS` is updated (likelihood and consequence unchanged). The finding answers half of the open question in the draft `REQ-TARGET-DEFAULT-GUARD` and suggests widening it to outputs and cache, so the last task item waits until the maintainer agrees to the proposed change of that item. The issue stays in progress until then.
