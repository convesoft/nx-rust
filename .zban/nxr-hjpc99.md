---
title: Harden plugin entry state wiring against hook destructuring and this rebinding
status: in-progress
type: task
parent: nxr-e2z8sz
created_at: 2026-11-20T10:24:47Z
---

Goal: plugin entry state lookup between `createNodes`, `createDependencies`, and `createMetadata` does not depend solely on `this` object identity from a `get createNodes()` getter side effect.

Context: `nx-rust/src/index.ts` defines `get createNodes()` to construct a new `Registration` whenever Nx copies the module's properties for an `nx.json` entry, and `nx-rust/src/graph/registration.ts` maps `this.createNodes` via a `WeakMap` assuming Nx always invokes `createDependencies` and `createMetadata` with `this` bound to that exact shallow copy (`DES-DISCOVERY`, `DES-PROJECT-GRAPH`, `RISK-UPSTREAM-CHANGES`). Destructuring hooks or changing Nx's plugin wrapper breaks `registrationOf(this)`.

- [ ] Audit how Nx 24 passes plugin identity/options to `createNodes`, `createDependencies`, and `createMetadata`, and check whether a fallback keyed by `(workspaceRoot, pluginEntryName)` or project metadata can survive hook destructuring
- [ ] Reduce reliance on `get createNodes()` side effects and `queueMicrotask` timing where a more explicit mechanism works cleanly
- [ ] Add tests covering single-entry, multi-entry, and unbound/copied-hook invocations

Done when: entry state resolution is resilient and tested, and `pnpm nx run-many -t build lint test`, `pnpm nx e2e nx-rust-e2e`, and `pnpm nx format:check --all` pass.
