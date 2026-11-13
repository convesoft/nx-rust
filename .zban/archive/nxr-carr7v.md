---
title: Make VER-SETUP check init's writes, generator mechanics and diagnostic content in full
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-eg9s2w
  - nxr-q6cxt3
discovered_from: nxr-dp5q0f
created_at: 2026-11-13T11:50:39Z
closed_at: 2026-11-13T21:32:57Z
---

Goal: `VER-SETUP` (`nx-rust/docs/verification.mara.md`) checks the promises of `DES-GENERATORS` and `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`) closely enough that an implementation that breaks one of them cannot pass. nxr-eg9s2w and nxr-q6cxt3 implement what `VER-SETUP` checks.

Context: the third review of pull request #9 (nxr-dp5q0f) found no defects but listed these lesser gaps in how thorough `VER-SETUP` is. They were left out of that pull request so that no Mara item changed after the review. Read the cited items rather than copying their text here.

- [x] **Stop before writing.** The check that `init` stops before it writes asserts only the final state of `nx.json`. An implementation that writes the entry and rolls it back, or writes another file on the error path, would pass. Observe writes, or assert that nothing in the repository changed. Run a failing second `init` on a `nx.json` that already lists the plugin, to show that an existing entry does not bypass the checks (`DES-GENERATORS`, steps 1 and 2).
- [x] **Generator mechanics** that `DES-GENERATORS` promises and no check names:
  - `directory` required and the first positional argument, `name` and `edition` optional;
  - the nearest enclosing workspace chosen when workspaces are nested (`EVD-CARGO-NEW`);
  - no cargo call when the enclosing workspace's `exclude` matches the folder;
  - creation through the callback the generator returns, not through Nx's file tree;
  - cargo alone editing the workspace manifest.
- [x] **Generator fixtures:** an omitted `name`, cargo's default edition where `[workspace.package]` sets none, and inherited `[workspace.lints]` (`DES-GENERATORS`, `EVD-CARGO-NEW`).
- [x] **Diagnostic content and boundary cases** from `DES-DIAGNOSTICS`:
  - the warning under `NX_RUST_ALLOW_UNSUPPORTED_NX` says that the major is untested;
  - messages carry no error codes (`ADR-NO-ERROR-CODES`);
  - every diagnostic names a remedy;
  - the override changed while a daemon runs (`EVD-NX-24-SETUP`);
  - a negative case for the directory warning in which only `.gitignore` covers the directory;
  - an explicit fixture for a collision with another plugin's project (`DES-PROJECT-GRAPH`);
  - a direct count of cargo calls with an unsupported Cargo.
- [x] **Cross-references** from `VER-SETUP` to `VER-TESTING` and `VER-ARTIFACTS`, which check two task-time diagnostics of `DES-DIAGNOSTICS`: an invalid `NX_RUST_TEST_MODE` and mismatched `wasm-bindgen` versions. Settled without a reference: see the summary.

