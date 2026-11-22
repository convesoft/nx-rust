---
title: Decide whether caching.mara.md gives its cargo-invocation and lockfile sections to a page of their own
status: todo
type: task
priority: deferred
tags:
  - deferred
  - backlog
  - maintainer
related:
  - nxr-y7pxgd
discovered_from: nxr-h52ghk
created_at: 2026-11-22T16:51:05Z
---

Cites: `DES-INPUTS`, `DES-OUTPUTS`, `DES-INVOCATION`, `REQ-CARGO-UNCHANGED`, `ADR-BUNDLED-DOCS`.

Finding 11 of the architecture audit after 1.0.0-rc.2 (22 November 2026, at 66964f3), first suggested by the worker of nxr-gb7nbn. `nx-rust/docs/caching.mara.md` is about 1,000 lines and carries two topics: what is in a cache key, what is stored and how the cache is shared; and where and how cargo runs and how the lockfile changes ("Lockfile changes", "Where cargo runs" with "Seeing the command", "Cargo configuration that Nx does not hash" and "Rustfmt configuration outside the repository", and the items `REQ-CARGO-UNCHANGED`, `REQ-VERBOSE-COMMAND`, `DES-INVOCATION`). `DES-LOCKFILE-HASHING` is already in `workspaces.mara.md`.

A new page is the maintainer's decision (the documentation layout rule of `AGENTS.md`), so this issue is tagged `maintainer` and starts with it.

- [ ] The maintainer decides: a new page for the second topic, or the sections stay
- [ ] If a new page: move the sections and items, list the page in `nx-rust/docs/index.mara.md` and the root `README.md`, and fix the links to the moved anchors in the other pages and in `nx-rust/PLUGIN.md`, which ships in the npm package (`ADR-BUNDLED-DOCS`)

Done when: the decision is recorded here and, if the page is split, every link resolves, and `pnpm nx format:check --all`, `mara schema validate` and `mara project validate` pass.
