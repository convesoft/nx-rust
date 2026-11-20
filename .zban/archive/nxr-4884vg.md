---
title: The publish executor checks a dependency's registry with the dependent's environment, which per-crate dotenv files can make differ
status: done
type: bug
related:
  - nxr-43zkh8
discovered_from: nxr-m8evx2
created_at: 2026-11-15T17:06:00Z
closed_at: 2026-11-20T11:14:42Z
---

The review of nxr-m8evx2 (at 1de909b) found that `@convesoft/nx-rust:release-publish` establishes a dependency's target registry with the environment of the task that depends on it (`nx-rust/src/release/publish.ts`, `targetOf(dependency, task)` in `checkTask`), while the dependency's own task publishes with its own environment, which a dotenv file in the dependency's folder can change.

Reproduction: one Cargo workspace whose crates default to `alpha`; `pub-base/.env` sets `CARGO_REGISTRY_DEFAULT=beta`; `pub-core` depends on `pub-base` through an entry that names `alpha`, and `alpha` already holds a different `pub-base@0.1.0`. `nx release publish --projects pub-base,pub-core` uploads `pub-base` to `beta` and `pub-core` to `alpha` against alpha's copy, and both tasks pass. It needs per-crate dotenv files that give the crates of one release different default registries; the release guide says that this is not supported.

- [x] Decide in `DES-RELEASE` whether a dependency's target registry comes from its own task's environment where its task is in the run, or whether the crates of a call must agree, and implement it with a test

Pulled back from the backlog on 20 November 2026 by the maintainer, overturning line 6 of nxr-43zkh8: an upload to a registry cannot be undone, so a note in the release guide is not enough. His direction: establish each dependency's target registry in that dependency's own environment, or fail early where the tasks of one release disagree on their registry settings.

- [x] Whatever cannot be established safely fails before any crate of the call is uploaded, with a message that names the crates and the registries
- [x] Replace the sentence in the release guide that asks users to keep the registry settings of one release in one place with what the plugin now does

## Summary of Changes

- `DES-RELEASE` gains **A dependency's environment** and **Checks before the first call**; **Where a dependency points**, _Dependencies published elsewhere_, **Lookups** and **Without a batch** are updated, and the opening paragraph records the maintainer's direction of 20 November 2026 and the control plane's decisions within it. `REQ-RELEASE` says that nothing of the run is uploaded where a dependency's registry cannot be established. `VER-RELEASE` group 9 covers the dotenv cases and the run-wide stop. The release guide's sentence asking for registry settings in one place is replaced by what the plugin does, with an example message.
- `nx-rust/src/release/publish.ts`: a dependency's target registry and its lookups use the environment of the dependency's own task (from the batch, or, for a task the executor does not run, the dependent's environment where both tasks' dotenv files give the same Cargo settings; otherwise not established). _Dependencies published elsewhere_ runs for every crate of the run before the first `cargo publish`; any failure fails every task received before any upload. Messages name the setting that chooses the dependency's registry and the dotenv file that sets it. New `nx-rust/src/release/publish-settings.ts` defines Cargo's settings and their comparison. After the review: for a dependency task outside the run's task graph, the executor resolves its configuration with Nx's own `ProcessTasks.resolveConfiguration` (new `nxTaskConfiguration` in `nx-rust/src/executors/task-env.ts`) and establishes its registry only where every configuration of its target, and none, give the same Cargo settings; a task in the graph keeps the configuration Nx gave it. The guide, `REQ-RELEASE` and `DES-RELEASE` now say that the check covers one release group at a time, and that a group published before stays where its own settings sent it.
- Tests: `release-registries.spec.ts` gains the reproduction (stops before any upload with a batch and with `NX_BATCH_MODE=false`; no upload to `alpha` or `beta`), the matching-entry case (publishes `pub-base` to `beta` and `pub-core` to `alpha` in a batch; stops without a batch), and the consistent case (both to `alpha` in both modes); two existing cases now expect no upload at all. `publish-settings.spec.ts` checks the settings comparison.

Checks run on the final head: `pnpm nx run-many -t build lint test` (69 suites, 1994 passed, 62 skipped, 6 todo); `pnpm nx e2e nx-rust-e2e` (27 passed); the release and publish spec files on Cargo 1.91.0 with a private rustup home (9 suites, 271 passed, 1 skipped); `pnpm nx format:check --all`; `mara schema validate`; `mara project validate` (valid, complete evaluation); `zban check`. The new configuration test fails with the earlier behaviour, which uploads `pub-core` to `alpha`. No test or command reached a real registry.
