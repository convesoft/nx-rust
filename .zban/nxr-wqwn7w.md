---
title: Report a targetDefaults entry that narrows what an inferred target's inputs or outputs mean
status: todo
type: bug
priority: low
parent: nxr-9y4eh8
discovered_from: nxr-vnb0ph
created_at: 2026-11-15T13:36:48Z
---

Goal: a `targetDefaults` entry that keeps every entry an inferred target declares but adds a negated pattern to its `inputs` or `outputs`, or a named input that holds one, is reported like an entry that replaces them, so that it cannot take files out of a Rust target's key unnoticed.

Context: found while nxr-vnb0ph applied the maintainer's rule to what a list means (`DES-TARGET-DEFAULT-GUARD`, "Other layers"). That rule judges what other plugins do. It leaves `targetDefaults` entries to the rows of "What counts", which look only for lost inferred entries. So `"check": { "inputs": ["...", "!{projectRoot}/src/**/*"] }` in `nx.json`, or an entry that adds `"production"` whose definition in `nx.json` holds negated patterns, passes without a report, although Nx then hashes fewer of the crate's files (`EVD-NX-24-PLUGIN-NODES`, "What a list means"). Not reproduced yet; found by reading. It needs a decision whether such an entry is an error, like a replaced list, or the repository's deliberate statement, like a negated pattern beside `"..."` in a target table (`DES-PLUGIN-OPTIONS`, "Targets").

- [ ] Reproduce with the real Nx in both plugin modes: an entry that adds a negated input pattern, and one that adds a named input with negations, each followed by a cache hit after a change that must fail
- [ ] Decide with the maintainer, and record the decision in `DES-TARGET-DEFAULT-GUARD`
- [ ] Implement it with the comparison of meaning that "Other layers" already uses, test it in both modes, and update `VER-TARGET-DEFAULT-GUARD`
