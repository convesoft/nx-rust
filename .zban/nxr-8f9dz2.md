---
title: Implement feature sets and the workspace-build strategy
status: todo
type: feature
parent: nxr-9y4eh8
blocked_by:
  - nxr-s12cpg
  - nxr-ms8zzk
  - nxr-ypa0aw
created_at: 2026-11-12T18:20:01Z
---

Goal: features are resolved for the whole workspace on every run, with the fallback strategy that always works.

Implements `REQ-STABLE-FEATURES`, `DES-FEATURE-SETS` and the `workspace-build` strategy of `DES-UNIFICATION` (`nx-rust/docs/execution.mara.md`). Checked by `VER-BATCHING`.

- [ ] The default and all-features configurations at workspace level
- [ ] `crate/feature` and crates that form their own group
- [ ] `workspace-build`: every step selects the whole workspace with `--workspace` ("How each strategy selects" in `DES-UNIFICATION`)
- [ ] `test` under `workspace-build`, however many tasks the group holds ("Under `workspace-build`" to "The runner program" in `DES-TEST-RUN`): with the `cargo` runner the three steps `cargo test --workspace --no-run`, `cargo test --workspace --tests --no-fail-fast --message-format=json-render-diagnostics` with the selecting runner through `--config 'target.<host>.runner=[…]'`, and `cargo test --workspace --doc --no-fail-fast` without a runner; the runner as a Node script in the package, started by absolute path with the Node that runs the batch implementation, with `NX_RUST_TEST_PACKAGES` as `:a:b:` and the record in `NX_RUST_TEST_RECORD` (a start written before anything else, then a skip, an error or the end), passing cargo's environment on unchanged; the check of the test binaries' step against every `compiler-artifact` message of that command, with no stopping point (a record of each test executable of the package, by real path and package, ending with 0; a `build-finished` that reports a failure, or none; an artifact message of no member; a failed exit of cargo that nothing explains), never against human-readable output; the doctest step's results from cargo's exit status and the failure list that ends its standard error (every task failing where cargo fails without one), with the warning for a failing doctest of a crate outside the group; the two messages of `DES-DIAGNOSTICS`; each task's terminal output without the other crates' blocks; with nextest, `--workspace` with the `package(=…)` filterset and `--no-tests=pass`, no runner, and the same doctest step
- [ ] Detect a runner for the host ("A runner the user configured" in `DES-TEST-RUN`): `CARGO_TARGET_<HOST>_RUNNER`, `runner` under `target.<host>` or a `cfg(` table in the configuration files and the files they include (the walk of `nx-rust/src/cargo/build-settings.ts`), and a file that cannot be read or parsed; such a group's `test` tasks run one crate per command, each saying why, with the case of `VER-TESTING`
- [ ] The `VER-BATCHING` cases "Tests under `workspace-build`", "Evidence for test binaries", "Lines that are not cargo's", "The runner and the check" and "A group left with one task", and the compile error in the tests of a crate outside the selection in a `test` run
- [ ] A non-host triple as its own group, with one cargo command per crate ("Groups of one crate" in `DES-BATCH`, `DES-FEATURE-SETS`), and the `workspace-build` case of "Triples" in `VER-BATCHING`
- [ ] Under `workspace-build`, give every target of a crate that has its digest the digests of all members and the folders of the path crates outside the workspace that any member reaches ("External dependencies", "Crates outside the workspace" and "Whole-workspace builds" in `DES-INPUTS`), and drop the second half of the status note of `nx-rust/docs/caching.mara.md`; name all those digests in the targets' `metadata.cargo.digests`, so that the post-check compares every digest that the key holds ("Post-check" in `DES-LOCKFILE-HASHING`), with the `VER-CACHE-KEYS` case of a change during the run that moves only a sibling's digest
- [ ] Turn the `VER-CACHE-KEYS` cases that hold under `hakari` only since nxr-ms8zzk into the cases that must differ under `workspace-build` in their fixtures: a locked version bump outside the crate's resolved dependencies, also for the crate at the root of its workspace, a change in a redirected crate for a member without registry or git dependencies, and the end-to-end lockfile case, which then runs every crate of the workspace; and add the new `workspace-build` rows (another member's package, a path crate outside the workspace that only another member reaches)

Done when: the parts of the cited verification that cover this work pass, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
