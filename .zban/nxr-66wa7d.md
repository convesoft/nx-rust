---
title: Run graph-time cargo in workspace root folders with RUSTUP_AUTO_INSTALL=0
status: todo
type: task
priority: high
parent: nxr-w9qa5f
discovered_from: nxr-1ydrfd
created_at: 2026-11-13T14:30:22Z
---

Goal: graph creation installs no toolchain, and each of its cargo calls starts in the folder that `DES-METADATA-REPORT` names.

Implements `ADR-GRAPH-NO-TOOLCHAIN-INSTALL` and the last paragraph of `DES-METADATA-REPORT` (`nx-rust/docs/workspaces.mara.md`). Checked by the graph-creation cases of a missing pinned toolchain in `VER-SETUP`. `EVD-RUSTUP-MISSING-TOOLCHAIN` has what rustup prints.

- [ ] Set the variable in `runCargoForGraph` (`nx-rust/src/cargo/run-cargo.ts`) for its child only, not in `process.env`
- [ ] Request a workspace's report again in its root folder when discovery first read it from another folder (`nx-rust/src/graph/discovery.ts` starts in the folder of the shallowest unclaimed manifest)
- [ ] Tests. The harness sets `RUSTUP_AUTO_INSTALL=0` for every command (`nx-rust/test/harness/environment.ts`), so a test that checks the plugin sets it has to remove it from the environment, and should then pin no missing toolchain, so that a failure cannot download one

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
