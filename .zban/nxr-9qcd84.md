---
title: Share the cargo-affected report reader, the nextest list arguments and the library-target test
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-h52ghk
created_at: 2026-11-22T16:50:26Z
---

Cites: `DES-TEST-MODE`, `DES-TEST-RUN`.

Goal: each of these exists once. No behaviour changes.

Context: finding 6 of the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3). Wave: seam. It goes with nxr-8jv932.

- `readAffectedReport` (`nx-rust/src/executors/affected.ts`) and `collectionChoice` (`baseline.ts`) copy about fifty lines that read cargo-affected's exit status, stderr, JSON, `schema_version`, `cache.status` and `miss-fingerprint`, and already differ in how they list labels; both also have their own `stderrTail`.
- `command.ts` and `affected.ts` each strip `--no-fail-fast` and `--no-tests*` from nextest's run arguments to get the list arguments, so a new run-only flag has to be added twice.
- `packageOf` (`affected.ts`) and `binaryPackage` (`nextest.ts`) are the same function.
- "Is this Cargo target a library?" is written four times: `group-run.ts`, `test-steps.ts`, `graph/build-records.ts`, `cargo-output.ts`.

- [ ] One reader of the report's header for `affected.ts` and `baseline.ts`
- [ ] One function from nextest run arguments to list arguments
- [ ] One `binaryPackage`, and one library-target test beside `CargoTarget` in `cargo/metadata.ts`

Done when: the copies are gone, the tests pass unchanged apart from import lines, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
