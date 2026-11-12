---
title: Set up fixture workspaces and the graph and cache-key test harness
status: todo
type: feature
priority: high
tags:
  - tests
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
---

Goal: the test infrastructure that every later feature of the plugin is checked with.

Described under "How the plugin is tested" in `nx-rust/docs/verification.mara.md`. Used first by `VER-GRAPH` and `VER-CACHE-KEYS`.

- [ ] Fixture Cargo workspaces under version control: a workspace in a subfolder, two workspaces, a standalone crate, an excluded member, a path dependency across workspaces, a vendored crate that is excluded and used by path, a name collision, a dev-dependency cycle, workspaces with different toolchains
- [ ] A helper that loads a fixture through the plugin and returns the project graph for comparison
- [ ] A cache-key matrix runner: pairs of states with the verdict "must differ" or "must not differ", hashed with the real Nx hasher
- [ ] The end-to-end project installs a fixture next to the plugin, and a cargo wrapper logs invocations

Done when: one trivial graph test, one matrix row and one end-to-end test run against a fixture, in `pnpm exec nx run-many -t test` and `pnpm exec nx e2e nx-rust-e2e`.
