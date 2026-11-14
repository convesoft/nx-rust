---
title: Decide whether VER-CARGO-UNCHANGED keeps the run for a triple list that names the host twice
status: done
type: task
tags:
  - tests
discovered_from: nxr-fq4f40
created_at: 2026-11-14T11:24:22Z
closed_at: 2026-11-14T11:40:52Z
---

Goal: the maintainer decides whether `VER-CARGO-UNCHANGED` keeps naming a real run for a `build.target` list that names the host triple twice, and the test suite follows that decision.

Context: the test-suite review of 14 November 2026 listed `caching-runs.spec.ts`, "caches build and doc where Cargo's configuration picks the triple as a list that names it twice, and restores what the run wrote", among the tests to delete: removing duplicate triples is unit-tested in `target-triples.spec.ts`, and the run adds nothing over the string case. nxr-fq4f40 kept it, because `VER-CARGO-UNCHANGED` names exactly this case ("as a string and as a list that names it twice … the next run restores both without a cargo build"), and that task changes no Mara item.

What else covers the case today:
- `target-triples.spec.ts`, "joins the lists of several files, each triple once…": `pickedTriples` drops a repeated triple (the same `new Set` that handles one file's list).
- `target-triples.spec.ts`, "are those that cargo build and cargo doc write to for a list" (`target = [HOST, HOST]`): the folder the plugin names is the one cargo writes to.
- `caching.spec.ts`, "name the folder of each triple that a list in Cargo's configuration picks…": a list keeps `build` and `doc` cached with outputs in each triple's folder.
- `caching-runs.spec.ts`, the string case of the same test: a restore puts back what the run wrote.

- [x] Ask the maintainer: keep the run (about 2 Nx runs, 1.2 s), or reword the sentence of `VER-CARGO-UNCHANGED` so that the list case is covered by the unit and graph tests above, and delete the row
- [x] Apply the decision, with `mara schema validate` and `mara project validate` if the item changes

Done when: the decision is recorded in Mara where it changes an item, the test suite matches it, and `pnpm nx run-many -t build lint test` passes.

## Summary of Changes

Decided and done in the pull request of nxr-fq4f40 (#74), not in a pull request of its own: the maintainer's "Go ahead" for the review's lists covered the rewordings of verification items that they need, and on 14 November 2026 the control plane said that this is one of them.

- `VER-CARGO-UNCHANGED` now names the run through Nx for `build.target` as a string and for a list of the host triple and a second installed triple, and checks a list that names a triple twice where that is decided: the graph names its folder once, and the triples that the plugin reads hold each triple once, for one file's list and for the lists of several files.
- `caching-runs.spec.ts`: the "a list that names it twice" run is deleted; the string case is a single test.
- `target-triples.spec.ts`: "joins the lists of several files, each triple once, also where one list names it twice, …" now also checks one file's list `["a", "a"]`.
- `caching.spec.ts`: "name the folder of each triple that %s picks…" has a row for a list that names one triple twice, whose outputs name the folder once.
- With the `new Set` of `pickedTriples` removed for a moment, both of those fail (the graph row on the declared outputs).

Checks: `mara schema validate` and `mara project validate` (`valid: true`, evaluation complete, no diagnostics); the three spec files (100 passed); the remaining checks are in nxr-fq4f40.
