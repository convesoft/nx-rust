---
title: Record that Nx hashes nx.json and every target's options into each task of a project
status: todo
type: task
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-wynx3g
created_at: 2026-11-13T11:03:15Z
---

Goal: the cache design and the caching guide say which changes outside a crate's declared inputs invalidate its cached results.

`EVD-NX-OPTION-VALIDATION` (`nx-rust/docs/decisions.mara.md`, bullet "Cache key") found that Nx 24.0.6 puts two things into every task's hash, whatever the target's inputs:

- the file `nx.json`;
- one `ProjectConfiguration` value per project.

For each target, Nx passes the native hasher its executor, `inputs`, `outputs`, `options`, `configurations` and `parallelism`. For the project it passes the root, named inputs and tags.

With the real in-process hasher, a change to `options` or `configurations` of `test`, or to the project's tags, changed the hashes of both `test` and `build`. A change to `metadata`, `cache` or `dependsOn` of `test`, or to the project's `metadata`, changed neither.

Any edit of `nx.json` therefore invalidates every cached task. So does a change to one target's options or configurations, for example an option of `test` set in a crate's `Cargo.toml`, for every cached task of that crate. That is safe (`GOAL-TRUSTED-CACHE`) but costs hits (`NEED-EFFICIENT-BUILDS`), and `DES-INPUTS` (`nx-rust/docs/caching.mara.md`) does not mention it.

- [ ] Decide whether this needs a risk item or only a sentence in `DES-INPUTS` and the guide, and write it
- [ ] Add rows for these changes to the cache-key matrix of `VER-CACHE-KEYS` if the policies call for it

Done when: the knowledge is recorded, and `mara schema validate`, `mara project validate` (`valid: true`) and `pnpm nx format:check --all` pass.
