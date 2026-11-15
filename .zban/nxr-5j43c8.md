---
title: Tests that compare { status, output } with expect.any(String) hide a failing command's output
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-cq1cx1
created_at: 2026-11-15T12:14:12Z
---

Goal: when an `nx` or `cargo` command in a test ends with another status than expected, Jest prints what the command wrote, so that a failure that happens once, such as one under load, can be understood from the test run alone.

Context: many tests assert a command's result as `expect({ status, output }).toEqual({ status: 0, output: expect.any(String) })`. On a status mismatch, Jest prints `"output": Any<String>` in place of the output, so the output is lost. nxr-cq1cx1 met this in `nx-rust/test/shared-executables.spec.ts` and added `expectStatus(result, status, label?)` to `nx-rust/test/harness/task-runs.ts`. It throws an error whose message holds the command's whole output, and that file now uses it. Files that still use the pattern on 15 November 2026: `artifact-folders`, `caching-runs`, `cargo-directories`, `configuration`, `declared-files`, `executors`, `missing-toolchain`, `plugin-version`, `redirections`, `release-lockfile`, `release-version`, `shared-names`, `target-defaults`, `targets`, `test-after-build` and `verbose-command` (`.spec.ts` in `nx-rust/test`), and `nx-rust-e2e/src/nx-rust.spec.ts`.

- [ ] Replace each such status assertion with `expectStatus`, or, where the output is matched as well, keep that match and check the status with `expectStatus` first
- [ ] Give the end-to-end tests the same helper, or one of their own where they do not import the harness
- [ ] Run each changed suite, and make one expectation fail on purpose to see that Jest prints the output
