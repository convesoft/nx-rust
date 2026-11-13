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
- [ ] Inputs for redirected crates (`DES-INPUTS`, `ADR-REDIRECTION-EDGES`): a crate that a workspace's `[patch]` or `[replace]` redirects to and that has no project is handled like a path dependency without one, on every member that `redirectedUses` in `nx-rust/src/graph/edges.ts` lists for its folder when it is given the folders of the workspace's redirections, the warning included, and the folder of a `paths` entry without a project at it likewise; a member whose use `redirectedUses` returns with `edge: false` gets a fileset for that crate's folder on its targets
- [ ] The cache-key matrix rows for all of the above, the `VER-CACHE-KEYS` rows for redirected crates included

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
