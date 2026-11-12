---
title: Add the init and crate generators
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-dp5q0f
created_at: 2026-11-12T18:20:01Z
---

Goal: `nx add @convesoft/nx-rust` sets the plugin up, and `library` and `binary` generators create crates.

Implements `REQ-INIT` and `REQ-CRATE-GENERATORS` (`nx-rust/docs/setup.mara.md`). Checked by `VER-SETUP`.

- [ ] `init` registers the plugin in `nx.json` and reports missing tools; it writes nothing into crates
- [ ] `library` and `binary` wrap `cargo new` and add the crate to the workspace members once
- [ ] `generators.json` and the `nx add` entry point in the package

Done when: the parts of the cited verification that cover this work pass, and `pnpm exec nx run-many -t build lint test` and `pnpm format:check` pass.
