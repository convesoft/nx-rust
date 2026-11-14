---
title: Name the right folder, or refuse, when the targetTriple option is host-tuple or a target specification file
status: in-progress
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-3svm6z
created_at: 2026-11-13T22:34:06Z
---

Goal: a cached `build` or `doc` whose `targetTriple` option is `host-tuple` or the path of a target specification file stores the artifacts that cargo writes, or does not run.

`EVD-CARGO-TRIPLE-FOLDERS` shows that `cargo build --target host-tuple` writes to the folder of the host's triple, and cargo names the folder of a `.json` specification after the file. The outputs of `DES-OUTPUTS` interpolate the option as text (`{options.targetTriple ?? …}`), so with `--targetTriple=host-tuple` they name `target/host-tuple/...`, Nx stores no artifact, and a later cache hit reports a success without restoring one. nxr-1x4a2k treats the same values as triples that cannot be named where Cargo's configuration or `CARGO_BUILD_TARGET` picks them, but not where the option gives them.

- [ ] Decide with the user: reject such option values on a cached `build` or `doc` before cargo runs (as the profiles `dev`, `test` and `bench` are), or name the host's folder for `host-tuple`
- [ ] Update `DES-OUTPUTS`, the task-time row of `DES-DIAGNOSTICS` and `VER-CARGO-UNCHANGED`
- [ ] Implement it in the executor (`nx-rust/src/executors/task.ts`), with a run of the real Nx

Done when: the case added to `VER-CARGO-UNCHANGED` passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.
