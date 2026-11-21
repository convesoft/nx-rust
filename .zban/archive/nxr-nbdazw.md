---
title: Remove the second names of kept files that an interrupted test batch leaves in the artifact directory
status: done
type: bug
discovered_from: nxr-5hzxra
created_at: 2026-11-21T14:41:21Z
closed_at: 2026-11-21T15:33:12Z
---

Goal: a `test` or `bench` batch that is interrupted while its group runs (Ctrl-C, a killed batch process) leaves neither stray second names nor the executables of `cargo test` in place of what the command's builds stored, or says so.

Context: since nxr-5hzxra, each `test` and `bench` group of a batch keeps the files that the command's builds store under a second name, `.<name>.nx-rust-kept-<process id>`, in the same folder, and puts them back in a `finally` when its commands end (`DES-BATCH`, "Files that a test batch puts back"). Where the batch process is killed, the `finally` does not run: the second names stay in the artifact directory until `cargo clean`, and the files keep the test build. A later batch of the same process id removes only the second name of a file it keeps again. A stage already handles the same case with a marker and a removal of stages whose process has ended (`DES-BATCH`, "Staged builds"). Found while working on nxr-5hzxra; not part of it, which implements the maintainer's decision for batches that end.

- [x] Decide whether a later test group removes second names whose process has ended, puts them back, or leaves them, and record it in `DES-BATCH`
- [x] Implement it, with unit tests of the left stage and its removal and real-tools runs that leave no stage (no test kills the real Nx mid-group; see the summary), and add the check to `VER-BATCHING`

## Summary of Changes

Folded into nxr-5hzxra by the orchestrator after the review of c08c014, and done in its branch. A `test` or `bench` group no longer keeps files under second names beside them: it holds them in a stage of the artifact directory (`.nx-rust-stage/<pid>-<counter>`), made with `createStage` only where it keeps a file and removed in a `finally` (`DES-BATCH`, "Files that a test batch puts back"; `ADR-STAGED-BUILDS`, second use). A batch killed mid-group therefore leaves only its stage, which the outputs that the plugin infers never name; an output that a user widens to the whole artifact directory (`rust/target` or `rust/target/**`) stores it with the build's files until it is removed, which stays a stated limit (`DES-BATCH`, "Staged builds"), since a `build` that selects its crates is not staged and removes none. The next staged command or test group that keeps files removes it through the existing handling of ended processes and reused process ids; the artifact directory holds the test build until the next `build` runs or is restored, as after plain `cargo test`. Nothing is put back from an abandoned stage.

The decision is the orchestrator's (option: stage over second names), recorded in `DES-BATCH` and `ADR-STAGED-BUILDS`.

Checks: `nx-rust/test/kept-files.spec.ts`, "leaves only a stage where the process ends before it puts back, which the next keeping removes" (a stage of an ended process with a kept file in it, no name beside the files, removed by the next `keepFiles`); `nx-rust/test/stage.spec.ts` shows the removal of stages of ended processes and reused ids; the real-tools cases in `nx-rust/test/test-after-build.spec.ts` check that no stage is left after a run, successful or failed. `VER-BATCHING` ("Files that a test batch puts back") names them. The real Nx was not killed mid-group in a test: the removal is the same code that the stage tests drive.
