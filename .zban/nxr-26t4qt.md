---
title: Say in the cache design which changes outside a crate's inputs invalidate its tasks
status: todo
type: task
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-wynx3g
created_at: 2026-11-13T11:03:15Z
---

Goal: `DES-INPUTS` and the caching guide (`nx-rust/docs/caching.mara.md`) say what the bullet "Cache key" of `EVD-NX-OPTION-VALIDATION` (`nx-rust/docs/decisions.mara.md`) found Nx 24.0.6 to hash into every task of a project, beyond the declared inputs.

- [ ] Decide with the maintainer whether this needs a risk item or a sentence in `DES-INPUTS` and the guide, and write it, citing that bullet
- [ ] Add rows to the cache-key matrix of `VER-CACHE-KEYS` if the policies call for it

Done when: the knowledge is recorded, and `mara schema validate`, `mara project validate` (`valid: true`) and `pnpm nx format:check --all` pass.
