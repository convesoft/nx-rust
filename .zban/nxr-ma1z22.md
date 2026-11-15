---
title: Refuse a cached nx-release-publish task at run time, as the cargo executors refuse caching of their uncached targets
status: todo
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-m8evx2
created_at: 2026-11-15T17:06:06Z
---

The review of nxr-m8evx2 (at 1de909b) found that `@convesoft/nx-rust:release-publish` has no run-time check like the one with which the cargo executors fail a task whose configuration caches a target that the plugin leaves uncached (`prepareTask` in `nx-rust/src/executors/task.ts`, `DES-OUTPUTS` "Per project"). `uncachedByDesign` names `nx-release-publish`, and the target-default guard reports `cache: true` from `targetDefaults`, but a `project.json` that sets `"cache": true` on the target is not stopped (`nx-rust/src/release/publish.ts`, `prepare`).

Reproduction: a crate folder's `project.json` sets `"cache": true` on `nx-release-publish`; `nx release publish` publishes and Nx stores the results; a second run with another default registry is restored from the cache and reports success without an upload. The release guide says not to turn caching on for the target.

- [ ] Fail a publish task whose configuration caches it before anything runs, with the message of the cargo executors, and test it
