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

- `caching.mara.md`: `envInputs` and `runtimeInputs` join the crate's `default` named input (every cached target of the crate and its dependents); new recipe for test-only variables and programs in `[package.metadata.nx.targets.test]` `inputs` (`{ env = ... }`, `{ runtime = "tar --version" }`). A paragraph on why `fileInputs` refuses Cargo's build and artifact directories and where test data goes: unignored files in the crate's folder count, ignored or outside files need `fileInputs`; for files inside `target/`, a per-target `runtime` input that prints their digest (`cksum <file>`) where they exist before hashing, else every determinant of the step that writes them; `CARGO_BIN_EXE_<name>` paths move with `CARGO_TARGET_DIR`/`build.target-dir`. New section "Sharing the cache between checkouts": which checkouts Nx 24 shares a cache between and which settings turn sharing off, what a hit restores per target, compiled-in paths of restored `build` artifacts, `--remap-path-prefix` limits, a checkout-keyed `build` (`{ runtime = "pwd" }` in `[workspace.metadata.nx.targets.build]`) that also holds with a remote cache, and a local-only cache of its own with `cacheDirectory` or `NX_CACHE_DIRECTORY` (stop a running daemon with `nx daemon --stop`, or `NX_DAEMON=false`).
- `configuration.mara.md`: the `runtime` entry in the per-target example and the scope of a per-target input versus `envInputs`/`runtimeInputs`.
- `setup.mara.md`: subsection "Several checkouts of one repository" pointing to the caching section.
- No Mara item changes; `RISK-HOST-ENVIRONMENT` stays as it was (whether to accept cross-checkout restoration of path-sensitive artifacts as a risk is left to the maintainer).

Checks run, in scratch copies of the `subfolder-workspace` fixture with the built plugin and Nx 24.0.6:

- per-target `env`/`runtime` inputs reach only `api:test`, and `envInputs` reach dependents;
- a `fileInputs` pattern into `target/` fails graph creation;
- a second linked worktree restores the first one's results, and its `build` binary prints the first checkout's `CARGO_MANIFEST_DIR`;
- `--remap-path-prefix` removes the debug-info path but not `env!`;
- the digest recipe, with an integration test that reads `target/debug/golden.txt`: a changed, empty or missing file each missed the cache, and the original content hit again; with `NX_CACHE_FAILURES=true` a missing file replayed its stored failure, so its key is stable;
- with `{ runtime = "pwd" }` on `build` and the default shared cache, the second worktree missed, built a binary that printed its own path, and then hit its own result; Nx 24.0.6 `tasks-runner/cache.js` looks the same hash up in a remote cache after a local miss;
- for the daemon, `nx daemon --help` lists `--stop`, and `utils/cache-directory.js` fixes the chosen directories per process at startup; with a daemon already running, a command with `NX_CACHE_DIRECTORY` wrote its own cache entries there, and no error appeared;
- the sharing rules come from `utils/cache-directory.js`, `utils/workspace-id.js` and `command-line/reset/reset.js`.

`pnpm nx run-many -t build lint test` (first round), `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check` pass. CI on the pull request covers the remaining check.

## Decisions made

- The cross-checkout guidance states the installed Nx's rule, sharing per workspace identity, rather than worktrees only, and names every setting that turns sharing off.
- The docs say `--remap-path-prefix` rewrites source paths but not `env!("CARGO_MANIFEST_DIR")`, and that a checkout-specific value in `RUSTFLAGS` splits keys per checkout; tried in the fixture.
- Where artifacts have to come from their own checkout, the recommended remedy is a `runtime` input on `build` that prints the checkout's folder, because it also holds with a remote cache and costs only `build` reuse between checkouts; `--skip-nx-cache` is named as the alternative that stores nothing, and a cache directory of its own is described as local only.
- For test data inside `target/` that exists before hashing, the recipe prints the files' digest; otherwise every determinant of the writing step is keyed, the tool's version alone only where nothing else decides the content.
