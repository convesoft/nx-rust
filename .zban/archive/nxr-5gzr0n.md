---
title: Name build outputs where cargo writes them when a link and .. spell the artifact directory
status: done
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-zz36hb
created_at: 2026-11-13T19:47:57Z
closed_at: 2026-11-13T21:14:45Z
---

Goal: the `build` and `doc` outputs of a workspace name the folder that cargo actually writes to, also where the artifact directory is spelled through a symbolic link followed by `..` (`DES-OUTPUTS`, `GOAL-TRUSTED-CACHE`).

Context: `locateArtifactDirectories` in `nx-rust/src/graph/caching.ts` derives the outputs' `path` with `path.relative(repositoryRoot, target_directory)`, which resolves `..` as text. Where a link comes before the `..`, that is not where cargo writes. In the review case of nxr-zz36hb (`two-workspaces`, root `.cargo/config.toml` with `target-dir = "deep/target"`, `tools/.cargo/config.toml` with `target-dir = "link/../target"`, and `tools/link -> ../deep/child`), cargo writes the `tools` workspace's files to `deep/target`. On 13 November 2026 with Nx 24 and cargo 1.100.0, the graph named that directory `tools/target` in the warning about the shared directory. By the code, the `build` outputs of `tools` therefore name `{workspaceRoot}/tools/target/...`, so a cached `build` stores no binary and a cache hit restores none. The outputs and the restore were not run. Since nxr-zz36hb, `artifactDirectorySharers` already compares the physical path (`physicalPath` in `real-path.ts`), so sharing is detected. Only the output paths and the shown path are affected.

Open for the maintainer: name the outputs by the physical path relative to the repository's real path, or leave such a workspace's `build` and `doc` uncached. Also, what to do when the physical path lies outside the repository although the text path lies inside, or the other way round.

- [x] Decide in Mara (`DES-OUTPUTS`) which path the outputs use where the text path and the physical path differ
- [x] A test with the review case above: `tools:build` restored from the cache puts the binary back where cargo writes it, or runs uncached, as decided

## Summary of Changes

The control plane decided the open question, on the basis of `GOAL-TRUSTED-CACHE`, `ADR-WORKSPACE-ROOT` and `DES-OUTPUTS` (outputs must name where the files are): where the path that cargo reports and the physical path differ, the outputs name the physical path, relative to the repository's real path, using `physicalPath` (`real-path.ts`) as the shared-directory check does. A physical path outside the repository leaves `build` and `doc` uncached with the existing warning, also when the text path lies inside; a physical path inside counts as inside, also when the text path lies outside. The warnings name the physical path. Recorded in `DES-OUTPUTS` and in the user guidance of `caching.mara.md`; `VER-CARGO-UNCHANGED` names the checks.

Reproduced first with the real Nx on `main` (ab21f45), in `two-workspaces` with the review case (root `target-dir = "deep/target"`, `tools` `target-dir = "link/../target"`, `tools/link -> ../deep/child`): `nx run tools:build` was cached and wrote `deep/target/debug/tools`; after deleting the binary, a second run was a cache hit and restored nothing, because the outputs named `tools/target/...`. The shared-directory warning named `tools/target`.

Code: `caching.ts` computes the reached folder of each workspace's artifact directory once (`reachedArtifactDirectories`) and uses it for the sharing check, for `locateArtifactDirectories` (relative to the repository's real path) and for both warnings.

Tests: `caching.spec.ts` (the shared-directory cases now check that the warning and the `build` outputs of `app` and `tools` name the reached folder; a link inside the repository that leads outside leaves `tools:build` and `tools:doc` uncached with the warning naming the folder outside; a link outside that leads inside caches them with outputs inside); `caching-runs.spec.ts` (the review case with the real Nx: the cache hit puts the binary back in `deep/target/debug/tools`, and nothing appears in `tools/target`). Each new test failed on the unchanged code and passes now.

The warning about build and artifact directories that Nx does not ignore still judges the text path; that is nxr-x24z1t.

Checks run: `pnpm nx run-many -t build lint test` (28 suites, 829 tests passed), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (30 tests passed), `mara schema validate`, `mara project validate` (valid, evaluation complete) and `zban check`. Merged with `origin/main` at 294b249 before the runs.
