---
title: Recognise an aliased entry of the plugin where it is installed only under .nx/installation
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-gtxq18
created_at: 2026-11-20T13:24:33Z
---

Goal: the plugin recognises its own entries in `nx.json` by any specifier that resolves to it, also where it is installed only under `.nx/installation` (`DES-DISCOVERY`, `DES-TARGET-DEFAULT-GUARD`).

Context: found by the review of nxr-gtxq18, and older than that change. Three lookups resolve the plugin's own package with `require.resolve(<specifier>, { paths: [workspaceRoot] })`, without `.nx/installation`: `nx-rust/src/graph/entries.ts` (the overlap guard between entries), `nx-rust/src/graph/target-defaults.ts` (the identity check of the target-default guard) and `nx-rust/src/graph/plugin-package.ts` (the package version, which falls back safely to its version option). Reproduction of the reviewer: install the plugin only under `.nx/installation`, register it as `@convesoft/nx-rust` and as `@convesoft/nx-rust/src/index.js` with `include` patterns that split one Cargo workspace. Nx loads both entries, and the overlap guard misses the alias; with the same installation also reachable through the root `node_modules`, the overlap error appears. Exotic: it needs one plugin registered under two different specifiers in a repository that uses Nx's `installation` layout.

- [ ] Resolve the plugin's own specifiers through the repository resolution of `nx-rust/src/compatibility/nx-bridge.ts` (`.nx/installation` first, then the repository root), or say in the design items why not
- [ ] Add a check with a real Nx in a `.nx/installation` layout under `$TMPDIR` for the overlap guard and the target-default identity check

Done when: both guards recognise the aliased entry in a `.nx/installation` layout, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
