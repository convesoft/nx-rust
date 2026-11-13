---
title: Decide whether init counts cargo-audit as a tool the configuration needs
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-kq5pm5
  - nxr-eg9s2w
discovered_from: nxr-dp5q0f
created_at: 2026-11-13T10:12:53Z
---

Goal: a recorded answer to whether `init` reports a missing cargo-audit as a warning or on its informational line, added to the table of tools in `DES-GENERATORS` (`nx-rust/docs/setup.mara.md`).

Context: `DES-GENERATORS` makes `init` warn about each missing tool that the repository's configuration needs and list absent tools that nothing needs on one line marked "not needed by your settings" (answer of 13 November 2026 under nxr-dp5q0f). Its table says when each tool counts as needed. nxr-kq5pm5 decided on 13 November 2026 that every workspace project gets an `audit` target running `cargo audit`, whether or not cargo-audit is installed. Whether that makes cargo-audit a tool the configuration needs was not asked, so the table leaves cargo-audit out and `init` says nothing about it yet. cargo-deny is in the table: it is needed where a workspace project has a `deny` target, which only a deny configuration file creates.

Options:

- **Optional, on the informational line (recommended).** No setting or file asks for `audit`; the target exists on every workspace. A warning would appear in every repository without cargo-audit, including the one `SCN-ADOPT` describes, while pipelines that run `nx affected -t lint test build` never run `audit`. A missing cargo-audit still fails an `audit` task with the standard message (`DES-DIAGNOSTICS`).
- **Needed, as a warning.** The target exists on every workspace project, so `nx run-many -t audit` fails without the tool, and `init` would say so up front.

- [ ] Agree the option with the maintainer
- [ ] Add a cargo-audit row to the table of tools in `DES-GENERATORS`
- [ ] Extend `VER-SETUP` if the answer makes cargo-audit a needed tool

Done when: the row is in the accepted `DES-GENERATORS`, and `mara schema validate` and `mara project validate` report `valid: true`.
