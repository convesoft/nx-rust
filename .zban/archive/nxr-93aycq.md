---
title: Decide how a Cargo configuration file that Nx does not hash stops giving wrong cache hits
status: done
type: bug
discovered_from: nxr-dj5tvp
created_at: 2026-11-14T11:12:29Z
closed_at: 2026-11-14T12:16:35Z
---

Goal: the maintainer decides what keeps a change to a Cargo configuration file that Nx does not hash from restoring a result that cargo would now build differently (`GOAL-TRUSTED-CACHE`).

Found while checking nxr-dj5tvp; the facts are in `EVD-CARGO-REDIRECTIONS` (bullets "Ignored configuration files" and "Ignored configuration and the keys"). Nx hashes no file that an ignore rule (`.gitignore`, `.nxignore`, git's exclude files) leaves out, so the file inputs that `DES-INPUTS` gives for `.cargo/config.toml` contribute nothing for such a file, and the Nx daemon does not create the graph again when it changes. `RISK-HOST-ENVIRONMENT` accepts this for configuration outside the repository; nothing covers an ignored file inside it. Since nxr-dj5tvp, both draw the warning of `DES-DIAGNOSTICS` when they hold `[patch]` or `paths`, with `nx reset` as a remedy.

Reproductions, with `nx` 24.0.6 and cargo 1.100.0, in a copy of the fixture `patched-workspaces` (root manifest as committed, so `fork` is patched to `third_party/fork`) with `rust/.cargo/` in `.gitignore`:

1. With the daemon (`NX_DAEMON=true`): add `third_party/fork-b`, a copy of `third_party/fork` (name `fork`, version 0.1.0, `model = "0.1"`) whose `name()` returns another text; `nx run api:build`; write `[patch.crates-io]\nfork = { path = "../third_party/fork-b" }` into `rust/.cargo/config.toml`; `nx run api:build` again. The lockfile task leaves `Cargo.lock` as it was and the second run is "existing outputs match the cache, left as is", replaying "Compiling fork v0.1.0 (…/third_party/fork)", while `cargo tree -p api --offline --locked` shows `third_party/fork-b`. The same `[patch]` in the Cargo home's `config.toml` gives the same hit. Without the daemon the task runs and compiles `fork-b`.
2. Without the daemon: `rust/crates/plain/src/lib.rs` with `pub const FLAVOUR: &str = env!("FLAVOUR");` and `[env]\nFLAVOUR = "a"` in the ignored `rust/.cargo/config.toml`; `nx run plain:build`; change the value to `"b"`; `nx run plain:build` is a cache hit. With the file not ignored, the second run runs. Other settings there, such as `rustflags` or profiles, stay out of the key in the same way, with or without redirections.

The throwaway Jest spec that ran both is not committed; the steps above are complete.

- [x] Decide with the maintainer what follows: accept it as a risk with the warning, hash ignored configuration files another way (for example a runtime input that prints their contents, or filesets with `includeIgnored`, which Nx does not count as changed files for `nx affected`), warn for every ignored configuration file, or fail graph creation for one
- [x] Record the decision in Mara (`DES-INPUTS`, `RISK-HOST-ENVIRONMENT` or a new risk, `DES-DIAGNOSTICS`) and implement it with tests

Done when: the decision is recorded and, if the behaviour changes, its checks pass with `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all`.

## Summary of Changes

The maintainer's decision of 14 November 2026, word for word the option he chose: "Keep the risk, warn clearly". No key changes and `RISK-HOST-ENVIRONMENT` stays accepted, now also for configuration files inside the repository that an ignore rule leaves out. His answer, the two options he did not take and the two reproductions (already in `EVD-CARGO-REDIRECTIONS`) are recorded there. The control plane's decisions within it, recorded as such in `DES-DIAGNOSTICS`:

- **Which files:** every configuration file that cargo reads for a workspace and that Nx does not hash: outside the repository (folders above it, the Cargo home) or ignored inside it, as Nx's workspace context reports. The redirection warning of nxr-dj5tvp is now the special case: one warning per file, naming what it sets.
- **Which tables:** only a file that sets `[build]`, `[target]`, `[host]`, `[profile]`, `[env]`, `[patch]`, `[source]`, `paths`, `[unstable]` or `[doc]` warns. `[host]` is the one I added from cargo's reference. `[alias]`, `[net]` and the other non-build tables stay quiet; `[resolver]` and the registries only change what `Cargo.lock` records, which the keys follow.
- **Not in keys, on every task:** the warning goes to the metadata of every project of the workspace concerned (`cargo.configurationWarnings`) and stays out of the `nx-rust-warnings` digest and every key. The executor prints it at the start of every task of those projects, as the other project warnings, through one code path that includes the lockfile task. Graph creation and `init` print it as before. The text is two lines, three for a file with redirections, and points to the caching guide's new section "Cargo configuration that Nx does not hash". The control plane first chose the lockfile task alone, then corrected that the same day, after the check below.
- **Remedy wording:** Nx 24.0.6 stores no result of a run with `--skip-nx-cache` (the task orchestrator passes `doNotSkipCache` as `postRunSteps`'s `shouldCache`), so a later run restores the result from before the change. The text therefore says to run `nx reset`, and that `--skip-nx-cache` covers only the command it is given to; for an ignored file it adds that not ignoring it makes Nx hash it. Recorded in `EVD-NX-24-WARNING-CHANNELS`.
- **Where it shows:** a first version printed it from the lockfile task alone, which Nx hides for `nx run <crate>:build` in its default output styles (without a terminal, `CI` false and true; in a terminal with and without `CI`). Printed by every task, it now appears under `plain:build`'s own header in all of these modes, when the task runs and when it is restored. Stated limit in `DES-DIAGNOSTICS`: a cache hit replays the stored run's output, so it can show an earlier state of this one warning.

Code: `discovery.ts` (`unhashedConfigurationWarnings`, `buildTables`), `redirections.ts` (each configuration file with its keys), `projects.ts`, `collisions.ts`, `executors/task.ts`. Docs: `DES-DIAGNOSTICS`, `ADR-REDIRECTION-EDGES`, `RISK-HOST-ENVIRONMENT`, `EVD-NX-24-WARNING-CHANNELS`, `VER-GRAPH`, `VER-SETUP` and a paragraph in the caching guide.

Tests with the real Nx:
- `warnings.spec.ts`: `nx run plain:build` with the daemon and the default output style (`CI` false and true) shows the warning in the task's own output, run and restored. An ignored `.cargo/config.toml` with `[env]` (the second reproduction) warns from `plain:build` and the lockfile task in every run, with the remedy. Its build is restored after the change, runs with `--skip-nx-cache`, is restored again after that, and runs after `nx reset`. `[alias]` alone and a Cargo home with only `[net]` give no warning; a Cargo home with `[build] rustflags` warns. No key changes in any case. Two checkouts with and without a private Cargo home that sets `[build]` get the same keys. A Cargo home `[patch]` changes `api:check` through its edge only.
- `redirections.spec.ts`: crate tasks of the workspaces concerned print the warning, those of other workspaces don't.

Checks run after the correction, on the merge with `origin/main` f3ba0e6: the three specs (discovery 45, redirections 59, warnings 31 passed), `pnpm nx run-many -t build lint test` (36 suites, 1181 passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (26 passed), `mara schema validate`, `mara project validate` (valid, evaluation complete, no diagnostics) and `zban check`.
