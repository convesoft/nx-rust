---
title: Decide whether VER-CARGO-UNCHANGED keeps the run for a triple list that names the host twice
status: todo
type: task
tags:
  - tests
discovered_from: nxr-fq4f40
created_at: 2026-11-14T11:24:22Z
---

Goal: the maintainer decides whether `VER-CARGO-UNCHANGED` keeps naming a real run for a `build.target` list that names the host triple twice, and the test suite follows that decision.

Context: the test-suite review of 14 November 2026 listed `caching-runs.spec.ts`, "caches build and doc where Cargo's configuration picks the triple as a list that names it twice, and restores what the run wrote", among the tests to delete: removing duplicate triples is unit-tested in `target-triples.spec.ts`, and the run adds nothing over the string case. nxr-fq4f40 kept it, because `VER-CARGO-UNCHANGED` names exactly this case ("as a string and as a list that names it twice … the next run restores both without a cargo build"), and that task changes no Mara item.

What else covers the case today:
- `target-triples.spec.ts`, "joins the lists of several files, each triple once…": `pickedTriples` drops a repeated triple (the same `new Set` that handles one file's list).
- `target-triples.spec.ts`, "are those that cargo build and cargo doc write to for a list" (`target = [HOST, HOST]`): the folder the plugin names is the one cargo writes to.
- `caching.spec.ts`, "name the folder of each triple that a list in Cargo's configuration picks…": a list keeps `build` and `doc` cached with outputs in each triple's folder.
- `caching-runs.spec.ts`, the string case of the same test: a restore puts back what the run wrote.

- [ ] Ask the maintainer: keep the run (about 2 Nx runs, 1.2 s), or reword the sentence of `VER-CARGO-UNCHANGED` so that the list case is covered by the unit and graph tests above, and delete the row
- [ ] Apply the decision, with `mara schema validate` and `mara project validate` if the item changes

Done when: the decision is recorded in Mara where it changes an item, the test suite matches it, and `pnpm nx run-many -t build lint test` passes.
