---
title: Specify the release flow
status: todo
type: task
tags:
  - spec
parent: nxr-6q2chq
created_at: 2026-11-12T18:20:01Z
---

Goal: turn the draft items `REQ-RELEASE` and `DES-RELEASE` (`nx-rust/docs/release.mara.md`) into accepted knowledge. `DES-RELEASE` lists the points the design has to cover.

- [ ] Read how `@monodon/rust` 3.0.0 implements Nx release `VersionActions` for `Cargo.toml`
- [ ] Answer each point in `DES-RELEASE` with the user: version bumps, dependents, `Cargo.lock`, publish order, the hack-crate dependency
- [ ] Rewrite the items, remove their `Open:` paragraphs and set them `accepted`
- [ ] Add or extend the verification that the Mara policies then require
- [ ] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
