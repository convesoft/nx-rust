---
title: Review the decisions made in 1.0
status: done
type: task
tags:
  - maintainer
created_at: 2026-11-21T21:14:00Z
closed_at: 2026-11-22T08:55:10Z
---

Goal: the maintainer reads, once, the decisions that the control plane made on his behalf while milestone 1.0 (nxr-nm0jd6) and the three issues that he asked for before it (nxr-hh3kwy, nxr-27zbta, nxr-c63t0r) were built, and overturns those he disagrees with. A decision he overturns becomes a new issue. This issue is never dispatched to a worker.

Each line says what was decided, which Mara items it rests on, and how to undo it. "Provisional" marks a decision of a kind the maintainer reserved for himself (anything that cannot be undone, a capability users see) that can still be undone before 1.0 and was therefore taken without stopping the work.

- [x] Read the list below and overturn what is wrong

## Decisions

1. nxr-hh3kwy (21 November 2026): the guide's text on the warm-cache limit of the same-folder `build` refusal says what a restore really leaves, not what the first draft promised. The review showed, and a fixture with the plugin confirmed, that Nx removes no file on a restore and that a `build` stores a file left at one of its declared output paths although it did not produce it (a binary with `required-features`, after a build with the feature or a plain `cargo build --features`). So the advice "run it in a command of its own" was replaced by "a task that reads the folder should read only the files it needs", `DES-BATCH` was corrected the same way, and `DES-OUTPUTS` gained one sentence that states the limit. The limit itself was filed in the backlog as nxr-m1tfp3 and not fixed, because the issue was a change of wording and nxr-m1tfp3 is two steps from an issue of the run; the control plane recommends deciding it before 1.0, since the stored file can come from older sources than the key describes (`GOAL-TRUSTED-CACHE`). Rests on `DES-OUTPUTS`, `DES-BATCH`, `ADR-STAGED-BUILDS`. To undo: take nxr-m1tfp3 out of the backlog, or reword the guide. The fix round was verified by the control plane's own reading against the reviewer's and the worker's facts, without a second reviewer, because it changed wording only.

2. nxr-27zbta (21 November 2026): the Linux job `Build, lint, test and format` installs more than the four items the issue listed: also cargo-affected 0.4.1 and the `llvm-tools` component, because `verification.mara.md` names cargo-affected among the tools CI installs and `affected-coverage.spec.ts` needs both with nextest. The tools are prebuilt releases pinned by version and SHA-256 (cargo-nextest 0.9.152, cargo-hakari 0.9.39, wasm-bindgen 0.2.130, the versions the docs' evidence used and the one the `wasm-packages` fixture locks); cargo-affected, which publishes no binary, is built with its own lockfile where the cache of GitHub Actions has no entry and restored otherwise. Each tool sits in a folder of its own outside the Cargo home, so that the missing-tool cases can still hide it. The job's time limit went from 25 to 35 minutes. The cases that need the musl target or cargo-deny still skip in CI, since `verification.mara.md` does not promise them (backlog nxr-ty0a0k). Nothing of this ran on GitHub: the review was by reading (URLs, digests, archive layouts and cache steps checked against upstream), and the live run is nxr-vqe9kb. Rests on `ADR-CI-LINUX-ONLY` and "How the plugin is tested" in `verification.mara.md`. To undo: remove the steps of a tool from `.github/workflows/ci.yml` and its sentence from `verification.mara.md`; the tests then skip with their warning as before.

3. nxr-c63t0r (21 November 2026): the maintainer decided that `@convesoft/nx-rust:release-publish` runs the dotenv check; the control plane decided how a refused task sits among the others. In a batch the refusal is local: a task that fails before its crate is read (by the dotenv check, its target or the `registry` option) stays a task of its batch and is not taken for a task of another run, so unrelated crates publish; a crate of the batch that depends on it fails before its cargo call, in a dry run too, with a message that names the dependency and the failed task, because without that task's environment the executor can tell neither where the dependency goes nor whether its version is in the registry. Without a batch (`NX_BATCH_MODE=false`) nothing changes: Nx runs the refused task as a run of its own, and the accepted rule "Checks before the first call" of `DES-RELEASE` stops the other tasks where the refused crate depends on a crate of the repository and its dotenv files give other Cargo settings, as it did before this issue. The alternative, judging the tasks of other runs by the dotenv check and leaving refused ones out, was not taken: the executor can only approximate another run's environment, and a wrong refusal could let an upload through against a registry that a dependent's entry contradicts. Smaller choices: the check's message is passed on unchanged behind the task's name; an unexpected error of the check fails only that task in a batch; on an installed Nx that lacks what the check reads, a task on its own says "cannot check the dotenv files of this task" and a batch usually says "cannot rebuild this task's environment" first. Rests on `DES-RELEASE` ("Dotenv files", "Batch", "Checks before the first call"), `DES-BATCH`, `VER-RELEASE` group 6. To undo the non-batch rule: change "Checks before the first call" in `DES-RELEASE` first, then the code. The review found the batch defect and one re-check confirmed the fixes; a last change of one message string was verified by the control plane's reading and its own full run of the checks.

## Summary of Changes

Reviewed all three decisions with the maintainer on 22 November 2026:

1. `nxr-hh3kwy` (warm-cache leftover `required-features` binary on `build`): kept as documented in `DES-OUTPUTS`, `DES-BATCH`, and the guide; `nxr-m1tfp3` stays deferred in the backlog because narrowing outputs per feature is not expressible in Nx's target-level `outputs` and deleting unproduced files would violate `REQ-CARGO-UNCHANGED`.
2. `nxr-27zbta` (CI optional-tool installs): confirmed keep (verified live on GitHub Actions in `nxr-vqe9kb`).
3. `nxr-c63t0r` (`release-publish` dotenv check batch vs non-batch behaviour): confirmed keep.

Checks run: `pnpm nx format:check --all`, `zban check`, and CI on the pull request.
