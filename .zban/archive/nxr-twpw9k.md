---
title: Escape glob characters in the real path that a fileInputs pattern resolves to
status: done
type: bug
priority: low
discovered_from: nxr-1by7h4
created_at: 2026-11-14T08:02:42Z
closed_at: 2026-11-14T09:16:20Z
---

Goal: the fileset that `declaredFiles` declares for a pattern names the same folder that the pattern's fixed part resolves to, whatever characters its real path holds.

Found while working on nxr-1by7h4. `declaredFiles` (`nx-rust/src/graph/declared-files.ts`) resolves a pattern's fixed part, the segments before the first one with a glob character, to its real path, symbolic links included, and declares `{workspaceRoot}/<real path>/<rest>` without escaping (`DES-INPUTS`). The fixed part as written has no glob characters, but a link in it can lead to a folder whose name has some, such as `shared/linked -> real[1]` or `gen(old)`. Nx would then read that part as a glob (`partition_glob` in Nx's `native/glob/glob_transform.rs`) and match other files, or none. The filesets that nxr-1by7h4 adds for project folders already escape the folder with a backslash, as the build input check does for the lines it prints.

- [x] Show with a test that a pattern through a link to a folder whose name has `[`, `{` or `(` misses its files in the key today
- [x] Escape the real path as the folder filesets do, and check that Nx 24 reads the escaped path as literal
- [x] Note it in `DES-INPUTS`

Done when: the test passes, `DES-INPUTS` says how the path is written, and `pnpm nx run-many -t build lint test` passes.

## Summary of Changes

Fixed in the pull request of nxr-1by7h4 (#64), at the control plane's request, because the maintainer asked that findings belonging to the task they were found in be fixed there.

`declaredFiles` now escapes, with a backslash, each character of the resolved real path that Nx reads as glob syntax: `*`, `?`, brackets, braces, parentheses and the backslash. This applies to the paths of the links that the pattern passes as well, the same way the folder filesets of nxr-1by7h4 already did. `DES-INPUTS` says so, and `VER-CACHE-KEYS` names the case.

New tests in `declared-files.spec`: a pattern through a link to `shared/real[1]`, `shared/gen{x}` or `shared/old(1)`. For each, a change to the file there changes the keys of `check`, `lint`, `test`, `build` and `doc`, and `nx affected` selects the tasks, after a commit and with `--files`. With the escape switched off, all three tests failed; with it, Nx reads the escaped path as literal and they pass.

Checks: `declared-files.spec` and `build-input-check.spec`, `pnpm nx run-many -t build lint test`, `pnpm nx format:check --all`, `pnpm nx e2e nx-rust-e2e --skip-nx-cache`, `mara schema validate`, `mara project validate` and `zban check`, as listed in #64.
