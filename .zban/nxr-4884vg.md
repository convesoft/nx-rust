---
title: The publish executor checks a dependency's registry with the dependent's environment, which per-crate dotenv files can make differ
status: todo
type: bug
related:
  - nxr-43zkh8
discovered_from: nxr-m8evx2
created_at: 2026-11-15T17:06:00Z
---

The review of nxr-m8evx2 (at 1de909b) found that `@convesoft/nx-rust:release-publish` establishes a dependency's target registry with the environment of the task that depends on it (`nx-rust/src/release/publish.ts`, `targetOf(dependency, task)` in `checkTask`), while the dependency's own task publishes with its own environment, which a dotenv file in the dependency's folder can change.

Reproduction: one Cargo workspace whose crates default to `alpha`; `pub-base/.env` sets `CARGO_REGISTRY_DEFAULT=beta`; `pub-core` depends on `pub-base` through an entry that names `alpha`, and `alpha` already holds a different `pub-base@0.1.0`. `nx release publish --projects pub-base,pub-core` uploads `pub-base` to `beta` and `pub-core` to `alpha` against alpha's copy, and both tasks pass. It needs per-crate dotenv files that give the crates of one release different default registries; the release guide says that this is not supported.

- [ ] Decide in `DES-RELEASE` whether a dependency's target registry comes from its own task's environment where its task is in the run, or whether the crates of a call must agree, and implement it with a test

Pulled back from the backlog on 20 November 2026 by the maintainer, overturning line 6 of nxr-43zkh8: an upload to a registry cannot be undone, so a note in the release guide is not enough. His direction: establish each dependency's target registry in that dependency's own environment, or fail early where the tasks of one release disagree on their registry settings.

- [ ] Whatever cannot be established safely fails before any crate of the call is uploaded, with a message that names the crates and the registries
- [ ] Replace the sentence in the release guide that asks users to keep the registry settings of one release in one place with what the plugin now does
