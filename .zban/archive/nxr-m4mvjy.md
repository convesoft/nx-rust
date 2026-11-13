---
title: Specify disk caching of the cargo metadata report
status: done
type: task
priority: low
tags:
  - spec
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T17:14:53Z
---

Goal: turn the draft item `REQ-METADATA-DISK-CACHE` (`nx-rust/docs/workspaces.mara.md`) into accepted knowledge with a design.

- [x] Answer the open questions in the item with the user: which files the report depends on and where it is kept. The network question is settled: the report is `--no-deps` (`ADR-METADATA-NO-DEPS`)
- [x] Measure `cargo metadata --no-deps` on a large workspace first; if a disk cache would save too little, retire the requirement instead
- [x] Rewrite the items, remove their `Open:` paragraphs and set them `accepted` (the maintainer chose to retire the requirement: it is `retired`, and the new decision and evidence are `accepted`)
- [x] Add or extend the verification that the Mara policies then require (none: a retired requirement needs no verification)
- [x] Bring the user guidance at the top of the page in line with the items

Done when: the user has agreed to the answers, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

The maintainer agreed on 13 November 2026 to retire the requirement rather than design a disk cache, to record the measurement as evidence and the choice as a decision, and to change the sentence in `DES-METADATA-REPORT` that pointed at the requirement.

- `REQ-METADATA-DISK-CACHE` is `retired`. Its `Open:` paragraph is replaced by a dated retirement note that cites `ADR-NO-METADATA-CACHE`, as `REQ-RUN-WATCH` and `TERM-EXTERNAL-NODE` do. The schema's `supersedes` relation links items of the same flavour only and no requirement replaces this one, so the decision cites the requirement in its text.
- New accepted `ADR-NO-METADATA-CACHE` (justifies `DES-METADATA-REPORT`): the report is requested afresh in every graph computation and kept nowhere in between, the daemon included.
- New accepted `EVD-METADATA-TIMING` (supports the ADR): the measurements of 13 November 2026, taken during the research for this issue. With cargo 1.100.0, the 598 members of polkadot-sdk took 180 ms warm and 198 ms with a cold page cache; with cargo 1.98.1, the 262 members of zed took 79 ms and the same polkadot-sdk 233 ms; with cargo 1.99.0, the 55 members of ruff took 13 ms. A stored report would cost about 15–30 ms to read and check. The item also lists what the report depends on and the Nx 24.0.6 facts. Nothing was measured again.
- `DES-METADATA-REPORT`: "Keeping the report between Nx processes is [[REQ-METADATA-DISK-CACHE]]." becomes "The report is requested afresh in every graph computation ([[ADR-NO-METADATA-CACHE]])." Nothing else in the item changed.
- `EVD-CARGO-NO-DEPS` now points to the new evidence for the timing on a large workspace.
- Guidance in `workspaces.mara.md`, "How workspaces are found": the plugin asks Cargo again each time Nx creates the graph and keeps no answer in between, which takes about 0.2 s for 600 crates on a fast machine.

Rejected: a report stored in `.nx/workspace-data`, or kept in the daemon's memory, under a key that covers what the report depends on. It saves at most about 0.15 s per computation on the largest workspace measured, it needs `@nx/devkit/internal`, and any gap in the key gives a stale graph.

Checks run: `mara schema validate` and `mara project validate` (valid, evaluation complete, 0 errors, 0 warnings), `zban check`, `pnpm nx run-many -t build lint test` (4 tasks succeeded), `pnpm nx format:check --all`. No verification is needed: a retired requirement has none, and no code changed.