Done when: `VER-SETUP` covers each point above, the user has agreed to any change in what it requires, and `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation.

## Summary of Changes

`VER-SETUP` gained a check only where an implementation that breaks a stated promise of `DES-GENERATORS`, `DES-DIAGNOSTICS` or `DES-PROJECT-GRAPH` could pass it before. Each new check follows a promise those design items already make, so what the product is required to do did not change. The control plane agreed on the maintainer's behalf, also to the remedy requirement, and decided against the cross-references and for cargo's own line as the remedy of the lockfile task in locked mode.

Stop before writing:
- `VER-SETUP` now requires that a failing `init` changes no file of the repository, not only `nx.json`, also for the Nx-internals failure, and that a second run on an `nx.json` that lists the plugin without the executors' empty entries stops all the same.
- Already covered: every failing `init` case in `init.spec.ts` (`expectStopped`, the missing cargo, `targetNames`, `namePrefix` and `cargo metadata` cases) and the `init` cases in `target-defaults.spec.ts` compared every file of the repository before and after.
- Added: the Nx-internals cases in `init.spec.ts` compare the files on disk as well as Nx's file tree, and the new case "stops a second run on an nx.json that lists the plugin without the executors' entries, and writes nothing".
- Rejected: watching modification times to catch a write that is then rolled back. The issue allowed asserting that nothing changed instead, and `init` writes through Nx's tree, which Nx does not flush after a failing generator.

Generator mechanics and fixtures (`crate-generators.spec.ts`):
- Already tested, now stated in `VER-SETUP`: `directory` required and first positional, with `name` and `edition` optional (the schema test); no `cargo new` when `exclude` matches (`cargoNewCalls` is empty); an omitted `name` and cargo's default edition (the first test runs `cargo new` without them, in a workspace without `[workspace.package]`).
- Added: "go by the nearest workspace where one lies in the folder of another", where the outer workspace's `exclude` matches the folder and the crate joins the inner workspace only.
- Added: no `CREATE`, `UPDATE` or `DELETE` line from Nx in a normal run and with `--dry-run`, so the generator writes nothing through Nx's tree. A temporary `tree.write` in the generator made three tests fail.
- Added: cargo's "Adding `part` as member" line where the manifest had no `members`.
- Added: "leave the fields of [workspace.package] and the lints of [workspace.lints] to cargo, as cargo new does", which compares the repository with plain `cargo new` and asserts `license`, `rust-version`, `[lints]` and cargo's default edition.

Diagnostic content:
- Already tested, now stated in `VER-SETUP`: the warning that the Nx major has not been checked (`compatibility.spec.ts`, `init.spec.ts`); the variable changing while a daemon runs ("follows NX_RUST_ALLOW_UNSUPPORTED_NX as it changes while the Nx daemon creates the graph"); exactly one more `cargo --version` with an older Cargo (`compatibility.spec.ts`, `init.spec.ts`); no directory warning where only `.gitignore` covers the directory (`cargo-directories.spec.ts`).
- Collision with another plugin's project: graph creation was already tested (`graph.spec.ts`, "leave a collision of %s with a JS project to Nx's own error", which `VER-GRAPH` states). `VER-SETUP` now requires `init` to stop for it, and a new `init.spec.ts` case checks that.
- No error codes: `VER-SETUP` requires that no diagnostic carries one. The new `error-codes.spec.ts` scans every string and template literal in `nx-rust/src` for a code-shaped token (such as `NXR001`, `E0001` or `NXR-001`) where a message would carry it: before a colon, in brackets, after "error" or "warning", or at the start before a dash. Positive and negative examples cover the pattern: `ISO8601`, `UTF8`, `SHA256` and version-like words pass. A code added to a real message made it fail. After review, the first scan, which flagged such a token anywhere in a string, was narrowed to this.
- Remedies: `VER-SETUP` requires that each message it names says what the user can do. Assertions added for the failing `cargo metadata` and the missing toolchain (`init.spec.ts`, `missing-toolchain.spec.ts`); the `targetNames` collision, inputs without `"..."` and an unknown key in the plugin options (`init.spec.ts`); `executor` or `command` on an inferred target, `!` in `implicitDependencies` and `affectedTests` in stored configuration (`configuration.spec.ts`); the target-default error and warning in `init` (`target-defaults.spec.ts`); a path dependency that Nx cannot see (`caching.spec.ts`); shared and outside artifact directories (`caching-runs.spec.ts`); redirections from outside the repository and an unreported redirected crate (`redirections.spec.ts`); and the lockfile task in locked mode, through cargo's own help line (`lockfile-runs.spec.ts`).
- Remedies that tests already asserted: cargo missing from `PATH`, the Cargo and Nx versions, name collisions, unknown keys and options, `pluginVersion`, the Nx internals, missing tools, a target that was not inferred, per-workspace settings, the Cargo directory warning, a workspace without a lockfile task, and `targetNames` keys.
- `fileInputs` (#49, merged into this branch): `declared-files.spec.ts` asserts the full message of each of its three errors, remedy included, and the `init` cases in `init.spec.ts` now assert the remedy as well. The messages that #50 added (a missing tool at task start, the Nx and redirection warnings repeated at task start) carry the remedies asserted above; #53 adds no message.
- Not testable yet: `affectedTests` without nextest and the cargo-affected warning, which are not implemented; their own issues bring their tests.
- Filed: bug nxr-vqnsn1, because the warning about an included configuration file that is no valid TOML names no remedy, and nxr-wwm6br for the remedies of diagnostics that only other verification items name.

Cross-references: not added. `VER-TESTING` ("any other value fails the task") and `VER-ARTIFACTS` ("fails with a message that names both versions") already check both diagnostics, so a reference from `VER-SETUP` would add no check. Their remedies are part of nxr-wwm6br.

Checks run:
- `pnpm nx run-many -t build lint test`: 29 suites, 823 tests passed, 1 todo.
- `pnpm nx format:check --all`: passed.
- `mara schema validate`: valid.
- `mara project validate`: `valid: true`, complete evaluation, no errors or warnings, 20 of 20 policies passed.
- `zban check`: no findings.
- The end-to-end suite did not run: neither product code nor the suite changed.

After merging `origin/main` at bd9ceae, these checks ran again, one after another:
- The ten changed spec files with every `CLAUDE*`, `CODEX*` and `AI_AGENT` variable removed: 315 tests passed.
- `pnpm nx run-many -t build lint test`: 30 suites, 860 tests passed, 1 todo.
- `pnpm nx format:check --all`: passed.
- `mara schema validate`: valid.
- `mara project validate`: `valid: true`, complete evaluation.
- `zban check`: no findings.

After review (merging `origin/main` at 2765657, #54, whose messages add none and whose new toolchain case asserts its advice), these checks ran again, one after another:
- The ten changed spec files with `CI=true GITHUB_ACTIONS=true` and every `CLAUDE*`, `CODEX*` and `AI_AGENT` variable removed: 343 tests passed.
- `pnpm nx run-many -t build lint test`: 30 suites, 889 tests passed, 1 todo.
- `pnpm nx format:check --all`: passed.
- `mara schema validate`: valid.
- `mara project validate`: `valid: true`, complete evaluation.
- `zban check`: no findings.
