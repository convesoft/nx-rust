---
title: Handle a dotenv file that moves a task's artifact directory
status: done
type: task
tags:
  - spec
parent: nxr-w9qa5f
discovered_from: nxr-0haa7z
created_at: 2026-11-13T15:20:23Z
closed_at: 2026-11-14T09:03:26Z
---

Goal: a `build` or `doc` result is never stored or restored with artifacts other than the ones its task produced, when a dotenv file that Nx loads for the task sets Cargo's artifact or build directory.

Concerns `DES-OUTPUTS`, `DES-BUILD-DIRS` and `REQ-CACHE-OUTPUTS` (`nx-rust/docs/caching.mara.md`), `DES-METADATA-REPORT` (`nx-rust/docs/workspaces.mara.md`), `DES-DIAGNOSTICS` (`nx-rust/docs/setup.mara.md`), `RISK-NX-INPUT-SEMANTICS` and `GOAL-TRUSTED-CACHE`.

Observed while researching nxr-0haa7z on 2026-11-13, with cargo 1.98.1, not yet recorded as evidence: with `CARGO_TARGET_DIR` set, `cargo build` wrote the binary into that folder, and with `CARGO_TARGET_DIR` and `CARGO_BUILD_BUILD_DIR` set, `cargo metadata --no-deps` reported both folders. Graph creation runs without the dotenv files of a crate's folder and of a target or configuration, such as `.env.build`, so the outputs it declares would name the workspace's usual artifact directory while the task writes elsewhere. Not tried: what Nx then stores for the task, possibly an older file at the declared path, and what it restores. `CARGO_BUILD_TARGET_DIR` should act like `CARGO_TARGET_DIR`.

- [x] Reproduce with Nx 24 and record the result as an evidence item
- [x] Propose to the maintainer how the plugin handles it, for example a warning, or the executor comparing the folders under the task's environment with those of the graph, and update the items (decided by the control plane, see the summary)
- [x] Extend the verification that the Mara policies then require

Done when: the maintainer has decided, the items say what happens, and `mara schema validate` and `mara project validate` report `valid: true`.

## Summary of Changes

Closed in the pull request of nxr-3tf0pz, on the control plane's decision. The decision is consistent with how pull request #59 treats a triple that only a crate's `.env` picks: a cached `build` or `doc` fails rather than caching a folder that graph creation cannot see. It is recorded in `ADR-ARTIFACT-DIR-OUTPUTS`.

- **Evidence.** The research report's Question B (14 November 2026, Nx 24.0.6) is recorded in `EVD-NX-24-MOVED-ARTIFACT-DIRS`: the outputs for each dotenv file, the four steps that restored `app v1` for source v2, the `doc` run, the hash rows, and the three findings about the build input check. My own runs with the fix are recorded there too.
- **The executor (rule 1).** A cached `build` or `doc` whose task environment (dotenv files included) makes cargo report another artifact directory fails before cargo builds. The message names both folders and the variables (`CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`, `CARGO_HOME`) and says to set them in the `nx` command's environment, in the root `.env`, or as `build.target-dir` in `.cargo/config.toml`. The directory comes from `cargo metadata --no-deps` with the task's environment.
- **The key (rule 2).** The artifact input prints the directory with the task's environment, so the key of a cached `build` and `doc` follows such a file. `VER-CACHE-KEYS` now says that `CARGO_TARGET_DIR` in a crate's `.env` changes the key of that crate's `build`, and of nothing else. `cache-keys.spec.ts` checks it.
- **The build input check (rule 3).** The check takes the build and artifact directories that cargo reports for the task. The graph's record source no longer carries them.
- **Tests with the real Nx.** In `artifact-folders.spec.ts`: the four-step sequence ends with the v2 binary and nothing of v1 restored. The variable in a crate's `.env`, a root `.env.build`, the `.env.fast` of a selected configuration, the workspace folder's `.env`, and a root `.env.doc` setting `CARGO_HOME` each fail before cargo builds and name both folders. A root `.env` caches `build` and `doc` in its folder. A broken Cargo home that only the `.env` names fails with cargo's message. In `build-input-check.spec.ts`: `CARGO_BUILD_BUILD_DIR=bd` in the crate's `.env` with an `OUT_DIR` include fails nothing.
- **Not done (rule 5).** Following the dotenv file at graph creation (design B2) is not done, and no issue was filed for it. `VER-SETUP` covers only graph-time errors, so it needed no row.

Checks run: `pnpm nx run-many -t build lint test` (1002 passed, 1 todo), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 passed), `mara schema validate` and `mara project validate` (valid, evaluation complete, no warnings), and `zban check`.
