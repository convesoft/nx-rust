---
title: Specify the remaining targets and the workspace project
status: todo
type: task
priority: high
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: turn the draft items `DES-TARGET-COMMANDS`, `DES-WORKSPACE-TARGETS` and `REQ-RUN-WATCH` (`nx-rust/docs/targets.mara.md`) into accepted knowledge, or retire what is not wanted.

- [ ] Answer the open questions in the three items with the user: exact commands and flags of `check`, `lint`, `fmt-check`, `fmt`, `doc`, `bench` and `run`; which workspace targets exist without their tool; whether `run` becomes a continuous task in v1
- [ ] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [ ] Add or extend the verification that the Mara policies then require
- [ ] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
