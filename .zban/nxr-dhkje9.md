---
title: Narrow declared-files real-Nx pattern matrices and cover glob syntax in unit tests
status: todo
type: task
priority: low
parent: nxr-m7sbwe
created_at: 2026-11-21T20:31:24Z
---

Goal: cut redundant Nx subprocess spawns in `nx-rust/test/declared-files.spec.ts` while keeping real-Nx boundary coverage and full glob-syntax coverage (`VER-CACHE-KEYS`, `DES-INPUTS`).

Context: measured at `54adf17`, `declared-files.spec.ts` takes 68.6 s for 101 tests, of which `that name files of other projects` takes 43.9 s for 45 tests. Lines 1409–1484 run 24 separate fixture copies × 3 Nx spawns each (72 spawns) even though `patternsBelow` is unit-tested at lines 1487–1533 (<50 ms), and lines 1051–1080 run 8 full git+hash+affected cycles on near-identical sibling globs. Projected saving: ~44 s suite-time.

- [ ] Narrow the 24-pattern `it.each` (`declared-files.spec.ts:1409–1484`) to 5 representative real-Nx patterns (simple wildcard, brace alternative, extglob, trailing-slash folder, repo-root `../../..`) and ensure every remaining syntax variant is covered in the `patternsBelow` unit table (`lines 1487–1533`)
- [ ] Narrow the 8-pattern git+affected `it.each` (`declared-files.spec.ts:1051–1080`) to 3 representative patterns (direct sibling, wildcard across sibling and non-crate, repo-root pattern)
- [ ] Update `VER-CACHE-KEYS` in `nx-rust/docs/verification.mara.md` to reflect the representative real-Nx patterns plus the full in-process syntax matrix
- [ ] Verify with temporary mutations that the remaining real-Nx tests still catch broken fileset generation / uncovered-folder detection and the unit table still catches glob-matching regressions, and record before/after timings

Done when: `declared-files.spec.ts` passes with reported timings, `mara schema validate`, `mara project validate`, `zban check`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
