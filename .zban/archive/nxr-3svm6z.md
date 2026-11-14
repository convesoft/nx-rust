---
title: Specify where build outputs lie when Cargo's configuration picks the target triple
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T13:38:50Z
closed_at: 2026-11-13T22:45:09Z
---

Goal: `DES-OUTPUTS` names the folder of `build`'s final artifacts for every way a triple can be chosen.

`EVD-CARGO-DEP-INFO` ("Where such names fall short") shows that `build.target` in `.cargo/config.toml` sends a plain `cargo build -p <crate>` to `<artifact directory>/<triple>/<profile>` without any `--target` flag, as `CARGO_BUILD_TARGET` does. `DES-OUTPUTS` and `DES-FEATURE-SETS` say only that outputs lie in the artifact directory and that the triple is a target option, so declared outputs could point at `<artifact directory>/<profile>` while cargo writes elsewhere. `DES-BUILD-INPUT-CHECK` works around the same question by skipping such records; the outputs cannot be skipped.

- [x] Decide with the user how the plugin learns a triple set in Cargo's configuration (for example by reading the configuration files Cargo reads in the workspace root, or by rejecting such a setting), and what happens with `build.target` as a list
- [x] Update `DES-OUTPUTS` (and `DES-BUILD-INPUT-CHECK` if the answer lets the check read those records too), with the verification the policies then require
- [x] Until this is specified, nxr-fy4t4k keeps nothing cached that it cannot name: `build` and `doc` of a workspace whose Cargo configuration sets `build.target` are inferred uncached with a warning (`uncachedReason` in `nx-rust/src/graph/outputs.ts`, the file from `buildTargetFiles` in `nx-rust/src/cargo/redirections.ts`), and the executor fails a cached `build` or `doc` whose triple `CARGO_BUILD_TARGET` chooses (`taskInvocation` in `nx-rust/src/executors/task.ts`). The answer here may replace both rules with outputs in the triple's folder; change the "Paths" paragraph of `DES-OUTPUTS`, its rows in `DES-DIAGNOSTICS` and the cases in `VER-CARGO-UNCHANGED` with it

Done when: the user has agreed to the answer, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

The maintainer agreed on 13 November 2026, choosing the option "Follow cargo: cache with the right folder": the plugin reads the triple that Cargo's configuration or environment picks and declares the outputs in that triple's folder, so `build` and `doc` stay cached; for `build.target` as a list, outputs lie in each triple's folder. This replaces the interim rules of nxr-fy4t4k. The decision is `ADR-TRIPLE-OUTPUTS`.

- Evidence first: `EVD-CARGO-TRIPLE-FOLDERS` records, with cargo 1.100.0 and 1.91.0 (and 1.89 to 1.99 for `include`), where `build` and `doc` write for `--target`, `CARGO_BUILD_TARGET` and `build.target` as a string and a list, with and without profiles, with the host's own triple, `host-tuple`, empty values, several files, the Cargo home and `include`, and their precedence. It also records that cargo has no stable command that reports the triples, and what Nx 24.0.6 does with such outputs: it hashes them with the project's configuration, counts equal outputs once, and interpolates no environment variable into them.
- `DES-OUTPUTS` ("Paths" and three new paragraphs) now names each picked triple's folder behind the `targetTriple` option. It reads `CARGO_BUILD_TARGET` from the graph's environment and fails a cached task before cargo runs when only the task's environment picks other triples. It leaves `build` and `doc` uncached where it cannot name the folder (`host-tuple`, target specification files, a `build.target` set only through `include`), and says how the key follows each way.
- Also updated: the two triple rows of `DES-DIAGNOSTICS`, the triple cases of `VER-CARGO-UNCHANGED`, points 1 and 2 of `DES-BUILD-INPUT-CHECK` with the matching case of `VER-BUILD-INPUT-CHECK` (the check now reads the records in the configured triples' folders; design text only, the check itself is nxr-agyqmz), the `Options` row of `DES-INPUTS`, `DES-FEATURE-SETS`, `DES-DISCOVERY`, and the guide text of `caching.mara.md` and `setup.mara.md`.
- The implementation is in the same pull request, as nxr-1x4a2k. A related bug in the `targetTriple` option itself is nxr-qdedbc.

Checks: `mara schema validate` and `mara project validate` report `valid: true` with complete evaluation, 0 errors and 0 warnings.
