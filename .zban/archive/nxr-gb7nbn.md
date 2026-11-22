---
title: Document per-target test inputs, non-Cargo assets outside target/, and cross-worktree cache isolation
status: done
type: task
parent: nxr-h52ghk
discovered_from: nxr-pt464b
created_at: 2026-11-22T10:39:28Z
closed_at: 2026-11-22T11:47:45Z
---

Cites: `DES-INPUTS`, `DES-OUTPUTS`, `DES-INVOCATION`, `RISK-HOST-ENVIRONMENT`, `REQ-CACHE-OUTPUTS`.

Three documentation gaps from adopting `1.0.0-rc.1` in `mara`:

- [x] Per-target `inputs` (#4): document in `nx-rust/docs/caching.mara.md` and `nx-rust/docs/configuration.mara.md` that `envInputs` and `runtimeInputs` apply to the crate's `default` named input (every target of the crate and its dependents), and show the `[package.metadata.nx.targets.test]` `inputs = ["...", ...]` recipe for test-only environment variables and external programs on `PATH` (for example `{ runtime = "tar --version" }`)
- [x] Non-Cargo assets and `fileInputs` (#5): note in `nx-rust/docs/caching.mara.md` why `fileInputs` rejects paths inside Cargo's artifact/build directory (`target/`) and recommend placing non-Cargo test assets outside `target/` or keying them via a per-target `runtime` input (noting `CARGO_TARGET_DIR` when tests resolve paths relative to `CARGO_BIN_EXE_*`)
- [x] Cross-worktree cache sharing & restored artifacts (#6): document in `nx-rust/docs/caching.mara.md` and `nx-rust/docs/setup.mara.md` (and note in `RISK-HOST-ENVIRONMENT` if appropriate) that `check`/`lint`/`fmt-check`/`test` store results only and `build` restores only final artifacts (never `.d` files or Cargo's build directory), that Nx 24 shares a per-user cache across linked git worktrees by default, that restored `build` binaries can embed the producing checkout's path via `env!("CARGO_MANIFEST_DIR")` or DWARF debug info unless `--remap-path-prefix` is used, and how to isolate worktrees via `cacheDirectory` in `nx.json` or `NX_CACHE_DIRECTORY` (with `NX_DAEMON=false` when set per command)

Done when: all three topics are clearly documented in the guides, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check` and CI pass.

## Summary of Changes

- `caching.mara.md`: `envInputs` and `runtimeInputs` join the crate's `default` named input (every cached target of the crate and its dependents); new recipe for test-only variables and programs in `[package.metadata.nx.targets.test]` `inputs` (`{ env = ... }`, `{ runtime = "tar --version" }`); a paragraph on why `fileInputs` refuses Cargo's build/artifact directory and where to keep non-Cargo test data (outside `target/`, or keyed by a per-target `runtime` input; `CARGO_BIN_EXE_<name>` paths move with `CARGO_TARGET_DIR`/`build.target-dir`); new section "Sharing the cache between checkouts" (Nx 24's per-user cache, what a hit restores per target, compiled-in paths of restored `build` artifacts, `--remap-path-prefix` limits, isolation with `cacheDirectory` or `NX_CACHE_DIRECTORY` with `NX_DAEMON=false`).
- `configuration.mara.md`: the `runtime` entry in the per-target example and the scope of a per-target input versus `envInputs`/`runtimeInputs`.
- `setup.mara.md`: subsection "Several checkouts of one repository" pointing to the caching section.
- `RISK-HOST-ENVIRONMENT`: one sentence on restored `build` artifacts across checkouts.

Checks run: the recipe and claims in a scratch copy of the `subfolder-workspace` fixture with the built plugin and Nx 24.0.6 (per-target `env`/`runtime` inputs reach only `api:test`; `envInputs` reach dependents; a `fileInputs` pattern into `target/` fails graph creation; a second linked worktree restores the first one's results and its `build` binary prints the first checkout's `CARGO_MANIFEST_DIR`; `--remap-path-prefix` removes the debug-info path but not `env!`; `NX_CACHE_DIRECTORY` and a relative `cacheDirectory` give the checkout its own cache), the Nx 24.0.6 sources for the sharing rules; `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check` pass. CI on the pull request covers the remaining check.

## Decisions made

- The cross-checkout guidance covers every checkout that Nx 24.0.6 shares a cache between (linked worktrees and clones with the same remote or first commit), not only worktrees, because that is what the installed Nx does.
- The docs say `--remap-path-prefix` rewrites source paths but not `env!("CARGO_MANIFEST_DIR")`, and that a checkout-specific value in `RUSTFLAGS` splits keys per checkout; tried in the fixture. Isolating the cache with `cacheDirectory` is the recommended remedy.
- Non-Cargo test data inside `target/` is keyed by what decides its content (for example the producing tool's `--version`), not by reading the files.
