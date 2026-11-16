---
title: Fall back from hakari where a member's dependency on the hack crate is optional and not enabled
status: todo
type: bug
priority: deferred
tags:
  - backlog
discovered_from: nxr-k64tm5
created_at: 2026-11-16T17:57:33Z
---

Goal: a workspace whose members do not really use the cargo-hakari hack crate is not treated as one that the `hakari` strategy can build crate by crate (`DES-UNIFICATION`, the four checks; `REQ-STABLE-FEATURES`).

Context: found in the review of nxr-k64tm5 (16 November 2026), with the real Nx, cargo and cargo-hakari 0.9.39; it needs a manifest that cargo-hakari itself does not write, which is why it waits in the backlog. Members `a` and `b` ask a third-party crate `x` for the features `f1` and `f2`. Both declare `workspace-hack` with `optional = true` and do not enable it by default. The generated hack manifest asks for both features, `platforms` holds the host, and all four graph checks pass. `cargo hakari generate --diff` and `manage-deps --dry-run` both accept it, and `manage-deps` keeps the optional lines. Yet `nx run a:build` builds an executable that prints `f1`, `nx run-many -t build -p a,b --skip-nx-cache` one that prints `f1 f2`, the real hasher gives `a:build` the same key in both runs, and a later restore returns the `f1` executable. So passing cargo-hakari's own checks does not show that every selected crate uses the hack crate (`nx-rust/src/graph/unification.ts`, about line 195; `nx-rust/src/executors/command.ts`, about line 234).

- [ ] Reproduce with the real tools
- [ ] Require that every member's dependency on the hack crate is one that cargo always builds (not optional, or enabled in every feature set the plugin builds), and otherwise fall back to `workspace-build` with the warning that names the member; record the rule in `DES-UNIFICATION`
- [ ] A test with the real cargo-hakari, and the row in `VER-BATCHING`

Done when: such a workspace falls back with the warning, the test passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
