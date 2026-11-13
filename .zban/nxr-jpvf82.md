---
title: Warn when a workspace's artifact directory lies outside the repository
status: todo
type: feature
parent: nxr-w9qa5f
related:
  - nxr-fy4t4k
discovered_from: nxr-g4arav
created_at: 2026-11-13T16:02:01Z
---

Goal: graph creation warns when a workspace's artifact directory lies outside the repository, as the row "An artifact directory outside the repository" of `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) and `DES-OUTPUTS` (`nx-rust/docs/caching.mara.md`) say. Checked by `VER-CARGO-UNCHANGED` (first paragraph, last sentence) and the last paragraph of `VER-SETUP`.

Context: found while adding the row for a shared artifact directory (nxr-g4arav). nxr-fy4t4k leaves `build` and `doc` uncached in that case and, since nxr-g4arav, owns the warning for a shared artifact directory, but no issue had a step for this warning. If nxr-fy4t4k takes it over as a step, cancel this issue.

- [ ] The warning when the graph is created, naming the workspace and the directory
- [ ] A test that `init` prints it
- [ ] The warning again from the executor at the start of a task of the workspace concerned ("Warnings where they are seen" in `DES-DIAGNOSTICS`), once the executor of nxr-kmdpgj exists

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
