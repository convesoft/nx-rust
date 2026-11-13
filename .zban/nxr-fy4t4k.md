---
title: Declare cache inputs and outputs
status: todo
type: feature
priority: high
parent: nxr-w9qa5f
blocked_by:
  - nxr-t1ht7j
  - nxr-5p9zq5
related:
  - nxr-1ydrfd
created_at: 2026-11-12T18:20:01Z
---

Goal: every cached target declares complete inputs and only final outputs.

Implements `REQ-INPUT-FILES`, `REQ-ENV-ALLOWLIST`, `REQ-TOOLCHAIN-KEY`, `REQ-CACHE-OUTPUTS`, `DES-INPUTS`, `DES-OUTPUTS` and `DES-BUILD-DIRS` (`nx-rust/docs/caching.mara.md`). Checked by `VER-CACHE-KEYS` and `VER-CARGO-UNCHANGED`. The whole `Cargo.lock` is the interim input for external dependencies.

- [ ] The whole crate folder as the crate-file input, and real paths for workspace files, including every `.cargo/config.toml` and `rust-toolchain.toml` that applies
- [ ] Inputs for path dependencies without a project, with the warning where Nx cannot see them, and for tool configuration files
- [ ] A test that `init` prints the warning for a path dependency that Nx cannot see (`VER-SETUP`); `init` runs `createNodes` through Nx (`nx-rust/src/generators/init/graph-check.ts`), so a warning printed there reaches it
- [ ] `^` inputs over normal, build and dev-dependency edges
- [ ] The environment allowlist and the inputs the repository adds, placed as `DES-INPUTS` says
- [ ] `externalDependencies: ["@convesoft/nx-rust"]` on every cached target where Nx has a node for the package, and otherwise `[]` with the plugin's version in the option `pluginVersion` of every inferred target (`DES-INPUTS`, `DES-PLUGIN-OPTIONS`); the graph and cache-key harness loads the plugin from source, which is the second case
- [ ] Under the `cargo` and `workspace-build` strategies, the manifest of every member as an input of every member of the workspace (`DES-INPUTS`)
- [ ] The toolchain runtime input, run in the workspace root
- [ ] The toolchain input's command for a missing pinned toolchain (`DES-INPUTS`, `ADR-GRAPH-NO-TOOLCHAIN-INSTALL`), with the missing-toolchain case of `VER-CACHE-KEYS`
- [ ] Outputs: executables, `cdylib` and `staticlib` files for `build`, the whole doc folder of the artifact directory for the workspace project's `doc`, none elsewhere; nothing inside the build directory; no caching of `build` and `doc` when the artifact directory is outside the repository, and none of `doc` when two workspaces share one artifact directory
- [ ] The warning when two or more workspaces share an artifact directory (`DES-OUTPUTS`, its row in `DES-DIAGNOSTICS`), also from the executor at the start of a task of each workspace concerned and in `init`'s output ("Warnings where they are seen" in `DES-DIAGNOSTICS`), with its case in the last paragraph of `VER-SETUP`
- [ ] Inputs for redirected crates (`DES-INPUTS`, row "Redirected crates", `ADR-REDIRECTION-EDGES`): every use that `redirectedUses` in `nx-rust/src/graph/redirected-uses.ts` returns with `edge: false` gives the member's targets a fileset for the use's `folder`; where the use has no `projectRoot` and is `reported`, that crate is handled like a path dependency without a project, the path dependencies behind it and the warning where Nx cannot see its files included; where it is not `reported`, its folder alone
- [ ] The cache-key matrix rows for all of the above, the `VER-CACHE-KEYS` rows for redirected crates included
- [ ] Set `cache: true` on `build`, `check`, `lint`, `test`, `fmt-check` and `doc` together with their inputs and outputs, as `DES-TARGETS` and `DES-OUTPUTS` give them. Until then nxr-t1ht7j leaves every inferred target uncached, because Nx's default inputs miss `Cargo.lock`, the workspace's manifest, the toolchain and the environment (`GOAL-TRUSTED-CACHE`); `target()` in `nx-rust/src/graph/targets.ts` sets it
- [ ] If this issue lands before nxr-kmdpgj: make sure that a `targetDefaults` entry in `nx.json` that sets `cache: true` on an inferred target, keyed by the target's name or by its executor, cannot cache a result under Nx's default inputs while the plugin infers `cache: false` for the target (`GOAL-TRUSTED-CACHE`; the interim rule is in the status note of `nx-rust/docs/targets.mara.md`, the cached targets in `DES-TARGETS`). Declaring the inputs on the targets that `DES-TARGETS` caches settles it for them, because such an entry then keeps the inferred inputs; the uncached ones keep the question. If nxr-kmdpgj landed first and dealt with it, tick this
- [ ] Inputs of the uncached `fmt`, `bench` and `run`, as `DES-INPUTS` lists them (`CARGO_BUILD_WARNINGS` on `bench` and `run`), so that `nx affected` selects them; nxr-t1ht7j leaves them, and those of the cached targets, to Nx's default inputs, which select no crate target after a change to `Cargo.lock` or the workspace's manifest

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
