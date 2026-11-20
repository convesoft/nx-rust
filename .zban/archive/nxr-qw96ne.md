---
title: Remove the provisional marks of the decisions the maintainer confirmed
status: done
type: task
tags:
  - docs
blocked_by:
  - nxr-sy0tsz
related:
  - nxr-5rrkay
  - nxr-sv61dx
  - nxr-bhh3mm
  - nxr-43zkh8
created_at: 2026-11-20T10:31:14Z
closed_at: 2026-11-20T11:24:51Z
---

Goal: no Mara item, guide page or code comment still calls a decision provisional that the maintainer confirmed on 20 November 2026.

He confirmed thirteen of the sixteen provisional decisions of the review issues: lines 3, 17 and 24 of nxr-5rrkay; lines 10, 21, 44 and 45 of nxr-sv61dx; lines 5, 6, 13, 18, 30 and 32 of nxr-bhh3mm. The other three became work of their own (nxr-8paqsn, nxr-sy0tsz, nxr-4884vg) and are not part of this issue. Text only, no code beyond comments. It waits for nxr-sy0tsz, which changes the same paragraphs.

- [x] Find the marks: `git grep -n -i "provisional" -- nx-rust/docs nx-rust/src`, and for each confirmed line the items it names
- [x] Remove each mark that belongs to a confirmed line and say, where the item records who decided, that the maintainer confirmed it on 20 November 2026; the decision's content does not change
- [x] Leave every other use of the word, and say in this issue's summary which marks stayed and why

Done when: each of the thirteen lines has no provisional mark left in `nx-rust/docs` and `nx-rust/src`, and `pnpm nx format:check --all`, `pnpm nx lint @convesoft/nx-rust`, `mara schema validate`, `mara project validate` and `zban check` pass.

## Summary of Changes

Marks removed (the decisions' content is unchanged):

- nxr-5rrkay line 24 (strict per-crate build target of `hakari`): `execution.mara.md`, "Masked missing features" now says "Decided by the control plane on 16 November 2026 and confirmed by the maintainer on 20 November 2026". Lines 3 and 17 had no mark in `nx-rust/docs` or `nx-rust/src`.
- nxr-sv61dx line 21: `testing.mara.md` (`DES-TEST-PHASES`) now says "Proposed by the control plane on 16 November 2026 in nxr-jb6g5y and confirmed by the maintainer on 20 November 2026".
- nxr-sv61dx lines 44 and 45: "a provisional name" removed from `ci.mara.md` (`DES-BASELINE`) and `targets.mara.md` (`DES-TARGETS` paragraph listing targets); "whose names are provisional" removed from `DES-BASELINE`; "; provisional" removed from the `fullCollectThreshold`, `fullCollect`, `diffOnly` and `separateBuildDir` rows of the options table in `configuration.mara.md`; ", provisional" removed from the comment of `defaultFullCollectThreshold` in `nx-rust/src/graph/targets.ts`. Line 10 had no mark.
- nxr-bhh3mm lines 5 and 6: `ADR-NAPI-SHARED-BUILD-DIR` and `ADR-NAPI-RS-3` now say "The control plane took this decision on 16 November 2026, and the maintainer confirmed it on 20 November 2026."
- nxr-bhh3mm line 13: the parenthesis "(Provisional until the maintainer has reviewed the decisions made in 0.4: ...)" removed from `REQ-INFERRED-TARGETS` in `targets.mara.md`.
- nxr-bhh3mm line 18: `napi-build` paragraph in `artifacts.mara.md` now says the worker gave it these options "and the maintainer confirmed them on 20 November 2026".
- nxr-bhh3mm lines 30 and 32, and the default `bundler` confirmed with nxr-sy0tsz: `wasm-build` paragraph in `artifacts.mara.md` now says the worker chose "and the maintainer confirmed on 20 November 2026".

Mark that stayed: the parenthesis after the sentence added to `REQ-NO-RUST-TASK-DEPS` in `targets.mara.md` ("Provisional until the maintainer has reviewed the decisions made in 0.4"). It belongs to nxr-bhh3mm line 12, which the maintainer's review neither confirmed nor overturned. No mark belonged to an overturned decision (nxr-8paqsn, nxr-sy0tsz, nxr-4884vg).

Checks: `pnpm nx format:write`, `pnpm nx format:check --all`, `pnpm nx lint @convesoft/nx-rust`, `mara schema validate`, `mara project validate` (valid, evaluation complete), `zban check`. No test runs (text only).
