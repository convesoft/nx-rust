---
title: Check the remedy of the diagnostics that only verification items other than VER-SETUP name
status: done
type: task
priority: low
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-carr7v
created_at: 2026-11-13T21:28:16Z
closed_at: 2026-11-14T07:46:43Z
---

Goal: no implementation that drops the "what the user can do" part of a diagnostic of `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) can pass the verification items.

Context: nxr-carr7v made `VER-SETUP` require that each message it names says what the user can do, and added that assertion to the tests of those messages. Rows of the `DES-DIAGNOSTICS` table that only other verification items name are still checked for the facts they state and not for their remedy, so a message could lose its remedy and every check would pass. Examples, as the table stands: a value of `NX_RUST_TEST_MODE` other than `affected` and `full` (`VER-TESTING`), differing `wasm-bindgen` CLI and crate versions (`VER-ARTIFACTS`), an invalid `NX_RUST_LOCKED`, `Cargo.lock` changing during a cached task, a task that runs without its lockfile task, a `build` that read a file outside its inputs, a `pluginVersion` for one run, `build.target` choosing the triple of a cached `build` or `doc`, the profiles `dev`, `test` and `bench` on `build` or `doc`, a configuration that caches a target the plugin leaves uncached, and `--affectedTests=true` without the setting.

- [x] For each row of the table, find the verification item that names it and the test that checks it
- [x] Where the item or the test leaves out the remedy, add it (one sentence in the item, as in `VER-SETUP`, and the assertion in the test); file a bug where a message has none

Done when: each row of `DES-DIAGNOSTICS` that is implemented has a verification item that requires its remedy and a test that asserts it, and `mara schema validate`, `mara project validate` and `pnpm nx run-many -t build lint test` pass.

## Summary of Changes

Every row of `DES-DIAGNOSTICS` on `main` was checked, after merging #57 (the build input check).

Verification items: `VER-GRAPH`, `VER-CONFIGURATION`, `VER-UNKNOWN-OPTIONS`, `VER-TARGET-DEFAULT-GUARD`, `VER-CACHE-KEYS`, `VER-CARGO-UNCHANGED` and `VER-BUILD-INPUT-CHECK` now end with "Each message of [[DES-DIAGNOSTICS]] that this verification names also says what the user can do." Rows that no item named are now named where their tests run:

- the plugin's own TOML error for a configuration file (`VER-GRAPH`);
- a `targetNames` that is no object or gives a target no name (`VER-CONFIGURATION`);
- `pluginVersion`, and a key that the target does not take, in a Cargo metadata target table (`VER-UNKNOWN-OPTIONS`);
- a task whose dependency on the lockfile task is taken away (`VER-CACHE-KEYS`);
- an invalid `locked` option or `NX_RUST_LOCKED` (`VER-CARGO-UNCHANGED`).

`VER-TARGET-DEFAULT-GUARD` now also requires the command that shows where a cache setting comes from.

Tests that now assert the remedy:

- `target-defaults.spec.ts`: the Nx without the guard's internals, as a unit test and in graph creation;
- `discovery.spec.ts`: a path dependency that cargo does not report, and one whose report fails;
- `vendored-sources.spec.ts`: a vendored crate without `.cargo-checksum.json`;
- `redirections.spec.ts`: the plugin's TOML error;
- `targets.spec.ts`: invalid `targetNames` values;
- `lockfile-digest.spec.ts`: "run it again" after `Cargo.lock` changed;
- `lockfile-runs.spec.ts`: a task without its lockfile task;
- `caching.spec.ts`: the `build.target` warning;
- `caching-runs.spec.ts`: a run that clears the configured triple, and a `project.json` that caches `build` where the plugin leaves it uncached.

Added here, because a remedy was one sentence: the warning that the build input check did not run (`skippedCheckWarning` in `nx-rust/src/executors/nx-task-files.ts`) now says to use a supported Nx, or a version of the plugin that supports the installed one. `build-input-check.spec.ts` asserts it.

Filed: nxr-nst7g2. The unknown-option line for an option passed on the command line has no remedy, and what it should suggest needs a decision.

Out of scope, not implemented on `main` yet: a value of `NX_RUST_TEST_MODE` other than `affected` and `full`, `--affectedTests=true` at the start of a `test` task, and differing `wasm-bindgen` CLI and crate versions. Rows that open pull requests #59 and #60 add are left to them.

Checks run: `pnpm nx run-many -t build lint test` (31 suites, 941 tests passed); the changed spec files again with `CI=true GITHUB_ACTIONS=true` and without the agent variables (350 tests passed); `pnpm nx format:check --all`; `mara schema validate`, `mara project validate` and `zban check`.

## Addendum after merging #59 (target triples)

#59 added three rows, and each message has a remedy. `VER-CARGO-UNCHANGED` names them all, and it requires the remedy through its closing sentence.

- A triple whose folder the plugin cannot name, at graph creation: `caching.spec.ts` now asserts the "To cache them, give the triple as the targetTriple option …" sentence of the new message.
- At the start of a task, the environment or configuration picks other triples than the outputs name: the dotenv test in `caching-runs.spec.ts` now asserts the whole remedy sentence. A new test covers the branch where a dotenv file picks `host-tuple` ("Give the triple as the targetTriple option instead."), and `VER-CARGO-UNCHANGED` now names it.
- Cargo's configuration changed since graph creation: its `nx reset` remedy was already asserted.

No bug was needed.
