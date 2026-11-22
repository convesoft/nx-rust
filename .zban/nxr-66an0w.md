---
title: Review the decisions made in 1.0.0-rc.2
status: todo
type: task
tags:
  - maintainer
created_at: 2026-11-22T10:39:56Z
---

Review every decision made for the maintainer during milestone `nxr-h52ghk` (`1.0.0-rc.2: Findings from adopting nx-rust in mara`) before publishing `1.0.0-rc.2`.

- [ ] Review each decision line added during `1.0.0-rc.2`

Done when: every decision made during `1.0.0-rc.2` has been reviewed by the maintainer.

## Decisions made for the maintainer during 1.0.0-rc.2

Each line gives what was decided, the items it rests on, and how to undo it. The maintainer's own answers of 22 November 2026 are in the items and are not repeated here: no `args` option on `lint`; `REQ-BATCHING` amended so that denied warnings fail every task of a step; the test steps keep failing every task and name the cause; a `build` restored from another checkout accepted in `RISK-HOST-ENVIRONMENT`; a warning for a `clippy.toml` above the repository after rc.2 (nxr-8akbay); zban from npm in CI (nxr-9tcscc).

1. nxr-6rfafh: the decision to ship `PLUGIN.md` and the docs folder in the npm package is a new item, `ADR-BUNDLED-DOCS`, and `ADR-PUBLISHING-AT-1-0` is untouched; `PLUGIN.md` sits at the package root, the path that Nx 24's agent rule names; the package's contents are checked in `VER-SETUP`. Undo: remove the docs asset from `nx-rust/project.json` and the item.
2. nxr-tjxcvx: the plugin applies Cargo's `build.warnings` to JSON compile steps itself, reading `CARGO_BUILD_WARNINGS` or else the first `build.warnings` through the existing configuration walk, and asking `cargo --version` for the 1.97 boundary, where an answer that cannot be read counts as a version that honours the setting; every `compiler-message` of level `warning` counts, also one without a lint code; under `workspace-build` the step's own command and feature selection are the reference (`DES-BATCH` "Denied warnings", `DES-UNIFICATION`, `EVD-CARGO-TARGET-COMMANDS`). Undo: per-crate attribution, nxr-hwkc7z.
3. nxr-rpcfg4: the runtime input of `lint` prints both Clippy files of the first folder that has one, for every folder clippy can be given (the variable and each value of Cargo's `[env]`), without copying cargo's precedence; whether rustfmt configuration covers a crate is judged from each target's source file; the warning also covers a rustfmt file in a folder above the repository, as what follows from "Keep the risk, warn clearly" (`DES-INPUTS`, `DES-DIAGNOSTICS`, `RISK-HOST-ENVIRONMENT`, `EVD-CLIPPY-RUSTFMT-CONFIG-LOOKUP`). Undo: narrow the warning to the per-user files.
4. nxr-k5y74e: the new option of the `test` target is named `test`, after cargo's flag, as `bin` is on `run` (the alternative was `testTarget`); a task with it runs in a cargo command of its own under every strategy; with nextest it has no doctest step, for which `REQ-DOCTESTS` gained one sentence, taken from the issue's own wording; in affected mode it selects nothing and records no subset (`DES-PLUGIN-OPTIONS`, `DES-BATCH`, `DES-TEST-RUN`, `DES-TEST-MODE`, `EVD-CARGO-TEST-TARGET-SELECTOR`). Undo: rename the option before 1.0.0-rc.2 is published; afterwards it is a breaking change.
5. nxr-k5y74e: a crate with an executable and an integration test target that its manifest turns off (`test = false`) now has `test` wait for `build` and put the executable back, because the `test` option can select that target from the command line (`DES-TARGETS`, `DES-OUTPUTS`). Undo: the rule in `testReplacesExecutables`.
6. nxr-w1qhmx: the cause of a test step that denied warnings stop is read from cargo's own output only; the message names the crates that cargo compiled until it stopped and does not claim the list is complete; progress text is left out for those lines only (`DES-TEST-RUN` "Denied warnings in a test step"). Undo: the general message of a failed step.
7. nxr-gb7nbn: the guides cover every checkout that Nx 24 shares its cache between, not only linked worktrees, and recommend a `runtime` input on `build` that names the checkout, since `--remap-path-prefix` and a cache directory of its own are each only part of a remedy; no Mara item changed in that issue. Undo: edit the guidance.
