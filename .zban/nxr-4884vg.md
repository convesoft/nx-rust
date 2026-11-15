---
title: The publish executor checks a dependency's registry with the dependent's environment, which per-crate dotenv files can make differ
status: todo
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-m8evx2
created_at: 2026-11-15T17:06:00Z
---

The review of nxr-m8evx2 (at 1de909b) found that `@convesoft/nx-rust:release-publish` establishes a dependency's target registry with the environment of the task that depends on it (`nx-rust/src/release/publish.ts`, `targetOf(dependency, task)` in `checkTask`), while the dependency's own task publishes with its own environment, which a dotenv file in the dependency's folder can change.

Reproduction: one Cargo workspace whose crates default to `alpha`; `pub-base/.env` sets `CARGO_REGISTRY_DEFAULT=beta`; `pub-core` depends on `pub-base` through an entry that names `alpha`, and `alpha` already holds a different `pub-base@0.1.0`. `nx release publish --projects pub-base,pub-core` uploads `pub-base` to `beta` and `pub-core` to `alpha` against alpha's copy, and both tasks pass. It needs per-crate dotenv files that give the crates of one release different default registries; the release guide says that this is not supported.

- [ ] Decide in `DES-RELEASE` whether a dependency's target registry comes from its own task's environment where its task is in the run, or whether the crates of a call must agree, and implement it with a test
