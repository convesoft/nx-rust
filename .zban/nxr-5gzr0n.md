---
title: Name build outputs where cargo writes them when a link and .. spell the artifact directory
status: todo
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-zz36hb
created_at: 2026-11-13T19:47:57Z
---

Goal: the `build` and `doc` outputs of a workspace name the folder that cargo actually writes to, also where the artifact directory is spelled through a symbolic link followed by `..` (`DES-OUTPUTS`, `GOAL-TRUSTED-CACHE`).

Context: `locateArtifactDirectories` in `nx-rust/src/graph/caching.ts` derives the outputs' `path` with `path.relative(repositoryRoot, target_directory)`, which resolves `..` as text. Where a link comes before the `..`, that is not where cargo writes. In the review case of nxr-zz36hb (`two-workspaces`, root `.cargo/config.toml` with `target-dir = "deep/target"`, `tools/.cargo/config.toml` with `target-dir = "link/../target"`, and `tools/link -> ../deep/child`), cargo writes the `tools` workspace's files to `deep/target`. On 13 November 2026 with Nx 24 and cargo 1.100.0, the graph named that directory `tools/target` in the warning about the shared directory. By the code, the `build` outputs of `tools` therefore name `{workspaceRoot}/tools/target/...`, so a cached `build` stores no binary and a cache hit restores none. The outputs and the restore were not run. Since nxr-zz36hb, `artifactDirectorySharers` already compares the physical path (`physicalPath` in `real-path.ts`), so sharing is detected. Only the output paths and the shown path are affected.

Open for the maintainer: name the outputs by the physical path relative to the repository's real path, or leave such a workspace's `build` and `doc` uncached. Also, what to do when the physical path lies outside the repository although the text path lies inside, or the other way round.

- [ ] Decide in Mara (`DES-OUTPUTS`) which path the outputs use where the text path and the physical path differ
- [ ] A test with the review case above: `tools:build` restored from the cache puts the binary back where cargo writes it, or runs uncached, as decided
