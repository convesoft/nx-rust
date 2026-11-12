---
title: Check how napi crates link under cargo test
status: todo
type: task
priority: low
tags:
  - spike
parent: nxr-z9jq1n
created_at: 2026-11-12T18:20:01Z
---

Goal: answer the second question in `RISK-NAPI-TOOLING` (`nx-rust/docs/decisions.mara.md`): whether napi crates need a special feature to link under `cargo test`.

- [ ] Run `cargo test` and nextest on a napi crate on Linux; the macOS run moved to nxr-wfzc23 (`ADR-CI-LINUX-ONLY`)
- [ ] If a feature or flag is needed: say whether the plugin should set it for the `test` target
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
