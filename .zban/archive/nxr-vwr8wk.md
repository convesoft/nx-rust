---
title: Apply the first review corrections to the specification
status: done
type: task
priority: high
tags:
  - docs
created_at: 2026-11-12T19:06:29Z
closed_at: 2026-11-12T19:14:56Z
---

Two corrections from the user's review of the initial specification on 2026-11-12.

- [x] `EVD-NXRUST-BUILD-DEPS` names its source: nxrust's issue log, entry ISS-001, as supplied by the user
- [x] Record what `nx format` does in Nx 24.0.6 and whether it can run rustfmt, as an evidence item
- [x] Correct `ADR-NX-TARGET-NAMES` and `DES-TARGETS`, which say that only `lint`, `test` and `build` have an Nx-wide convention
- [x] Name the rustfmt targets as the user decides, in every page and issue that mentions them
- [x] `mara schema validate`, `mara project validate` and `zban check` pass, and the changed pages are formatted

Done when: the checks above pass and the user has confirmed the names.

## Summary of Changes

- `EVD-NXRUST-BUILD-DEPS` now cites nxrust's issue log (ISS-001 in `plans/issues.md`, commit 53572b2) with the figures the user supplied, and says it is a secondary record.
- New evidence item `EVD-NX-FORMAT`: `nx format` is a built-in command that runs prettier or oxfmt, runs no targets, reserves the name `format`, and cannot reach rustfmt through either formatter in Nx 24.0.6. Based on reading the installed `nx` package and on two experiments (a prototype prettier plugin that delegates to rustfmt, and oxfmt 0.78.0 on a `.rs` file and a `Cargo.toml`).
- The user decided to keep `fmt-check` and `fmt`, so no target was renamed. `ADR-NX-TARGET-NAMES` and `DES-TARGETS` now give the real reason, and `ADR-V1-SCOPE`, the product page and `AGENTS.md` list formatting Rust through `nx format` as outside v1.
- `targets.mara.md` has a new Formatting section and `configuration.mara.md` points to it.
- Follow-up filed as `nxr-e0ztna` (deferred): decide after v1 whether `nx format` should cover Rust.

Checks run: `mara schema validate` and `mara project validate` (both `valid: true`, evaluation complete), `zban check` (no findings), `oxfmt --check` on the changed Markdown (clean). No code changed, so build, lint, test and the end-to-end suite were not run again. Nothing is committed.
