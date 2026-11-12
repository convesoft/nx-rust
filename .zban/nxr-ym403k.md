---
title: Specify mixed projects
status: todo
type: task
tags:
  - spec
parent: nxr-z9jq1n
blocked_by:
  - nxr-n3d954
created_at: 2026-11-12T18:20:01Z
---

Goal: turn the draft item `REQ-MIXED-PROJECTS` (`nx-rust/docs/artifacts.mara.md`) into accepted knowledge with a design, using the result of the spike that blocks this issue.

- [ ] Answer the open questions in the item with the user: which name wins, what happens to targets both plugins infer, how a JS consumer's dependency on the crate enters the project graph, and what the consumer's own `^build` then runs on the crate
- [ ] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [ ] Add or extend the verification that the Mara policies then require
- [ ] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
