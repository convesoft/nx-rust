---
title: Record that Nx hashes nx.json and the whole project configuration into every task
status: todo
type: task
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-wynx3g
created_at: 2026-11-13T11:03:15Z
---

Goal: the cache design and the caching guide say which changes outside a crate's declared inputs invalidate its cached results.

`EVD-NX-OPTION-VALIDATION` (`nx-rust/docs/decisions.mara.md`, bullet "Cache key") found that Nx 24.0.6 puts the file `nx.json` and one `ProjectConfiguration` value per project into every task's hash, whatever the target's inputs. Any edit of `nx.json`, and any change to one target of a crate, such as an option of `test` in its `Cargo.toml`, therefore invalidates every cached task of the crate. That is safe (`GOAL-TRUSTED-CACHE`) but costs hits (`NEED-EFFICIENT-BUILDS`), and `DES-INPUTS` (`nx-rust/docs/caching.mara.md`) does not mention it.

- [ ] Decide whether this needs a risk item or only a sentence in `DES-INPUTS` and the guide, and write it
- [ ] Add rows for these two changes to the cache-key matrix of `VER-CACHE-KEYS` if the policies call for it

Done when: the knowledge is recorded, and `mara schema validate`, `mara project validate` (`valid: true`) and `pnpm nx format:check --all` pass.
