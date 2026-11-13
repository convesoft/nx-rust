---
title: Decide what to do when two redirected crates would get edges to each other
status: todo
type: task
tags:
  - spec
discovered_from: nxr-p5ybc0
created_at: 2026-11-13T15:11:05Z
---

Goal: the edges to redirected crates (`ADR-REDIRECTION-EDGES`, `DES-PROJECT-GRAPH`) never close a cycle that cargo cannot have, or the docs say when they do.

The rule gives every member with a registry or git dependency an edge to every redirected crate, and leaves an edge out only where the redirected crate reaches the member through normal or build dependencies. When a workspace redirects to two of its members that both have registry dependencies and do not depend on each other, each gets an edge to the other. Checked on 2026-11-13 with cargo 1.100.0 and `nx` 24.0.6 in a copy of the fixture `patched-workspaces` with `util = { path = "crates/util" }` and `harness = { path = "crates/harness" }` added to the `[patch.crates-io]` of `rust/Cargo.toml`: the graph had both `util -> harness` and `harness -> util`. Cargo can use at most one direction through normal dependencies. A `targetDefaults` entry with `dependsOn: ["^build"]` turns the project cycle into a task cycle, which fails the run unless `NX_IGNORE_CYCLES=true`.

Options for the maintainer:

- Keep both edges, and say in `ADR-ALL-DEP-KINDS` and the guidance that such a cycle can appear.
- Leave out both edges, and give each crate's targets the other's files as an input, as the rule already does where the redirected crate reaches the member. Keys of the two crates and task-based `nx affected` stay right; `nx show projects --affected` and the `^` inputs of a dependent outside the workspace, such as a JS project, miss the other crate. Recommended by the worker of nxr-p5ybc0, because it matches the decided exception.
- Keep one direction, chosen by a fixed order, and treat the other as in the second option.

- [ ] Decide with the user and record it in `ADR-REDIRECTION-EDGES` and `DES-PROJECT-GRAPH`
- [ ] Implement it in `redirectedUses` (`nx-rust/src/graph/edges.ts`), with the case above as a test
- [ ] Extend `VER-GRAPH` for the case

Done when: the parts of the cited verification that cover this pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
