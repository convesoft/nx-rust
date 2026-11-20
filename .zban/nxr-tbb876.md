---
title: Do not give a crate inside CARGO_HOME the report of the workspace around it
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-gp1awx
created_at: 2026-11-20T13:58:37Z
---

Goal: a manifest gets the `cargo metadata` report of the workspace that cargo itself picks for it, also where it lies inside `CARGO_HOME` (`DES-METADATA-REPORT`).

Context: found by the review of nxr-gp1awx, and the same at commits 3e87698 and e954cfa. With `CARGO_HOME=root/home` and a workspace `root` that lists `home/crate` as a member, `ComputationReports` reuses the root's report for `root/home/crate/Cargo.toml`, while cargo, asked for that manifest directly, reports it as a standalone package: cargo stops looking for a workspace root when it reaches the folder that holds its home. Exotic: it needs cargo's home inside a workspace whose members include a crate in that home.

- [ ] Reproduce with a real `cargo` in a fixture under `$TMPDIR`, on the installed cargo and on Cargo 1.91
- [ ] Do not reuse a report for a manifest inside cargo's home unless cargo names the same root for it, or record the limit in `DES-METADATA-REPORT`

Done when: the fixture's crate gets its own report, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
