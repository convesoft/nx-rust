---
title: Specify build-script and macro inputs
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: turn the draft item `REQ-BUILD-SCRIPT-INPUTS` (`nx-rust/docs/caching.mara.md`) into accepted knowledge with a design, or record why it stays out of v1. It mitigates `RISK-UNDECLARED-INPUTS`.

- [ ] Answer the open questions in the item with the user: how the plugin learns `rerun-if-changed` and `include_str!` paths outside the crate's folder without running the build, and what happens on the first run
- [ ] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [ ] Add or extend the verification that the Mara policies then require
- [ ] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
