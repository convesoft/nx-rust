---
title: Decide how a Cargo configuration file that Nx does not hash stops giving wrong cache hits
status: todo
type: bug
discovered_from: nxr-dj5tvp
created_at: 2026-11-14T11:12:29Z
---

Goal: the maintainer decides what keeps a change to a Cargo configuration file that Nx does not hash from restoring a result that cargo would now build differently (`GOAL-TRUSTED-CACHE`).

Found while checking nxr-dj5tvp; the facts are in `EVD-CARGO-REDIRECTIONS` (bullets "Ignored configuration files" and "Ignored configuration and the keys"). Nx hashes no file that an ignore rule (`.gitignore`, `.nxignore`, git's exclude files) leaves out, so the file inputs that `DES-INPUTS` gives for `.cargo/config.toml` contribute nothing for such a file, and the Nx daemon does not create the graph again when it changes. `RISK-HOST-ENVIRONMENT` accepts this for configuration outside the repository; nothing covers an ignored file inside it. Since nxr-dj5tvp, both draw the warning of `DES-DIAGNOSTICS` when they hold `[patch]` or `paths`, with `nx reset` as a remedy.

Reproductions, with `nx` 24.0.6 and cargo 1.100.0, in a copy of the fixture `patched-workspaces` (root manifest as committed, so `fork` is patched to `third_party/fork`) with `rust/.cargo/` in `.gitignore`:

1. With the daemon (`NX_DAEMON=true`): add `third_party/fork-b`, a copy of `third_party/fork` (name `fork`, version 0.1.0, `model = "0.1"`) whose `name()` returns another text; `nx run api:build`; write `[patch.crates-io]\nfork = { path = "../third_party/fork-b" }` into `rust/.cargo/config.toml`; `nx run api:build` again. The lockfile task leaves `Cargo.lock` as it was and the second run is "existing outputs match the cache, left as is", replaying "Compiling fork v0.1.0 (…/third_party/fork)", while `cargo tree -p api --offline --locked` shows `third_party/fork-b`. The same `[patch]` in the Cargo home's `config.toml` gives the same hit. Without the daemon the task runs and compiles `fork-b`.
2. Without the daemon: `rust/crates/plain/src/lib.rs` with `pub const FLAVOUR: &str = env!("FLAVOUR");` and `[env]\nFLAVOUR = "a"` in the ignored `rust/.cargo/config.toml`; `nx run plain:build`; change the value to `"b"`; `nx run plain:build` is a cache hit. With the file not ignored, the second run runs. Other settings there, such as `rustflags` or profiles, stay out of the key in the same way, with or without redirections.

The throwaway Jest spec that ran both is not committed; the steps above are complete.

- [ ] Decide with the maintainer what follows: accept it as a risk with the warning, hash ignored configuration files another way (for example a runtime input that prints their contents, or filesets with `includeIgnored`, which Nx does not count as changed files for `nx affected`), warn for every ignored configuration file, or fail graph creation for one
- [ ] Record the decision in Mara (`DES-INPUTS`, `RISK-HOST-ENVIRONMENT` or a new risk, `DES-DIAGNOSTICS`) and implement it with tests

Done when: the decision is recorded and, if the behaviour changes, its checks pass with `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all`.
