---
title: Print the projects' graph-time warnings once per command, where a cache hit and the daemon cannot hide them
status: todo
type: feature
parent: nxr-w9qa5f
discovered_from: nxr-zqvnrh
created_at: 2026-11-13T20:36:42Z
---

Goal: a graph-time warning reaches the terminal in every Nx command that runs tasks of the projects it concerns, also when a task is restored from the cache, and a warning whose cause is gone is not repeated. Concerns `DES-DIAGNOSTICS`, "Warnings where they are seen", under `REQ-DIAGNOSTICS`, checked by `VER-SETUP`.

Context: since nxr-fy4t4k and nxr-zqvnrh, the executor prints the warnings in a project's `metadata.cargo.warnings`, and the warning for a newer Nx under `NX_RUST_ALLOW_UNSUPPORTED_NX=true`, at the start of each task (`runTask` in `nx-rust/src/executors/task.ts`). On a cache hit, Nx runs no executor and replays the stored output. Found in the review of pull request #50: in `patched-workspaces`, after `api:fmt-check` was cached, a `[patch]` added to `$CARGO_HOME/config.toml` gave the graph the warning about configuration outside the repository, but the cache hit printed none. In the reverse order, the cache hit replayed a warning whose cause was gone. The cache keys rightly stay the same, because the warnings change no result.

The design does not say yet where such a warning is printed once per command, or what happens to the copies inside a task's stored output. Record that decision in `DES-DIAGNOSTICS` (with the evidence it rests on, and `VER-SETUP` adjusted), and have the user agree to it, before writing code.

- [ ] Find out what Nx 24 offers for printing once per command in the terminal, also with the daemon on and for cache hits: for example the `preTasksExecution` hook that `nx-rust/src/executors/nx-command.ts` already uses, and which projects' warnings it can know there. Record what was found as evidence
- [ ] Propose the change to `DES-DIAGNOSTICS`, including whether the executor keeps printing the warnings into the task output (where a cache hit replays them), and get the user's agreement
- [ ] Implement it and extend the tests of `VER-SETUP`: a warning that arose after a task was cached appears in a run that restores the task, and one whose cause is gone does not

Done when: the cited verification covers the new behaviour and passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
