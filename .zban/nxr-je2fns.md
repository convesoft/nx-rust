---
title: Share the cargo version check, the source-URL key and the list formatter
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-h52ghk
created_at: 2026-11-22T16:50:34Z
---

Cites: `DES-BATCH`, `REQ-COMPATIBILITY`, `EVD-CARGO-PATCH-AFTER-BUMP`.

Goal: small helpers that exist several times, some of them with different results, exist once.

Context: finding 8 of the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3). Wave: seam.

- `deniedWarnings` (`nx-rust/src/cargo/warnings-setting.ts`) starts `cargo --version` for every JSON step that reports a warning where warnings are denied, and parses the version itself, beside the parser in `compatibility/cargo-version.ts`. `tools/optional-tools.ts` likewise starts `rustc -vV` itself, beside `cargo/host-triple.ts`.
- `sourceKey` (`release/places.ts`) keeps the `sparse+` prefix of a registry URL, as `EVD-CARGO-PATCH-AFTER-BUMP` records; `sourceUrl`/`sameSource` (`graph/redirected-uses.ts`) remove it, so a `[patch]` for a registry URL without the prefix counts as a direct use of a sparse registry of the same URL. Decide which is right for the graph against a run of cargo; if the graph's reading changes, that is a behaviour change to record.
- `real` in `executors/test-steps.ts` repeats `realPath` of `graph/real-path.ts`.
- Joining a list as "a, b and c" is written sixteen times (`describeList` in `cargo-output.ts` and fifteen others).

- [ ] One version parser and comparison, and one `cargo --version` per group at most
- [ ] One source key for `release/` and `graph/`, with the `sparse+` question decided and recorded
- [ ] One `realPath`, one list formatter

Done when: the copies are gone, the decision on `sparse+` is in the evidence item with a test, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, `pnpm nx format:check --all` and the Mara validation pass.
