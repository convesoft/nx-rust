---
title: Print the projects' graph-time warnings once per command, where a cache hit and the daemon cannot hide them
status: done
type: feature
parent: nxr-w9qa5f
discovered_from: nxr-zqvnrh
created_at: 2026-11-13T20:36:42Z
closed_at: 2026-11-14T09:28:00Z
---

Goal: a graph-time warning reaches the terminal in every Nx command that runs tasks of the projects it concerns, also when a task is restored from the cache, and a warning whose cause is gone is not repeated. Concerns `DES-DIAGNOSTICS`, "Warnings where they are seen", under `REQ-DIAGNOSTICS`, checked by `VER-SETUP`.

Context: since nxr-fy4t4k and nxr-zqvnrh, the executor prints the warnings in a project's `metadata.cargo.warnings`, and the warning for a newer Nx under `NX_RUST_ALLOW_UNSUPPORTED_NX=true`, at the start of each task (`runTask` in `nx-rust/src/executors/task.ts`). On a cache hit, Nx runs no executor and replays the stored output. Found in the review of pull request #50: in `patched-workspaces`, after `api:fmt-check` was cached, a `[patch]` added to `$CARGO_HOME/config.toml` gave the graph the warning about configuration outside the repository, but the cache hit printed none. In the reverse order, the cache hit replayed a warning whose cause was gone. The cache keys rightly stay the same, because the warnings change no result.

The design does not say yet where such a warning is printed once per command, or what happens to the copies inside a task's stored output. Record that decision in `DES-DIAGNOSTICS` (with the evidence it rests on, and `VER-SETUP` adjusted), and have the user agree to it, before writing code.

- [x] Find out what Nx 24 offers for printing once per command in the terminal, also with the daemon on and for cache hits: for example the `preTasksExecution` hook that `nx-rust/src/executors/nx-command.ts` already uses, and which projects' warnings it can know there. Record what was found as evidence
- [x] Propose the change to `DES-DIAGNOSTICS`, including whether the executor keeps printing the warnings into the task output (where a cache hit replays them), and get the user's agreement
- [x] Implement it and extend the tests of `VER-SETUP`: a warning that arose after a task was cached makes the task run again and print it, and one whose cause is gone makes it run again without it

Done when: the cited verification covers the new behaviour and passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Research: a researcher measured Nx 24's channels on 14 November 2026. With the Nx daemon on, nothing that a plugin prints at graph creation or in the `preTasksExecution` and `postTasksExecution` hooks reaches the terminal, so "once per command" cannot be had there; only a task's own output does, which a cache hit replays as stored. Recorded as `EVD-NX-24-WARNING-CHANNELS`, with the rows the design relies on rerun the same day: a changed named input that no target names changes the keys of the project's tasks and of dependants (`util` → `model:check`), changed metadata changes none, and both hooks print without the daemon and only to its log with it.

Decision: the maintainer agreed on 14 November 2026 to "Key the warnings (Recommended)", design B of the research. This reverses the premise of this issue's context that the keys stay the same, and the third task item was reworded as he decided: "a warning that arose after a task was cached makes the task run again and print it, and one whose cause is gone makes it run again without it". Where a result stored under the key without the warning exists from before, removing the cause restores that result, which has no warning; otherwise the task runs again without it. The tests cover both.

What changed:

- Graph creation gives each project with warnings a named input `nx-rust-warnings`, which no target names and whose only entry, `{ "runtime": "echo <digest>" }`, holds SHA-256 over the warnings, each once and sorted, with paths inside the repository relative to its root (`nx-rust/src/graph/warnings.ts`). A project without warnings gets none, so keys of repositories without warnings stay as they are: across all 62 tasks of `two-workspaces` and `subfolder-workspace`, Nx's hash details on `main` and on this branch differed only in the fixture's `nx.json`, which names the compiled plugin by a path that changes with every test run (two runs of the same code differ there too).
- The warning for a newer Nx under `NX_RUST_ALLOW_UNSUPPORTED_NX=true` joins every project's warnings, and so the digest; the executor prints only the project's warnings.
- `DES-DIAGNOSTICS` ("Warnings where they are seen") takes the research's wording, says what the digest means for a shared cache (a path outside the repository, such as the Cargo home, keeps keys apart between machines), and lists each line that the executor prints before cargo, with why a hit shows it right or why it stays outside the key (a tool on `PATH`; the `targetDefaults` warnings of `createDependencies`, nxr-rxzgbq). `DES-INPUTS`, `VER-SETUP`, the setup guide and the caching guide say the same.
- Tests: `nx-rust/test/warnings.spec.ts` (digest, named input, keys through Nx's hasher, two checkouts in different folders with and without warnings, runs without the daemon for a `[patch]` in the Cargo home and for a `.gitignore` without `target/`, and the daemon case), a key test for the newer-Nx warning in `compatibility.spec.ts`, and the test in `cargo-directories.spec.ts` that asserted "changes no cache key" now asserts that the keys change through the projects' configuration alone.

Checks run: `pnpm nx run-many -t build lint test` (33 suites, 1003 tests passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 tests), `mara schema validate`, `mara project validate` (valid, evaluation complete, no diagnostics) and `zban check`.
