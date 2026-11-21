---
title: Split the largest spec files along their describe blocks
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-rarqzn
  - nxr-mdpha2
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:47:06Z
---

Goal: no spec file is so large that two changes to it collide by default. No test, assertion or `VER-` item changes.

Context: finding 14 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: split. During 0.6 three issues at a time wanted `batch-runs.spec.ts`, which had to be worked one after the other. The files and the cuts that workers and the auditor suggested:

- `nx-rust/test/target-defaults.spec.ts` (2,680 lines): by concern (attribution of layers and merging; weakening and other layers; reporting);
- `nx-rust/test/cache-keys.spec.ts` (2,045): environment and toolchain; declared files and what the repository adds; test mode, nextest and plugin version; the project at the repository root;
- `nx-rust-e2e/src/nx-rust.spec.ts` (1,355): the setup, the Nx helpers and `fileDigests` into a helper module; the `nx add` with `targetDefaults` block and the release block into specs of their own that share one global setup;
- `nx-rust/test/batch-runs.spec.ts` (1,206): `describe("the environment of a task in a batch")` with `waysOfRunning` into `batch-environment.spec.ts`;
- `nx-rust/test/build-input-check.spec.ts` (1,176): its helpers into a module, and `describe("in a group of several crates")` into `build-input-check-groups.spec.ts`;
- `nx-rust/test/sparse-registry.spec.ts` (1,075): the shared-registry block with its `upload` helper into `sparse-registry-reset.spec.ts`;
- `nx-rust/test/napi-build.spec.ts` (876), `nx-rust/test/batch-builds.spec.ts` (856), `nx-rust/test/wasm-build.spec.ts` (855): the warm-fixture guards into a spec of their own, `describe("the compile of wasm-build")` into `wasm-build-args.spec.ts`, and `describe("the reviewer's reproductions")` into its own spec.

Two things to keep: the test sequencer of nxr-krddfp names the heavy specs by file, so a split spec keeps its place among the first; and the 11 ways of running and the fixtures of the ordinary cases stay as they are.

- [ ] One commit per file, each followed by the unit suite, and for the end-to-end spec by `pnpm nx e2e nx-rust-e2e`
- [ ] Count the tests before and after each split: the numbers must be equal
- [ ] Update the test sequencer and `nx-rust/test/README.md` where they name a file
- [ ] Give the time of the unit suite before and after, measured alone: a split can change how the three workers are filled

Done when: the test counts are equal, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.
