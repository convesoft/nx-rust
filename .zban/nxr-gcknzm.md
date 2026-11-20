---
title: A crate's dotenv vault leaks DOTENV_VAULT_<ENV> into other tasks' cargo, depending on task order and batching
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-4sr6hd
created_at: 2026-11-20T15:36:17Z
---

Goal: decide whether the plugin should make the `DOTENV_VAULT_<ENV>` variable that dotenv writes for a vault the same in every way of running a task, and do it if so (`DES-BATCH`, "Dotenv files"; `VER-BATCHING`).

Context: with `DOTENV_KEY` set, dotenv 16.4.7 (`lib/main.js`, `_parseVault`) parses a `.vault` file into the live `process.env` before it decrypts, even when Nx passes a copy for the decrypted values. Nx 24.0.6's `getTaskSpecificEnv` runs that for every task whose dotenv files have a vault beside them. The `nx` process writes it there, and so does a batch process that rebuilds the layer. Later environments copied from that `process.env` then carry the vault's raw `DOTENV_VAULT_<ENV>`: tasks computed later, and the batch process that Nx spawns. The dotenv check refuses the vault's own task, but not the other tasks of the run.

Reproduction (20 November 2026, nxr-4sr6hd, Nx 24.0.6, plugin at the branch of nxr-4sr6hd), in a copy of the `batch-groups` fixture with `rust/crates/indep/.env.test` and `.env.test.vault` holding `DOTENV_VAULT_TEST=…` and `DOTENV_KEY` set to a key for environment `test`, an integration test of `breakable` printing `DOTENV_VAULT_TEST`, and `nx run-many -t test --excludeTaskDependencies --skip-nx-cache`:

- `-p breakable` alone, with `--batch` or `--batch=false`: unset.
- `-p indep breakable`, with `--batch`, `--batch=false` or `--batch=false --parallel=1`: `breakable` sees the raw vault value.
- `-p breakable indep --batch=false`: unset. With `--batch`: set, because the batch process starts with it (Nx's own process wrote it before spawning the batch).

Nx's own task runs therefore already depend on the order in which Nx computes the task environments. The batch makes the variable reach every task of the run. No cache key covers it.

- [ ] Decide with the maintainer whether to act (for example, leave `DOTENV_VAULT_*` out of cargo's environment in every way of running, as `cargoTaskEnvironment` does for Nx's run variables, or refuse every task of a run in which the check finds a vault) or to record it as a limit only
- [ ] If acting, update `DES-BATCH` first and add the case to `VER-BATCHING`
