---
title: Document per-target test inputs, non-Cargo assets outside target/, and cross-worktree cache isolation
status: todo
type: task
parent: nxr-h52ghk
discovered_from: nxr-pt464b
created_at: 2026-11-22T10:39:28Z
---

Cites: `DES-INPUTS`, `DES-OUTPUTS`, `DES-INVOCATION`, `RISK-HOST-ENVIRONMENT`, `REQ-CACHE-OUTPUTS`.

Three documentation gaps from adopting `1.0.0-rc.1` in `mara`:

- [ ] Per-target `inputs` (#4): document in `nx-rust/docs/caching.mara.md` and `nx-rust/docs/configuration.mara.md` that `envInputs` and `runtimeInputs` apply to the crate's `default` named input (every target of the crate and its dependents), and show the `[package.metadata.nx.targets.test]` `inputs = ["...", ...]` recipe for test-only environment variables and external programs on `PATH` (for example `{ runtime = "tar --version" }`)
- [ ] Non-Cargo assets and `fileInputs` (#5): note in `nx-rust/docs/caching.mara.md` why `fileInputs` rejects paths inside Cargo's artifact/build directory (`target/`) and recommend placing non-Cargo test assets outside `target/` or keying them via a per-target `runtime` input (noting `CARGO_TARGET_DIR` when tests resolve paths relative to `CARGO_BIN_EXE_*`)
- [ ] Cross-worktree cache sharing & restored artifacts (#6): document in `nx-rust/docs/caching.mara.md` and `nx-rust/docs/setup.mara.md` (and note in `RISK-HOST-ENVIRONMENT` if appropriate) that `check`/`lint`/`fmt-check`/`test` store results only and `build` restores only final artifacts (never `.d` files or Cargo's build directory), that Nx 24 shares a per-user cache across linked git worktrees by default, that restored `build` binaries can embed the producing checkout's path via `env!("CARGO_MANIFEST_DIR")` or DWARF debug info unless `--remap-path-prefix` is used, and how to isolate worktrees via `cacheDirectory` in `nx.json` or `NX_CACHE_DIRECTORY` (with `NX_DAEMON=false` when set per command)

Done when: all three topics are clearly documented in the guides, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate`, `zban check` and CI pass.
