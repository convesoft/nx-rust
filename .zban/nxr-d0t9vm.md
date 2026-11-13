---
title: Add the coverage baseline target
status: todo
type: feature
parent: nxr-m3k3w8
blocked_by:
  - nxr-tabkjx
  - nxr-3k3z1j
created_at: 2026-11-12T18:20:01Z
---

Goal: a workspace-level target brings the coverage baseline up to date, and the docs show the main and pull request pipelines.

Implements `REQ-BASELINE` and `DES-BASELINE` (`nx-rust/docs/ci.mara.md`). Checked by `VER-TESTING`.

- [ ] The collection target on the workspace project: `collect --diff`, or a full `collect` when there is no usable data or the threshold is exceeded
- [ ] The threshold option
- [ ] The optional switches listed in `DES-BASELINE`
- [ ] A worked CI example in `ci.mara.md`

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
