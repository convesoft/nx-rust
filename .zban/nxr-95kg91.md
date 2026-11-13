---
title: Fail graph creation on unknown target options in the nx metadata tables
status: todo
type: feature
parent: nxr-w9qa5f
blocked_by:
  - nxr-xyq7c8
  - nxr-9f4w3f
discovered_from: nxr-wynx3g
created_at: 2026-11-13T11:02:57Z
---

Goal: the graph-time check of `REQ-UNKNOWN-METADATA-OPTIONS` exists.

Implements `REQ-UNKNOWN-METADATA-OPTIONS` and the last paragraph of `DES-UNKNOWN-OPTIONS` (`nx-rust/docs/configuration.mara.md`), with its row in `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`). Checked by the last paragraph of `VER-UNKNOWN-OPTIONS` and by the `init` case in `VER-SETUP`. Blocked by nxr-9f4w3f for the names of the target options and by nxr-xyq7c8, which reads the tables.

- [ ] Check the target tables while the metadata tables are read, in `tableProblems` (`nx-rust/src/graph/target-tables.ts`), the one place where nxr-xyq7c8 checks each `targets.<name>` table against the target it addresses before merging it
- [ ] Compare the keys with the `properties` of the executors' schemas (`nx-rust/src/executors/cargo/schema.json` and `run/schema.json`), so that the check and the executors cannot disagree (moved here from nxr-xyq7c8)
- [ ] Graph tests for each table and configuration case of the verification

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
