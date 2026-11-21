---
title: Run the dotenv check in the publish executor
status: done
type: task
priority: high
discovered_from: nxr-m8evx2
created_at: 2026-11-15T16:29:00Z
closed_at: 2026-11-21T21:46:38Z
---

---
title: Run the dotenv check in the publish executor
status: done
type: task
priority: high
discovered_from: nxr-m8evx2
created_at: 2026-11-15T16:29:00Z
closed_at: 2026-11-21T21:03:07Z
---

`@convesoft/nx-rust:release-publish` (nxr-m8evx2) rebuilds each task's environment in a batch as the cargo executors do (`DES-BATCH`, `taskEnvironments` with the shield for run-dependent variables), but it does not run the dotenv check (`dotenvProblem` in `nx-rust/src/executors/dotenv-check.ts`) that fails a cargo task whose dotenv files make Nx look up a variable whose value depends on how the task runs. For a publish task the difference reaches only a crate whose dotenv files in its own folder refer to such a variable, and the target is not cached, so no stored result depends on it; `DES-RELEASE` does not say either way.

- [x] Update `DES-RELEASE` (and `nx-rust/docs/release.mara.md`) to require the dotenv check on `@convesoft/nx-rust:release-publish`, matching the cargo executors
- [x] Run `dotenvProblem` in the publish executor before cargo runs (both single-task and batched), covering the `CARGO_REGISTRY_DEFAULT=team-${NX_TASK_TARGET_CONFIGURATION}` reproduction
- [x] Add unit/integration tests for single-task and batched publish runs (and check CI-env harness rules if applicable)

Reproduction from the review of nxr-4sr6hd (20 November 2026, the same before and after that change): with `NX_TASK_TARGET_CONFIGURATION=release`, `CARGO_REGISTRY_DEFAULT=team-${NX_TASK_TARGET_CONFIGURATION}` in a crate's `.env.nx-release-publish` and `publish = ["official"]` in its manifest, a real dry run reports the registry `team-release` with `--batch=false`, and `team-` followed by the shield value of `taskEnvironments` with `--batch`. So a publish task whose dotenv file builds a value from a run-dependent variable gets a different environment in a batch than on its own, and the placeholder reaches a diagnostic; a real upload would then name a registry that does not exist. The cargo executors refuse such a task before cargo runs (`dotenvProblem`); the publish executor does not.

Maintainer decision (21 November 2026, from review of `nxr-43zkh8` line 8): enable the dotenv check (`dotenvProblem`) in `@convesoft/nx-rust:release-publish` so it fails closed consistently with the cargo executors instead of leaking shield placeholders into registry names in batch mode. Note: this also answers the open question in audit seam `nxr-es2rrj`.

Done when: `DES-RELEASE` and `nx-rust/docs/release.mara.md` record the requirement, `release-publish` fails closed on disallowed dotenv patterns in single and batched runs with tests, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.

## Review of 4d19b99

- [x] A task that fails before its crate is read (the dotenv check, the target check, the `registry` option) stays a task that the executor received and failed: `otherRunTasks` no longer takes it for a task of another run, and a crate of the batch that depends on it fails before its call (`DES-RELEASE`, "Dotenv files")
- [x] Mixed case in `release-publish-dry-run.spec.ts`, failing without the fix
- [x] The refusal case asserts that the executor runs no cargo command (only graph creation's and the version actions' reports are logged)
- [x] `DES-RELEASE` wording: where the check runs and is reported, "passes the check" instead of "no run-dependent reference", the environment before the four task-identity variables are left out, which message appears where, the unexpected-error rule
- [x] Decision without a batch: the accepted rule of "Checks before the first call" applies to a refused task as to any task of another run (settled, see below)

## Question without a batch (settled)

Without a batch (`NX_BATCH_MODE=false`), Nx runs the refused crate's task as a run of its own, so the task of an unrelated crate sees it as a task of another run. The accepted "Checks before the first call" of `DES-RELEASE` then stops the unrelated task where the refused crate depends on a crate of the repository and its dotenv files give other Cargo settings, as before this issue. Settled on 21 November 2026 by the control plane: the accepted rule stays (option 1). It fails closed and names a batch as the way out. Judging another run's task by an approximate environment (option 2) would loosen what the rule protects. `DES-RELEASE` ("Dotenv files") and the release guide say so; the mixed test pins the rule.

## Summary of Changes

