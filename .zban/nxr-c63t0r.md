---
title: Run the dotenv check in the publish executor
status: in-progress
type: task
priority: high
discovered_from: nxr-m8evx2
created_at: 2026-11-15T16:29:00Z
---

`@convesoft/nx-rust:release-publish` (nxr-m8evx2) rebuilds each task's environment in a batch as the cargo executors do (`DES-BATCH`, `taskEnvironments` with the shield for run-dependent variables), but it does not run the dotenv check (`dotenvProblem` in `nx-rust/src/executors/dotenv-check.ts`) that fails a cargo task whose dotenv files make Nx look up a variable whose value depends on how the task runs. For a publish task the difference reaches only a crate whose dotenv files in its own folder refer to such a variable, and the target is not cached, so no stored result depends on it; `DES-RELEASE` does not say either way.

- [ ] Update `DES-RELEASE` (and `nx-rust/docs/release.mara.md`) to require the dotenv check on `@convesoft/nx-rust:release-publish`, matching the cargo executors
- [ ] Run `dotenvProblem` in the publish executor before cargo runs (both single-task and batched), covering the `CARGO_REGISTRY_DEFAULT=team-${NX_TASK_TARGET_CONFIGURATION}` reproduction
- [ ] Add unit/integration tests for single-task and batched publish runs (and check CI-env harness rules if applicable)

Reproduction from the review of nxr-4sr6hd (20 November 2026, the same before and after that change): with `NX_TASK_TARGET_CONFIGURATION=release`, `CARGO_REGISTRY_DEFAULT=team-${NX_TASK_TARGET_CONFIGURATION}` in a crate's `.env.nx-release-publish` and `publish = ["official"]` in its manifest, a real dry run reports the registry `team-release` with `--batch=false`, and `team-` followed by the shield value of `taskEnvironments` with `--batch`. So a publish task whose dotenv file builds a value from a run-dependent variable gets a different environment in a batch than on its own, and the placeholder reaches a diagnostic; a real upload would then name a registry that does not exist. The cargo executors refuse such a task before cargo runs (`dotenvProblem`); the publish executor does not.

Maintainer decision (21 November 2026, from review of `nxr-43zkh8` line 8): enable the dotenv check (`dotenvProblem`) in `@convesoft/nx-rust:release-publish` so it fails closed consistently with the cargo executors instead of leaking shield placeholders into registry names in batch mode. Note: this also answers the open question in audit seam `nxr-es2rrj`.

Done when: `DES-RELEASE` and `nx-rust/docs/release.mara.md` record the requirement, `release-publish` fails closed on disallowed dotenv patterns in single and batched runs with tests, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.
