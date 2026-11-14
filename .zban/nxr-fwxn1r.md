---
title: Settle how nx release publish --registry maps to Cargo
status: todo
type: task
tags:
  - spec
parent: nxr-6q2chq
related:
  - nxr-m8evx2
discovered_from: nxr-5fp9d3
created_at: 2026-11-14T15:49:00Z
---

Goal: `nx release publish --registry <value>` publishes crates to the registry the user means, or keeps failing with a clear reason.

Until this is settled, `DES-RELEASE` (`nx-rust/docs/release.mara.md`, Options and "Settled during implementation") fails a publish task that receives `registry`, because ignoring it would publish to another registry than the one asked for. Nx passes the flag's value through as given (`EVD-NX-24-RELEASE`); for npm it is a URL. Cargo takes a registry's name from its configuration with `--registry`, or an index URL with `--index`, and a crate's `publish` list and `registry.default` choose one as well (`EVD-CARGO-PUBLISH`: path dependencies are looked up on crates.io when packaged unless their entry names a `registry`).

- [ ] Find with evidence what `nx release publish --registry` passes and what each Cargo form does with a name, a URL and a crate whose `publish` list names another registry
- [ ] Ask the maintainer which mapping v1 offers: a name, a URL, either by its form, or none (keep failing)
- [ ] Update `DES-RELEASE`, its user guidance and `VER-RELEASE` group 7, and file the implementation step on nxr-m8evx2 or its successor

Done when: the maintainer has chosen, the items are updated, and `mara schema validate` and `mara project validate` report `valid: true`.
