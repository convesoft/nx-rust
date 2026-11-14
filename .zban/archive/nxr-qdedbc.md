---
title: Name the right folder, or refuse, when the targetTriple option is host-tuple or a target specification file
status: done
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-3svm6z
created_at: 2026-11-13T22:34:06Z
closed_at: 2026-11-14T09:03:15Z
---

Goal: a cached `build` or `doc` whose `targetTriple` option is `host-tuple` or the path of a target specification file stores the artifacts that cargo writes, or does not run.

`EVD-CARGO-TRIPLE-FOLDERS` shows that `cargo build --target host-tuple` writes to the folder of the host's triple, and cargo names the folder of a `.json` specification after the file. The outputs of `DES-OUTPUTS` interpolate the option as text (`{options.targetTriple ?? …}`), so with `--targetTriple=host-tuple` they name `target/host-tuple/...`, Nx stores no artifact, and a later cache hit reports a success without restoring one. nxr-1x4a2k treats the same values as triples that cannot be named where Cargo's configuration or `CARGO_BUILD_TARGET` picks them, but not where the option gives them.

- [x] Decide with the user: reject such option values on a cached `build` or `doc` before cargo runs (as the profiles `dev`, `test` and `bench` are), or name the host's folder for `host-tuple` (decided by the control plane: reject)
- [x] Update `DES-OUTPUTS`, the task-time row of `DES-DIAGNOSTICS` and `VER-CARGO-UNCHANGED`
- [x] Implement it in the executor (`nx-rust/src/executors/task.ts`), with a run of the real Nx

Done when: the case added to `VER-CARGO-UNCHANGED` passes, and `pnpm nx run-many -t build lint test` and `pnpm nx format:check --all` pass.

## Summary of Changes

Decision: reject. This was the control plane's decision under `GOAL-TRUSTED-CACHE`, applying the triple rule that the maintainer was told on 14 November 2026 and did not object to, as closely as an option value allows. It is recorded in `ADR-TRIPLE-OUTPUTS`, which also rejects naming the host's folder: Nx puts the option's text into the outputs.

- A cached `build` or `doc` whose `targetTriple` option is `host-tuple`, or ends in `.json` (a target specification file), fails before cargo runs (`optionTripleReason` in `target-triples.ts`, `checkOptionTriple` in `task.ts`).
- The message names the option and its value and says that the plugin cannot name the folder that cargo writes to for it. For `host-tuple` it names the host's triple from `rustc -vV` in the workspace root, as `--targetTriple=<host>`. For a specification file it says to build with a built-in triple or to set `cache = false` in the target's table or `project.json`.
- An uncached run passes the value to cargo.
- `DES-OUTPUTS` has a new paragraph "Option values that cannot be named". `DES-DIAGNOSTICS` has the task-start row. `VER-CARGO-UNCHANGED` has the case and the guide on the caching page has the rule.
- Tests in `artifact-folders.spec.ts` run the real Nx: `host-tuple` on `cli:build` and `rust:doc` fails with the message and no cargo call, and `--targetTriple=<host>` then builds. `specs/custom.json` fails with its message. With `cache = false` on `build`, `host-tuple` reaches cargo as `--target host-tuple`.

Checks run: `pnpm nx run-many -t build lint test` (1002 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), `mara schema validate` and `mara project validate` (valid, evaluation complete), and `zban check`.
