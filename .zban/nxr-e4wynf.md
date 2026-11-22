---
title: Share the matchers, the stopped-step message and one parse of cargo's JSON between the step readers
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-h52ghk
created_at: 2026-11-22T16:50:10Z
---

Cites: `DES-BATCH`, `DES-TEST-RUN`.

Goal: each rule for reading a step's output exists once. No behaviour changes.

Context: finding 4 of the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3). Wave: seam. Before the splits of `cargo-output.ts` and `group-run.ts` (nxr-xccm6a, nxr-n83w5r).

- The message of a step that cargo stopped is assembled three times with the same causes and fix: `failStopped` (`nx-rust/src/executors/test-steps.ts`), `readTestStep` (`cargo-output.ts`) and `readDoctestStep` (`test-steps.ts`).
- The pattern for `could not compile` and `failed to run custom build command for` exists five times (`cargo-output.ts` twice, one of them without ` v`; `test-steps.ts` twice; `denied-warnings.ts`).
- The parser of cargo's closing list of failed targets exists in `cargo-output.ts` and in `test-steps.ts`.
- One JSON step's output is split and parsed up to three times: `readJsonStep`, `warnedPackages` (`denied-warnings.ts`), and `stagedFinalFiles` (`stage.ts`) or `reportedCdylibFiles`.
- `outsideMembers.atPath` (`cargo-output.ts`) and its counterpart in `test-steps.ts` sort the members again for every diagnostic line.

- [ ] One matcher each for crates that did not compile and for the closing list of failed targets
- [ ] One formatter for the stopped-step message, used by the three readers
- [ ] Parse a JSON step's messages once and pass them to the readers that need them
- [ ] Sort the members once per step

Done when: the copies are gone, the tests pass unchanged apart from import lines, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
