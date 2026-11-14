---
title: Say in the cache design which changes outside a crate's inputs invalidate its tasks
status: done
type: task
priority: low
parent: nxr-w9qa5f
discovered_from: nxr-wynx3g
created_at: 2026-11-13T11:03:15Z
closed_at: 2026-11-14T07:53:52Z
---

Goal: `DES-INPUTS` and the caching guide (`nx-rust/docs/caching.mara.md`) say what the bullet "Cache key" of `EVD-NX-OPTION-VALIDATION` (`nx-rust/docs/decisions.mara.md`) found Nx 24.0.6 to hash into every task of a project, beyond the declared inputs.

- [x] Decide with the maintainer whether this needs a risk item or a sentence in `DES-INPUTS` and the guide, and write it, citing that bullet
- [x] Add rows to the cache-key matrix of `VER-CACHE-KEYS` if the policies call for it

Done when: the knowledge is recorded, and `mara schema validate`, `mara project validate` (`valid: true`) and `pnpm nx format:check --all` pass.

## Summary of Changes

Decision, taken by the control plane under `GOAL-TRUSTED-CACHE` ("running more than a key promises is fine"): no new risk item, but one short paragraph in `DES-INPUTS` and a few sentences in the guide, citing the "Cache key" bullet of `EVD-NX-OPTION-VALIDATION`, and rows in `VER-CACHE-KEYS` only if the Mara policies require them or an existing row contradicts the paragraph.

- `DES-INPUTS` has a new paragraph, "Beyond the declared inputs". It says that Nx puts `nx.json` and the project's configuration into every key (per target: executor, `inputs`, `outputs`, `options`, `configurations` and `parallelism`; per project: root, named inputs and tags), together with the configuration of each project hashed through `^` inputs (`EVD-NX-24-PLUGIN-VERSION`). It names the effect: any `nx.json` change changes every key, and an option of one target, a `package.json` script that Nx reads, or a `targetDefaults` or `project.json` value changes every key of the crate and of the crates that depend on it. `metadata`, `cache` and `dependsOn` change none. These parts only make tasks run more often.
- The guide ("What is in a cache key") says the same in a short paragraph.
- `VER-CACHE-KEYS`: the policies required no new row. The "Keys must not differ after" row about "a file outside the crate's folder that none of the task's inputs covers" contradicted the paragraph for `nx.json`. A sentence now restricts those rows to states in which `nx.json` and the configuration of the projects a key holds stay the same. No test row was added.

Checks: `mara schema validate` and `mara project validate` (`valid: true`, evaluation complete, no errors or warnings), `pnpm nx format:check --all`, `pnpm nx run-many -t build lint test` and `zban check` pass.