- `nx-rust/src/executors/release-publish/executor.ts`: alone and in a batch, the executor passes each task's environment through the existing `dotenvProblem` while it builds that environment, as `prepareTask` does for the cargo executors: `cargoTaskEnvironment` + `withoutUnloadedRootValues` alone, `taskEnvironments` in a batch. A task that fails gets `env: { failure }`, which `Publisher.prepare` reports after the target check, before the `registry` option check and any cargo command. How the environment is built and where the check sits against the batch's dotenv layer are unchanged (nxr-es2rrj and nxr-vwpjg2 are untouched).
- `nx-rust/src/release/publish.ts`, `publish-environments.ts` and `publish-messages.ts`: the `Publisher` records every task that it received, and for a task that fails `prepare`, its crate's folder from the project graph. `otherRunTasks` skips every received task, so a refused task never comes back as a task of another run, never gets a `cargo metadata` or a foreign-environment check, and stops no other task. The checks before the first call skip a link to a refused crate. `checkTask` fails a dependent of a refused crate before its call, also in a dry run, with `refusedDependencyMessage`, which names the dependency and the failed task.
- `DES-RELEASE` (`nx-rust/docs/release.mara.md`): the **Dotenv files** paragraph says where the check runs and where its failure is reported, which environment it sees, what passing it means, which message appears where, the unexpected-error rule, that a refused task stays local to the batch, and how its dependents fail. The decision history and the release guide are updated. `VER-RELEASE` group 6 names the cases.
- `nx-rust/test/release-publish-dry-run.spec.ts` runs the real Nx (`nx release publish --dry-run`) and a real cargo against the harness registry, with `NX_TASK_TARGET_CONFIGURATION=release` and no `CARGO_REGISTRY_DEFAULT`, in four cases:
  - The issue's reproduction, with a batch and with `NX_BATCH_MODE=false`: the task fails with the check's message, no `team-` appears, and the only cargo calls are graph creation's and the version actions' report of each workspace. The executor asks for its report without `--manifest-path`, so a call of its own would be a third.
  - A file without a run-dependent reference still verifies the crate, in both modes.
  - The mixed case, `--projects pub-core,pub-plain,pub-tool`, with the dotenv line on pub-core, which depends on pub-base. In a batch, pub-plain is verified with a call of its own, pub-tool fails with the new message, and the run does not stop. Without a batch, pub-plain stops with the existing "cannot rebuild its environment" message, the pinned behaviour of the accepted rule (see "Question without a batch").
  - How each test was shown to fail: the mixed case fails with the old `publish*.ts`; the reproduction failed with the check removed from the batch path only and then from the single path only.

Checks run after merging `main` at e984053, all passing:
- `pnpm nx run-many -t build lint test`: 80 suites, 2103 passed, 61 skipped, 6 todo.
- The changed spec as CI runs it: 6 passed.
- `pnpm nx e2e nx-rust-e2e`: 27 passed.
- `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` (valid, complete, 0 errors, 0 warnings) and `zban check`.

## Decisions made

- The publish task reports the check's own message unchanged, prefixed with the task (`<project>:nx-release-publish: …`), as the cargo executors do.
- On an installed Nx that lacks what the check reads, a task on its own fails with "cannot check the dotenv files of this task … Nothing was published. Use an Nx version that @convesoft/nx-rust supports.". In a batch, the environment rebuild reads the same parts first, so the batch's "cannot rebuild this task's environment in a batch" message appears instead, unless the rebuild succeeded. Both fail closed (`DES-RELEASE`).
- In a batch, an unexpected error from the check fails only that task, with the batch's rebuild message (`DES-RELEASE`).
- Every task that fails before its crate is read, whether through the dotenv check, its target or the `registry` option, stays a task of the batch, not of another run (`DES-RELEASE`).
- A crate of the batch that depends on such a crate fails before its call, also in a dry run, because without that task's environment neither the dependency's registry nor its version can be told (`DES-RELEASE`).
- Without a batch, the rule of "Checks before the first call" applies to a refused task as to any task of another run: the other tasks stop with that rule's message where the refused crate depends on a crate of the repository (control plane, 21 November 2026; `DES-RELEASE`, release guide).
- The guide tells users to name the registry in the file, or to refer to a variable set in the command's environment.

## Final step (21 November 2026)

The settled rule without a batch is recorded in `DES-RELEASE` ("Dotenv files") and in one sentence of the release guide. The mixed test now says that its non-batch assertion pins the accepted rule. No source file changed, so the full suites run at d35bca3 stand; listed above. Checks run for this step, all passing:
- `pnpm nx test nx-rust --testPathPatterns=release-publish-dry-run`: 6 passed.
- `pnpm nx format:check --all`.
- `mara schema validate` and `mara project validate`: valid, complete, 0 errors, 0 warnings.
- `zban check`.

## Message wording (21 November 2026)

`refusedDependencyMessage` now says "and that task failed in this run, so …" without "before cargo ran", because a task can also fail `prepare` after its own `cargo metadata` call, such as on a report failure. The test assertion follows the new wording. The comments and `DES-RELEASE` say "before its crate is read", which holds for every such task, and do not quote the message. No behaviour changed. Checks run, all passing:
- `pnpm nx run-many -t build lint`.
- `pnpm nx test nx-rust --testPathPatterns=release-publish-dry-run`: 6 passed.
- `pnpm nx format:check --all`.
- `mara schema validate` and `mara project validate`: valid, complete, 0 errors, 0 warnings.
- `zban check`.
