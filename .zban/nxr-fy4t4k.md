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
- [ ] The cache-key matrix rows for all of the above
- [ ] Set `cache: true` on `build`, `check`, `lint`, `test`, `fmt-check` and `doc` together with their inputs and outputs, as `DES-TARGETS` and `DES-OUTPUTS` give them. Until then nxr-t1ht7j leaves every inferred target uncached, because Nx's default inputs miss `Cargo.lock`, the workspace's manifest, the toolchain and the environment (`GOAL-TRUSTED-CACHE`); `target()` in `nx-rust/src/graph/targets.ts` sets it
- [ ] If this issue lands before nxr-kmdpgj: make sure that a `targetDefaults` entry in `nx.json` that sets `cache: true` on an inferred target, keyed by the target's name or by its executor, cannot cache a result under Nx's default inputs while the plugin infers `cache: false` for the target (`GOAL-TRUSTED-CACHE`; the interim rule is in the status note of `nx-rust/docs/targets.mara.md`, the cached targets in `DES-TARGETS`). Declaring the inputs on the targets that `DES-TARGETS` caches settles it for them, because such an entry then keeps the inferred inputs; the uncached ones keep the question. If nxr-kmdpgj landed first and dealt with it, tick this
- [ ] nxr-d3087e makes graph creation fail for such an entry, on every target that the plugin leaves uncached, whether it is keyed by the target's name, its executor or a glob (`DES-TARGET-DEFAULT-GUARD`, `VER-TARGET-DEFAULT-GUARD`). Once that is merged, tick the step above and cite it
- [ ] Add the real cases of `VER-TARGET-DEFAULT-GUARD` to `nx-rust/test/target-defaults.spec.ts`, in place of its stand-in values: an entry whose `inputs` or `outputs` list, without `"..."`, replaces what `build` and `test` now declare fails graph creation, and one that keeps them with `"..."` does not. The report compares with whatever the plugin infers, so it needs no change; its tests that expect `cache: true` on `build`, and through the executor's key on the other targets this issue caches, to fail graph creation then expect no report for those targets, while `fmt` and the workspace targets keep failing
- [ ] Inputs of the uncached `fmt`, `bench` and `run`, as `DES-INPUTS` lists them (`CARGO_BUILD_WARNINGS` on `bench` and `run`), so that `nx affected` selects them; nxr-t1ht7j leaves them, and those of the cached targets, to Nx's default inputs, which select no crate target after a change to `Cargo.lock` or the workspace's manifest

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
