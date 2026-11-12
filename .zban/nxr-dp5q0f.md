---
title: Specify generators and diagnostics
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: turn the draft items `DES-GENERATORS` and `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) into accepted knowledge.

- [ ] Answer the open questions in the two items with the user: whether `init` offers to write the build directory setting and warns about target defaults; generator options and behaviour outside a workspace; error codes; what the plugin does on an Nx major newer than the supported ones
- [ ] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [ ] Add or extend the verification that the Mara policies then require
- [ ] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
