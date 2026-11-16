---
title: Key napi-build on the packages that @napi-rs/cli depends on
status: todo
type: task
priority: deferred
tags:
  - backlog
discovered_from: nxr-tv3r95
created_at: 2026-11-16T17:05:24Z
---

The key of `napi-build` holds the version of the `@napi-rs/cli` that Node resolves from the crate's folder, through a runtime input (`DES-NAPI`, `DES-INPUTS`, "napi CLI"), but not the packages that the CLI depends on, which its semver ranges let a JS lockfile change without a new CLI version. A change there that changes what `generateTypeDef` or `writeJsBinding` write would let Nx restore files that the task would now write otherwise. Low priority: the CLI bundles its own code, and its dependencies are tooling (TypeScript, YAML, prompts).

- [ ] Decide whether to hash the CLI's package and its dependencies with an `externalDependencies` input where Nx has an npm node for `@napi-rs/cli`, as the plugin's own version does (`DES-INPUTS`, "Plugin"), keeping the runtime input otherwise
- [ ] Record the decision in `DES-NAPI` and `DES-INPUTS`, and check it with a row of `VER-CACHE-KEYS`
