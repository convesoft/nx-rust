---
title: A cached build stores a leftover file at a declared output path that it did not produce
status: todo
type: bug
priority: deferred
tags:
  - deferred
  - backlog
discovered_from: nxr-hh3kwy
created_at: 2026-11-21T21:03:14Z
---

Goal: a cached `build` stores, in its own cache entry, a file that lies at one of its declared output paths although this build did not produce it. Decide whether that needs a fix and fix it, or accept it.

Context: `DES-OUTPUTS` declares every final file of a crate's `bin` targets, also a binary with `required-features`, for every configuration of `build`. Cargo writes such a binary only where the features are on, and leaves an earlier one in place where they are off. Nx stores every declared path that exists when the task ends. So a `build` without the features, run uncached after a build with them (another configuration of `build`, or plain `cargo build --features`), stores the leftover binary, and a later cache hit restores it, also into an empty folder. `DES-OUTPUTS` states this as a limit since nxr-hh3kwy.

Reproduction, found in nxr-hh3kwy on cargo 1.100.0 and Nx 24.0.6 with the built plugin: a workspace with one member `pa` that has the feature `extra = []`, the binary `pa` (`src/main.rs`) and the binary `extra` (`src/bin/extra.rs`) with `required-features = ["extra"]`, `nx.json` with `"plugins": ["@convesoft/nx-rust"]`, `NX_DAEMON=false`:

```sh
cargo build --features extra   # writes target/debug/pa and target/debug/extra
nx run pa:build                # uncached; its outputs name target/debug/{extra,pa}
rm -rf target
nx run pa:build                # cache hit: restores target/debug/pa and target/debug/extra
./target/debug/extra           # prints "extra"
```

- [ ] Decide with the maintainer whether a `build` should store only the files that its own cargo command reported (and how that fits Nx's outputs and `GOAL-TRUSTED-CACHE`), or whether the limit stands
- [ ] Update `DES-OUTPUTS` and the guide accordingly
