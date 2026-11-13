---
title: Detect a shared artifact directory that cargo reports through ..
status: done
type: bug
parent: nxr-w9qa5f
discovered_from: nxr-7vmkx2
created_at: 2026-11-13T18:42:20Z
closed_at: 2026-11-13T19:39:59Z
---

Goal: two workspaces whose artifact directories are the same folder count as sharing it, as the row of `DES-DIAGNOSTICS` and `DES-OUTPUTS` say for an artifact directory that two or more workspaces share, however cargo spells the path.

Context: `cargo metadata` does not normalise a relative `build.target-dir`. In `two-workspaces` with `tools/.cargo/config.toml` holding `[build]` `target-dir = "../target"`, cargo started in `tools/` reports `target_directory` and `build_directory` as `<repo>/tools/../target`, while the root workspace reports `<repo>/target` (observed with cargo 1.100.0 on 13 November 2026, while working on nxr-7vmkx2). `locateArtifactDirectories` and `artifactDirectoryWarning` in `nx-rust/src/graph/caching.ts` compare the raw `target_directory` strings, so they treat the two as separate: neither workspace gets the warning about the shared directory, and both `doc` targets stay cached, so restoring one workspace's `doc` folder can delete the pages of the other. A shared directory that a root `.cargo/config.toml` sets (`target-dir = "target"`) is reported with the same spelling for both and is detected. nxr-7vmkx2's `unignoredDirectoryWarnings` compares the paths relative to the repository root, which `path.relative` normalises.

- [x] Compare the artifact directories by a normalised path, also where `CARGO_TARGET_DIR` or a configuration gives one through `..` or a symbolic link, and check the other places that compare `target_directory` or `build_directory` as strings
- [x] A test with `two-workspaces` and `target-dir = "../target"` in `tools/.cargo/config.toml`: the warning about the shared directory for both workspaces, and `doc` uncached in both

## Summary of Changes

- `cacheContext` (`nx-rust/src/graph/caching.ts`) now works out once which workspaces share an artifact directory (`artifactDirectorySharers`). Both the `shared` flag and the warning use that result. Two reported paths count as one folder when they agree after `path.resolve`, which handles `.`, `..` and a trailing separator as text, or after `physicalPath` (new in `real-path.ts`), which follows symbolic links the way the system does, including a link to a folder that does not exist yet. Either match counts, so a doubtful case leaves `doc` uncached.
- Other places that read the paths: `unignoredDirectoryWarnings` and `init`'s report use `path.relative`, which already handles `..` and a trailing separator, and neither one decides caching. They are unchanged.
- Mara: `DES-OUTPUTS` now says how reports are compared. `EVD-CARGO-DIRECTORIES` records how cargo 1.100.0 spells the directory (`..`, a trailing separator and a dangling link are all kept, and `metadata` creates nothing) and now supports `DES-OUTPUTS`. `VER-CARGO-UNCHANGED` names the new cases.
- Test: the shared-directory test in `caching.spec.ts` now has three rows: a root config, `target-dir = "../target"` in `tools/.cargo/config.toml`, and a dangling `tools/target -> ../target` link. Each row checks that `doc` is uncached in both workspaces and that each one's warning names the other. Without the fix, the `..` and link rows fail.
- Harm reproduced with the real Nx 24 in `two-workspaces` with `../target`. Before the fix, both `doc` targets were cached with no warning, and a cache hit on `cargo-workspace:doc` deleted `target/doc/tools` and `target/doc/scaffold`. After the fix, both run uncached with the warning, and both workspaces' pages survive. `build` restores in the shared directory replace only their own files. Where both workspaces have a binary `app`, each restore puts back the file that the same task writes with `--skip-nx-cache`, so `build` needs no change.
- Filed nxr-xrfd50. With a workspace's root manifest excluded, graph creation runs `cargo metadata` in a member's folder, while tasks run in the workspace root, so the two can see different artifact directories.

Checks: `pnpm nx run-many -t build lint` (also with `--skip-nx-cache`), then `pnpm nx test nx-rust --maxWorkers=3` (24 suites, 733 tests; run in place of `run-many -t test` because the machine is short of memory), `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache` (27 tests), `mara schema validate` and `mara project validate` (valid, evaluation complete, no diagnostics), and `zban check`. All passed.
