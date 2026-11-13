---
title: Specify build outputs for the profiles dev, test and bench given by name
status: todo
type: task
tags:
  - spec
parent: nxr-w9qa5f
related:
  - nxr-3svm6z
discovered_from: nxr-fy4t4k
created_at: 2026-11-13T16:02:41Z
---

Goal: `DES-OUTPUTS` names the folder of `build`'s final artifacts for every value of the `profile` option, so that a cache hit on `build` restores the files that the run wrote.

Context: nxr-fy4t4k declares `build`'s outputs as `<artifact directory>/{options.targetTriple ?? .}/{options.profile ?? debug}/<file>` (the "Paths" paragraph of `DES-OUTPUTS`, `targetOutputs` in `nx-rust/src/graph/outputs.ts`). Nx interpolates outputs from the task's options and has no way to map one value to another (`EVD-NX-24-INPUTS-OUTPUTS`). Cargo writes the profiles `dev` and `test` to `debug` and `bench` to `release` (`DES-BUILD-INPUT-CHECK`, point 1). So `nx build api --profile=dev`, `--profile=test` or `--profile=bench` declares a folder that cargo never writes: Nx stores no artifact, and a later cache hit restores none. No wrong file is stored. Without the option, and for `release` or a custom profile, the outputs are right.

Options for the maintainer:

- Accept and document it: those three names are rare on `build`, and `dev` is the default anyway. Cheapest; the cache hit stays wrong for them.
- Reject `profile` values `dev`, `test` and `bench` on `build` and `doc` with a message that names the equivalent (no option, or `release`), at graph creation for stored configuration and in the executor for the command line. Recommended: it keeps outputs exact and costs one check.
- Have the executor pass `--profile` with the value Cargo writes to (`dev` for `debug`), which changes nothing for `test` and `bench`, whose settings differ from `dev` and `release`.

- [ ] Decide with the user and record the answer in `DES-OUTPUTS` (and `DES-DIAGNOSTICS` if it adds a message)
- [ ] Implement it, with a test in `nx-rust/test/caching.spec.ts`

Done when: the user has agreed to the answer, the items are accepted and implemented, and `mara schema validate`, `mara project validate`, `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
