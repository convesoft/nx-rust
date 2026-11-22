---
title: Read cargo's lines without colour in release publish, graph discovery and napi-build
status: todo
type: bug
priority: high
discovered_from: nxr-h52ghk
created_at: 2026-11-22T16:50:03Z
---

Cites: `DES-RELEASE`, `DES-BATCH`, `DES-PROJECT-GRAPH`, `DES-NAPI`, `GOAL-CARGO-NATIVE`.

Finding 1 of the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3), made by reading, not yet reproduced. It predates rc.2.

The batch and test readers match cargo's human-readable lines through `plainLine` (`nx-rust/src/executors/cargo-output.ts`), which removes the escape sequences that cargo adds where `CARGO_TERM_COLOR=always` or `term.hyperlinks` asks for them, as CI configurations often do. Four other readers of cargo's output do not:

- `nx-rust/src/release/publish-cargo.ts`: `shownRegistry` (`Updating`), `readLookup` (`version:`, `could not find`), `uploadedCrates` (`Uploaded`), `verifiedCrates` (`Verifying`, `Finished`, `Uploading`). With coloured status verbs, the registry probe would show no registry, and a task could fail although cargo uploaded its crate.
- `nx-rust/src/graph/discovery.ts`, `isUnreportedPathDependency`: matches `error: ...` in cargo's stderr; a coloured `error` would turn a tolerated failure into a graph error.
- `nx-rust/src/executors/napi-build.ts`, `cargoTree`: reads `cargo tree --prefix depth` and strips `(*)` and `(proc-macro)`, which cargo colours.
- `nx-rust/src/executors/group-run.ts`, `listNextestTests`: builds the tail of stderr without `plainLine`, unlike `affected.ts` and `baseline.ts`.

- [ ] Reproduce each of the four with a real cargo and `CARGO_TERM_COLOR=always` (release publish against the harness's local registry), and record what cargo prints in the evidence item the reader rests on
- [ ] Decide per call between reading through one shared helper and passing `--color never` where the plugin alone reads the output and never shows it; move `plainLine` to a place that `release/`, `graph/` and `executors/` may all import
- [ ] Fix the readers the reproductions confirm, with a test for each with the real tool
- [ ] Say in the design items which lines are read without escape sequences

Done when: with `CARGO_TERM_COLOR=always`, `nx release publish` in a dry run and a real run against the local registry, graph creation with an unreported path dependency, `napi-build` and the nextest listing behave as without it, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.
