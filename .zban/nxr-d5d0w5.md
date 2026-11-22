---
title: Warn about a per-user rustfmt file that HOME or XDG_CONFIG_HOME places in an ignored folder of a crate
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-rpcfg4
created_at: 2026-11-22T12:48:19Z
---

Cites: `DES-DIAGNOSTICS`, `RISK-HOST-ENVIRONMENT`, `EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`.

When `HOME` or `XDG_CONFIG_HOME` places the rustfmt file that rustfmt takes inside the repository, the warning of `DES-DIAGNOSTICS` ("Rustfmt configuration outside the repository") skips the crates whose folder holds the file, because a crate's key holds the files of its folder. If an ignore rule (`.gitignore`, `.nxignore`) hides that file, Nx does not hash it, and that crate gets neither a key change nor a warning. This was found in review of nxr-rpcfg4 and is exotic: it takes a per-user configuration folder that is both inside a crate and ignored.

- [ ] In `rustfmtConfigurationWarnings` (`nx-rust/src/graph/rustfmt-config.ts`), check with `filesNxSees` (`graph/visibility.ts`) whether Nx sees the file before skipping the crates whose folder holds it, and warn for them otherwise; this makes the function async
- [ ] Update `DES-DIAGNOSTICS` and add a case to `nx-rust/test/rustfmt-config.spec.ts`
