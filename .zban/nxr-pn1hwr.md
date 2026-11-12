---
title: Specify per-crate lockfile hashing
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: turn the draft item `DES-LOCKFILE-HASHING` (`nx-rust/docs/workspaces.mara.md`) into accepted knowledge, so that `REQ-EXTERNAL-DEPS` can be met. Until then the whole `Cargo.lock` is an input, which is correct but invalidates every crate on any dependency update.

- [ ] Answer the open questions in the item with the user: what a node's hash covers, what a node is called when one crate name has several locked versions or sits in the lockfiles of two workspaces, features, and the key of workspace-level tasks. Locked versions come from `Cargo.lock`, because the graph's report is `--no-deps`
- [ ] Check what the Nx `externalDependencies` input and an external node's `hash` do in Nx 24
- [ ] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [ ] Add or extend the verification that the Mara policies then require
- [ ] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
