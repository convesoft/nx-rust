---
title: Use one helper to tell whether a path lies inside a folder
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
blocked_by:
  - nxr-aa287j
discovered_from: nxr-e2z8sz
created_at: 2026-11-21T18:45:34Z
---

Goal: the source has one set of helpers for "is this path inside that folder" and "this path relative to the repository", and no hand-written copy.

Context: finding 3 of the architecture audit after 0.6 (21 November 2026, at 54adf17). Wave: seam. More than 13 places decide containment by hand, and they disagree on the root (`""` or `.`), on links and on separators. Eight of them test `!relative.startsWith("..")`, which also takes a file or folder whose name begins with two dots, such as `..config` at the repository root, for one outside: `nx-rust/src/executors/kept-files.ts` (about lines 188 and 377), `nx-rust/src/graph/caching.ts` (621), `nx-rust/src/graph/artifact-names.ts` (338), `nx-rust/src/cargo/target-triples.ts` (149), `nx-rust/src/generators/crate/crate.ts` (129), `nx-rust/src/graph/unification.ts` (436), `nx-rust/src/release/places.ts` (414). `nx-rust/src/graph/real-path.ts` (about line 83) and `nx-rust/src/executors/stage.ts` (428) have the correct test. Other copies: `input-check.ts` (312), `declared-files.ts` (684), `inputs.ts` (937), `path-dependencies.ts` (579), `discovery.ts` (831), `publish-crates.ts` (380), `repository.ts` (240). A name that begins with two dots is rare, which is why this waits in the backlog. It waits for nxr-aa287j, which changes the same lines of `kept-files.ts` and `stage.ts`.

- [ ] Export the helpers from `nx-rust/src/graph/real-path.ts` and replace every copy, with a unit case for a name that begins with two dots
- [ ] Say in the summary where a copy's behaviour changed (root spelling, links, separators) and why that is right

Done when: no hand-written containment test is left in `nx-rust/src/`, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e` and `pnpm nx format:check --all` pass.

Added by the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3): `nx-rust/src/graph/rustfmt-config.ts` (PR #90) uses `realPath` of `graph/real-path.ts`, but has two more hand-written containment tests, `insidePath` and `isWithin`. Include them here.
