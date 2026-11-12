---
title: Check that the napi CLI can post-process an existing cargo build
status: todo
type: task
tags:
  - spike
parent: nxr-z9jq1n
created_at: 2026-11-12T18:20:01Z
---

Goal: confirm or refute the first assumption in `RISK-NAPI-TOOLING` (`nx-rust/docs/decisions.mara.md`). `DES-NAPI` needs it so that compiling stays in the batch.

- [ ] Build a napi crate with plain `cargo build`, then produce the `.node` file, JS and type definitions from that build with the napi CLI
- [ ] If the CLI insists on running cargo itself: what it would cost to let `napi-build` leave the batch
- [ ] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [ ] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.
