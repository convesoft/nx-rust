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

Goal: a key under `options` or under a configuration of a `targets.<name>` table in `[package.metadata.nx]` or `[workspace.metadata.nx]` that is no option of the target's executor stops graph creation with a message that names the manifest, the target, the configuration if any, and the key.

Implements `REQ-UNKNOWN-METADATA-OPTIONS` and the last paragraph of `DES-UNKNOWN-OPTIONS` (`nx-rust/docs/configuration.mara.md`). Checked by the second paragraph of `VER-UNKNOWN-OPTIONS`. Blocked by nxr-9f4w3f for the names of the target options and by nxr-xyq7c8, which reads the tables.

- [ ] Compare the keys under `options` and under each configuration of each such table with the options that the target's executor declares
- [ ] Fail graph creation with the manifest, the target, the configuration if any, and the key in the message
- [ ] Graph tests with an unknown key in a package table, in a workspace table and in a configuration, and with known keys only

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
