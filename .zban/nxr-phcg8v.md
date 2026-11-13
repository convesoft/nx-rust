---
title: Handle a dotenv file that moves a task's artifact directory
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-0haa7z
created_at: 2026-11-13T15:20:23Z
---

Goal: a `build` or `doc` result is never stored or restored with artifacts other than the ones its task produced, when a dotenv file that Nx loads for the task sets Cargo's artifact or build directory.

Concerns `DES-OUTPUTS`, `DES-BUILD-DIRS` and `REQ-CACHE-OUTPUTS` (`nx-rust/docs/caching.mara.md`), `DES-METADATA-REPORT` (`nx-rust/docs/workspaces.mara.md`), `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`), `RISK-NX-INPUT-SEMANTICS` and `GOAL-TRUSTED-CACHE`.

Observed while researching nxr-0haa7z on 2026-11-13, with cargo 1.98.1, not yet recorded as evidence: with `CARGO_TARGET_DIR` set, `cargo build` wrote the binary into that folder, and with `CARGO_TARGET_DIR` and `CARGO_BUILD_BUILD_DIR` set, `cargo metadata --no-deps` reported both folders. Graph creation runs without the dotenv files of a crate's folder and of a target or configuration, such as `.env.build`, so the outputs it declares would name the workspace's usual artifact directory while the task writes elsewhere. Not tried: what Nx then stores for the task, possibly an older file at the declared path, and what it restores. `CARGO_BUILD_TARGET_DIR` should act like `CARGO_TARGET_DIR`.

- [ ] Reproduce with Nx 24 and record the result as an evidence item
- [ ] Propose to the maintainer how the plugin handles it, for example a warning, or the executor comparing the folders under the task's environment with those of the graph, and update the items
- [ ] Extend the verification that the Mara policies then require

Done when: the maintainer has decided, the items say what happens, and `mara schema validate` and `mara project validate` report `valid: true`.
