---
title: Declare build and doc outputs in the folders of the triples that Cargo's configuration or environment picks
status: done
type: feature
parent: nxr-w9qa5f
discovered_from: nxr-3svm6z
created_at: 2026-11-13T22:18:47Z
closed_at: 2026-11-13T22:46:27Z
---

Goal: `build` and `doc` stay cached where `build.target` in Cargo's configuration or `CARGO_BUILD_TARGET` picks the triple, with outputs in each picked triple's folder, as `DES-OUTPUTS` ("Paths") now specifies. Replaces the interim rules of nxr-fy4t4k: `build` and `doc` inferred uncached where the configuration sets `build.target`, and a cached task failed whenever `CARGO_BUILD_TARGET` picks its triple.

Read `ADR-TRIPLE-OUTPUTS`, `DES-OUTPUTS`, the triple rows of `DES-DIAGNOSTICS`, `EVD-CARGO-TRIPLE-FOLDERS` and the triple cases of `VER-CARGO-UNCHANGED`.

- [x] Read `build.target` from the configuration files that cargo reads in the workspace root, merged as cargo merges them, and add the `CARGO_BUILD_TARGET` of the graph's environment (`nx-rust/src/cargo/`)
- [x] Declare the outputs of `build` and `doc` in each picked triple's folder, falling back to them when a run names no `targetTriple` (`nx-rust/src/graph/outputs.ts`, `caching.ts`)
- [x] Leave `build` and `doc` uncached with a warning where the plugin cannot name the folder, and drop the warning and the guard for `build.target` as such
- [x] Fail a cached `build` or `doc` before cargo runs when the task's environment and the configuration then pick other triples than its outputs name (`nx-rust/src/executors/task.ts`)
- [x] Tests with the real cargo and Nx: outputs, warnings, and runs that store and restore the artifacts for each way a triple is picked

Done when: the triple cases of `VER-CARGO-UNCHANGED` pass, and `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all` and `pnpm nx e2e nx-rust-e2e` pass.

## Summary of Changes

- `nx-rust/src/cargo/target-triples.ts` (new): `pickedTriples` reads `build.target` from the configuration files that cargo reads in the workspace root (`configFiles`, now exported from `redirections.ts`), merged in cargo's order, and applies `CARGO_BUILD_TARGET`. Where reading and ignoring `include` pick differently, and for `host-tuple`, `.json` specifications, empty values and names an output cannot hold, it returns a triple it cannot name. `readRedirections` no longer collects `buildTargetFiles`.
- Discovery records the picked triples per workspace from the graph's environment. `targetOutputs` names `{options.targetTriple ?? <triple>}` for each picked triple, `?? .` for none, and `{options.targetTriple}` for an empty list or a triple it cannot name. Only the last case leaves `build` and `doc` uncached, with the new warning.
- The executor fails a cached `build` or `doc` whose run names no triple before cargo runs. It does so when the task's environment and the configuration files, read again at task start, pick other triples than the metadata (`cargo.triples`) records, or one it cannot name. The old `buildTargetFile` guard became the `tripleProblem` guard.
- Tests: `target-triples.spec.ts` (new) covers the merge rules and compares the named folders with where the real `cargo build` and `cargo doc` write, for 11 ways of picking the host triple. `caching.spec.ts` covers the declared outputs, metadata and warnings. `caching-runs.spec.ts` uses the real Nx: run, delete, run again, and the files come back byte for byte without cargo. It does this for a string, a list naming the host twice, a list of two triples (skipped where the musl target is not installed, as in CI) and `CARGO_BUILD_TARGET` in the nx command's environment. It also covers the failure for a triple set only in a dotenv file of the task, and the `host-tuple` cases. `cargo-directories.spec.ts` and `target-defaults.spec.ts` now provoke the warning with `host-tuple`, and the harness unsets a `CARGO_BUILD_TARGET` from the developer's shell.

Checks run: `pnpm nx run-many -t build lint test` (30 suites, 900 tests passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), the changed spec files once more with `CI=true GITHUB_ACTIONS=true` and the agent variables removed (153 passed), `mara schema validate`, `mara project validate` (valid, complete) and `zban check`.

## Review fix (14 November 2026)

The review of pull request #59 at 8694dea found that with the Nx daemon on, a change to `build.target` in a Cargo configuration file outside the repository (the Cargo home, a folder above the repository, or the setting removed) left both the daemon's graph and the key unchanged. A cache hit then put back the artifacts of the old triple, and the executor's check never ran. The maintainer decided on a runtime input. Changes:

- `nx-rust/src/cargo/print-triples.ts` (new) prints `pickText(pickedTriples(cwd, env))`. `tripleCommand` in `inputs.ts` runs it in the workspace root, one command per workspace (`cd '<workspace>' && '<node>' '<plugin>/src/cargo/print-triples.js'`, with a random value where the script cannot run). `configureCaching` adds it to cached `build` and `doc` only.
- The executor tells a stale graph from a task-only variable. Graph creation records the configuration's own pick (`cargo.configuredPick`); where the configuration alone now picks differently, the cached task fails before cargo runs with a new message: the configuration changed after Nx created the project graph, run `nx reset` or stop the daemon. That message has a new row in `DES-DIAGNOSTICS`.
- `DES-INPUTS` (a `Triples` row), `DES-OUTPUTS` ("Triples that only a task picks", "Keys"), `ADR-TRIPLE-OUTPUTS`, `VER-CARGO-UNCHANGED` (the daemon cases) and `EVD-CARGO-TRIPLE-FOLDERS` ("The daemon", "Runtime inputs") are updated.
- Merged with #57: `nameRecords` takes its triples from the same `pickedTriples`, so the build input check reads the records in each folder that the outputs name. `build-input-check.spec.ts` checks that a cached `build` with `build.target`, or with `CARGO_BUILD_TARGET` from the nx command, fails on an undeclared file there.

Cost of the runtime input. Nx 24.0.6 evaluates it once per task, not once per command line, although the command is the same for every task of a workspace: 6 evaluations for 6 `build`/`doc` tasks of `crate-shapes`, with and without the daemon, in plugin workers and in Nx's process. One evaluation takes about 16 ms, 12 to 14 ms of it starting Node. A fully cached `nx run-many -t build doc` over `two-workspaces` (6 tasks) took a median of 493 and 502 ms with the input, against 464 and 458 ms without it, on a shared machine: about 30 to 45 ms per command, 5 to 7 ms per task.

Checks for this fix: the daemon tests in `caching-runs.spec.ts` pass, and fail with the input removed (cache hits that restore the old triple's artifacts). The changed spec files passed under `CI=true GITHUB_ACTIONS=true` with the agent variables removed. The full checks are listed in the pull request.
