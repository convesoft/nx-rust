---
title: Check the remedy of the diagnostics that only verification items other than VER-SETUP name
status: in-progress
type: task
priority: low
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-carr7v
created_at: 2026-11-13T21:28:16Z
---

Goal: no implementation that drops the "what the user can do" part of a diagnostic of `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) can pass the verification items.

Context: nxr-carr7v made `VER-SETUP` require that each message it names says what the user can do, and added that assertion to the tests of those messages. Rows of the `DES-DIAGNOSTICS` table that only other verification items name are still checked for the facts they state and not for their remedy, so a message could lose its remedy and every check would pass. Examples, as the table stands: a value of `NX_RUST_TEST_MODE` other than `affected` and `full` (`VER-TESTING`), differing `wasm-bindgen` CLI and crate versions (`VER-ARTIFACTS`), an invalid `NX_RUST_LOCKED`, `Cargo.lock` changing during a cached task, a task that runs without its lockfile task, a `build` that read a file outside its inputs, a `pluginVersion` for one run, `build.target` choosing the triple of a cached `build` or `doc`, the profiles `dev`, `test` and `bench` on `build` or `doc`, a configuration that caches a target the plugin leaves uncached, and `--affectedTests=true` without the setting.

- [ ] For each row of the table, find the verification item that names it and the test that checks it
- [ ] Where the item or the test leaves out the remedy, add it (one sentence in the item, as in `VER-SETUP`, and the assertion in the test); file a bug where a message has none

Done when: each row of `DES-DIAGNOSTICS` that is implemented has a verification item that requires its remedy and a test that asserts it, and `mara schema validate`, `mara project validate` and `pnpm nx run-many -t build lint test` pass.
