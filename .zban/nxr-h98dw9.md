---
title: Specify what targetNames does with a key that names no inferred target
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-t1ht7j
created_at: 2026-11-13T14:56:44Z
---

Goal: `DES-PLUGIN-OPTIONS` (`nx-rust/docs/configuration.mara.md`) says what happens when a key of the plugin option `targetNames` is no default name of an inferred target, such as Cargo's `clippy` or a misspelt `lnt`.

Context: the "Unknown keys" paragraph of `DES-PLUGIN-OPTIONS` covers the top-level keys of the plugin options, not the keys inside `targetNames`. nxr-t1ht7j reads `targetNames` (`readTargetNames` in `nx-rust/src/graph/options.ts`) and rejects a value that is no name, but leaves such a key without effect and without a message, because no item decides it. Rejecting it is closest to `NEED-CLEAR-FAILURES`, but then the list of valid keys has to include the inferred targets that later milestones add: `napi-build`, `wasm-build`, the release targets and the coverage baseline of `DES-BASELINE`, whose default name is not specified yet.

- [ ] Agree with the user whether such a key fails graph creation, warns or is ignored, and record it in `DES-PLUGIN-OPTIONS`, with a row in `DES-DIAGNOSTICS` if it is a diagnostic
- [ ] Record there too what nxr-t1ht7j already does when `targetNames` is no object or gives a value that is no non-empty string: graph creation fails with a message that names `targetNames` in `nx.json` and the key
- [ ] Extend `VER-CONFIGURATION` accordingly
- [ ] Implement it in `readTargetNames` and test it in `nx-rust/test/targets.spec.ts`

Done when: the item says what happens, the verification covers it, `mara schema validate` and `mara project validate` report `valid: true`, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
