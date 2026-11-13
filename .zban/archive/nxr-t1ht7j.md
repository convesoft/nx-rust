---
title: Infer targets with Nx names and no task dependencies
status: done
type: feature
priority: high
parent: nxr-w9qa5f
blocked_by:
  - nxr-1bv0wm
  - nxr-kq5pm5
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T15:00:57Z
---

Goal: every crate and every workspace project gets its targets from its shape, under the default names, with renaming through plugin options.

Implements `REQ-INFERRED-TARGETS`, `REQ-TARGET-NAMES`, `REQ-NO-RUST-TASK-DEPS`, `DES-TARGETS`, and the target configuration of `DES-TARGET-COMMANDS` and `DES-WORKSPACE-TARGETS` (`nx-rust/docs/targets.mara.md`, `configuration.mara.md`). Checked by `VER-TARGETS` and `VER-CONFIGURATION`.

- [x] `build`, `check`, `lint`, `test`, `fmt-check` and `fmt` on every crate; `run` and `bench` by target kind; no release targets with `publish = false`
- [x] `doc`, `audit` and `update` on every workspace project, and `deny` where `deny.toml`, `.deny.toml` or `.cargo/deny.toml` is in the workspace root; the same targets whether or not cargo-audit and cargo-deny are installed
- [x] Take those file names from `cargoDenyConfigurationFiles` (`nx-rust/src/tools/optional-tools.ts`), from which `init` tells whether cargo-deny is needed, so that both agree
- [x] `bench` with `parallelism: false`; `run` on an executor without a batch implementation and not continuous; `fmt`, `bench`, `run`, `audit`, `deny` and `update` uncached, the last three with the inputs `DES-WORKSPACE-TARGETS` lists
- [x] Renaming of each target through plugin options, with the graph-creation error for two inferred targets that get one name (`DES-PLUGIN-OPTIONS`, `DES-DIAGNOSTICS`)
- [x] No `dependsOn` between Rust crates, and none added to JS projects
- [x] Tests for each crate shape in the fixtures

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

- `nx-rust/src/graph/targets.ts` infers each project's targets from the `cargo metadata` report (`DES-TARGETS`, `DES-TARGET-COMMANDS`, `DES-WORKSPACE-TARGETS`): `build`, `check`, `lint`, `test`, `fmt-check` and `fmt` on every crate, `run` where the crate has a `bin` target, `bench` where it has a `bench` target; `doc`, `audit` and `update` on the workspace project, and `deny` where `deny.toml`, `.deny.toml` or `.cargo/deny.toml` is in the workspace root. The crate of a root manifest gets both sets. Whether a tool is installed decides nothing. There are no release or artifact targets yet (0.4 and 0.5).
- Every target names `@convesoft/nx-rust:cargo`, apart from `run`, which names `@convesoft/nx-rust:run` and is `continuous: false`; `bench` has `parallelism: false`. Options: `allTargets: true` on `check` and `lint`, `noDeps: true` on `doc`. `audit`, `deny` and `update` have the inputs of `DES-WORKSPACE-TARGETS`. No target has a `dependsOn`. Each target's metadata has a description, `technologies: ["cargo"]` and, under `cargo`, its default name, from which the executor will tell which command to run under any name. `DES-TARGETS` now names the executors and that metadata, and the Targets guide names the executors for a `targetDefaults` entry.
- Interim caching: every target is `cache: false`, the ones the items cache included, because Nx's default inputs miss `Cargo.lock`, the workspace manifest, the toolchain and the environment (`GOAL-TRUSTED-CACHE`). nxr-fy4t4k has the steps to turn caching on with the inputs and outputs, and to declare the inputs of `fmt`, `bench` and `run`.
- `targetNames` in the plugin options (`nx-rust/src/graph/options.ts`) renames any inferred target. Two inferred targets of one project with one name fail graph creation with a message naming every such project, its manifest, the targets, the name and `targetNames` (`DES-PLUGIN-OPTIONS`, `DES-DIAGNOSTICS`). A key of `targetNames` that is not the default name of an inferred target this version knows (`inferredTargetNames`), whether or not a project has that target, fails graph creation with a message that names the key and lists the names that can be renamed; so does a `targetNames` that is no object, or a name that is no non-empty string. The control plane decided this under the maintainer's standing instruction, together with keeping the executor names and the `metadata.cargo.target` key; `DES-PLUGIN-OPTIONS`, `DES-DIAGNOSTICS` (a new row), `VER-CONFIGURATION` and the list in `VER-SETUP` say so, and the issue filed for the question was deleted.
- The deny file names come from `cargoDenyConfigurationFiles` in `nx-rust/src/tools/optional-tools.ts` (from #19) after merging `main` (b66c24e, then cf7e3e6).
- New fixture `crate-shapes` (library with an example, binary, library with two binaries, library with a bench, `publish = false`), listed in the harness, the fixture, discovery and graph specs and the test README.
- Steps added to the owning issues: nxr-kmdpgj (executor names, reading `metadata.cargo.target`, option defaults in the targets, clippy in the mixed `lint` run), nxr-fy4t4k (caching and inputs), nxr-xyq7c8 (metadata tables under renamed names, `continuous` and `readyWhen` on `run`), nxr-0ap8n4 and nxr-tv3r95 (artifact targets in the inference and renaming), nxr-m8evx2 (renaming the publish target).
- Status notes of the Targets, Configuration and Workspaces pages say what works now; the Targets note also says that a `targetDefaults` entry with `cache: true` overrides the interim `cache: false`, for which nxr-kmdpgj, nxr-fy4t4k (whichever lands first) and nxr-d3087e have steps. The status lines of the two READMEs are left to nxr-2v14h1, which needs the maintainer's answer.

Checks run: `nx-rust/test/targets.spec.ts` (36 tests: target sets per crate shape and for root-manifest crates, the configuration of each target, inputs of `audit`, `deny` and `update`, `deny` for each configuration file name and with cargo-audit and cargo-deny on `PATH` or not, `nx affected` selecting `audit`, `deny` and `update` per changed file, the task graph of `nx run-many -t build test lint` without edges, a JS `^build` that reaches only the crate it depends on, a mixed `run-many -t lint`, renaming, collisions, keys that name no inferred target and invalid `targetNames`), `pnpm nx run-many -t build lint test` (passed), `pnpm nx format:check --all` (passed), `pnpm nx e2e nx-rust-e2e` (11 tests passed after the merge of `main` at cf7e3e6, a new one checks the targets through the installed plugin with `nx show project` and the task graph), `mara schema validate` and `mara project validate` (valid, evaluation complete, 0 errors and 0 warnings), `mara related` for each linked item, `zban check`. The parts of `VER-TARGETS` and `VER-CONFIGURATION` that need the executor (the cargo commands, cache restores, `run` arguments, clippy in the mixed `lint` run) are steps of nxr-kmdpgj; those about metadata tables are nxr-xyq7c8's; the artifact shapes are nxr-0ap8n4 and nxr-tv3r95.
