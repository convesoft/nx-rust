---
title: Check whether a git-ignored .cargo/config.toml with redirections needs the warning too
status: todo
type: task
priority: low
discovered_from: nxr-p5ybc0
created_at: 2026-11-13T15:11:16Z
---

Goal: the user learns about every file whose redirections the graph follows but whose changes Nx does not see.

`ADR-REDIRECTION-EDGES` warns for a configuration file outside the repository that redirects dependencies through `[patch]` or `paths` (`DES-DIAGNOSTICS`), because the Nx daemon does not watch it (`EVD-CARGO-REDIRECTIONS`). A `.cargo/config.toml` inside the repository that `.gitignore` or `.nxignore` ignores is a common place for local `[patch]` entries. If the daemon does not recompute the graph when such a file changes, the graph keeps old edges there too, without a warning. Not checked.

- [ ] Check with the Nx daemon whether a change to a git-ignored `.cargo/config.toml` in the workspace root makes Nx compute the graph again
- [ ] If it does not, decide with the user whether the warning covers such files, and record it in `DES-DIAGNOSTICS` and `VER-GRAPH`

Done when: the check is recorded as evidence, and any change it leads to passes `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all`.
