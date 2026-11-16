---
title: Check that cargo-affected's report is enough to filter and map tests
status: done
type: task
priority: high
tags:
  - spike
parent: nxr-m3k3w8
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T13:02:38Z
---

Goal: confirm or refute the first assumption in `RISK-CARGO-AFFECTED` (`nx-rust/docs/decisions.mara.md`). Steps 3 and 4 of `DES-TEST-RUN` rest on it.

- [x] Run `cargo affected status --report-json <path> --report-detail full` on a real workspace
- [x] Build a nextest filter from the listed tests and run exactly those tests
- [x] Map each selected test, and each nextest result, to its crate
- [x] Read `cache.status` for every way selection can be refused
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [x] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

Ran cargo-affected 0.4.1 with cargo-nextest 0.9.152 and cargo 1.100.0 on ripgrep (178cc02), tokio (f3e855f) and a four-crate fixture at the top of its repository and in a subfolder, after changes of every kind the issue lists. Recorded in `EVD-CARGO-AFFECTED-REPORT`: the report is precise enough to filter and to map results to crates (nextest ran exactly the selected tests every time), with four conditions. A workspace below the top of its git repository needs git's `diff.relative`. The report is not narrowed to the crates passed. The selection must go on the command line in chunked `-E` arguments. Tests that run a crate's binary are missed. Updated `DES-TEST-RUN` steps 1 to 4, `RISK-CARGO-AFFECTED` (possible, now moderate), `VER-TESTING` and `DES-BASELINE`, and added `ADR-AFFECTED-TESTS-WIDENING`. Changed the task lists of nxr-tabkjx, nxr-539qtw and nxr-d0t9vm, and filed backlog nxr-4bhgkd. Checks: `mara schema validate`, `mara project validate` (valid, evaluation complete), `zban check`, `pnpm nx format:check --all`. No test suite, since only documents changed.

After review, on the control plane's decisions: coverage now narrows only Rust files whose whole effect it records. Every other change widens by the tasks' inputs across the whole repository, and the binary rule also covers dependents (`ADR-AFFECTED-TESTS-WIDENING`). A baseline is trusted only in its recorded context (`ADR-AFFECTED-BASELINE-CONTEXT`, `DES-BASELINE`). The changed-file check is specified in step 1 of `DES-TEST-RUN` and `VER-TESTING`. The risk's consequence is back to major. Compile-time evaluation stays a stated limit. Checks rerun: the same four.
