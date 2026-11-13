---
title: Check how Nx merges target defaults with inferred targets
status: done
type: task
priority: high
tags:
  - spike
parent: nxr-w9qa5f
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-13T08:37:26Z
---

Goal: establish what a `targetDefaults` entry keyed by `build`, `lint` or `test` does to an inferred Rust target in Nx 24, as `RISK-TARGET-DEFAULTS` (`nx-rust/docs/decisions.mara.md`) describes. The draft `REQ-TARGET-DEFAULT-GUARD` depends on the answer.

- [x] Whether `dependsOn`, `inputs`, `outputs` and `cache` from a target default replace, merge with or lose against inferred values
- [x] Whether a `filter` on `plugin` or `projects` keeps a default away from this plugin's targets
- [x] Whether the plugin can see the merged target, or only its own inferred one
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [x] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

- Ran the spike in a throwaway Nx 24.0.6 workspace, with stand-in plugins whose crate targets have the shape of `DES-TARGETS` and `DES-INPUTS`, and recorded the result as `EVD-NX-TARGET-DEFAULTS` (accepted) in `nx-rust/docs/decisions.mara.md`. It supports `RISK-TARGET-DEFAULTS` and `ADR-NX-TARGET-NAMES`. The stand-ins ran no cargo, so the item covers how Nx merges, hashes and schedules such targets, not what inherited builds cost in time.
- Updated `RISK-TARGET-DEFAULTS` with the finding, including replaced `outputs` and `cache`. Likelihood and consequence are unchanged. No accepted design or decision changes.
- The finding answers the first half of the `Open:` paragraph of the draft `REQ-TARGET-DEFAULT-GUARD`, how Nx 24 merges target defaults with inferred targets. The requirement is left unchanged for nxr-d3087e, whose first task is to rewrite and accept it.
- Filed nxr-wynx3g for what the cargo executor does with options that target defaults add.
- Checks: `mara schema validate` (valid), `mara project validate` (`valid: true`, evaluation complete, no errors or warnings), `zban check` (no problems), `pnpm nx run-many -t build lint test` (passed) and `pnpm nx format:check --all` (passed). The end-to-end suite was not run, because the plugin's behaviour did not change.
