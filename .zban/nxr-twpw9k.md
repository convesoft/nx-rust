---
title: Escape glob characters in the real path that a fileInputs pattern resolves to
status: todo
type: bug
priority: low
discovered_from: nxr-1by7h4
created_at: 2026-11-14T08:02:42Z
---

Goal: the fileset that `declaredFiles` declares for a pattern names the same folder that the pattern's fixed part resolves to, whatever characters its real path holds.

Found while working on nxr-1by7h4. `declaredFiles` (`nx-rust/src/graph/declared-files.ts`) resolves a pattern's fixed part, the segments before the first one with a glob character, to its real path, symbolic links included, and declares `{workspaceRoot}/<real path>/<rest>` without escaping (`DES-INPUTS`). The fixed part as written has no glob characters, but a link in it can lead to a folder whose name has some, such as `shared/linked -> real[1]` or `gen(old)`. Nx would then read that part as a glob (`partition_glob` in Nx's `native/glob/glob_transform.rs`) and match other files, or none. The filesets that nxr-1by7h4 adds for project folders already escape the folder with a backslash, as the build input check does for the lines it prints.

- [ ] Show with a test that a pattern through a link to a folder whose name has `[`, `{` or `(` misses its files in the key today
- [ ] Escape the real path as the folder filesets do, and check that Nx 24 reads the escaped path as literal
- [ ] Note it in `DES-INPUTS`

Done when: the test passes, `DES-INPUTS` says how the path is written, and `pnpm nx run-many -t build lint test` passes.
