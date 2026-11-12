---
title: Decide whether nx format should cover Rust
status: todo
type: task
priority: deferred
tags:
  - spike
discovered_from: nxr-vwr8wk
created_at: 2026-11-12T19:14:27Z
---

v1 formats Rust only through the `fmt-check` and `fmt` targets. `nx format:check` and `nx format:write` cannot run rustfmt in Nx 24.0.6: `EVD-NX-FORMAT` (`nx-rust/docs/decisions.mara.md`) records why, and `ADR-V1-SCOPE` puts formatting Rust through `nx format` outside v1. The user asked on 2026-11-12 to keep the idea for after v1.

What the evidence leaves open: a prettier plugin that pipes `.rs` files through rustfmt works with the plain `prettier` CLI, but Nx drops `.rs` files before prettier sees them, and workspaces that use oxfmt cannot be covered at all.

- [ ] Check whether a newer Nx passes configured prettier plugins to its file filter, or offers a formatter hook
- [ ] If not: ask the user whether to propose that change to Nx, and draft the proposal for them to file
- [ ] Decide with the user whether nx-rust ships a rustfmt plugin for prettier: edition per crate, the toolchain per folder, and what `nx format` then means in a workspace that uses oxfmt
- [ ] If it goes ahead: a draft need and decision in Mara first, for the user to accept

Done when: the user has decided, and the decision is recorded in Mara or this issue is cancelled with the reason.
