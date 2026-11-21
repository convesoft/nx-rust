---
title: Move the evidence out of decisions.mara.md into a page of its own
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:46:48Z
---

Goal: `nx-rust/docs/decisions.mara.md` is a page a person can read and edit, with the evidence items on a page of their own.

Context: finding 12 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: split. The page has 3,184 lines, nearly four times the next largest page: `## Decisions` (about lines 6-794), `## Risks` (795-1109), `## Evidence` (1110-3164) and `## Sources` (3165-3184). Workers of 0.6 asked for the split twice (nxr-hjpc99, nxr-yfh7zh). `AGENTS.md` ("Documentation layout") places decisions, risks, evidence and sources in `decisions.mara.md`, so the layout rule changes with this, and with it `nx-rust/docs/index.mara.md` and the root `README.md`, which list the pages. The layout rule is the maintainer's: this issue needs his agreement before it starts.

- [ ] Agree with the maintainer on the pages: `evidence.mara.md` for the evidence, and whether the risks get `risks.mara.md` too
- [ ] Move the items with the Mara tools, so that their identities and every relation survive; no item's text changes
- [ ] Update the layout rule in `AGENTS.md`, the page list in `nx-rust/docs/index.mara.md` and the root `README.md`

Done when: `mara schema validate` and `mara project validate` report a valid project with complete evaluation, every item that was in the old page is found with `mara get`, and `pnpm nx format:check --all` passes.
