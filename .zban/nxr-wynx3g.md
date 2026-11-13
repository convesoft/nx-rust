---
title: Decide what the cargo executor does with options that target defaults add
status: todo
type: task
parent: nxr-w9qa5f
related:
  - nxr-d3087e
discovered_from: nxr-pana9e
created_at: 2026-11-13T08:35:28Z
---

Goal: the plugin's cargo executor treats an option it does not know, such as one that a `targetDefaults` entry written for a JS executor adds to an inferred Rust target, in a way that is decided and recorded in Mara.

Context: `EVD-NX-TARGET-DEFAULTS` (`nx-rust/docs/decisions.mara.md`) shows that a target default's `options` reach the executor of an inferred target (`RISK-TARGET-DEFAULTS`). With an open schema the option arrives silently and is part of the task hash; with `additionalProperties: false` the batched task fails with an error that names neither the option nor the entry.

- [ ] Agree with the maintainer whether the executor rejects, ignores or reports unknown options, possibly through `REQ-TARGET-DEFAULT-GUARD`, and record the choice in Mara
- [ ] If an unknown option fails a task, the failure names the option and the target (`NEED-CLEAR-FAILURES`)

Done when: the decision is accepted in Mara and `mara project validate` reports `valid: true`.
