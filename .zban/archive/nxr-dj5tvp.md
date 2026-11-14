---
title: Check whether a git-ignored .cargo/config.toml with redirections needs the warning too
status: done
type: task
priority: low
discovered_from: nxr-p5ybc0
created_at: 2026-11-13T15:11:16Z
closed_at: 2026-11-14T11:22:36Z
---

Goal: the user learns about every file whose redirections the graph follows but whose changes Nx does not see.

`ADR-REDIRECTION-EDGES` warns for a configuration file outside the repository that redirects dependencies through `[patch]` or `paths` (`DES-DIAGNOSTICS`), because the Nx daemon does not watch it (`EVD-CARGO-REDIRECTIONS`). A `.cargo/config.toml` inside the repository that `.gitignore` or `.nxignore` ignores is a common place for local `[patch]` entries. If the daemon does not recompute the graph when such a file changes, the graph keeps old edges there too, without a warning. Not checked.

- [x] Check with the Nx daemon whether a change to a git-ignored `.cargo/config.toml` in the workspace root makes Nx compute the graph again
- [x] If it does not, decide with the user whether the warning covers such files, and record it in `DES-DIAGNOSTICS` and `VER-GRAPH`

Done when: the check is recorded as evidence, and any change it leads to passes `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all`.

## Summary of Changes

The check, with `nx` 24.0.6 and the real daemon: a `[patch]` written into a `rust/.cargo/config.toml` that `.gitignore`, or in another copy `.nxignore`, leaves out did not make the daemon create the graph again; the edges came only after a tracked file changed. The same file not ignored did at once. Nx's hasher leaves an ignored configuration file out of every key. Recorded in `EVD-CARGO-REDIRECTIONS`.

Decided by the control plane (recorded in `ADR-REDIRECTION-EDGES` as such), as the consistent extension of the warning for configuration outside the repository: every file whose redirections the plugin follows and whose changes Nx does not see draws that warning. That covers a configuration file outside the repository, and a configuration file or root manifest inside it that Nx does not read, which `filesNxSees` asks Nx's workspace context about, so git's exclude files count as well. The remedy for an ignored file is to stop ignoring it or to run `nx reset` after changing it. The warning names the tables the file uses. `nx-rust/src/graph/discovery.ts`: `unwatchedRedirectionWarnings` replaces `outsideRedirectionWarnings`. Updated `DES-DIAGNOSTICS`, `VER-GRAPH`, `VER-SETUP`, the status note of `setup.mara.md` and the guidance in `workspaces.mara.md`. Tests: `redirections.spec.ts` (a `.cargo/config.toml` ignored by `.gitignore` and by `.nxignore`, and an ignored root manifest, with no warning before the file is ignored) and `warnings.spec.ts` (a task prints the warning whether it runs or is restored, and its key follows it, as for the Cargo home).

The cache key: a wrong cache hit remains under the daemon, and without it for settings other than redirections. That needs a decision, so it is filed as nxr-93aycq with reproductions and left alone here.

Checks run: `pnpm nx run-many -t build lint test` (36 suites, 1217 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), `mara schema validate`, `mara project validate` (valid, evaluation complete, no diagnostics) and `zban check`.
