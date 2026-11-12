---
title: Specify disk caching of the cargo metadata report
status: todo
type: task
priority: low
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: turn the draft item `REQ-METADATA-DISK-CACHE` (`nx-rust/docs/workspaces.mara.md`) into accepted knowledge with a design.

- [ ] Answer the open questions in the item with the user: which files the report depends on and where it is kept. The network question is settled: the report is `--no-deps` (`ADR-METADATA-NO-DEPS`)
- [ ] Measure `cargo metadata --no-deps` on a large workspace first; if a disk cache would save too little, retire the requirement instead
- [ ] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [ ] Add or extend the verification that the Mara policies then require
- [ ] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
