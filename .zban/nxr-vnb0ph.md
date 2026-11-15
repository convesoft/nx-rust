---
title: Close the remaining gaps of the target-default guard around other plugins and extra targets
status: todo
type: bug
priority: low
parent: nxr-9y4eh8
discovered_from: nxr-gyyhdj
created_at: 2026-11-15T10:39:53Z
---

Goal: `DES-TARGET-DEFAULT-GUARD` has no case left in which an inferred target loses an input, an output or a dependency, or gains caching, without an error or a warning that the executor backs, and it blames the entry that Nx really applied.

Context: found while nxr-gyyhdj and nxr-6prnx1 were fixed and reviewed (15 November 2026). The first four were found by reading the code and were not run; the fifth was reproduced by the reviewer. None is a regression of that work. Each needs a second Nx plugin or an extra target, so they are rare; the second one can end in a stale cache hit and is why this is a bug.

- [ ] Reproduce each case with the real Nx in both plugin modes (`NX_ISOLATE_PLUGINS` true and false), and drop from this list what does not reproduce
- [ ] Extra targets that a crate declares in its Cargo tables are compared as if the plugin had inferred them: an ordinary entry such as `"e2e": { "cache": true }` probably fails graph creation for a crate that defines `e2e`, and where another plugin turns caching on for such a target, the warning has nothing behind it, because the executor is not the plugin's
- [ ] Another plugin replaces the `inputs` or `outputs` of an inferred target and no `targetDefaults` entry is involved: the guard only warns, with empty `targetDefaults` it says nothing, and nothing at run time stops a stale hit. Decide with the maintainer whether this is an error, a warning that the executor backs, or outside what the guard promises, and record it in `DES-TARGET-DEFAULT-GUARD`
- [ ] The digest of warnings that `createNodes` computes (`targetDefaultCauses`) does not consider the source that `filter.plugin` compares with, so a warning can be missing on a cache hit
- [ ] An addition to `dependsOn` is never blamed on an entry where the rebuild does not reproduce the field; it stays a warning either way
- [ ] Misleading attribution: with a plugin `other` registered before nx-rust, an executor-keyed entry `[{ "filter": { "plugin": "other" }, "inputs": ["default"] }]` beside `"check": [{ "filter": { "projects": ["api"] }, "inputs": ["default"] }]` blames `check` for `api`, although Nx selects the executor key (`nx-rust/src/graph/target-defaults.ts`, about line 329). Graph creation still fails
- [ ] Tests in `target-defaults.spec.ts` for each case that is fixed, and `VER-TARGET-DEFAULT-GUARD` updated

Done when: each case above is fixed, decided or shown not to reproduce, the decisions are in Mara, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
