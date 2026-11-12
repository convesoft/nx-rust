---
title: Validate the plugin on a real mixed repository
status: todo
type: task
tags:
  - validation
parent: nxr-nm0jd6
created_at: 2026-11-12T18:20:01Z
---

Goal: carry out the outcome checks `VAL-MIXED-REPO`, `VAL-CARGO-PARITY` and `VAL-CACHE-TRUST` (`nx-rust/docs/verification.mara.md`) and record what they show.

- [ ] Choose the repository with the user
- [ ] `VAL-MIXED-REPO`: one set of commands over at least twenty pull requests
- [ ] `VAL-CARGO-PARITY`: Rust developers' workflow before and after
- [ ] `VAL-CACHE-TRUST`: the scheduled uncached comparison over at least thirty days
- [ ] Record the results as evidence items, and shortfalls as issues or changes to the knowledge

Done when: each validation has a recorded result, and `mara project validate` reports `valid: true`.
