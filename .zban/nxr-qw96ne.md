---
title: Remove the provisional marks of the decisions the maintainer confirmed
status: todo
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
---

Goal: no Mara item, guide page or code comment still calls a decision provisional that the maintainer confirmed on 20 November 2026.

He confirmed thirteen of the sixteen provisional decisions of the review issues: lines 3, 17 and 24 of nxr-5rrkay; lines 10, 21, 44 and 45 of nxr-sv61dx; lines 5, 6, 13, 18, 30 and 32 of nxr-bhh3mm. The other three became work of their own (nxr-8paqsn, nxr-sy0tsz, nxr-4884vg) and are not part of this issue. Text only, no code beyond comments. It waits for nxr-sy0tsz, which changes the same paragraphs.

- [ ] Find the marks: `git grep -n -i "provisional" -- nx-rust/docs nx-rust/src`, and for each confirmed line the items it names
- [ ] Remove each mark that belongs to a confirmed line and say, where the item records who decided, that the maintainer confirmed it on 20 November 2026; the decision's content does not change
- [ ] Leave every other use of the word, and say in this issue's summary which marks stayed and why

Done when: each of the thirteen lines has no provisional mark left in `nx-rust/docs` and `nx-rust/src`, and `pnpm nx format:check --all`, `pnpm nx lint @convesoft/nx-rust`, `mara schema validate`, `mara project validate` and `zban check` pass.
