---
title: Decide what happens to unknown options in a configuration of a target in Cargo metadata
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-9f4w3f
discovered_from: nxr-wynx3g
created_at: 2026-11-13T11:03:08Z
---

Goal: the plugin treats an unknown key in `configurations.<configuration>` of a `targets.<name>` table in `[package.metadata.nx]` or `[workspace.metadata.nx]` in a way the maintainer has agreed.

`REQ-UNKNOWN-METADATA-OPTIONS` covers only the keys under `options` of such a table, as the maintainer's answer of 13 November 2026 named them. A target table has the shape of an Nx target, so it can also hold configurations whose keys are options. As written, an unknown key there reaches the executor, which ignores it with a warning (`REQ-UNKNOWN-OPTIONS`), and `DES-UNKNOWN-OPTIONS` would name the crate's folder as its source although the key came from the manifest.

Options: fail graph creation as for `options` (recommended: the plugin owns the source and knows the option names at graph creation), or ignore with a warning that names the manifest.

- [ ] Agree the answer with the maintainer
- [ ] Extend `REQ-UNKNOWN-METADATA-OPTIONS`, `DES-UNKNOWN-OPTIONS` and `VER-UNKNOWN-OPTIONS` accordingly

Done when: the answer is accepted in Mara and `mara project validate` reports `valid: true`.
