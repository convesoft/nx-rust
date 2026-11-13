---
title: Detect a shared artifact directory that cargo reports through ..
status: in-progress
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-7vmkx2
created_at: 2026-11-13T18:42:20Z
---

Goal: two workspaces whose artifact directories are the same folder count as sharing it, as the row of `DES-DIAGNOSTICS` and `DES-OUTPUTS` say for an artifact directory that two or more workspaces share, however cargo spells the path.

Context: `cargo metadata` does not normalise a relative `build.target-dir`. In `two-workspaces` with `tools/.cargo/config.toml` holding `[build]` `target-dir = "../target"`, cargo started in `tools/` reports `target_directory` and `build_directory` as `<repo>/tools/../target`, while the root workspace reports `<repo>/target` (observed with cargo 1.100.0 on 13 November 2026, while working on nxr-7vmkx2). `locateArtifactDirectories` and `artifactDirectoryWarning` in `nx-rust/src/graph/caching.ts` compare the raw `target_directory` strings, so they treat the two as separate: neither workspace gets the warning about the shared directory, and both `doc` targets stay cached, so restoring one workspace's `doc` folder can delete the pages of the other. A shared directory that a root `.cargo/config.toml` sets (`target-dir = "target"`) is reported with the same spelling for both and is detected. nxr-7vmkx2's `unignoredDirectoryWarnings` compares the paths relative to the repository root, which `path.relative` normalises.

- [ ] Compare the artifact directories by a normalised path, also where `CARGO_TARGET_DIR` or a configuration gives one through `..` or a symbolic link, and check the other places that compare `target_directory` or `build_directory` as strings
- [ ] A test with `two-workspaces` and `target-dir = "../target"` in `tools/.cargo/config.toml`: the warning about the shared directory for both workspaces, and `doc` uncached in both
