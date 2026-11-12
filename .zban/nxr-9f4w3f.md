---
title: Specify the option reference
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: turn the draft item `DES-PLUGIN-OPTIONS` (`nx-rust/docs/configuration.mara.md`) into accepted knowledge. The option names in it are proposals, apart from `testRunner` and `affectedTests`.

- [ ] Answer the open questions in the item with the user: final option names, including the proposed `artifacts` and `locked`, and which options a crate may set. Settled on 2026-11-12: tags add up, and `targetNames` covers every inferred target
- [ ] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [ ] Add or extend the verification that the Mara policies then require
- [ ] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
