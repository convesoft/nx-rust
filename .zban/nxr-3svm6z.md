---
title: Specify where build outputs lie when Cargo's configuration picks the target triple
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-qv2cq5
created_at: 2026-11-13T13:38:50Z
---

Goal: `DES-OUTPUTS` names the folder of `build`'s final artifacts for every way a triple can be chosen.

`EVD-CARGO-DEP-INFO` ("Where such names fall short") shows that `build.target` in `.cargo/config.toml` sends a plain `cargo build -p <crate>` to `<artifact directory>/<triple>/<profile>` without any `--target` flag, as `CARGO_BUILD_TARGET` does. `DES-OUTPUTS` and `DES-FEATURE-SETS` say only that outputs lie in the artifact directory and that the triple is a target option, so declared outputs could point at `<artifact directory>/<profile>` while cargo writes elsewhere. `DES-BUILD-INPUT-CHECK` works around the same question by skipping such records; the outputs cannot be skipped.

- [ ] Decide with the user how the plugin learns a triple set in Cargo's configuration (for example by reading the configuration files Cargo reads in the workspace root, or by rejecting such a setting), and what happens with `build.target` as a list
- [ ] Update `DES-OUTPUTS` (and `DES-BUILD-INPUT-CHECK` if the answer lets the check read those records too), with the verification the policies then require
- [ ] Until this is specified, nxr-fy4t4k keeps nothing cached that it cannot name: `build` and `doc` of a workspace whose Cargo configuration sets `build.target` are inferred uncached with a warning (`uncachedReason` in `nx-rust/src/graph/outputs.ts`, the file from `buildTargetFiles` in `nx-rust/src/cargo/redirections.ts`), and the executor fails a cached `build` or `doc` whose triple `CARGO_BUILD_TARGET` chooses (`taskInvocation` in `nx-rust/src/executors/task.ts`). The answer here may replace both rules with outputs in the triple's folder; change the "Paths" paragraph of `DES-OUTPUTS`, its rows in `DES-DIAGNOSTICS` and the cases in `VER-CARGO-UNCHANGED` with it

Done when: the user has agreed to the answer, the items are accepted, and `mara schema validate` and `mara project validate` report `valid: true`.
