---
title: Record that publishing is decided at 1.0
status: done
type: task
tags:
  - docs
related:
  - nxr-nm0jd6
  - nxr-g5dfee
created_at: 2026-11-14T14:36:38Z
closed_at: 2026-11-14T14:40:27Z
---

Goal: the knowledge base, the backlog and the status lines agree with the maintainer's decision of 14 November 2026 that no 0.x milestone is published to npm on its own, and that whether and when `@convesoft/nx-rust` is published is decided at 1.0.

Context: in his words, "we decide on publishing at the end on 1.0". Asked about the item "0.x is published to npm" in each milestone epic, he answered "Can't we cancel those items with proper reason?". He also allowed the control plane to close a milestone epic once none of its items remains and its own checks are verified; closing epics is not part of this issue.

The roadmap in `nx-rust/docs/product.mara.md` said that each milestone can be released on its own, and each milestone epic before 1.0 had publishing the milestone among its items. The status lines that nxr-2v14h1 wrote say that `nx add` works "once 0.1 is on npm".

- [x] Record the decision in Mara: the roadmap of `product.mara.md` and a decision item in `decisions.mara.md`, without changing what a milestone contains
- [x] Cancel the item "0.x is published to npm", with its reason, in the epics of 0.1 (nxr-w9qa5f), 0.2 (nxr-9y4eh8), 0.3 (nxr-m3k3w8), 0.4 (nxr-z9jq1n) and 0.5 (nxr-6q2chq), and say in the 1.0 epic (nxr-nm0jd6) that the decision to publish is taken there
- [x] Reword nxr-g5dfee for "when the package is published" and make it a child of the 1.0 epic
- [x] Reword the status lines of `README.md`, `nx-rust/README.md`, `AGENTS.md`, `index.mara.md`, `product.mara.md` and `setup.mara.md` that promise a 0.1 release

Done when: `zban show` counts no publishing item among the task items of the 0.x epics, and `pnpm nx format:check --all`, `mara schema validate`, `mara project validate` and `zban check` pass.

## Summary of Changes

- `decisions.mara.md`: new accepted decision `ADR-PUBLISHING-AT-1-0`. The milestones are completed on `main` one after another, no 0.x milestone is published to npm on its own, whether and when the package is published is decided at 1.0, and publishing is not one of a 0.x milestone's checks, while whether it is one of 1.0's is decided there. It needs no other item under the engineering policies.
- `product.mara.md`: the roadmap no longer says that each milestone can be released on its own; it says the above and cites the decision. What each milestone contains is unchanged.
- Epics 0.1 to 0.5: the item "0.x is published to npm" is a plain bullet now, struck through, with the date, the reason and the decision. `zban show` counts 3 task items in each of them instead of 4. The 1.0 epic says that the decision to publish is taken there and keeps its item "1.0 is published to npm". No other item was ticked and no epic was closed.
- nxr-g5dfee is about the package being published, not 0.1, is a child of the 1.0 epic and no longer related to the 0.1 epic, and says to cancel it if 1.0 decides not to publish.
- `README.md`, `nx-rust/README.md`, `setup.mara.md`: "once 0.1 is on npm", "once 0.1 is published" and "before the release" now say "once the package is published" or "until the package is published". The status lines of both READMEs, which name the milestones, say that publishing is decided at 1.0, and so does the project paragraph of `AGENTS.md`. The status notes of `index.mara.md` and `product.mara.md` promised no release and are unchanged.

Checks: `pnpm nx format:check --all` passes, `mara schema validate` reports a valid schema, `mara project validate` reports `valid: true` with `evaluation_complete: true`, no errors and no warnings, and `zban check` reports nothing. No build, unit or end-to-end run: this is a text change only. The end-to-end test that compares the packed README with `nx-rust/README.md` reads both files, so the new wording cannot break it.
