---
title: Move redirection, graph collision and target/caching builder permutations to in-process unit tests
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: push pure graph-assembly, cycle-breaking, collision-formatting and target/input-builder permutations in `redirections.spec.ts`, `graph.spec.ts`, `discovery.spec.ts`, `targets.spec.ts` and `caching.spec.ts` down to in-process unit tests (`VER-GRAPH`, `VER-TARGETS`, `VER-CACHE-KEYS`, `VER-CARGO-UNCHANGED`).

Context: measured at `54adf17`, these five specs take 78.5 s across 238 tests (`redirections`: 30.1 s / 59, `graph`: 18.7 s / 58, `discovery`: 9.3 s / 28, `targets`: 10.0 s / 46, `caching`: 10.4 s / 47). Most spawn `inspect-workspace.cjs` + `cargo metadata` just to inspect constructed `ProjectConfiguration` / edge objects. Projected saving: ~44 s suite-time.

- [ ] `redirections.spec.ts`: keep ~15 real-Nx tests (`[patch]`, `[replace]`, `paths`, symlinks, `.cargo/config.toml`, Cargo home warning, daemon refresh); move cycle-avoidance, indirect-redirection and fallback-input graph permutations to unit tests on synthetic metadata
- [ ] `graph.spec.ts` & `discovery.spec.ts`: narrow `projects and edges of each fixture` from all 27 fixtures to ~12 distinct workspace topologies; keep worker/in-process collision boundaries and unit-test collision formatting/remedy permutations; remove discovery overlap already covered by `computation-reports.spec.ts` and `plugin-entries.spec.ts`
- [ ] `targets.spec.ts` & `caching.spec.ts`: keep real task-graph (`--graph`) and `expectArtifactInputAgrees` checks (~18–20 real-Nx tests each) and verify per-crate-shape target and input/output array rules directly on the builders
- [ ] Update `VER-GRAPH`, `VER-TARGETS`, `VER-CACHE-KEYS` and `VER-CARGO-UNCHANGED` in `nx-rust/docs/verification.mara.md`
- [ ] Verify with temporary mutations and record before/after timings

Done when: all five specs pass with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
